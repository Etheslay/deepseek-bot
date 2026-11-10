/**
 * Find a PowerPoint skill on GitHub, then keep it.
 *
 * The first call searches. Later calls read the saved copy and do not use
 * the network. The body is untrusted instructions for the model, not code
 * this process runs.
 */
import { getSettingRaw, setSetting, type OpenedDatabase } from "@deepseek-bot/storage";

export interface FoundGithubSkill {
  readonly name: string;
  readonly url: string;
  readonly instructions: string;
  readonly cached?: boolean;
}

const PPT_SKILL_SETTING = "skills.github.pptx.v1";

const FALLBACKS = [
  "https://raw.githubusercontent.com/MiniMax-AI/skills/main/skills/pptx-generator/SKILL.md",
  "https://raw.githubusercontent.com/kolega-ai/kolega-skills/main/skills/pptx/SKILL.md",
];

let memory: FoundGithubSkill | undefined;

function usable(skill: FoundGithubSkill | undefined): skill is FoundGithubSkill {
  return (
    skill !== undefined &&
    skill.name.trim().length > 0 &&
    skill.url.startsWith("https://") &&
    skill.instructions.trim().length >= 40 &&
    /pptx|powerpoint|presentation/i.test(skill.instructions)
  );
}

/** The skill saved after the first successful search, if it is still readable. */
export function readSavedPptSkill(db: OpenedDatabase): FoundGithubSkill | undefined {
  const raw = getSettingRaw(db, PPT_SKILL_SETTING);
  if (raw === null || typeof raw !== "object") return undefined;
  const record = raw as { name?: unknown; url?: unknown; instructions?: unknown };
  const skill = {
    name: typeof record.name === "string" ? record.name : "",
    url: typeof record.url === "string" ? record.url : "",
    instructions: typeof record.instructions === "string" ? record.instructions : "",
  };
  return usable(skill) ? skill : undefined;
}

/** Remember the skill so the next deck does not search GitHub again. */
export function savePptSkill(db: OpenedDatabase, skill: FoundGithubSkill): void {
  setSetting(db, PPT_SKILL_SETTING, {
    name: skill.name,
    url: skill.url,
    instructions: skill.instructions,
  });
}

interface RepoHit {
  readonly fullName: string;
  readonly branch: string;
}

function score(text: string): number {
  const body = text.toLowerCase();
  let value = 0;
  if (body.includes("pptxgenjs")) value += 6;
  if (body.includes("python-pptx")) value += 4;
  if (body.includes(".pptx") || body.includes("powerpoint")) value += 3;
  if (body.includes("presentation") || body.includes("slides")) value += 1;
  if (body.includes("reveal.js") && !body.includes("pptxgenjs") && !body.includes("python-pptx")) value -= 4;
  return value;
}

function skillName(text: string, url: string): string {
  const match = /^---[\s\S]*?\nname:\s*([^\n]+)/.exec(text);
  const named = match?.[1]?.trim();
  if (named !== undefined && named.length > 0 && named.length <= 80) return named;
  const repo = /github\.com\/([^/]+\/[^/]+)/.exec(url)?.[1] ?? "pptx";
  return repo;
}

async function readText(fetchImpl: typeof fetch, url: string, signal: AbortSignal): Promise<string | undefined> {
  const response = await fetchImpl(url, {
    signal,
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "deepseek-bot",
    },
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  const text = await response.text();
  if (text.length > 1_000_000) return undefined;
  return text;
}

async function searchRepos(fetchImpl: typeof fetch, query: string, signal: AbortSignal): Promise<RepoHit[]> {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=5`;
  const text = await readText(fetchImpl, url, signal);
  if (text === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return [];
  }
  const items = (parsed as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const repos: RepoHit[] = [];
  for (const item of items) {
    if (repos.length >= 4) break;
    if (item === null || typeof item !== "object") continue;
    const fullName = (item as { full_name?: unknown }).full_name;
    const branch = (item as { default_branch?: unknown }).default_branch;
    if (typeof fullName !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(fullName)) continue;
    repos.push({
      fullName,
      branch: typeof branch === "string" && branch.length > 0 ? branch : "main",
    });
  }
  return repos;
}

async function skillPaths(fetchImpl: typeof fetch, repo: RepoHit, signal: AbortSignal): Promise<string[]> {
  const text = await readText(
    fetchImpl,
    `https://api.github.com/repos/${repo.fullName}/git/trees/${encodeURIComponent(repo.branch)}?recursive=1`,
    signal,
  );
  if (text === undefined) return ["SKILL.md"];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return ["SKILL.md"];
  }
  const tree = (parsed as { tree?: unknown }).tree;
  if (!Array.isArray(tree)) return ["SKILL.md"];
  const paths = tree
    .map((entry) => (entry !== null && typeof entry === "object" ? (entry as { path?: unknown }).path : undefined))
    .filter((path): path is string => typeof path === "string" && path.endsWith("SKILL.md") && !path.includes(".."));
  paths.sort((left, right) => Number(/pptx|powerpoint|slide/i.test(right)) - Number(/pptx|powerpoint|slide/i.test(left)));
  return paths.slice(0, 3);
}

/** Search GitHub and return the PowerPoint skill with the strongest match. */
export async function findGithubPptSkill(options?: {
  readonly query?: string;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly load?: () => FoundGithubSkill | undefined;
  readonly save?: (skill: FoundGithubSkill) => void;
}): Promise<FoundGithubSkill> {
  const saved = options?.load?.() ?? (options?.fetch === undefined ? memory : undefined);
  if (usable(saved)) return { ...saved, cached: true };
  const query = (options?.query?.trim() || "powerpoint pptx presentation").slice(0, 120);
  const fetchImpl = options?.fetch ?? fetch;
  const signal = options?.signal ?? AbortSignal.timeout(20_000);
  const repos = [
    ...(await searchRepos(fetchImpl, `${query} skill`, signal)),
    ...(await searchRepos(fetchImpl, "pptxgenjs powerpoint skill", signal)),
  ];
  const seen = new Set<string>();
  const candidates: Array<{ readonly url: string; readonly text: string }> = [];
  for (const repo of repos) {
    if (seen.has(repo.fullName)) continue;
    seen.add(repo.fullName);
    if (seen.size > 4) break;
    for (const path of await skillPaths(fetchImpl, repo, signal)) {
      const raw = `https://raw.githubusercontent.com/${repo.fullName}/${repo.branch}/${path.split("/").map(encodeURIComponent).join("/")}`;
      const text = await readText(fetchImpl, raw, signal);
      if (text !== undefined && score(text) >= 3) candidates.push({ url: raw, text });
    }
  }
  for (const url of FALLBACKS) {
    const text = await readText(fetchImpl, url, signal);
    if (text !== undefined && score(text) >= 3) candidates.push({ url, text });
  }
  candidates.sort((left, right) => score(right.text) - score(left.text));
  const best = candidates[0];
  if (best === undefined) {
    throw new Error("GitHub 上没有找到可用的演示文稿技能");
  }
  const skill: FoundGithubSkill = {
    name: skillName(best.text, best.url),
    url: best.url,
    instructions: best.text.length > 7_000 ? `${best.text.slice(0, 7_000)}\n…` : best.text,
  };
  options?.save?.(skill);
  if (options?.fetch === undefined) memory = skill;
  return skill;
}
