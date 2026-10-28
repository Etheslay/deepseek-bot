/**
 * Workflow templates (G11'): the user can save the current editor draft as a
 * reusable local template and apply one back onto the canvas as a new draft.
 * Storage is localStorage — the same renderer-first shelf as bot templates
 * and the skill library; host-side persistence waits for the Renderer→Host
 * 拍板. Templates are inert data: applying one only loads a draft, and the
 * bot nodes keep no policy of their own — every node's tool authorization
 * comes from the referenced bot's CURRENT toolPolicyId at run time. Entries
 * are re-parsed through the frozen WorkflowDraftSchema on read, so a
 * hand-edited shelf entry (or a smuggled extra field) cannot resurrect
 * anything the contract strips.
 */
import { WorkflowDraftSchema, type WorkflowDraft } from "@deepseek-bot/contracts";

export type WorkflowTemplate = {
  id: string;
  name: string;
  createdAt: string;
  /** Draft without id/revision — applying must never inherit an identity. */
  workflow: WorkflowDraft;
};

const STORAGE_KEY = "deepseek-bot.workflow-templates.v1";
export const MAX_WORKFLOW_TEMPLATES = 30;

/** Parse one shelf entry; drop anything the frozen draft schema rejects. */
function toTemplate(item: unknown): WorkflowTemplate | null {
  if (typeof item !== "object" || item === null) {
    return null;
  }
  const candidate = item as { id?: unknown; name?: unknown; createdAt?: unknown; workflow?: unknown };
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.createdAt !== "string"
  ) {
    return null;
  }
  const parsed = WorkflowDraftSchema.safeParse(candidate.workflow);
  if (!parsed.success) {
    return null;
  }
  const { id: _id, revision: _revision, ...workflow } = parsed.data;
  return { id: candidate.id, name: candidate.name, createdAt: candidate.createdAt, workflow };
}

export function listWorkflowTemplates(storage: Storage): WorkflowTemplate[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(toTemplate).filter((item): item is WorkflowTemplate => item !== null);
  } catch {
    return [];
  }
}

export function saveWorkflowTemplate(
  storage: Storage,
  template: { name: string; workflow: WorkflowDraft },
): { ok: true; template: WorkflowTemplate } | { ok: false; reason: "limit" | "duplicate" | "invalid" } {
  // 校验照走: only a contract-valid draft may become a template, and the
  // stored copy is the schema-normalized draft — unknown fields (a tampered
  // node carrying toolPolicyId, permissions, …) are stripped here, not
  // trusted.
  const parsed = WorkflowDraftSchema.safeParse(template.workflow);
  if (!parsed.success) {
    return { ok: false, reason: "invalid" };
  }
  const existing = listWorkflowTemplates(storage);
  if (existing.length >= MAX_WORKFLOW_TEMPLATES) {
    return { ok: false, reason: "limit" };
  }
  if (existing.some((item) => item.name === template.name)) {
    return { ok: false, reason: "duplicate" };
  }
  const { id: _id, revision: _revision, ...workflow } = parsed.data;
  const full: WorkflowTemplate = {
    id: `wtpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: template.name,
    createdAt: new Date().toISOString(),
    workflow,
  };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify([...existing, full]));
  } catch {
    return { ok: false, reason: "limit" };
  }
  return { ok: true, template: full };
}

export function deleteWorkflowTemplate(storage: Storage, id: string): WorkflowTemplate[] {
  const next = listWorkflowTemplates(storage).filter((item) => item.id !== id);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // deletion at least reflected in the returned list this session
  }
  return next;
}
