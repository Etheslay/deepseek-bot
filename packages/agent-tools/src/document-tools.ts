/**
 * `write_document` replaces one workspace .docx or .pdf with new text.
 * The Host encodes the bytes; this binding only checks the caller and the
 * shape of the request. Authorization maps to `fs.write`.
 */
import { z } from "zod";
import { ToolRejectionError, type ToolCapability, type ToolContext } from "./types.js";
import { WorkspaceFilePathSchema } from "./workspace-file.js";

export const WriteDocumentInputSchema = z
  .object({
    path: WorkspaceFilePathSchema,
    text: z.string().max(100_000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!/\.(?:pdf|docx)$/i.test(value.path)) {
      ctx.addIssue({ code: "custom", message: "path must end with .docx or .pdf" });
    }
  });

export interface WrittenDocument {
  readonly path: string;
  readonly bytes: number;
  readonly format: "pdf" | "docx";
}

export interface DocumentWriter {
  write(
    botId: string,
    relativePath: string,
    text: string,
  ): Promise<WrittenDocument> | WrittenDocument;
}

function requireBot(context: ToolContext): string {
  const botId = context.caller.botId;
  if (typeof botId !== "string" || botId.length === 0) {
    throw new ToolRejectionError(
      "UNAUTHORIZED_PATH",
      "document writer is not bound to a bot",
    );
  }
  return botId;
}

export function bindWriteDocumentTool(
  writer: DocumentWriter,
): ToolCapability<typeof WriteDocumentInputSchema> {
  return {
    name: "write_document",
    description:
      "Write one .docx or .pdf in the bot workspace from the full text. " +
      "path is workspace-relative and must end in .docx or .pdf. text is the entire document, " +
      "not a patch. A .pdf path is rendered by the Harness LibreOffice engine into a real PDF, " +
      "including Chinese; call it whenever the user wants a PDF document. " +
      "A slide deck is write_presentation, not this tool. " +
      "Use this to rewrite a chat attachment such as attachments/report.docx. " +
      "After it returns, the chat attaches the file under the reply. Tell the user the file is in this chat. " +
      "Do not paste a disk path, a folder, or a download link.",
    inputSchema: WriteDocumentInputSchema,
    handler: async (params, context) => {
      const botId = requireBot(context);
      return writer.write(botId, params.path, params.text);
    },
  };
}
