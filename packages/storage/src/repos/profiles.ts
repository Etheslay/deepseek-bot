/**
 * Model profile and workspace repositories (CONTRACTS.md §2).
 *
 * Neither entity carries a contract revision field in v0.1, so updates are
 * last-write-wins with fresh `updated_at`; the API surface for
 * revision-guarded profile updates can be added with a contract bump.
 */
import {
  ModelProfileSchema,
  WorkspaceSchema,
  type ModelProfile,
  type Workspace,
} from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "../database.js";
import { invalidInput } from "../errors.js";
import {
  constraintError,
  isoNow,
  parseJsonColumn,
  stringifyJson,
} from "./shared.js";

interface ProfileRow {
  id: string;
  provider: string;
  model: string;
  endpoint: string;
  credential_ref: string;
  limits_json: string;
  created_at: string;
}

function rowToProfile(row: ProfileRow): ModelProfile {
  return ModelProfileSchema.parse({
    id: row.id,
    provider: row.provider,
    model: row.model,
    endpoint: row.endpoint,
    credentialRef: row.credential_ref,
    limits: parseJsonColumn(
      ModelProfileSchema.shape.limits,
      row.limits_json,
      "model profile limits",
    ),
  });
}

export interface CreateProfileResult {
  readonly profile: ModelProfile;
  readonly created: boolean;
}

export function createModelProfile(
  db: OpenedDatabase,
  profile: ModelProfile,
): CreateProfileResult {
  const parsed = ModelProfileSchema.parse(profile);
  const existing = db.raw
    .prepare("SELECT * FROM model_profiles WHERE id = ?;")
    .get(parsed.id) as ProfileRow | undefined;
  if (existing !== undefined) {
    return { profile: rowToProfile(existing), created: false };
  }
  // The credential registry row must exist before a profile references it.
  const credential = db.raw
    .prepare("SELECT ref FROM credentials WHERE ref = ?;")
    .get(parsed.credentialRef);
  if (credential === undefined) {
    throw invalidInput("credential ref is not registered", {
      credentialRef: parsed.credentialRef,
    });
  }
  const now = isoNow(db.now);
  try {
    db.raw
      .prepare(
        "INSERT INTO model_profiles (id, provider, model, endpoint, credential_ref, " +
          "limits_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);",
      )
      .run(
        parsed.id,
        parsed.provider,
        parsed.model,
        parsed.endpoint,
        parsed.credentialRef,
        stringifyJson(parsed.limits),
        now,
        now,
      );
  } catch (error) {
    constraintError(error, "create model profile");
  }
  return { profile: parsed, created: true };
}

export function getModelProfile(
  db: OpenedDatabase,
  id: string,
): ModelProfile | undefined {
  const row = db.raw
    .prepare("SELECT * FROM model_profiles WHERE id = ?;")
    .get(id) as ProfileRow | undefined;
  return row === undefined ? undefined : rowToProfile(row);
}

export function listModelProfiles(db: OpenedDatabase): ModelProfile[] {
  const rows = db.raw
    .prepare("SELECT * FROM model_profiles ORDER BY created_at ASC, id ASC;")
    .all() as unknown as ProfileRow[];
  return rows.map(rowToProfile);
}

export function updateModelProfile(
  db: OpenedDatabase,
  input: {
    id: string;
    patch: Partial<Pick<ModelProfile, "model" | "endpoint" | "limits">>;
  },
): ModelProfile {
  const row = db.raw
    .prepare("SELECT * FROM model_profiles WHERE id = ?;")
    .get(input.id) as ProfileRow | undefined;
  if (row === undefined) {
    throw invalidInput("model profile not found", { modelProfileId: input.id });
  }
  const merged = ModelProfileSchema.parse({
    id: row.id,
    provider: row.provider,
    model: input.patch.model ?? row.model,
    endpoint: input.patch.endpoint ?? row.endpoint,
    credentialRef: row.credential_ref,
    limits: input.patch.limits ??
      parseJsonColumn(ModelProfileSchema.shape.limits, row.limits_json, "model profile limits"),
  });
  db.raw
    .prepare(
      "UPDATE model_profiles SET model = ?, endpoint = ?, limits_json = ?, updated_at = ? WHERE id = ?;",
    )
    .run(merged.model, merged.endpoint, stringifyJson(merged.limits), isoNow(db.now), input.id);
  return merged;
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

interface WorkspaceRow {
  id: string;
  canonical_path: string;
  grants_json: string;
  created_at: string;
}

function rowToWorkspace(row: WorkspaceRow): Workspace {
  return WorkspaceSchema.parse({
    id: row.id,
    canonicalPath: row.canonical_path,
    grants: parseJsonColumn(
      WorkspaceSchema.shape.grants,
      row.grants_json,
      "workspace grants",
    ),
  });
}

export interface CreateWorkspaceResult {
  readonly workspace: Workspace;
  readonly created: boolean;
}

export function createWorkspace(
  db: OpenedDatabase,
  workspace: Workspace,
): CreateWorkspaceResult {
  const parsed = WorkspaceSchema.parse(workspace);
  const existing = db.raw
    .prepare("SELECT * FROM workspaces WHERE id = ?;")
    .get(parsed.id) as WorkspaceRow | undefined;
  if (existing !== undefined) {
    return { workspace: rowToWorkspace(existing), created: false };
  }
  const now = isoNow(db.now);
  try {
    db.raw
      .prepare(
        "INSERT INTO workspaces (id, canonical_path, grants_json, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?);",
      )
      .run(parsed.id, parsed.canonicalPath, stringifyJson(parsed.grants), now, now);
  } catch (error) {
    constraintError(error, "create workspace");
  }
  return { workspace: parsed, created: true };
}

export function getWorkspace(db: OpenedDatabase, id: string): Workspace | undefined {
  const row = db.raw
    .prepare("SELECT * FROM workspaces WHERE id = ?;")
    .get(id) as WorkspaceRow | undefined;
  return row === undefined ? undefined : rowToWorkspace(row);
}

export function listWorkspaces(db: OpenedDatabase): Workspace[] {
  const rows = db.raw
    .prepare("SELECT * FROM workspaces ORDER BY created_at ASC, id ASC;")
    .all() as unknown as WorkspaceRow[];
  return rows.map(rowToWorkspace);
}

export function updateWorkspaceGrants(
  db: OpenedDatabase,
  input: { id: string; grants: Workspace["grants"] },
): Workspace {
  const row = db.raw
    .prepare("SELECT * FROM workspaces WHERE id = ?;")
    .get(input.id) as WorkspaceRow | undefined;
  if (row === undefined) {
    throw invalidInput("workspace not found", { workspaceId: input.id });
  }
  const merged = WorkspaceSchema.parse({
    id: row.id,
    canonicalPath: row.canonical_path,
    grants: input.grants,
  });
  db.raw
    .prepare("UPDATE workspaces SET grants_json = ?, updated_at = ? WHERE id = ?;")
    .run(stringifyJson(merged.grants), isoNow(db.now), input.id);
  return merged;
}
