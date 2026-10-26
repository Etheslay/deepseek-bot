/**
 * SQLite open + migration runner (docs/ARCHITECTURE.md §4).
 *
 * - WAL journal, foreign keys on, bounded busy timeout; a single Host process
 *   is the writer (ARCHITECTURE.md §4: 单 Host 写入).
 * - Migrations are ordered, checksummed and applied transactionally. A
 *   database written by a newer app version is rejected with
 *   DATA_VERSION_UNSUPPORTED instead of being silently misread.
 */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { dataVersionUnsupported, invalidInput, storageErrorFromFsError } from "./errors.js";

export type { DatabaseSync } from "node:sqlite";

export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
}

export interface OpenedDatabase {
  readonly raw: DatabaseSync;
  readonly file: string;
  readonly schemaVersion: number;
  readonly appliedMigrations: ReadonlyArray<{ id: number; name: string }>;
  /** Injectable clock for reproducible timestamps; defaults to the real one. */
  readonly now: () => Date;
  close(): void;
}

export interface OpenOptions {
  now?: () => Date;
  /** Run `PRAGMA quick_check` on open (used by restore verification). */
  verifyIntegrity?: boolean;
}

export interface MigrationDefinition {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
}

export function checksumMigration(migration: MigrationDefinition): string {
  return createHash("sha256").update(migration.sql, "utf8").digest("hex");
}

export function openDatabase(file: string, options: OpenOptions = {}): OpenedDatabase {
  if (file === "") {
    throw invalidInput("database file path must not be empty");
  }
  let raw: DatabaseSync;
  try {
    raw = new DatabaseSync(file);
  } catch (error) {
    throw storageErrorFromFsError(error, `opening ${file}`);
  }
  try {
    raw.exec("PRAGMA journal_mode = WAL;");
    raw.exec("PRAGMA foreign_keys = ON;");
    raw.exec("PRAGMA busy_timeout = 5000;");
    raw.exec("PRAGMA synchronous = NORMAL;");
    if (options.verifyIntegrity === true) {
      const row = raw.prepare("PRAGMA quick_check;").get() as
        | { quick_check: string }
        | undefined;
      if (row === undefined || row.quick_check !== "ok") {
        throw invalidInput("database integrity check failed", {
          result: row?.quick_check ?? "no result",
        });
      }
    }
    const applied = migrate(raw, MIGRATIONS);
    return {
      raw,
      file,
      schemaVersion: applied.currentVersion,
      appliedMigrations: applied.rows.map((row) => ({ id: row.id, name: row.name })),
      now: options.now ?? (() => new Date()),
      close: () => {
        raw.close();
      },
    };
  } catch (error) {
    raw.close();
    throw error;
  }
}

interface AppliedRow {
  id: number;
  name: string;
  checksum: string;
}

function migrate(
  raw: DatabaseSync,
  migrations: ReadonlyArray<MigrationDefinition>,
): { currentVersion: number; rows: AppliedRow[] } {
  raw.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (" +
      "id INTEGER PRIMARY KEY, " +
      "name TEXT NOT NULL UNIQUE, " +
      "checksum TEXT NOT NULL, " +
      "applied_at TEXT NOT NULL);",
  );

  const applied = readAppliedMigrations(raw);

  for (const row of applied) {
    const known = migrations.find((migration) => migration.id === row.id);
    if (known === undefined) {
      throw dataVersionUnsupported(
        "database contains migrations from a newer application version",
        { appliedMigrationId: row.id },
      );
    }
    if (known.name !== row.name || checksumMigration(known) !== row.checksum) {
      throw dataVersionUnsupported("migration checksum mismatch", {
        migrationId: row.id,
      });
    }
  }

  for (const migration of migrations) {
    if (applied.some((row) => row.id === migration.id)) {
      continue;
    }
    applyMigration(raw, migration);
  }

  const rows = readAppliedMigrations(raw);
  const currentVersion = rows.reduce((max, row) => Math.max(max, row.id), 0);
  return { currentVersion, rows };
}

function readAppliedMigrations(raw: DatabaseSync): AppliedRow[] {
  return raw
    .prepare("SELECT id, name, checksum FROM schema_migrations ORDER BY id ASC;")
    .all() as unknown as AppliedRow[];
}

function applyMigration(raw: DatabaseSync, migration: MigrationDefinition): void {
  raw.exec("BEGIN IMMEDIATE;");
  try {
    raw.exec(migration.sql);
    raw
      .prepare(
        "INSERT INTO schema_migrations (id, name, checksum, applied_at) VALUES (?, ?, ?, ?);",
      )
      .run(
        migration.id,
        migration.name,
        checksumMigration(migration),
        new Date().toISOString(),
      );
    raw.exec("COMMIT;");
  } catch (error) {
    try {
      raw.exec("ROLLBACK;");
    } catch {
      // Rollback of a failed transaction may itself fail; surface the cause.
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Schema v1 — the contract v0.1 entities (docs/CONTRACTS.md §2).
//
// Structured payloads (grants, nodes/edges, snapshots, trigger, event
// payloads) are JSON columns; every read/write path parses them through the
// contract schemas, so the shapes stay validated at runtime.
// `tool_policy_id` referenced the tool_policies table added in migration
// 0002 (D08); bots keep storing the plain id until then (checked by the
// repos, not by a foreign key).
// ---------------------------------------------------------------------------

const INITIAL_SCHEMA_SQL = /* sql */ `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE credentials (
  ref TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE model_profiles (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider = 'deepseek'),
  model TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  credential_ref TEXT NOT NULL REFERENCES credentials(ref),
  limits_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  canonical_path TEXT NOT NULL,
  grants_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE bots (
  id TEXT PRIMARY KEY,
  revision TEXT NOT NULL,
  name TEXT NOT NULL,
  instructions TEXT NOT NULL,
  model_profile_id TEXT NOT NULL REFERENCES model_profiles(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  tool_policy_id TEXT NOT NULL,
  archived_at TEXT,
  created_request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX bots_created_request_id
  ON bots(created_request_id) WHERE created_request_id IS NOT NULL;

CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  revision TEXT NOT NULL,
  name TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  nodes_json TEXT NOT NULL,
  edges_json TEXT NOT NULL,
  limits_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  timezone TEXT NOT NULL,
  recurrence TEXT NOT NULL,
  next_run_at TEXT,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  misfire_policy TEXT NOT NULL CHECK (misfire_policy = 'skip-and-notify'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN (
    'queued', 'running', 'waiting_approval', 'cancelling',
    'succeeded', 'failed', 'cancelled', 'interrupted')),
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('manual', 'schedule')),
  trigger_schedule_id TEXT,
  trigger_occurrence_utc TEXT,
  trigger_json TEXT NOT NULL,
  workflow_snapshot_json TEXT NOT NULL,
  bot_snapshots_json TEXT NOT NULL,
  resumed_from_run_id TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE UNIQUE INDEX runs_idempotency_key ON runs(idempotency_key);
CREATE UNIQUE INDEX runs_schedule_occurrence
  ON runs(trigger_schedule_id, trigger_occurrence_utc)
  WHERE trigger_kind = 'schedule';
CREATE INDEX runs_status ON runs(status);

CREATE TABLE node_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  node_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'running', 'waiting_approval',
    'succeeded', 'failed', 'cancelled', 'interrupted', 'skipped')),
  input_refs_json TEXT NOT NULL,
  output_refs_json TEXT NOT NULL,
  session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX node_runs_attempt ON node_runs(run_id, node_id, attempt);
CREATE INDEX node_runs_run ON node_runs(run_id);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  node_run_id TEXT NOT NULL REFERENCES node_runs(id),
  action_digest TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'approved', 'denied', 'expired', 'consumed')),
  consumed_at TEXT,
  generation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX approvals_run ON approvals(run_id);
CREATE INDEX approvals_pending ON approvals(status) WHERE status = 'pending';

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  node_run_id TEXT NOT NULL REFERENCES node_runs(id),
  relative_path TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  checksum_algorithm TEXT NOT NULL CHECK (checksum_algorithm = 'sha256'),
  checksum_value TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX artifacts_run ON artifacts(run_id);
CREATE INDEX artifacts_node_run ON artifacts(node_run_id);

CREATE TABLE events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  timestamp TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE (run_id, sequence)
);
CREATE INDEX events_run_sequence ON events(run_id, sequence);
`;

export const MIGRATIONS: ReadonlyArray<MigrationDefinition> = [
  {
    id: 1,
    name: "0001-initial",
    sql: INITIAL_SCHEMA_SQL,
  },
  {
    id: 2,
    name: "0002-tool-policies",
    sql: /* sql */ `
CREATE TABLE tool_policies (
  id TEXT PRIMARY KEY,
  revision TEXT NOT NULL,
  name TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
  {
    // D10 (FR-08): missed schedule occurrences stay visible
    // (skip-and-notify, QA-10) and resumed runs rehydrate the node outputs
    // of work that already completed before the restart.
    id: 3,
    name: "0003-schedule-misses-node-outputs",
    sql: /* sql */ `
CREATE TABLE schedule_misses (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  occurrence_utc TEXT NOT NULL,
  reason TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  UNIQUE (schedule_id, occurrence_utc)
);
CREATE INDEX schedule_misses_schedule ON schedule_misses(schedule_id, detected_at);

ALTER TABLE node_runs ADD COLUMN outputs_json TEXT;
`,
  },
  {
    // D15 write layer (FR-12): bot groups, per-bot avatar/group columns and
    // the batch ledger behind creation.revoke (整批撤销). Existing bots keep
    // NULL avatar/group columns — consumers fall back to their own
    // derivation, exactly like pre-v0.2 run snapshots without the keys.
    id: 4,
    name: "0004-creation-batches",
    sql: /* sql */ `
CREATE TABLE bot_groups (
  id TEXT PRIMARY KEY,
  revision TEXT NOT NULL,
  name TEXT NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE bots ADD COLUMN avatar_shape TEXT;
ALTER TABLE bots ADD COLUMN avatar_color TEXT;
ALTER TABLE bots ADD COLUMN group_id TEXT;

CREATE TABLE creation_batches (
  id TEXT PRIMARY KEY,
  group_id TEXT,
  created_group_id TEXT,
  bot_ids_json TEXT NOT NULL,
  request_id TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE UNIQUE INDEX creation_batches_request_id
  ON creation_batches(request_id) WHERE request_id IS NOT NULL;
`,
  },
  {
    id: 5,
    name: "0005-chat-messages",
    sql: /* sql */ `
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id),
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX chat_messages_bot_created ON chat_messages(bot_id, created_at);
`,
  },
  {
    id: 6,
    name: "0006-grants",
    sql: /* sql */ `
CREATE TABLE grants (
  id TEXT PRIMARY KEY,
  capability TEXT NOT NULL,
  bot_id TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('once', 'session', 'persistent')),
  max_uses INTEGER NOT NULL DEFAULT 1,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX grants_lookup ON grants(capability, bot_id, revoked_at, expires_at);
`,
  },
  {
    id: 7,
    name: "0007-permissions-grants",
    sql: /* sql */ `
CREATE TABLE permission_grants (
  id TEXT PRIMARY KEY,
  capability TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('policy', 'once', 'session', 'permanent')),
  bot_id TEXT REFERENCES bots(id),
  payload_json TEXT NOT NULL
);
CREATE UNIQUE INDEX permission_policy_capability ON permission_grants(capability) WHERE scope = 'policy';
CREATE INDEX permission_grants_bot ON permission_grants(bot_id);
CREATE TABLE app_approvals (
  id TEXT PRIMARY KEY,
  invocation_id TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL
);
CREATE TABLE permission_authorizations (
  invocation_id TEXT PRIMARY KEY,
  call_json TEXT NOT NULL,
  authorization_json TEXT NOT NULL
);
CREATE TABLE permission_audit (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL
);
CREATE TRIGGER permission_audit_no_update BEFORE UPDATE ON permission_audit
BEGIN SELECT RAISE(ABORT, 'permission audit is append-only'); END;
CREATE TRIGGER permission_audit_no_delete BEFORE DELETE ON permission_audit
BEGIN SELECT RAISE(ABORT, 'permission audit is append-only'); END;
`,
  },
  {
    id: 8,
    name: "0008-memories",
    sql: /* sql */ `
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX memories_bot_created ON memories(bot_id, created_at);
`,
  },
  {
    id: 9,
    name: "0009-connectors",
    sql: /* sql */ `
CREATE TABLE connectors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  credential_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX connectors_created ON connectors(created_at);
`,
  },
  {
    // D18 (独立知识表): long-form per-bot knowledge documents, separate from
    // the 4k memory notes. Whole documents, no chunk table — retrieval
    // windows and their vectors are computed at query time.
    id: 10,
    name: "0010-knowledge-docs",
    sql: /* sql */ `
CREATE TABLE knowledge_docs (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id),
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX knowledge_docs_bot_created ON knowledge_docs(bot_id, created_at);
`,
  },
  {
    // D20 (FR-17): event trigger rules and their review-queue firings. A
    // firing is unique per (rule, source event) — one event fires a rule
    // once; started_run_id carries the loop guard (runs the queue started
    // never enqueue new firings). NOTE: feature/connector-invoke carries a
    // 0011-connectors-endpoint migration; whichever branch merges first
    // owns id 11 and the other renumbers before merging.
    id: 11,
    name: "0011-automation-triggers",
    sql: /* sql */ `
CREATE TABLE trigger_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('run.failed', 'run.completed')),
  filter_workflow_id TEXT,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  cursor_event_rowid INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE trigger_firings (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES trigger_rules(id) ON DELETE CASCADE,
  source_event_id TEXT NOT NULL,
  source_run_id TEXT,
  source_workflow_id TEXT,
  reason TEXT NOT NULL CHECK (reason IN ('event', 'missed')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'dismissed')),
  started_run_id TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  UNIQUE (rule_id, source_event_id)
);
CREATE INDEX trigger_firings_status ON trigger_firings(status, created_at);
`,
  },
];

