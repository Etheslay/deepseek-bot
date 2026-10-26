/**
 * Local connector catalog. Rows start disabled. A credential column, when
 * present, is only a cred:<uuid> reference. This module never reads the blob
 * and never contacts the connector.
 */
import { randomUUID } from "node:crypto";
import type { OpenedDatabase } from "../database.js";
import { isValidCredentialRef } from "../credentials.js";
import { invalidInput } from "../errors.js";
import { constraintError, isoNow } from "./shared.js";

export const CONNECTOR_NAME_MAX = 200;

export interface ConnectorRow {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly credentialRef: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type ConnectorSqlRow = {
  id: string;
  name: string;
  enabled: number;
  credential_ref: string | null;
  created_at: string;
  updated_at: string;
};

function connectorName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > CONNECTOR_NAME_MAX) {
    throw invalidInput("connector name must be between 1 and 200 characters");
  }
  return trimmed;
}

function connectorCredential(credentialRef: string | null | undefined): string | null {
  if (credentialRef === undefined || credentialRef === null) return null;
  if (!isValidCredentialRef(credentialRef)) {
    throw invalidInput("credential ref has an unexpected format");
  }
  return credentialRef;
}

function mapRow(row: ConnectorSqlRow): ConnectorRow {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    credentialRef: row.credential_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readConnector(db: OpenedDatabase, id: string): ConnectorRow {
  const row = db.raw
    .prepare(
      "SELECT id, name, enabled, credential_ref, created_at, updated_at FROM connectors WHERE id = ?;",
    )
    .get(id) as unknown as ConnectorSqlRow | undefined;
  if (row === undefined) throw invalidInput("connector was not found");
  return mapRow(row);
}

export function registerConnector(
  db: OpenedDatabase,
  input: { id?: string; name: string; credentialRef?: string | null },
): ConnectorRow {
  const at = isoNow(db.now);
  const row: ConnectorRow = {
    id: input.id ?? randomUUID(),
    name: connectorName(input.name),
    enabled: false,
    credentialRef: connectorCredential(input.credentialRef),
    createdAt: at,
    updatedAt: at,
  };
  try {
    db.raw
      .prepare(
        "INSERT INTO connectors (id, name, enabled, credential_ref, created_at, updated_at) " +
          "VALUES (?, ?, 0, ?, ?, ?);",
      )
      .run(row.id, row.name, row.credentialRef, row.createdAt, row.updatedAt);
  } catch (error) {
    constraintError(error, "register connector");
  }
  return row;
}

/** Newest first. Enabling a connector does not call it. */
export function listConnectors(db: OpenedDatabase): ConnectorRow[] {
  const rows = db.raw
    .prepare(
      "SELECT id, name, enabled, credential_ref, created_at, updated_at FROM connectors " +
        "ORDER BY created_at DESC, rowid DESC;",
    )
    .all() as unknown as ConnectorSqlRow[];
  return rows.map(mapRow);
}

export function setConnectorEnabled(
  db: OpenedDatabase,
  input: { id: string; enabled: boolean },
): ConnectorRow {
  const at = isoNow(db.now);
  const result = db.raw
    .prepare("UPDATE connectors SET enabled = ?, updated_at = ? WHERE id = ?;")
    .run(input.enabled ? 1 : 0, at, input.id);
  if (Number(result.changes) !== 1) throw invalidInput("connector was not found");
  return readConnector(db, input.id);
}
