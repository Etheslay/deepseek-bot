/** Model-facing device input. One call is one pointer or one key, after a new approval. */
import {
  DeviceInputSchema,
  type DeviceInput,
  type DeviceInputResult,
} from "@deepseek-bot/contracts";
import type { ToolCaller, ToolCapability, ToolContext } from "./types.js";

export interface DeviceInputStore {
  perform(caller: ToolCaller, input: DeviceInput, context: ToolContext): Promise<DeviceInputResult>;
}

export function bindDeviceInputTool(
  store: DeviceInputStore,
): ToolCapability<typeof DeviceInputSchema> {
  return {
    name: "device_input",
    description:
      "Perform one pointer move or click, or one key tap, after a new approval. " +
      "pointer uses gesture move or click, button left right or middle, and x y from 0 to 8192. " +
      "key uses one allowlisted name, action tap, and shift ctrl alt booleans. " +
      "The Windows key, a command, and a path are not accepted. " +
      "The result is only id, at, and kind. This tool does not change the permission policy.",
    inputSchema: DeviceInputSchema,
    handler(params, context) {
      return store.perform(context.caller, params, context);
    },
  };
}
