/**
 * Local connector catalog. Rows start disabled. A credential column, when
 * present, is only a cred:<uuid> reference. This module never reads the blob
 * and never contacts the connector. MCP calls resolve the reference later,
 * outside this package.
 */
import { randomUUID } from "node:crypto";
import type { ConnectorKind } from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "../database.js";
import { isValidCredentialRef } from "../credentials.js";
import { invalidInput } from "../errors.js";
import { constraintError, isoNow } from "./shared.js";

export const CONNECTOR_NAME_MAX = 200;

const SHELL_BASENAMES = new Set([
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "wscript",
  "wscript.exe",
  "cscript",
  "cscript.exe",
]);

/** Names that would change how the child process is loaded or where it talks. */
const CREDENTIAL_ENV_DENY = new Set([
  "PATH",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "TMP",
  "TEMP",
  "TMPDIR",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PYTHONPATH",
  "PYTHONHOME",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "SHELL",
  "COMSPEC",
  "SYSTEMROOT",
  "WINDIR",
  "BASH_ENV",
  "ENV",
  "GIT_EXEC_PATH",
  "SSLKEYLOGFILE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "PROMPT",
  "PS1",
  "APPDATA",
  "LOCALAPPDATA",
]);

export interface ConnectorRow {
  readonly id: string;
  readonly name: string;
  readonly kind: ConnectorKind;
  readonly enabled: boolean;
  readonly credentialRef: string | null;
  readonly endpoint: string | null;
  readonly command: string | null;
  readonly args: readonly string[];
  readonly credentialEnv: string | null;
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
  command: string | null;
  args_json: string | null;
  credential_env: string | null;
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

/**
 * A stdio MCP command is an argv0, not a shell line. Bare names are looked
 * up by the OS. Absolute paths may not contain `..` or a UNC prefix.
 */
export function mcpStdioCommand(value: string): string {
  const command = value.trim();
  if (command.length < 1 || command.length > 1024)
    throw invalidInput("stdio command must be between 1 and 1024 characters");
  if (/[\0\r\n]/u.test(command))
    throw invalidInput("stdio command must not contain control characters");
  const base = command.split(/[\\/]/u).pop()?.toLowerCase() ?? "";
  if (SHELL_BASENAMES.has(base)) throw invalidInput("stdio command must not be a shell");
  const bare = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u.test(command);
  const posix = command.startsWith("/") && !command.split("/").includes("..");
  const windows = /^[A-Za-z]:[\\/]/u.test(command) && !command.split(/[\\/]/u).includes("..");
  if (command.startsWith("\\\\") || command.includes("//"))
    throw invalidInput("stdio command must not be a network path");
  if (!bare && !posix && !windows)
    throw invalidInput("stdio command must be a bare executable name or an absolute path");
  return command;
}

/** Argv entries. They are not joined into a shell string. */
export function mcpStdioArgs(value: readonly string[] | null | undefined): string[] {
  const args = value ?? [];
  if (args.length > 32) throw invalidInput("stdio MCP accepts at most 32 arguments");
  return args.map((arg) => {
    if (arg.length > 1024) throw invalidInput("stdio argument must be at most 1024 characters");
    if (/[\0\r\n]/u.test(arg))
      throw invalidInput("stdio argument must not contain control characters");
    return arg;
  });
}

/**
 * Env var that will receive the resolved secret. Defaults to MCP_CREDENTIAL
 * when a credential is present and the caller did not name one.
 */
export function mcpCredentialEnv(
  value: string | null | undefined,
  credentialPresent: boolean,
): string | null {
  if (!credentialPresent) {
    if (value != null && value.trim() !== "")
      throw invalidInput("credential environment requires a credential reference");
    return null;
  }
  if (value == null || value.trim() === "") return "MCP_CREDENTIAL";
  const name = value.trim();
  if (!/^[A-Z][A-Z0-9_]{0,63}$/u.test(name) || CREDENTIAL_ENV_DENY.has(name))
    throw invalidInput("credential environment name is not allowed");
  return name;
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

function parseArgs(value: string | null): string[] {
  if (value == null || value === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw invalidInput("stdio arguments are unreadable");
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string"))
    throw invalidInput("stdio arguments are unreadable");
  return mcpStdioArgs(parsed);
}

function mapRow(row: ConnectorSqlRow): ConnectorRow {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    enabled: row.enabled === 1,
    credentialRef: row.credential_ref,
    endpoint: row.endpoint,
    command: row.command,
    args: parseArgs(row.args_json),
    credentialEnv: row.credential_env,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const CONNECTOR_COLUMNS =
  "id, name, kind, enabled, credential_ref, endpoint, command, args_json, credential_env, created_at, updated_at";

export function getConnector(db: OpenedDatabase, id: string): ConnectorRow {
  const row = db.raw
    .prepare(`SELECT ${CONNECTOR_COLUMNS} FROM connectors WHERE id = ?;`)
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
    command?: string | null;
    args?: readonly string[];
    credentialEnv?: string | null;
  },
): ConnectorRow {
  const kind = input.kind ?? "sd-webui";
  if (kind !== "sd-webui" && kind !== "mcp-http" && kind !== "mcp-stdio")
    throw invalidInput("unsupported connector kind");
  const credentialRef = connectorCredential(input.credentialRef);
  let endpoint: string | null;
  let command: string | null = null;
  let args: string[] = [];
  let credentialEnv: string | null = null;
  if (kind === "mcp-stdio") {
    if (input.endpoint != null && input.endpoint.trim() !== "")
      throw invalidInput("stdio MCP does not use an HTTP endpoint");
    if (input.command == null || input.command.trim() === "")
      throw invalidInput("stdio MCP requires a command");
    command = mcpStdioCommand(input.command);
    args = mcpStdioArgs(input.args);
    credentialEnv = mcpCredentialEnv(input.credentialEnv, credentialRef !== null);
    endpoint = null;
  } else {
    if (
      (input.command != null && input.command.trim() !== "") ||
      (input.args != null && input.args.length > 0) ||
      (input.credentialEnv != null && input.credentialEnv.trim() !== "")
    )
      throw invalidInput("only stdio MCP accepts a command");
    endpoint =
      kind === "mcp-http" ? mcpConnectorEndpoint(input.endpoint) : connectorEndpoint(input.endpoint);
  }
  const at = isoNow(db.now);
  const row: ConnectorRow = {
    id: input.id ?? randomUUID(),
    name: connectorName(input.name),
    kind,
    enabled: false,
    credentialRef,
    endpoint,
    command,
    args,
    credentialEnv,
    createdAt: at,
    updatedAt: at,
  };
  try {
    db.raw
      .prepare(
        "INSERT INTO connectors (id, name, kind, enabled, credential_ref, endpoint, command, args_json, credential_env, created_at, updated_at) " +
          "VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?);",
      )
      .run(
        row.id,
        row.name,
        row.kind,
        row.credentialRef,
        row.endpoint,
        row.command,
        row.args.length > 0 ? JSON.stringify(row.args) : null,
        row.credentialEnv,
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
      `SELECT ${CONNECTOR_COLUMNS} FROM connectors ORDER BY created_at DESC, rowid DESC;`,
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
  if (connector.kind === "mcp-stdio")
    throw invalidInput("stdio MCP does not use an HTTP endpoint");
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

/** Replace the stdio argv. Does not spawn the process. */
export function setConnectorCommand(
  db: OpenedDatabase,
  input: { id: string; command: string; args?: readonly string[] },
): ConnectorRow {
  const connector = getConnector(db, input.id);
  if (connector.kind !== "mcp-stdio")
    throw invalidInput("command is only valid for stdio MCP");
  const command = mcpStdioCommand(input.command);
  const args = mcpStdioArgs(input.args);
  const at = isoNow(db.now);
  const result = db.raw
    .prepare("UPDATE connectors SET command = ?, args_json = ?, updated_at = ? WHERE id = ?;")
    .run(command, args.length > 0 ? JSON.stringify(args) : null, at, input.id);
  if (Number(result.changes) !== 1) throw invalidInput("connector was not found");
  return getConnector(db, input.id);
}
