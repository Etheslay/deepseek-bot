/**
 * Workflow repository (CONTRACTS.md §2 Workflow / §3 workflow.save).
 *
 * Saving validates the draft end-to-end through the contracts graph validator
 * (cycles, dangling edges, missing bindings) before any write. Updates are
 * revision-guarded like bots.
 */
import { randomUUID } from "node:crypto";
import {
  validateWorkflowDraft,
  WorkflowSchema,
  type Workflow,
  type WorkflowDraft,
} from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "../database.js";
import { invalidInput, StorageError } from "../errors.js";
import {
  isoNow,
  parseJsonColumn,
  stringifyJson,
} from "./shared.js";

interface WorkflowRow {
  id: string;
  revision: string;
  name: string;
  schema_version: string;
  nodes_json: string;
  edges_json: string;
  limits_json: string;
  created_at: string;
}

function rowToWorkflow(row: WorkflowRow): Workflow {
  return WorkflowSchema.parse({
    id: row.id,
    revision: row.revision,
    name: row.name,
    schemaVersion: row.schema_version,
    nodes: parseJsonColumn(WorkflowSchema.shape.nodes, row.nodes_json, "workflow nodes"),
    edges: parseJsonColumn(WorkflowSchema.shape.edges, row.edges_json, "workflow edges"),
    limits: parseJsonColumn(WorkflowSchema.shape.limits, row.limits_json, "workflow limits"),
  });
}

export interface SaveWorkflowResult {
  readonly workflow: Workflow;
  readonly created: boolean;
}

/**
 * Create or revision-guard-update a workflow. `expectedRevision` is required
 * when the id already exists (CONTRACTS §1: 修改对象携带 expectedRevision).
 */
export function saveWorkflow(
  db: OpenedDatabase,
  draft: WorkflowDraft,
  options: { expectedRevision?: string } = {},
): SaveWorkflowResult {
  const issues = validateWorkflowDraft(draft);
  if (issues.length > 0) {
    throw invalidInput("workflow graph validation failed", {
      issues: issues.map((issue) => ({
        code: issue.code,
        nodeId: issue.nodeId ?? null,
        field: issue.field ?? null,
        message: issue.message,
      })),
    });
  }
  const parsed = WorkflowSchema.parse({
    id: draft.id ?? randomUUID(),
    revision: draft.revision ?? randomUUID(),
    name: draft.name,
    schemaVersion: draft.schemaVersion,
    nodes: draft.nodes,
    edges: draft.edges,
    limits: draft.limits,
  });

  const existing = db.raw
    .prepare("SELECT * FROM workflows WHERE id = ?;")
    .get(parsed.id) as unknown as WorkflowRow | undefined;

  const expectedRevision = options.expectedRevision;
  if (existing !== undefined) {
    // CONTRACTS §1: modification requests carry expectedRevision; without it
    // the update is rejected instead of silently overwriting.
    if (expectedRevision === undefined) {
      throw invalidInput("expectedRevision is required to update an existing workflow", {
        workflowId: parsed.id,
        currentRevision: existing.revision,
      });
    }
    if (existing.revision !== expectedRevision) {
      throw new StorageError({
        code: "REVISION_CONFLICT",
        message: "workflow was modified by someone else",
        details: { workflowId: parsed.id, currentRevision: existing.revision },
        retryable: false,
      });
    }
    const nextRevision = randomUUID();
    db.raw
      .prepare(
        "UPDATE workflows SET revision = ?, name = ?, schema_version = ?, nodes_json = ?, " +
          "edges_json = ?, limits_json = ?, updated_at = ? WHERE id = ? AND revision = ?;",
      )
      .run(
        nextRevision,
        parsed.name,
        parsed.schemaVersion,
        stringifyJson(parsed.nodes),
        stringifyJson(parsed.edges),
        stringifyJson(parsed.limits),
        isoNow(db.now),
        parsed.id,
        existing.revision,
      );
    const updated = db.raw
      .prepare("SELECT * FROM workflows WHERE id = ?;")
      .get(parsed.id) as unknown as WorkflowRow;
    return { workflow: rowToWorkflow(updated), created: false };
  }

  const now = isoNow(db.now);
  try {
    db.raw
      .prepare(
        "INSERT INTO workflows (id, revision, name, schema_version, nodes_json, " +
          "edges_json, limits_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
      )
      .run(
        parsed.id,
        parsed.revision,
        parsed.name,
        parsed.schemaVersion,
        stringifyJson(parsed.nodes),
        stringifyJson(parsed.edges),
        stringifyJson(parsed.limits),
        now,
        now,
      );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE constraint failed")) {
      throw invalidInput("workflow id already exists", { workflowId: parsed.id });
    }
    throw error;
  }
  return { workflow: parsed, created: true };
}

export function getWorkflow(db: OpenedDatabase, id: string): Workflow | undefined {
  const row = db.raw
    .prepare("SELECT * FROM workflows WHERE id = ?;")
    .get(id) as WorkflowRow | undefined;
  return row === undefined ? undefined : rowToWorkflow(row);
}

export function listWorkflows(db: OpenedDatabase): Workflow[] {
  const rows = db.raw
    .prepare("SELECT * FROM workflows ORDER BY created_at ASC, id ASC;")
    .all() as unknown as WorkflowRow[];
  return rows.map(rowToWorkflow);
}
