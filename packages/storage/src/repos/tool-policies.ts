/**
 * Tool policy repository (CONTRACTS.md §2 Bot.toolPolicyId, D08).
 *
 * The structured policy lives in a JSON column validated through the
 * contract schema on every read/write, mirroring the workspace grants
 * pattern. Updates are last-write-wins in v0.1: bots snapshot their bot
 * record at run start and the engine pins the resolved policy for the
 * whole run, so a policy edit never rewrites a running run's decisions.
 */
import {
  ToolPolicySchema,
  type ToolPolicy,
} from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "../database.js";
import { invalidInput } from "../errors.js";
import {
  constraintError,
  isoNow,
  parseJsonColumn,
  stringifyJson,
} from "./shared.js";

interface ToolPolicyRow {
  id: string;
  revision: string;
  name: string;
  policy_json: string;
  created_at: string;
  updated_at: string;
}

function rowToPolicy(row: ToolPolicyRow): ToolPolicy {
  return ToolPolicySchema.parse({
    id: row.id,
    revision: row.revision,
    name: row.name,
    ...parseJsonColumn(ToolPolicySchema.omit({ id: true, revision: true, name: true }), row.policy_json, "tool policy"),
  });
}

export interface CreateToolPolicyResult {
  readonly policy: ToolPolicy;
  readonly created: boolean;
}

export function createToolPolicy(
  db: OpenedDatabase,
  policy: ToolPolicy,
): CreateToolPolicyResult {
  const parsed = ToolPolicySchema.parse(policy);
  const existing = db.raw
    .prepare("SELECT * FROM tool_policies WHERE id = ?;")
    .get(parsed.id) as ToolPolicyRow | undefined;
  if (existing !== undefined) {
    return { policy: rowToPolicy(existing), created: false };
  }
  const now = isoNow(db.now);
  try {
    db.raw
      .prepare(
        "INSERT INTO tool_policies (id, revision, name, policy_json, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?);",
      )
      .run(
        parsed.id,
        parsed.revision,
        parsed.name,
        stringifyJson({
          filesystem: parsed.filesystem,
          shell: parsed.shell,
          network: parsed.network,
          mcp: parsed.mcp,
        }),
        now,
        now,
      );
  } catch (error) {
    constraintError(error, "create tool policy");
  }
  return { policy: parsed, created: true };
}

export function getToolPolicy(
  db: OpenedDatabase,
  id: string,
): ToolPolicy | undefined {
  const row = db.raw
    .prepare("SELECT * FROM tool_policies WHERE id = ?;")
    .get(id) as ToolPolicyRow | undefined;
  return row === undefined ? undefined : rowToPolicy(row);
}

export function listToolPolicies(db: OpenedDatabase): ToolPolicy[] {
  const rows = db.raw
    .prepare("SELECT * FROM tool_policies ORDER BY created_at ASC, id ASC;")
    .all() as unknown as ToolPolicyRow[];
  return rows.map(rowToPolicy);
}

export function updateToolPolicy(
  db: OpenedDatabase,
  input: {
    id: string;
    expectedRevision?: string;
    patch: Partial<Pick<ToolPolicy, "name" | "filesystem" | "shell" | "network" | "mcp">> & {
      revision?: string;
    };
  },
): ToolPolicy {
  const row = db.raw
    .prepare("SELECT * FROM tool_policies WHERE id = ?;")
    .get(input.id) as ToolPolicyRow | undefined;
  if (row === undefined) {
    throw invalidInput("tool policy not found", { toolPolicyId: input.id });
  }
  if (
    input.expectedRevision !== undefined &&
    input.expectedRevision !== row.revision
  ) {
    throw invalidInput("tool policy revision conflict", {
      toolPolicyId: input.id,
      expectedRevision: input.expectedRevision,
      currentRevision: row.revision,
    });
  }
  const current = rowToPolicy(row);
  const merged = ToolPolicySchema.parse({
    id: current.id,
    revision: input.patch.revision ?? current.revision,
    name: input.patch.name ?? current.name,
    filesystem: input.patch.filesystem ?? current.filesystem,
    shell: input.patch.shell ?? current.shell,
    network: input.patch.network ?? current.network,
    mcp: input.patch.mcp ?? current.mcp,
  });
  db.raw
    .prepare(
      "UPDATE tool_policies SET revision = ?, name = ?, policy_json = ?, updated_at = ? WHERE id = ?;",
    )
    .run(
      merged.revision,
      merged.name,
      stringifyJson({
        filesystem: merged.filesystem,
        shell: merged.shell,
        network: merged.network,
        mcp: merged.mcp,
      }),
      isoNow(db.now),
      input.id,
    );
  return merged;
}
