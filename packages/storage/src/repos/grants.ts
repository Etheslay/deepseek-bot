/**
 * Capability grants (D16, docs/PERMISSIONS.md §1/§6).
 *
 * A grant is a human-issued permission for one bot (or all bots when bot_id is
 * null) to use one capability within a scope. The gateway checkpoint consumes
 * grants; models can never create or revoke them.
 */
import { randomUUID } from "node:crypto";
import type { OpenedDatabase } from "../database.js";
import { isoNow } from "./shared.js";

export type GrantScope = "once" | "session" | "persistent";

export interface GrantRow {
  readonly id: string;
  readonly capability: string;
  readonly botId: string | null;
  readonly scope: GrantScope;
  readonly maxUses: number;
  readonly used: number;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

export function createGrant(
  db: OpenedDatabase,
  input: {
    capability: string;
    botId?: string | null;
    scope: GrantScope;
    maxUses?: number;
    expiresInSeconds?: number | null;
  },
): GrantRow {
  const now = db.now();
  const row: GrantRow = {
    id: randomUUID(),
    capability: input.capability,
    botId: input.botId ?? null,
    scope: input.scope,
    maxUses: input.maxUses ?? 1,
    used: 0,
    expiresAt:
      input.expiresInSeconds === undefined || input.expiresInSeconds === null
        ? null
        : new Date(now.getTime() + input.expiresInSeconds * 1000).toISOString(),
    revokedAt: null,
    createdAt: isoNow(db.now),
  };
  db.raw
    .prepare(
      "INSERT INTO grants (id, capability, bot_id, scope, max_uses, used, expires_at, revoked_at, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
    )
    .run(
      row.id,
      row.capability,
      row.botId,
      row.scope,
      row.maxUses,
      row.used,
      row.expiresAt,
      row.revokedAt,
      row.createdAt,
    );
  return row;
}

function mapRow(row: {
  id: string;
  capability: string;
  bot_id: string | null;
  scope: string;
  max_uses: number;
  used: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}): GrantRow {
  return {
    id: row.id,
    capability: row.capability,
    botId: row.bot_id,
    scope: row.scope as GrantScope,
    maxUses: row.max_uses,
    used: row.used,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

export function listGrants(db: OpenedDatabase, capability?: string): GrantRow[] {
  const rows =
    capability === undefined
      ? (db.raw.prepare("SELECT * FROM grants ORDER BY created_at DESC;").all() as Parameters<
          typeof mapRow
        >[0][])
      : (db.raw
          .prepare("SELECT * FROM grants WHERE capability = ? ORDER BY created_at DESC;")
          .all(capability) as Parameters<typeof mapRow>[0][]);
  return rows.map(mapRow);
}

/** Newest usable grant for a capability/bot, or undefined. */
export function findValidGrant(
  db: OpenedDatabase,
  capability: string,
  botId: string | null,
  at: Date,
): GrantRow | undefined {
  const iso = at.toISOString();
  const rows = db.raw
    .prepare(
      "SELECT * FROM grants WHERE capability = ? AND revoked_at IS NULL " +
        "AND (expires_at IS NULL OR expires_at > ?) AND (max_uses = 0 OR used < max_uses) " +
        "AND (bot_id IS NULL OR bot_id = ?) ORDER BY created_at DESC;",
    )
    .all(capability, iso, botId ?? "") as Parameters<typeof mapRow>[0][];
  return rows.map(mapRow)[0];
}

export function consumeGrant(db: OpenedDatabase, id: string, at: Date): boolean {
  const result = db.raw
    .prepare("UPDATE grants SET used = used + 1 WHERE id = ? AND (max_uses = 0 OR used < max_uses);")
    .run(id);
  void at;
  return Number(result.changes) > 0;
}

export function revokeGrant(db: OpenedDatabase, id: string): boolean {
  const result = db.raw
    .prepare("UPDATE grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL;").run(
      isoNow(db.now),
      id,
    );
  return Number(result.changes) > 0;
}
