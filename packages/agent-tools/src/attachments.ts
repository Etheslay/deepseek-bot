/**
 * Chat attachment tools (D26).
 *
 * `import_attachment` is not a model tool. The Host stages bytes from the
 * trusted desktop method and only then calls the gateway, so the write is
 * grant- and approval-checked and the approval preview stores the name,
 * type, size and checksum — not the file body.
 *
 * `read` is the model tool that returns what was written. Chat shadows the
 * harness built-in of the same name so the call stays on this gateway.
 */
import { z } from "zod";
import { ToolRejectionError, type ToolCapability, type ToolContext } from "./types.js";

export const ImportAttachmentInputSchema = z
  .object({
    uploadId: z.string().uuid(),
    name: z.string().min(1).max(200),
    mediaType: z.string().min(3).max(255),
    size: z.int().min(1),
    checksum: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export const ReadWorkspaceInputSchema = z
  .object({
    file_path: z.string().min(1).max(1024),
  })
  .strict();

export interface ImportedAttachment {
  readonly relativePath: string;
  readonly mediaType: string;
  readonly size: number;
  readonly checksum: string;
}

export type WorkspaceRead =
  | {
      readonly kind: "text";
      readonly relativePath: string;
      readonly mediaType: string;
      readonly content: string;
      readonly truncated: boolean;
    }
  | {
      readonly kind: "image" | "binary";
      readonly relativePath: string;
      readonly mediaType: string;
      readonly size: number;
    };

export interface AttachmentWorkspace {
  importFile(
    botId: string,
    input: z.infer<typeof ImportAttachmentInputSchema>,
  ): ImportedAttachment | Promise<ImportedAttachment>;
  readFile(botId: string, relativePath: string): WorkspaceRead | Promise<WorkspaceRead>;
}

function requireBot(context: ToolContext): string {
  const botId = context.caller.botId;
  if (typeof botId !== "string" || botId.length === 0) {
    throw new ToolRejectionError("UNAUTHORIZED_PATH", "attachment caller is not bound to a bot");
  }
  return botId;
}

export function bindAttachmentTools(
  store: AttachmentWorkspace,
): [
  ToolCapability<typeof ImportAttachmentInputSchema>,
  ToolCapability<typeof ReadWorkspaceInputSchema>,
] {
  return [
    {
      name: "import_attachment",
      description:
        "Write one staged chat attachment into this bot's workspace. The model cannot supply file bytes or choose a bot.",
      inputSchema: ImportAttachmentInputSchema,
      async handler(params, context) {
        return store.importFile(requireBot(context), params);
      },
    },
    {
      name: "read",
      description:
        "Read one file in this bot's workspace. file_path is workspace-relative, for example attachments/notes.md. Text returns the file content. Images and other binaries return type and size only. There is no parameter for choosing a bot or an absolute path.",
      inputSchema: ReadWorkspaceInputSchema,
      async handler(params, context) {
        return store.readFile(requireBot(context), params.file_path);
      },
    },
  ];
}
