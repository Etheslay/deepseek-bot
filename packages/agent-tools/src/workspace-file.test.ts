import { describe, expect, it } from "vitest";
import type { ToolCaller } from "./types.js";
import {
  bindWorkspaceFileTool,
  WorkspaceFileInputSchema,
  type WorkspaceFileReader,
} from "./workspace-file.js";

function caller(overrides: Partial<ToolCaller> = {}): ToolCaller {
  return {
    id: "chat:chat-bot-1/11111111-1111-4111-8111-111111111111",
    botId: "11111111-1111-4111-8111-111111111111",
    sessionId: "chat-bot-1",
    ...overrides,
  };
}

const reader: WorkspaceFileReader = {
  read: (botId, relativePath) => {
    if (relativePath === "missing.md") {
      throw new (class extends Error {
        code = "INVALID_INPUT";
      })("attachment does not exist");
    }
    return { path: relativePath, content: `read by ${botId}` };
  },
};

describe("read_workspace_file", () => {
  it("forwards the parsed relative path with the trusted bot identity", async () => {
    const tool = bindWorkspaceFileTool(reader);
    const parsed = WorkspaceFileInputSchema.parse({ path: "attachments/notes.md" });
    const result = (await tool.handler(parsed, {
      caller: caller(),
    })) as { path: string; content: string };
    expect(result.path).toBe("attachments/notes.md");
    expect(result.content).toBe(
      "read by 11111111-1111-4111-8111-111111111111",
    );
  });

  it("rejects callers without a trusted bot identity before touching the reader", async () => {
    const spy: WorkspaceFileReader = {
      read: () => {
        throw new Error("reader must not be reached");
      },
    };
    const tool = bindWorkspaceFileTool(spy);
    await expect(
      tool.handler({ path: "attachments/notes.md" }, { caller: { id: "opaque" } }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
  });

  it("rejects absolute paths and traversal in the schema", () => {
    expect(
      WorkspaceFileInputSchema.safeParse({ path: "C:/Windows/system32" }).success,
    ).toBe(false);
    expect(WorkspaceFileInputSchema.safeParse({ path: "/etc/passwd" }).success).toBe(false);
    expect(
      WorkspaceFileInputSchema.safeParse({ path: "attachments/../../secrets.txt" }).success,
    ).toBe(false);
    expect(WorkspaceFileInputSchema.safeParse({ path: "..\\notes.md" }).success).toBe(false);
  });
});
