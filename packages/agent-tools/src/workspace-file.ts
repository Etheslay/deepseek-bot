/**
 * D26 attachment read closure: `read_workspace_file` lets a chat bot read one
 * text file from its own bot workspace (where trusted desktop uploads land in
 * `attachments/`). Path constraints, binary rejection and size caps live in
 * the Host-side reader; the tool only binds the trusted caller identity and
 * forwards. Authorization maps to the D08/D16 capability `fs.read`
 * (agent-permissions CAPABILITIES), so policy and audit follow the same
 * three-tier model as every other side-effectful tool.
 */
import { z } from "zod";
import { ToolRejectionError, type ToolCapability, type ToolContext } from "./types.js";

export const WorkspaceFilePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .superRefine((value, ctx) => {
    if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value)) {
      ctx.addIssue({ code: "custom", message: "path must be relative to the bot workspace" });
    }
    if (value.split(/[\\/]/).some((segment) => segment === "..")) {
      ctx.addIssue({ code: "custom", message: "path must not traverse outside the workspace" });
    }
  });

export const WorkspaceFileInputSchema = z
  .object({ path: WorkspaceFilePathSchema })
  .strict();

export interface WorkspaceFileContent {
  /** Workspace-relative path actually served (posix separators). */
  readonly path: string;
  /** UTF-8 text content; the Host rejects binaries and oversize files. */
  readonly content: string;
}

/** Host-side reader: workspace clamping, media checks and size caps. */
export interface WorkspaceFileReader {
  read(botId: string, relativePath: string): Promise<WorkspaceFileContent> | WorkspaceFileContent;
}

function requireBot(context: ToolContext): string {
  const botId = context.caller.botId;
  if (typeof botId !== "string" || botId.length === 0) {
    throw new ToolRejectionError(
      "UNAUTHORIZED_PATH",
      "workspace file caller is not bound to a bot",
    );
  }
  return botId;
}

export function bindWorkspaceFileTool(
  reader: WorkspaceFileReader,
): ToolCapability<typeof WorkspaceFileInputSchema> {
  return {
    name: "read_workspace_file",
    description:
      "Read one text file from the bot workspace (chat attachments land in attachments/). " +
      "Returns the workspace-relative path and UTF-8 content; binary files and files above " +
      "the inline size cap are rejected instead of truncated.",
    inputSchema: WorkspaceFileInputSchema,
    handler: async (params, context) => {
      const botId = requireBot(context);
      return reader.read(botId, params.path);
    },
  };
}
