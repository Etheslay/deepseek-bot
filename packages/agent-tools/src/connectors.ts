/**
 * Connector invocation tool (D19). Invokes a user-registered LOCAL service
 * (loopback only, enforced at registration). The user approves every call
 * with the exact parameters via the D16 checkpoint; the tool can neither
 * register connectors nor change endpoints, and there is no catalog read —
 * the model learns connector ids through list_bots-style context or the user.
 */
import { z } from "zod";
import type { ToolCapability } from "./types.js";

export const ConnectorInvokeInputSchema = z
  .object({
    connectorId: z.string().uuid(),
    action: z.enum(["txt2img"]),
    params: z
      .object({
        prompt: z.string().trim().min(1).max(2_000),
        negativePrompt: z.string().trim().max(2_000).optional(),
        width: z.int().min(64).max(2048).optional(),
        height: z.int().min(64).max(2048).optional(),
        steps: z.int().min(1).max(50).optional(),
      })
      .strict(),
  })
  .strict();

export interface ConnectorInvokeResult {
  readonly connectorId: string;
  readonly action: string;
  readonly savedPath: string;
  readonly sizeBytes: number;
  readonly at: string;
}

export interface ConnectorStore {
  invoke(
    connectorId: string,
    action: string,
    params: z.output<typeof ConnectorInvokeInputSchema>["params"],
  ): ConnectorInvokeResult | Promise<ConnectorInvokeResult>;
}

export function bindConnectorTools(
  store: ConnectorStore,
): [ToolCapability<typeof ConnectorInvokeInputSchema>] {
  return [
    {
      name: "connector_invoke",
      description:
        "Invoke one user-registered local connector (e.g. local Stable Diffusion image " +
        "generation). Every call needs user approval with the exact parameters. Returns the " +
        "absolute path of the saved output file on this machine. Connectors and endpoints are " +
        "managed by the user in settings, not by this tool.",
      inputSchema: ConnectorInvokeInputSchema,
      async handler(params) {
        return store.invoke(params.connectorId, params.action, params.params);
      },
    },
  ];
}
