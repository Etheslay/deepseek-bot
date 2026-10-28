import { describe, expect, it } from "vitest";
import { ToolGateway, ToolRegistry } from "./gateway.js";
import { MemoryAuditSink } from "./audit.js";
import { ToolRejectionError } from "./types.js";
import {
  bindAttachmentTools,
  type AttachmentWorkspace,
  type ImportedAttachment,
  type WorkspaceRead,
} from "./attachments.js";

function gateway(store: AttachmentWorkspace) {
  const registry = new ToolRegistry();
  for (const tool of bindAttachmentTools(store)) registry.register(tool);
  const audit = new MemoryAuditSink();
  return {
    audit,
    gateway: new ToolGateway({
      registry,
      audit,
      grants: {
        async check() {
          return { allowed: true, decision: "policy" };
        },
      },
    }),
  };
}

describe("attachment tools", () => {
  it("imports through the caller bot and reads the staged file back", async () => {
    const files = new Map<string, string>();
    const store: AttachmentWorkspace = {
      importFile(botId, input) {
        const saved: ImportedAttachment = {
          relativePath: `attachments/${input.name}`,
          mediaType: "text/plain",
          size: input.size,
          checksum: input.checksum,
        };
        files.set(`${botId}:${saved.relativePath}`, "hello attachment");
        return saved;
      },
      readFile(botId, relativePath) {
        const content = files.get(`${botId}:${relativePath}`);
        if (content === undefined) {
          throw new ToolRejectionError("INVALID_INPUT", "missing");
        }
        const result: WorkspaceRead = {
          kind: "text",
          relativePath,
          mediaType: "text/plain",
          content,
          truncated: false,
        };
        return result;
      },
    };
    const { gateway: tools } = gateway(store);
    const caller = { id: "ui:bot", botId: "11111111-1111-4111-8111-111111111111" };
    const imported = (await tools.call(caller, "import_attachment", {
      uploadId: "22222222-2222-4222-8222-222222222222",
      name: "notes.txt",
      mediaType: "text/plain",
      size: 16,
      checksum: "a".repeat(64),
    })) as ImportedAttachment;
    expect(imported.relativePath).toBe("attachments/notes.txt");
    await expect(
      tools.call({ id: "anon" }, "import_attachment", {
        uploadId: "33333333-3333-4333-8333-333333333333",
        name: "notes.txt",
        mediaType: "text/plain",
        size: 16,
        checksum: "b".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    const read = (await tools.call(caller, "read", {
      file_path: imported.relativePath,
    })) as WorkspaceRead;
    expect(read).toMatchObject({ kind: "text", content: "hello attachment" });
  });

  it("rejects a read that names a bot or an absolute path", async () => {
    const store: AttachmentWorkspace = {
      importFile() {
        throw new Error("unused");
      },
      readFile() {
        throw new Error("unused");
      },
    };
    const { gateway: tools } = gateway(store);
    await expect(
      tools.call({ id: "ui", botId: "11111111-1111-4111-8111-111111111111" }, "read", {
        file_path: "/etc/passwd",
        botId: "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
