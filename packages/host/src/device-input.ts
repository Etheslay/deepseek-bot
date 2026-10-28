/**
 * Device input (D21).
 *
 * Default off. One request waits for one exact once approval, then asks the
 * exec daemon to perform that pointer or key action. A denial, a disabled
 * policy, a reused approval, an unknown key, or an unavailable helper does
 * not perform input and does not write an artifact. The artifact stays under
 * device-outputs and is not a path in the response.
 */
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DeviceInputRecordSchema,
  DeviceInputSchema,
  type DeviceInput,
  type DeviceInputRecord,
  type DeviceInputResult,
} from "@deepseek-bot/contracts";
import { ScreenBackendError, type DeviceInputBackend } from "@deepseek-bot/exec-daemon";
import { getBot, listPermissionPolicies, type OpenedDatabase } from "@deepseek-bot/storage";
import {
  ToolRejectionError,
  type GrantCheckResult,
  type ToolCallOptions,
  type ToolCaller,
  type ToolContext,
} from "@deepseek-bot/agent-tools";
import type { AgentPermissionService } from "./agent-permissions.js";

const MAX_RECORDS = 100;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_ARTIFACT_BYTES = 8 * 1024;

interface Operation {
  readonly controller: AbortController;
  detach(): void;
}

export interface DeviceInputService {
  input(botId: string, input: DeviceInput): Promise<DeviceInputResult>;
  list(botId: string, limit: number): Promise<{ records: DeviceInputRecord[] }>;
  authorize(
    caller: ToolCaller,
    input: DeviceInput,
    options: ToolCallOptions,
  ): Promise<GrantCheckResult>;
  perform(caller: ToolCaller, input: DeviceInput, context: ToolContext): Promise<DeviceInputResult>;
  invalidate(): void;
  close(): void;
}

export function createDeviceInputService(options: {
  readonly root: string;
  readonly db: OpenedDatabase;
  readonly permissions: AgentPermissionService;
  readonly now: () => Date;
  readonly backend: DeviceInputBackend;
}): DeviceInputService {
  const root = path.resolve(options.root);
  const ops = new Map<string, Operation>();
  let closed = false;

  function reject(code: ToolRejectionError["code"], message: string): never {
    throw new ToolRejectionError(code, message);
  }

  function enabled(): boolean {
    return (
      listPermissionPolicies(options.db).find((policy) => policy.capability === "device.action")
        ?.mode === "ask"
    );
  }

  function liveBot(botId: string): void {
    const bot = getBot(options.db, botId);
    if (bot === undefined) reject("INVALID_INPUT", "device input bot was not found");
    if (bot.archivedAt !== null)
      reject("INVALID_INPUT", "archived bots cannot perform a device input");
  }

  function finish(botId: string, controller: AbortController): void {
    const operation = ops.get(botId);
    if (operation?.controller !== controller) return;
    operation.detach();
    ops.delete(botId);
  }

  function begin(botId: string, parent: AbortSignal | undefined): AbortController {
    if (closed) reject("RUNTIME_UNAVAILABLE", "device input host is closed");
    if (ops.has(botId)) reject("RATE_LIMITED", "a device input is already awaiting approval");
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    parent?.addEventListener("abort", abort, { once: true });
    ops.set(botId, {
      controller,
      detach: () => parent?.removeEventListener("abort", abort),
    });
    if (parent?.aborted) controller.abort();
    return controller;
  }

  async function authorize(
    caller: ToolCaller,
    input: DeviceInput,
    callOptions: ToolCallOptions,
  ): Promise<GrantCheckResult> {
    if (closed) reject("RUNTIME_UNAVAILABLE", "device input host is closed");
    if (!options.backend.supported) {
      reject("RUNTIME_UNAVAILABLE", "device input is not available");
    }
    const parsed = DeviceInputSchema.safeParse(input);
    if (!parsed.success) reject("INVALID_INPUT", "device input is invalid");
    if (caller.botId === undefined)
      reject("UNAUTHORIZED_PATH", "device input requires a trusted bot");
    const botId = caller.botId;
    liveBot(botId);
    if (!enabled()) {
      return options.permissions.check("device_input", caller, parsed.data, callOptions);
    }
    const controller = begin(botId, callOptions.signal);
    try {
      const authorization = await options.permissions.check("device_input", caller, parsed.data, {
        ...callOptions,
        signal: controller.signal,
      });
      if (!authorization.allowed) {
        finish(botId, controller);
        return authorization;
      }
      return {
        ...authorization,
        revalidate() {
          try {
            authorization.revalidate?.();
            if (!enabled()) reject("UNAUTHORIZED_PATH", "device input policy is not ask");
            if (controller.signal.aborted) reject("CANCELLED", "device input was cancelled");
          } catch (error) {
            finish(botId, controller);
            throw error;
          }
        },
      };
    } catch (error) {
      finish(botId, controller);
      throw error;
    }
  }

  async function perform(
    caller: ToolCaller,
    input: DeviceInput,
    context: ToolContext,
  ): Promise<DeviceInputResult> {
    if (caller.botId === undefined)
      reject("UNAUTHORIZED_PATH", "device input requires a trusted bot");
    const parsed = DeviceInputSchema.safeParse(input);
    if (!parsed.success) reject("INVALID_INPUT", "device input is invalid");
    const botId = caller.botId;
    const operation = ops.get(botId);
    if (operation === undefined) reject("CANCELLED", "device input was cancelled");
    const controller = operation.controller;
    try {
      if (controller.signal.aborted) reject("CANCELLED", "device input was cancelled");
      context.revalidateAuthorization?.();
      if (!enabled()) reject("UNAUTHORIZED_PATH", "device input policy is not ask");
      await options.backend.perform(parsed.data, controller.signal);
      if (controller.signal.aborted) reject("CANCELLED", "device input was cancelled");
      const record = DeviceInputRecordSchema.parse({
        id: randomUUID(),
        botId,
        at: options.now().toISOString(),
        input: parsed.data,
      });
      await publish(record);
      return { id: record.id, at: record.at, kind: record.input.kind };
    } catch (error) {
      throw error instanceof ToolRejectionError ? error : backendError(error);
    } finally {
      finish(botId, controller);
    }
  }

  async function publish(record: DeviceInputRecord): Promise<void> {
    const directory = await botDirectory(record.botId, true);
    if (directory === undefined) reject("RUNTIME_UNAVAILABLE", "device input artifact is unavailable");
    const file = path.join(directory, `${record.id}.json`);
    const body = JSON.stringify(record);
    if (Buffer.byteLength(body) > MAX_ARTIFACT_BYTES) {
      reject("INVALID_INPUT", "device input artifact is too large");
    }
    await assertAbsent(file);
    const temp = `${file}.tmp`;
    await assertAbsent(temp);
    await writeFile(temp, body, { encoding: "utf8", flag: "wx" });
    try {
      await rename(temp, file);
      const prior = await readManifest(directory);
      const next = [record, ...prior.filter((item) => item.id !== record.id)].slice(0, MAX_RECORDS);
      const dropped = prior.filter((item) => next.every((kept) => kept.id !== item.id));
      try {
        await writeManifest(directory, next);
      } catch (error) {
        await rm(file, { force: true }).catch(() => undefined);
        throw error;
      }
      for (const old of dropped) {
        await rm(path.join(directory, `${old.id}.json`), { force: true }).catch(() => undefined);
      }
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async function list(botId: string, limit: number): Promise<{ records: DeviceInputRecord[] }> {
    liveBot(botId);
    const directory = await botDirectory(botId, false);
    if (directory === undefined) return { records: [] };
    const records = await readManifest(directory);
    for (const record of records) await readArtifact(directory, record);
    const bounded = Math.max(1, Math.min(MAX_RECORDS, Math.floor(limit)));
    return { records: records.slice(0, bounded) };
  }

  async function botDirectory(botId: string, create: boolean): Promise<string | undefined> {
    await assertRealRoot();
    const directory = path.join(root, botId);
    if (!isInside(root, directory)) {
      reject("UNAUTHORIZED_PATH", "device input artifact escaped its directory");
    }
    let info: Awaited<ReturnType<typeof lstat>> | undefined;
    try {
      info = await lstat(directory);
    } catch (error) {
      if (!isMissing(error)) reject("RUNTIME_UNAVAILABLE", "device input artifact is unavailable");
    }
    if (info?.isSymbolicLink()) reject("UNAUTHORIZED_PATH", "device input artifact is a link");
    if (info === undefined) {
      if (!create) return undefined;
      await mkdir(directory, { recursive: true });
      info = await lstat(directory);
    }
    if (!info.isDirectory() || info.isSymbolicLink()) {
      reject("UNAUTHORIZED_PATH", "device input artifact is a link");
    }
    const resolved = await realpath(directory);
    if (!isInside(await realpath(root), resolved)) {
      reject("UNAUTHORIZED_PATH", "device input artifact escaped its directory");
    }
    return resolved;
  }

  async function assertRealRoot(): Promise<void> {
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      info = await lstat(root);
    } catch {
      reject("RUNTIME_UNAVAILABLE", "device input artifact is unavailable");
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      reject("UNAUTHORIZED_PATH", "device input artifact is a link");
    }
  }

  async function readManifest(directory: string): Promise<DeviceInputRecord[]> {
    const file = path.join(directory, "manifest.json");
    let bytes: Buffer;
    try {
      const info = await lstat(file);
      if (info.isSymbolicLink()) reject("UNAUTHORIZED_PATH", "device input artifact is a link");
      if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) {
        reject("RUNTIME_UNAVAILABLE", "device input artifact is unavailable");
      }
      bytes = await readFile(file);
    } catch (error) {
      if (isMissing(error)) return [];
      if (error instanceof ToolRejectionError) throw error;
      reject("RUNTIME_UNAVAILABLE", "device input artifact is unavailable");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      reject("RUNTIME_UNAVAILABLE", "device input artifact is unavailable");
    }
    const records = DeviceInputRecordSchema.array().max(MAX_RECORDS).safeParse(parsed);
    if (!records.success) reject("RUNTIME_UNAVAILABLE", "device input artifact is unavailable");
    return records.data;
  }

  async function writeManifest(directory: string, records: DeviceInputRecord[]): Promise<void> {
    const file = path.join(directory, "manifest.json");
    const temp = `${file}.tmp`;
    await assertReplaceable(file);
    await assertAbsent(temp);
    const body = JSON.stringify(records);
    if (Buffer.byteLength(body) > MAX_MANIFEST_BYTES) {
      reject("INVALID_INPUT", "device input artifact is too large");
    }
    await writeFile(temp, body, { encoding: "utf8", flag: "wx" });
    try {
      await replaceRegularFile(temp, file);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async function assertReplaceable(file: string): Promise<void> {
    try {
      const info = await lstat(file);
      if (info.isSymbolicLink() || !info.isFile()) {
        reject("UNAUTHORIZED_PATH", "device input artifact is a link");
      }
    } catch (error) {
      if (error instanceof ToolRejectionError) throw error;
      if (!isMissing(error)) reject("RUNTIME_UNAVAILABLE", "device input artifact is unavailable");
    }
  }

  async function replaceRegularFile(source: string, dest: string): Promise<void> {
    await assertReplaceable(dest);
    try {
      const info = await lstat(dest);
      if (info.isFile()) await rm(dest, { force: true });
    } catch (error) {
      if (error instanceof ToolRejectionError) throw error;
      if (!isMissing(error)) reject("RUNTIME_UNAVAILABLE", "device input artifact is unavailable");
    }
    await rename(source, dest);
  }

  async function readArtifact(directory: string, record: DeviceInputRecord): Promise<void> {
    const file = path.join(directory, `${record.id}.json`);
    if (!isInside(directory, file))
      reject("UNAUTHORIZED_PATH", "device input artifact escaped its directory");
    let bytes: Buffer;
    try {
      const info = await lstat(file);
      if (info.isSymbolicLink()) reject("UNAUTHORIZED_PATH", "device input artifact is a link");
      if (!info.isFile() || info.size > MAX_ARTIFACT_BYTES) {
        reject("RUNTIME_UNAVAILABLE", "device input artifact is unavailable");
      }
      bytes = await readFile(file);
    } catch (error) {
      if (error instanceof ToolRejectionError) throw error;
      reject("RUNTIME_UNAVAILABLE", "device input artifact is unavailable");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      reject("RUNTIME_UNAVAILABLE", "device input artifact is unavailable");
    }
    const artifact = DeviceInputRecordSchema.safeParse(parsed);
    if (
      !artifact.success ||
      artifact.data.id !== record.id ||
      artifact.data.botId !== record.botId
    ) {
      reject("RUNTIME_UNAVAILABLE", "device input artifact is unavailable");
    }
  }

  async function assertAbsent(file: string): Promise<void> {
    try {
      const info = await lstat(file);
      if (info.isSymbolicLink()) reject("UNAUTHORIZED_PATH", "device input artifact is a link");
      reject("RUNTIME_UNAVAILABLE", "device input artifact is unavailable");
    } catch (error) {
      if (error instanceof ToolRejectionError) throw error;
      if (!isMissing(error)) reject("RUNTIME_UNAVAILABLE", "device input artifact is unavailable");
    }
  }

  return {
    async input(botId, input) {
      const caller: ToolCaller = { id: `ui:${botId}`, botId };
      const grant = await authorize(caller, input, {});
      if (!grant.allowed) {
        reject(grant.code ?? "UNAUTHORIZED_PATH", grant.reason ?? "device input was not approved");
      }
      grant.revalidate?.();
      return perform(caller, input, {
        caller,
        ...(grant.revalidate !== undefined ? { revalidateAuthorization: grant.revalidate } : {}),
      });
    },
    list,
    authorize,
    perform,
    invalidate() {
      for (const operation of ops.values()) operation.controller.abort();
    },
    close() {
      if (closed) return;
      closed = true;
      for (const operation of ops.values()) operation.controller.abort();
      ops.clear();
    },
  };
}

function isInside(root: string, candidate: string): boolean {
  const left = process.platform === "win32" ? root.toLowerCase() : root;
  const right = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  const relative = path.relative(left, right);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function backendError(error: unknown): ToolRejectionError {
  if (error instanceof ToolRejectionError) return error;
  if (error instanceof ScreenBackendError) {
    const message = {
      INVALID_INPUT: "device input was rejected",
      UNAUTHORIZED_PATH: "device input path was rejected",
      RUNTIME_UNAVAILABLE: "device input is not available",
      TOOL_TIMEOUT: "device input timed out",
      CANCELLED: "device input was cancelled",
    }[error.code];
    return new ToolRejectionError(error.code, message);
  }
  return new ToolRejectionError("RUNTIME_UNAVAILABLE", "device input failed");
}
