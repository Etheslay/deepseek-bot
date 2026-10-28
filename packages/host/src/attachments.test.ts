import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DeepSeekBotHost } from "./host.js";
import { createHost } from "./host.js";

const hosts: DeepSeekBotHost[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.shutdown().catch(() => undefined);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function setup(): Promise<{ host: DeepSeekBotHost; botId: string; root: string }> {
  const root = mkdtempSync(join(tmpdir(), "dsb-attachments-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => "unused",
  });
  hosts.push(host);
  const bot = (await host.handleMethod("bot.create", {
    name: "attachments",
    instructions: "attachments",
    modelProfileId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "55555555-5555-4555-8555-555555555555",
    toolPolicyId: "66666666-6666-4666-8666-666666666666",
  })) as { id: string };
  return { host, botId: bot.id, root };
}

const sha = (bytes: Buffer | string): string =>
  createHash("sha256").update(bytes).digest("hex");

const b64 = (text: string): string => Buffer.from(text, "utf8").toString("base64");

describe("attachment upload store", () => {
  it("commits chunks into the bot workspace attachments directory", async () => {
    const { host, botId, root } = await setup();
    const payload = "# notes\n\nread me via read_workspace_file";
    const begun = (await host.handleMethod("attachment.begin", {
      botId,
      name: "notes.md",
      size: Buffer.byteLength(payload),
      sha256: sha(payload),
    })) as { uploadId: string };
    const appended = (await host.handleMethod("attachment.append", {
      uploadId: begun.uploadId,
      chunkBase64: b64(payload),
    })) as { received: number };
    expect(appended.received).toBe(Buffer.byteLength(payload));
    const committed = (await host.handleMethod("attachment.commit", {
      uploadId: begun.uploadId,
    })) as { botId: string; path: string; size: number; checksum: string };
    expect(committed).toEqual({
      botId,
      path: "attachments/notes.md",
      size: Buffer.byteLength(payload),
      checksum: sha(payload),
    });
    const stored = readFileSync(join(root, "workspace", "attachments", "notes.md"), "utf8");
    expect(stored).toBe(payload);
    // Commit removes the staging file: the cache sweep area is empty again.
    const staging = join(root, "cache", "attachments-staging");
    expect(readdirSync(staging)).toEqual([]);
  });

  it("dedupes colliding names instead of overwriting workspace files", async () => {
    const { host, botId } = await setup();
    const upload = async (text: string): Promise<{ path: string }> => {
      const begun = (await host.handleMethod("attachment.begin", {
        botId,
        name: "notes.md",
        size: Buffer.byteLength(text),
        sha256: sha(text),
      })) as { uploadId: string };
      await host.handleMethod("attachment.append", {
        uploadId: begun.uploadId,
        chunkBase64: b64(text),
      });
      return (await host.handleMethod("attachment.commit", {
        uploadId: begun.uploadId,
      })) as { path: string };
    };
    expect((await upload("first")).path).toBe("attachments/notes.md");
    expect((await upload("second")).path).toBe("attachments/notes-1.md");
  });

  it("rejects chunks beyond the declared size and cleans staging", async () => {
    const { host, botId, root } = await setup();
    const begun = (await host.handleMethod("attachment.begin", {
      botId,
      name: "big.md",
      size: 4,
      sha256: sha("abcd"),
    })) as { uploadId: string };
    await expect(
      host.handleMethod("attachment.append", {
        uploadId: begun.uploadId,
        chunkBase64: b64("abcdefgh"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(readdirSync(join(root, "cache", "attachments-staging"))).toEqual([]);
    await expect(
      host.handleMethod("attachment.append", {
        uploadId: begun.uploadId,
        chunkBase64: b64("a"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("refuses a commit whose checksum does not match and stores nothing", async () => {
    const { host, botId, root } = await setup();
    const begun = (await host.handleMethod("attachment.begin", {
      botId,
      name: "tampered.md",
      size: 5,
      sha256: sha("right"),
    })) as { uploadId: string };
    await host.handleMethod("attachment.append", {
      uploadId: begun.uploadId,
      chunkBase64: b64("wrong"),
    });
    await expect(
      host.handleMethod("attachment.commit", { uploadId: begun.uploadId }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(existsSync(join(root, "workspace", "attachments", "tampered.md"))).toBe(false);
    expect(readdirSync(join(root, "cache", "attachments-staging"))).toEqual([]);
  });

  it("rejects path separators and unknown or archived bots before staging", async () => {
    const { host, botId } = await setup();
    await expect(
      host.handleMethod("attachment.begin", {
        botId,
        name: "sub/dir.md",
        size: 1,
        sha256: sha("x"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      host.handleMethod("attachment.begin", {
        botId: "99999999-9999-4999-8999-999999999999",
        name: "ok.md",
        size: 1,
        sha256: sha("x"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const listed = (await host.handleMethod("bot.list", {})) as {
      bots: Array<{ id: string; revision: string }>;
    };
    const created = listed.bots.find((bot) => bot.id === botId)!;
    await host.handleMethod("bot.archive", {
      id: botId,
      expectedRevision: created.revision,
    });
    await expect(
      host.handleMethod("attachment.begin", {
        botId,
        name: "ok.md",
        size: 1,
        sha256: sha("x"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("read_workspace_file tool", () => {
  it("serves uploaded text through the gateway after an allow policy", async () => {
    const { host, botId } = await setup();
    await host.handleMethod("permission.policy.set", { capability: "fs.read", mode: "allow" });
    const payload = "attachment body for the bot";
    const begun = (await host.handleMethod("attachment.begin", {
      botId,
      name: "brief.md",
      size: Buffer.byteLength(payload),
      sha256: sha(payload),
    })) as { uploadId: string };
    await host.handleMethod("attachment.append", {
      uploadId: begun.uploadId,
      chunkBase64: b64(payload),
    });
    const committed = (await host.handleMethod("attachment.commit", {
      uploadId: begun.uploadId,
    })) as { path: string };
    expect(committed.path).toBe("attachments/brief.md");

    const result = (await host.agentTools.call(
      { id: `chat:chat-${botId}/${botId}`, botId, sessionId: `chat-${botId}` },
      "read_workspace_file",
      { path: committed.path },
    )) as { path: string; content: string };
    expect(result).toEqual({ path: "attachments/brief.md", content: payload });
  });

  it("rejects traversal, hidden files, binaries and oversize files explicitly", async () => {
    const { host, botId, root } = await setup();
    await host.handleMethod("permission.policy.set", { capability: "fs.read", mode: "allow" });
    const caller = { id: `chat:chat-${botId}/${botId}`, botId, sessionId: `chat-${botId}` };
    const read = (path: string): Promise<unknown> =>
      host.agentTools.call(caller, "read_workspace_file", { path });

    // The tool schema rejects traversal before the reader; the Host reader's
    // realpath clamp stays as defense in depth (hidden-file case below).
    await expect(read("attachments/../../secrets.txt")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(read("attachments/../outside.md")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });

    mkdirSync(join(root, "workspace", "attachments"), { recursive: true });
    writeFileSync(join(root, "workspace", "attachments", ".hidden.md"), "hidden");
    await expect(read("attachments/.hidden.md")).rejects.toMatchObject({
      code: "UNAUTHORIZED_PATH",
    });

    writeFileSync(
      join(root, "workspace", "attachments", "blob.bin"),
      Buffer.from([0x00, 0x01, 0x02]),
    );
    await expect(read("attachments/blob.bin")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });

    const oversized = "x".repeat(768 * 1024 + 1);
    writeFileSync(join(root, "workspace", "attachments", "huge.txt"), oversized);
    await expect(read("attachments/huge.txt")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("refuses callers without a trusted bot identity", async () => {
    const { host } = await setup();
    await expect(
      host.agentTools.call({ id: "opaque" }, "read_workspace_file", { path: "a.md" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
  });
});
