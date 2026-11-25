/**
 * `edit_document` creates, reads, edits, deletes, and converts one workspace
 * Word or PDF file. The Host owns the bytes. Authorization is `fs.read` for
 * read and `fs.write` for every other action.
 */
import { z } from "zod";
import { ToolRejectionError, type ToolCapability, type ToolContext } from "./types.js";
import { WorkspaceFilePathSchema } from "./workspace-file.js";

export const DOCUMENT_EDIT_ACTIONS = [
  "create",
  "read",
  "append",
  "replace",
  "delete_text",
  "delete_file",
  "convert",
] as const;

export type DocumentEditAction = (typeof DOCUMENT_EDIT_ACTIONS)[number];

export const EditDocumentInputSchema = z
  .object({
    action: z.enum(DOCUMENT_EDIT_ACTIONS),
    path: WorkspaceFilePathSchema,
    text: z.string().max(100_000).optional(),
    find: z.string().min(1).max(10_000).optional(),
    to: WorkspaceFilePathSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const docx = /\.docx$/i.test(value.path);
    const pdf = /\.pdf$/i.test(value.path);
    if (!docx && !pdf) {
      ctx.addIssue({ code: "custom", message: "path must end with .docx or .pdf" });
    }
    if (value.action === "create" && !docx) {
      ctx.addIssue({ code: "custom", message: "create only writes a .docx" });
    }
    if ((value.action === "append" || value.action === "replace" || value.action === "delete_text") && !docx) {
      ctx.addIssue({ code: "custom", message: "text edits only apply to a .docx" });
    }
    if ((value.action === "create" || value.action === "append" || value.action === "replace") && value.text === undefined) {
      ctx.addIssue({ code: "custom", message: "text is required" });
    }
    if (value.action === "append" && value.text?.length === 0) {
      ctx.addIssue({ code: "custom", message: "text is required" });
    }
    if (value.action === "delete_text" && value.find === undefined) {
      ctx.addIssue({ code: "custom", message: "find is required" });
    }
    if (value.action === "convert") {
      if (value.to === undefined) {
        ctx.addIssue({ code: "custom", message: "to is required" });
      } else if (docx && !/\.pdf$/i.test(value.to)) {
        ctx.addIssue({ code: "custom", message: "converting a .docx writes a .pdf" });
      } else if (pdf && !/\.docx$/i.test(value.to)) {
        ctx.addIssue({ code: "custom", message: "converting a .pdf writes a .docx" });
      }
    }
  });

export type DocumentEditInput = z.infer<typeof EditDocumentInputSchema>;

export interface DocumentEditResult {
  readonly action: DocumentEditAction;
  readonly path: string;
  readonly format: "docx" | "pdf";
  readonly text?: string;
  readonly bytes?: number;
  readonly matches?: number;
  readonly outputPath?: string;
  readonly deleted?: boolean;
}

export interface DocumentEditor {
  edit(botId: string, input: DocumentEditInput): Promise<DocumentEditResult> | DocumentEditResult;
}

function requireBot(context: ToolContext): string {
  const botId = context.caller.botId;
  if (typeof botId !== "string" || botId.length === 0) {
    throw new ToolRejectionError("UNAUTHORIZED_PATH", "document editor is not bound to a bot");
  }
  return botId;
}

export function bindEditDocumentTool(
  editor: DocumentEditor,
): ToolCapability<typeof EditDocumentInputSchema> {
  return {
    name: "edit_document",
    description:
      "Create, read, change, and delete a Word file in the bot workspace, or convert it to PDF. " +
      "action is create, read, append, replace, delete_text, delete_file, or convert. " +
      "path is workspace-relative. create writes a new .docx from text and fails if that file already exists. " +
      "read returns the text; pass find to return only lines that contain it. " +
      "append adds text at the end of an existing .docx. " +
      "replace with find swaps every occurrence, and without find rewrites the whole .docx. " +
      "delete_text removes every occurrence of find. delete_file removes the .docx or .pdf. " +
      "convert writes the other format at to and keeps the source. A .docx becomes a PDF through the " +
      "Harness LibreOffice engine, so the PDF keeps the Word layout. A PDF becomes a .docx from its text. " +
      "When the user asks for a new Word file, an edit, or a PDF conversion, call this tool instead of refusing. " +
      "When this call writes or converts a file, the chat attaches it. Tell the user the file is in this chat. " +
      "Do not paste a disk path, a folder, or a download link.",
    inputSchema: EditDocumentInputSchema,
    handler: async (params, context) => {
      const botId = requireBot(context);
      return editor.edit(botId, params);
    },
  };
}
