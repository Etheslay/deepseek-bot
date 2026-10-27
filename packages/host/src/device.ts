/**
 * Device-action approval gate (D21).
 *
 * A request stays rejected unless the device.action policy is ask. One request
 * waits for one exact once approval, then returns only an id and a timestamp.
 * This service does not move a pointer, send a key, or call the exec daemon.
 */
import { randomUUID } from "node:crypto";
import type { DeviceActionKind, DeviceActionResult } from "@deepseek-bot/contracts";
import { getBot, listPermissionPolicies, type OpenedDatabase } from "@deepseek-bot/storage";
import {
  ToolRejectionError,
  type GrantCheckResult,
  type ToolCallOptions,
  type ToolCaller,
  type ToolContext,
} from "@deepseek-bot/agent-tools";
import type { AgentPermissionService } from "./agent-permissions.js";

interface Operation {
  readonly controller: AbortController;
  detach(): void;
}

export interface DeviceActionService {
  request(botId: string, kind: DeviceActionKind): Promise<DeviceActionResult>;
  authorize(
    caller: ToolCaller,
    kind: DeviceActionKind,
    options: ToolCallOptions,
  ): Promise<GrantCheckResult>;
  accept(
    caller: ToolCaller,
    kind: DeviceActionKind,
    context: ToolContext,
  ): Promise<DeviceActionResult>;
  invalidate(): void;
  close(): void;
}

export function createDeviceActionService(options: {
  readonly db: OpenedDatabase;
  readonly permissions: AgentPermissionService;
  readonly now: () => Date;
}): DeviceActionService {
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
    if (bot === undefined) reject("INVALID_INPUT", "device action bot was not found");
    if (bot.archivedAt !== null) {
      reject("INVALID_INPUT", "archived bots cannot request a device action");
    }
  }

  function finish(botId: string, controller: AbortController): void {
    const operation = ops.get(botId);
    if (operation?.controller !== controller) return;
    operation.detach();
    ops.delete(botId);
  }

  function begin(botId: string, parent: AbortSignal | undefined): AbortController {
    if (closed) reject("RUNTIME_UNAVAILABLE", "device action host is closed");
    if (ops.has(botId)) reject("RATE_LIMITED", "a device action is already awaiting approval");
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
    kind: DeviceActionKind,
    callOptions: ToolCallOptions,
  ): Promise<GrantCheckResult> {
    if (closed) reject("RUNTIME_UNAVAILABLE", "device action host is closed");
    if (caller.botId === undefined) {
      reject("UNAUTHORIZED_PATH", "device action requires a trusted bot");
    }
    const botId = caller.botId;
    liveBot(botId);
    if (!enabled()) {
      return options.permissions.check("device_action", caller, { kind }, callOptions);
    }
    const controller = begin(botId, callOptions.signal);
    try {
      const authorization = await options.permissions.check(
        "device_action",
        caller,
        { kind },
        { ...callOptions, signal: controller.signal },
      );
      if (!authorization.allowed) {
        finish(botId, controller);
        return authorization;
      }
      return {
        ...authorization,
        revalidate() {
          try {
            authorization.revalidate?.();
            if (!enabled()) reject("UNAUTHORIZED_PATH", "device action policy is not ask");
            if (controller.signal.aborted) reject("CANCELLED", "device action was cancelled");
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

  async function accept(
    caller: ToolCaller,
    _kind: DeviceActionKind,
    context: ToolContext,
  ): Promise<DeviceActionResult> {
    if (caller.botId === undefined) {
      reject("UNAUTHORIZED_PATH", "device action requires a trusted bot");
    }
    const botId = caller.botId;
    const operation = ops.get(botId);
    if (operation === undefined) reject("CANCELLED", "device action was cancelled");
    const controller = operation.controller;
    try {
      if (controller.signal.aborted) reject("CANCELLED", "device action was cancelled");
      context.revalidateAuthorization?.();
      if (!enabled()) reject("UNAUTHORIZED_PATH", "device action policy is not ask");
      return { id: randomUUID(), at: options.now().toISOString() };
    } finally {
      finish(botId, controller);
    }
  }

  return {
    async request(botId, kind) {
      const caller: ToolCaller = { id: `ui:${botId}`, botId };
      const grant = await authorize(caller, kind, {});
      if (!grant.allowed) {
        reject(grant.code ?? "UNAUTHORIZED_PATH", grant.reason ?? "device action was not approved");
      }
      grant.revalidate?.();
      return accept(caller, kind, {
        caller,
        ...(grant.revalidate !== undefined ? { revalidateAuthorization: grant.revalidate } : {}),
      });
    },
    authorize,
    accept,
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
