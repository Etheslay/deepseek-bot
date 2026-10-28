import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  ToolRejectionError,
  type McpInvokeInput,
  type ToolCaller,
  type ToolContext,
} from "@deepseek-bot/agent-tools";
import type { McpTool } from "@deepseek-bot/contracts";
import {
  getBot,
  getConnector,
  getToolPolicy,
  listConnectors,
  type ConnectorRow,
  type OpenedDatabase,
} from "@deepseek-bot/storage";
import {
  callMcp,
  callMcpStdio,
  discoverMcp,
  discoverMcpStdio,
  injectableCredential,
  validateMcpArguments,
  type McpCallResult,
} from "./mcp-client.js";

export interface McpCatalogTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  invocation: {
    definitionId: string;
    connectorId: string;
    connectorName: string;
    toolName: string;
    endpoint: string;
  };
}
export interface McpServiceOptions {
  /** Overall deadline shared by every service in a turn, including queued discovery. */
  catalogTimeoutMs?: number;
  /**
   * Decrypt a cred: reference. The desktop main owns the ciphertext.
   * The returned string is injected into the MCP transport and then dropped.
   */
  resolveCredential?: (credentialRef: string) => Promise<string>;
}
interface Definition {
  botId: string;
  connector: ConnectorRow;
  tool: McpTool;
}
interface ActiveRequest {
  connectorId: string;
  botId?: string;
  controller: AbortController;
}
const denied = () => new ToolRejectionError("UNAUTHORIZED_PATH", "MCP tool is not authorized");
function snapshot(row: ConnectorRow): string {
  return JSON.stringify([
    row.kind,
    row.name,
    row.endpoint,
    row.command,
    row.args,
    row.credentialEnv,
    row.enabled,
    row.credentialRef,
    row.updatedAt,
  ]);
}
function transportLabel(row: ConnectorRow): string {
  if (row.kind === "mcp-stdio") return `stdio:${row.command ?? ""}`;
  return row.endpoint ?? "";
}
function isMcpKind(kind: ConnectorRow["kind"]): boolean {
  return kind === "mcp-http" || kind === "mcp-stdio";
}
function failure(error: unknown, signal?: AbortSignal): ToolRejectionError {
  if (signal?.aborted) return new ToolRejectionError("CANCELLED", "MCP request cancelled");
  if (error instanceof ToolRejectionError) return error;
  if (error instanceof Error && error.message === "MCP request timed out")
    return new ToolRejectionError("TOOL_TIMEOUT", "MCP request timed out");
  return new ToolRejectionError(
    "RUNTIME_UNAVAILABLE",
    "MCP service is unavailable or returned an invalid result",
  );
}

export class McpService {
  private readonly definitions = new Map<string, Definition>();
  private readonly active = new Set<ActiveRequest>();
  private closed = false;
  constructor(
    private readonly db: OpenedDatabase,
    private readonly outputsRoot: string,
    private readonly options: McpServiceOptions = {},
  ) {
    if (
      !Number.isSafeInteger(options.catalogTimeoutMs ?? 10_000) ||
      (options.catalogTimeoutMs ?? 10_000) <= 0
    )
      throw new Error("MCP catalog deadline must be positive");
    mkdirSync(outputsRoot, { recursive: true });
    this.stdioCwd = join(outputsRoot, "stdio-cwd");
  }
  private readonly stdioCwd: string;
  /** Created only when a stdio server is actually started, so HTTP-only runs leave the output root empty. */
  private stdioDirectory(): string {
    mkdirSync(this.stdioCwd, { recursive: true });
    return this.stdioCwd;
  }
  private connector(id: string): ConnectorRow {
    try {
      const row = getConnector(this.db, id);
      if (this.closed || !row.enabled || !isMcpKind(row.kind)) throw denied();
      if (row.kind === "mcp-http" && !row.endpoint) throw denied();
      if (row.kind === "mcp-stdio" && !row.command) throw denied();
      return row;
    } catch (error) {
      if (error instanceof ToolRejectionError) throw error;
      throw denied();
    }
  }
  private async credential(ref: string | null, signal: AbortSignal): Promise<string | undefined> {
    if (ref === null) return undefined;
    if (!this.options.resolveCredential)
      throw new ToolRejectionError("RUNTIME_UNAVAILABLE", "MCP credential is unavailable");
    let value: string;
    try {
      value = await new Promise<string>((resolve, reject) => {
        if (signal.aborted) {
          reject(new Error("aborted"));
          return;
        }
        const onAbort = () => reject(new Error("aborted"));
        signal.addEventListener("abort", onAbort, { once: true });
        this.options.resolveCredential!(ref).then(
          (secret) => {
            signal.removeEventListener("abort", onAbort);
            resolve(secret);
          },
          (error: unknown) => {
            signal.removeEventListener("abort", onAbort);
            reject(error instanceof Error ? error : new Error("unavailable"));
          },
        );
      });
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.message === "aborted"))
        throw new ToolRejectionError("CANCELLED", "MCP request cancelled");
      throw new ToolRejectionError("RUNTIME_UNAVAILABLE", "MCP credential is unavailable");
    }
    try {
      return injectableCredential(value);
    } catch {
      throw new ToolRejectionError("RUNTIME_UNAVAILABLE", "MCP credential is unusable");
    }
  }
  private grants(caller: ToolCaller) {
    if (!caller.botId || this.closed) return [];
    const bot = getBot(this.db, caller.botId);
    if (!bot || bot.archivedAt !== null) return [];
    const policy = getToolPolicy(this.db, bot.toolPolicyId);
    return policy?.mcp.enabled ? policy.mcp.servers : [];
  }
  private async request<T>(
    connectorId: string,
    botId: string | undefined,
    signal: AbortSignal | undefined,
    action: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const entry: ActiveRequest = {
      connectorId,
      ...(botId ? { botId } : {}),
      controller: new AbortController(),
    };
    this.active.add(entry);
    const combined = signal
      ? AbortSignal.any([signal, entry.controller.signal])
      : entry.controller.signal;
    try {
      combined.throwIfAborted();
      return await action(combined);
    } catch (error) {
      throw failure(error, combined);
    } finally {
      this.active.delete(entry);
    }
  }
  private async discoverLive(row: ConnectorRow, signal: AbortSignal): Promise<McpTool[]> {
    const secret = await this.credential(row.credentialRef, signal);
    if (row.kind === "mcp-stdio") {
      return discoverMcpStdio(
        {
          command: row.command ?? "",
          args: row.args,
          cwd: this.stdioDirectory(),
          ...(secret
            ? { credential: secret, credentialEnv: row.credentialEnv ?? "MCP_CREDENTIAL" }
            : {}),
        },
        signal,
      );
    }
    return discoverMcp(row.endpoint ?? "", signal, secret ? { authorization: secret } : {});
  }
  async discover(id: string, signal?: AbortSignal): Promise<McpTool[]> {
    const row = this.connector(id);
    return this.request(id, undefined, signal, async (combined) => {
      const current = this.connector(id);
      if (snapshot(current) !== snapshot(row)) throw denied();
      const tools = await this.discoverLive(current, combined);
      if (snapshot(this.connector(id)) !== snapshot(row)) throw denied();
      return tools;
    });
  }
  async catalog(
    caller: ToolCaller,
    signal: AbortSignal,
  ): Promise<{ tools: McpCatalogTool[]; warnings: string[] }> {
    const grants = this.grants(caller);
    if (!grants.length) return { tools: [], warnings: [] };
    const discoverySignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(this.options.catalogTimeoutMs ?? 10_000),
    ]);
    const rows = listConnectors(this.db).filter(
      (row) =>
        isMcpKind(row.kind) && row.enabled && grants.some((grant) => grant.serverId === row.id),
    );
    const results: Array<{ row: ConnectorRow; tools: McpTool[]; failed?: boolean }> = rows.map(
      (row) => ({ row, tools: [], failed: true }),
    );
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, rows.length) }, async () => {
        while (next < rows.length && !discoverySignal.aborted) {
          const index = next++;
          const row = rows[index]!;
          try {
            const tools = await this.request(
              row.id,
              caller.botId,
              discoverySignal,
              async (combined) => {
                const current = this.connector(row.id);
                if (snapshot(current) !== snapshot(row)) throw denied();
                return this.discoverLive(current, combined);
              },
            );
            results[index] = { row, tools };
          } catch {
            results[index] = { row, tools: [], failed: true };
          }
        }
      }),
    );
    if (signal.aborted) throw failure(undefined, signal);
    const tools: McpCatalogTool[] = [];
    const warnings: string[] = [];
    let bytes = 0;
    for (const result of results) {
      if (result.failed) {
        warnings.push("An authorized MCP service is unavailable.");
        continue;
      }
      for (const tool of result.tools) {
        if (
          !this.grants(caller).some(
            (grant) => grant.serverId === result.row.id && grant.allowedTools.includes(tool.name),
          )
        )
          continue;
        try {
          if (snapshot(this.connector(result.row.id)) !== snapshot(result.row)) continue;
        } catch {
          continue;
        }
        const definitionId = randomUUID();
        const entry: McpCatalogTool = {
          name: `mcp__${result.row.id.replaceAll("-", "")}__${createHash("sha256").update(tool.name).digest("hex").slice(0, 12)}`,
          description:
            `[${result.row.name} / ${tool.name}] ${tool.description ?? "Local MCP tool"}`.slice(
              0,
              4399,
            ),
          parameters: structuredClone(tool.inputSchema),
          invocation: {
            definitionId,
            connectorId: result.row.id,
            connectorName: result.row.name,
            toolName: tool.name,
            endpoint: transportLabel(result.row),
          },
        };
        const size = Buffer.byteLength(JSON.stringify(entry));
        if (tools.length >= 200 || bytes + size > 256 * 1024) {
          if (!warnings.includes("MCP catalog size limit reached."))
            warnings.push("MCP catalog size limit reached.");
          continue;
        }
        bytes += size;
        this.definitions.set(definitionId, {
          botId: caller.botId!,
          connector: result.row,
          tool: structuredClone(tool),
        });
        tools.push(entry);
      }
    }
    return { tools, warnings };
  }
  release(tools: readonly McpCatalogTool[]): void {
    for (const tool of tools) this.definitions.delete(tool.invocation.definitionId);
  }
  check(input: McpInvokeInput, caller: ToolCaller): void {
    this.definition(input, caller);
  }
  private definition(input: McpInvokeInput, caller: ToolCaller): Definition {
    const definition = this.definitions.get(input.definitionId);
    if (!definition || caller.botId !== definition.botId) throw denied();
    const row = this.connector(input.connectorId);
    if (
      row.id !== definition.connector.id ||
      snapshot(row) !== snapshot(definition.connector) ||
      input.connectorName !== row.name ||
      input.endpoint !== transportLabel(row) ||
      input.toolName !== definition.tool.name ||
      !this.grants(caller).some(
        (grant) => grant.serverId === row.id && grant.allowedTools.includes(input.toolName),
      )
    )
      throw denied();
    try {
      if (Buffer.byteLength(JSON.stringify(input.arguments)) > 64 * 1024) throw new Error();
      validateMcpArguments(definition.tool, input.arguments);
    } catch {
      throw new ToolRejectionError(
        "INVALID_INPUT",
        "MCP arguments do not match the authorized tool schema",
      );
    }
    return definition;
  }
  invalidate(filter: { connectorId?: string; botId?: string }): void {
    const matches = (connectorId: string, botId?: string) =>
      (!filter.connectorId || filter.connectorId === connectorId) &&
      (!filter.botId || filter.botId === botId);
    for (const [id, definition] of this.definitions)
      if (matches(definition.connector.id, definition.botId)) this.definitions.delete(id);
    for (const entry of this.active)
      if (matches(entry.connectorId, entry.botId)) entry.controller.abort();
  }
  close(): void {
    this.closed = true;
    this.invalidate({});
  }
  async invoke(input: McpInvokeInput, context: ToolContext): Promise<unknown> {
    const definition = this.definition(input, context.caller);
    return this.request(input.connectorId, context.caller.botId, context.signal, async (signal) => {
      const approved = definition.connector;
      const secret = await this.credential(approved.credentialRef, signal);
      const callOptions = {
        expectedTool: definition.tool,
        beforeCall: () => {
          signal.throwIfAborted();
          this.check(input, context.caller);
          context.revalidateAuthorization?.();
        },
      };
      const result =
        approved.kind === "mcp-stdio"
          ? await callMcpStdio(
              {
                command: approved.command ?? "",
                args: approved.args,
                cwd: this.stdioDirectory(),
                ...(secret
                  ? {
                      credential: secret,
                      credentialEnv: approved.credentialEnv ?? "MCP_CREDENTIAL",
                    }
                  : {}),
              },
              input.toolName,
              input.arguments,
              signal,
              callOptions,
            )
          : await callMcp(approved.endpoint ?? "", input.toolName, input.arguments, signal, {
              ...callOptions,
              ...(secret ? { authorization: secret } : {}),
            });
      signal.throwIfAborted();
      this.check(input, context.caller);
      return this.output(input.connectorId, result);
    });
  }
  private output(connectorId: string, result: McpCallResult): unknown {
    const images: { bytes: Buffer; savedPath: string }[] = [];
    const extensions: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/gif": "gif",
    };
    const content = (result.content ?? []).map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error();
      const item = raw as Record<string, unknown>;
      if (item.type === "image") {
        const mimeType = item.mimeType;
        const data = item.data;
        if (
          typeof mimeType !== "string" ||
          !Object.hasOwn(extensions, mimeType) ||
          typeof data !== "string" ||
          data.length > Math.ceil((8 * 1024 * 1024) / 3) * 4 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(data)
        )
          throw new Error();
        const bytes = Buffer.from(data, "base64");
        if (!bytes.length || bytes.length > 8 * 1024 * 1024 || bytes.toString("base64") !== data)
          throw new Error();
        const savedPath = join(
          this.outputsRoot,
          connectorId,
          `${randomUUID()}.${extensions[mimeType]!}`,
        );
        images.push({ bytes, savedPath });
        return { type: "image", mimeType, savedPath, sizeBytes: bytes.length } as Record<
          string,
          unknown
        >;
      }
      if (
        item.type === "resource" &&
        item.resource &&
        typeof item.resource === "object" &&
        "blob" in item.resource
      )
        throw new Error();
      if (!["text", "resource", "resource_link"].includes(String(item.type))) throw new Error();
      return structuredClone(item);
    });
    const output = {
      connectorId,
      content,
      ...(result.structuredContent === undefined
        ? {}
        : { structuredContent: result.structuredContent }),
      ...(result.isError === undefined ? {} : { isError: result.isError }),
    };
    if (Buffer.byteLength(JSON.stringify(output)) > 512 * 1024) throw new Error();
    const written: string[] = [];
    try {
      if (images.length) mkdirSync(join(this.outputsRoot, connectorId), { recursive: true });
      for (const image of images) {
        writeFileSync(image.savedPath, image.bytes, { flag: "wx" });
        written.push(image.savedPath);
      }
    } catch (error) {
      for (const path of written) {
        try {
          unlinkSync(path);
        } catch {
          /* best effort rollback */
        }
      }
      throw error;
    }
    return output;
  }
}
