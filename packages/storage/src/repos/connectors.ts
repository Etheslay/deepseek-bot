/**
 * Local connector catalog. Rows start disabled. A credential column, when
 * present, is only a cred:<uuid> reference. This module never reads the blob
 * and never contacts the connector.
 */
import { randomUUID } from "node:crypto";
import type { ConnectorKind } from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "../database.js";
import { isValidCredentialRef } from "../credentials.js";
import { invalidInput } from "../errors.js";
import { constraintError, isoNow } from "./shared.js";

export const CONNECTOR_NAME_MAX = 200;

export interface ConnectorRow {
  readonly id: string;
  readonly name: string;
  readonly kind: ConnectorKind;
  readonly enabled: boolean;
  readonly credentialRef: string | null;
  readonly endpoint: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

type ConnectorSqlRow = {
  id: string;
  name: string;
  kind: ConnectorKind;
  enabled: number;
  credential_ref: string | null;
  endpoint: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Loopback http(s) URL only — the first official connector (local Stable
 * Diffusion) and every other v0.x connector is a service on this machine.
 * Rejects anything else so a stored endpoint can never point the Host at a
 * remote target.
 */
export function connectorEndpoint(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw invalidInput("connector endpoint must be an absolute http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw invalidInput("connector endpoint must use http or https");
  }
  const host = url.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]" && host !== "::1") {
    throw invalidInput("connector endpoint must be a loopback address");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw invalidInput("connector endpoint must not carry a path");
  }
  return trimmed;
}

/** MCP Streamable HTTP allows a transport path, but no embedded auth or URL state. */
export function mcpConnectorEndpoint(value: string | null | undefined): string | null {
  if (value == null || value.trim() === "") return null;
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw invalidInput("connector endpoint must be an absolute http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw invalidInput("connector endpoint must use http or https");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase()))
    throw invalidInput("connector endpoint must be a loopback address");
  const authority =
    trimmed.split(/[\\/]/).find((part, index) => index >= 2 && part.length > 0) ?? "";
  if (
    url.username ||
    url.password ||
    authority.includes("@") ||
    trimmed.includes("?") ||
    trimmed.includes("#")
  )
    throw invalidInput("MCP endpoint must not contain credentials, query or fragment");
  if (url.hostname.toLowerCase() === "localhost") url.hostname = "127.0.0.1";
  return url.href;
}

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
    kind: row.kind,
    enabled: row.enabled === 1,
    credentialRef: row.credential_ref,
    endpoint: row.endpoint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getConnector(db: OpenedDatabase, id: string): ConnectorRow {
  const row = db.raw
    .prepare(
      "SELECT id, name, kind, enabled, credential_ref, endpoint, created_at, updated_at FROM connectors WHERE id = ?;",
    )
    .get(id) as unknown as ConnectorSqlRow | undefined;
  if (row === undefined) throw invalidInput("connector was not found");
  return mapRow(row);
}

export function registerConnector(
  db: OpenedDatabase,
  input: {
    id?: string;
    kind?: ConnectorKind;
    name: string;
    credentialRef?: string | null;
    endpoint?: string | null;
  },
): ConnectorRow {
  const kind = input.kind ?? "sd-webui";
  if (kind !== "sd-webui" && kind !== "mcp-http") throw invalidInput("unsupported connector kind");
  if (kind === "mcp-http" && input.credentialRef != null)
    throw invalidInput("MCP credentials are unsupported");
  const at = isoNow(db.now);
  const row: ConnectorRow = {
    id: input.id ?? randomUUID(),
    name: connectorName(input.name),
    kind,
    enabled: false,
    credentialRef: connectorCredential(input.credentialRef),
    endpoint:
      kind === "mcp-http"
        ? mcpConnectorEndpoint(input.endpoint)
        : connectorEndpoint(input.endpoint),
    createdAt: at,
    updatedAt: at,
  };
  try {
    db.raw
      .prepare(
        "INSERT INTO connectors (id, name, kind, enabled, credential_ref, endpoint, created_at, updated_at) " +
          "VALUES (?, ?, ?, 0, ?, ?, ?, ?);",
      )
      .run(
        row.id,
        row.name,
        row.kind,
        row.credentialRef,
        row.endpoint,
        row.createdAt,
        row.updatedAt,
      );
  } catch (error) {
    constraintError(error, "register connector");
  }
  return row;
}

/** Newest first. Enabling a connector does not call it. */
export function listConnectors(db: OpenedDatabase): ConnectorRow[] {
  const rows = db.raw
    .prepare(
      "SELECT id, name, kind, enabled, credential_ref, endpoint, created_at, updated_at FROM connectors " +
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
  return getConnector(db, input.id);
}

/** Set or clear the loopback endpoint. Never contacts the service. */
export function setConnectorEndpoint(
  db: OpenedDatabase,
  input: { id: string; endpoint: string | null },
): ConnectorRow {
  const at = isoNow(db.now);
  const connector = getConnector(db, input.id);
  const endpoint =
    connector.kind === "mcp-http"
      ? mcpConnectorEndpoint(input.endpoint)
      : connectorEndpoint(input.endpoint);
  const result = db.raw
    .prepare("UPDATE connectors SET endpoint = ?, updated_at = ? WHERE id = ?;")
    .run(endpoint, at, input.id);
  if (Number(result.changes) !== 1) throw invalidInput("connector was not found");
  return getConnector(db, input.id);
}
