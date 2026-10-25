/**
 * Harness tool call → D08 ToolActionRequest mapping (D12).
 *
 * The bridge forwards the exact recorded tool call (name + arguments from the
 * harness session log) and the gate needs a closed action vocabulary
 * (runtime/permissions/actions.ts). The census below starts from the verified
 * D01 fixtures (`write`/`read` with `file_path`); it widens with real-machine
 * evidence during D12 QA and every unrecognized tool fails closed as
 * unmapped — never executed without a mapped, authorized action.
 *
 * Wire shapes (docs/fixtures/d01): `arguments` arrives as a JSON-encoded
 * string; path arguments use `file_path`.
 */
import type { ToolActionKind, ToolActionRequest } from "@deepseek-bot/runtime";

/** Parsed form of one recorded harness tool call. */
export interface HarnessToolCall {
  readonly toolName: string;
  readonly callId: string;
  /** JSON string or object, as recorded on the tool/call event. */
  readonly arguments: unknown;
}

const FILE_WRITE_TOOLS = new Set([
  "write",
  "edit",
  "str_replace_editor",
  "multiedit",
  "notebook_edit",
]);
const FILE_READ_TOOLS = new Set(["read", "read_image", "view"]);
const FILE_LIST_TOOLS = new Set(["ls", "glob", "grep", "search", "file_search"]);
const FILE_DELETE_TOOLS = new Set(["rm", "remove", "delete"]);
const SHELL_TOOLS = new Set([
  "bash",
  "bash_persistent",
  "pwsh",
  "pwsh_persistent",
  "powershell",
  "terminal",
]);
const NETWORK_TOOLS = new Set(["web_fetch", "fetch", "web_search", "web"]);

/**
 * Parse the recorded arguments payload: JSON strings are decoded; objects
 * pass through; anything else (empty, malformed JSON) is treated as absent.
 */
export function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function firstDefined(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function kindFor(toolName: string): ToolActionKind | undefined {
  const name = toolName.toLowerCase();
  if (FILE_WRITE_TOOLS.has(name)) return "file.write";
  if (FILE_READ_TOOLS.has(name)) return "file.read";
  if (FILE_LIST_TOOLS.has(name)) return "file.list";
  if (FILE_DELETE_TOOLS.has(name)) return "file.delete";
  if (SHELL_TOOLS.has(name)) return "shell.exec";
  if (NETWORK_TOOLS.has(name)) return "network.request";
  if (name.startsWith("mcp__") || name.startsWith("mcp.")) return "mcp.call";
  return undefined;
}

/**
 * Map a recorded harness tool call into a gate action request, or `undefined`
 * when the tool is unrecognized (the caller must then fail closed).
 */
export function mapHarnessToolCall(call: HarnessToolCall): ToolActionRequest | undefined {
  const kind = kindFor(call.toolName);
  if (kind === undefined) {
    return undefined;
  }
  const args = parseToolArguments(call.arguments);
  const base = {
    kind,
    callId: call.callId,
    toolName: call.toolName,
    arguments: args,
  };
  switch (kind) {
    case "file.write":
    case "file.read":
    case "file.delete": {
      const path = firstDefined(args, ["file_path", "path", "filePath"]);
      return path === undefined ? base : { ...base, path };
    }
    case "file.list": {
      const path = firstDefined(args, ["path", "dir", "directory", "cwd"]);
      return path === undefined ? base : { ...base, path };
    }
    case "shell.exec": {
      const command = firstDefined(args, ["command", "cmd", "script"]);
      return command === undefined ? base : { ...base, command };
    }
    case "network.request": {
      const url = firstDefined(args, ["url", "uri"]);
      return url === undefined ? base : { ...base, url };
    }
    case "mcp.call": {
      // Upstream MCP tool names follow mcp__<server>__<tool> (underscore
      // separated); server ids may themselves contain underscores, so split
      // from the prefix and treat the remainder as server + tool.
      const rest = call.toolName.replace(/^mcp[_.]_?/, "");
      const separator = rest.indexOf("__");
      if (separator > 0) {
        return {
          ...base,
          mcpServerId: rest.slice(0, separator),
          mcpToolName: rest.slice(separator + 2),
        };
      }
      return { ...base, mcpServerId: rest };
    }
  }
}
