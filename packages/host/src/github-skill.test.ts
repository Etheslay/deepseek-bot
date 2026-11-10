import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "@deepseek-bot/storage";
import { WritePresentationInputSchema } from "@deepseek-bot/agent-tools";
import { findGithubPptSkill, readSavedPptSkill, savePptSkill } from "./github-skill.js";
import { renderPptxScript } from "./presentation-script.js";
import { extractPptxBody } from "./attachment-parse.js";

const SKILL = `---
name: pptx-generator
---
# PPTX
Create a presentation with pptxgenjs. Save a .pptx file.
`;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function githubFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/search/repositories")) {
      return jsonResponse({
        items: [{ full_name: "example/pptx-skill", default_branch: "main" }],
      });
    }
    if (url.includes("/git/trees/")) {
      return jsonResponse({ tree: [{ path: "skills/pptx/SKILL.md" }] });
    }
    if (url.includes("skills/pptx/SKILL.md")) return new Response(SKILL, { status: 200 });
    return new Response("missing", { status: 404 });
  }) as typeof fetch;
}

describe("find_github_skill", () => {
  it("returns a PowerPoint skill found on GitHub", async () => {
    const found = await findGithubPptSkill({ query: "powerpoint", fetch: githubFetch() });
    expect(found.name).toBe("pptx-generator");
    expect(found.url).toContain("example/pptx-skill");
    expect(found.instructions).toContain("pptxgenjs");
    expect(found.cached).toBeUndefined();
  });

  it("reads the saved skill and does not contact GitHub again", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsb-ppt-skill-"));
    const db = openDatabase(join(root, "app.sqlite"));
    try {
      await findGithubPptSkill({
        query: "powerpoint",
        fetch: githubFetch(),
        save: (skill) => savePptSkill(db, skill),
      });
      let calls = 0;
      const again = await findGithubPptSkill({
        query: "another deck",
        fetch: (() => {
          calls += 1;
          throw new Error("network");
        }) as typeof fetch,
        load: () => readSavedPptSkill(db),
      });
      expect(calls).toBe(0);
      expect(again.cached).toBe(true);
      expect(again.name).toBe("pptx-generator");
      expect(again.instructions).toContain("pptxgenjs");
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a hand-written slide list and accepts a script", () => {
    expect(WritePresentationInputSchema.safeParse({
      path: "attachments/deck.pptx",
      slides: [{ title: "手写" }],
    }).success).toBe(false);
    expect(WritePresentationInputSchema.safeParse({
      path: "attachments/deck.pptx",
      script: "const slide = pres.addSlide(); slide.addText('封面', { x: 0.6, y: 2, w: 12, h: 1 });",
    }).success).toBe(true);
  });
});

describe("pptxgenjs script", () => {
  it("draws the script onto a deck and refuses imports", async () => {
    const bytes = await renderPptxScript(
      "const slide = pres.addSlide(); slide.addText('技能封面', { x: 0.6, y: 2, w: 12, h: 1, fontSize: 32 });",
    );
    expect(extractPptxBody(bytes).text).toContain("技能封面");
    await expect(renderPptxScript(
      "require('fs'); const slide = pres.addSlide(); slide.addText('no', { x: 0.5, y: 1, w: 4, h: 1 });",
    )).rejects.toThrow(/pres/);
  });
});
