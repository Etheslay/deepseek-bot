/** Model-facing device action. The Host accepts a kind; it does not move a pointer or send a key. */
import { z } from "zod";
import type { ToolCaller, ToolCapability, ToolContext } from "./types.js";

export const DeviceActionInputSchema = z
  .object({
    kind: z.enum(["pointer", "key"]),
  })
  .strict();

export interface DeviceActionResult {
  readonly id: string;
  readonly at: string;
}

export interface DeviceActionStore {
  accept(
    caller: ToolCaller,
    kind: "pointer" | "key",
    context: ToolContext,
  ): Promise<DeviceActionResult>;
}

export function bindDeviceActionTool(
  store: DeviceActionStore,
): ToolCapability<typeof DeviceActionInputSchema> {
  return {
    name: "device_action",
    description:
      "Ask to accept one pointer or key action. kind is pointer or key. " +
      "Each call needs a new approval. The result is only an id and a timestamp. " +
      "This tool does not move the pointer, send keys, or change the permission policy.",
    inputSchema: DeviceActionInputSchema,
    handler(params, context) {
      return store.accept(context.caller, params.kind, context);
    },
  };
}
