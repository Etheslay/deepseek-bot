import { z } from "zod";
import { McpToolNameSchema } from "@deepseek-bot/contracts";
import type { ToolCapability, ToolContext } from "./types.js";

/** Metadata is supplied by the authenticated turn catalog, never model arguments. */
export const McpInvokeInputSchema = z
  .object({
    definitionId: z.string().uuid(),
    connectorId: z.string().uuid(),
    connectorName: z.string().min(1).max(200),
    toolName: McpToolNameSchema,
    endpoint: z.string().min(1).max(2048),
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict()
  .refine(
    (value) => Buffer.byteLength(JSON.stringify(value.arguments)) <= 64 * 1024,
    "MCP arguments exceed the size limit",
  );
export type McpInvokeInput = z.infer<typeof McpInvokeInputSchema>;

export function bindMcpTool(
  invoke: (input: McpInvokeInput, context: ToolContext) => Promise<unknown>,
): ToolCapability<typeof McpInvokeInputSchema> {
  return {
    name: "mcp_call",
    description:
      "Call one explicitly authorized local MCP tool after single-action human approval.",
    inputSchema: McpInvokeInputSchema,
    handler: invoke,
    resultFailed: (result) =>
      typeof result === "object" &&
      result !== null &&
      "isError" in result &&
      result.isError === true,
  };
}
