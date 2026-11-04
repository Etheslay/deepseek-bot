/**
 * D26 attachment paths kept together:
 * - attachment.begin/append/commit and read_workspace_file
 * - chat.attach through the tool gateway (import_attachment / read)
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ATTACHMENT_CHUNK_RAW_BYTES, type AppApproval } from "@deepseek-bot/contracts";
import type { DeepSeekBotHost } from "./host.js";
import { createHost } from "./host.js";
import { startApplicationToolServer, type ApplicationToolServer } from "./app-tool-channel.js";

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

const ingressHosts: DeepSeekBotHost[] = [];
const toolServers: ApplicationToolServer[] = [];
const ingressRoots: string[] = [];
const secret = "Attachment body Omega-9";

afterEach(async () => {
  for (const server of toolServers.splice(0)) await server.close();
  for (const host of ingressHosts.splice(0)) await host.shutdown();
  for (const root of ingressRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function ingressSetup() {
  const root = mkdtemp();
  const host = await createHost({ dataRoot: root, resolveApiKey: async () => "unused" });
  ingressHosts.push(host);
  await host.handleMethod("permission.policy.set", { capability: "fs.write", mode: "ask" });
  await host.handleMethod("permission.policy.set", { capability: "fs.read", mode: "ask" });
  const bot = (await host.handleMethod("bot.create", {
    name: "attacher",
    instructions: "read attachments",
    modelProfileId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "55555555-5555-4555-8555-555555555555",
    toolPolicyId: "66666666-6666-4666-8666-666666666666",
  })) as { id: string };
  const server = await startApplicationToolServer(host.agentTools);
  toolServers.push(server);
  const sessionId = `physical:${randomUUID()}`;
  const turn = server.openTurn({
    sessionId,
    caller: { id: `chat:${bot.id}`, botId: bot.id, sessionId: `chat:${bot.id}` },
    signal: new AbortController().signal,
  });
  const request = (path: string, body?: unknown) =>
    fetch(`${server.url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${turn.env.DSB_APP_TOOLS_TOKEN}`,
        "content-type": "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  return { host, request, bot, sessionId, workspace: join(host.layout.root, "workspace") };
}

function mkdtemp(): string {
  const root = mkdtempSync(join(tmpdir(), "dsb-attach-"));
  ingressRoots.push(root);
  return root;
}

async function otherBot(host: DeepSeekBotHost): Promise<string> {
  const created = (await host.handleMethod("bot.create", {
    name: "other",
    instructions: "other",
    modelProfileId: "44444444-4444-4444-8444-444444444444",
    workspaceId: "55555555-5555-4555-8555-555555555555",
    toolPolicyId: "66666666-6666-4666-8666-666666666666",
  })) as { id: string };
  return created.id;
}

function pieces(bytes: Buffer): Buffer[] {
  const out: Buffer[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += ATTACHMENT_CHUNK_RAW_BYTES) {
    out.push(
      bytes.subarray(offset, Math.min(bytes.byteLength, offset + ATTACHMENT_CHUNK_RAW_BYTES)),
    );
  }
  return out;
}

async function attach(
  host: DeepSeekBotHost,
  botId: string,
  name: string,
  mediaType: string,
  bytes: Buffer,
  checksum = createHash("sha256").update(bytes).digest("hex"),
) {
  const parts = pieces(bytes);
  const uploadId = randomUUID();
  let last: unknown;
  for (let index = 0; index < parts.length; index += 1) {
    last = await host.handleMethod("chat.attach", {
      botId,
      uploadId,
      name,
      mediaType,
      size: bytes.byteLength,
      checksum,
      index,
      count: parts.length,
      data: parts[index]!.toString("base64"),
    });
  }
  return last;
}

async function pendingApprovals(host: DeepSeekBotHost): Promise<AppApproval[]> {
  const listed = (await host.handleMethod("permission.approval.list", {})) as {
    approvals: AppApproval[];
  };
  return listed.approvals;
}

describe("chat attachments", () => {
  it("keeps the file body out of the approval and writes nothing when denied", async () => {
    const { host, bot, workspace } = await ingressSetup();
    const bytes = Buffer.from(secret, "utf8");
    const file = join(workspace, "attachments", "notes.md");
    const pending = attach(host, bot.id, "notes.md", "text/markdown", bytes).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    const approval = await vi.waitFor(async () => {
      const listed = await pendingApprovals(host);
      expect(listed).toHaveLength(1);
      return listed[0]!;
    });
    expect(approval.tool).toBe("import_attachment");
    expect(approval.capabilities).toEqual(["fs.write"]);
    expect(approval.params).toMatchObject({
      name: "notes.md",
      mediaType: "text/markdown",
      size: bytes.byteLength,
    });
    expect(JSON.stringify(approval.params)).not.toContain(secret);
    expect(existsSync(file)).toBe(false);
    await host.handleMethod("permission.approval.decide", {
      approvalId: approval.id,
      expectedActionDigest: approval.actionDigest,
      decision: "denied",
      scope: "once",
    });
    const settled = await pending;
    expect(settled.ok).toBe(false);
    expect(settled.ok === false && settled.error).toMatchObject({ code: "UNAUTHORIZED_PATH" });
    expect(existsSync(file)).toBe(false);
    expect(await host.handleMethod("artifacts.list", { botId: bot.id })).toEqual({ artifacts: [] });
  });

  it("imports under grant, previews text, and lets read return the file", async () => {
    const { host, request, bot, sessionId, workspace } = await ingressSetup();
    await host.handleMethod("permission.policy.set", { capability: "fs.write", mode: "allow" });
    await host.handleMethod("permission.policy.set", { capability: "fs.read", mode: "allow" });
    const names = host.agentTools.capabilities.list().map((tool) => tool.name);
    expect(names).toContain("import_attachment");
    expect(names).toContain("read");
    const catalog = (await (await request("/app-tools")).json()) as {
      tools: Array<{ name: string }>;
    };
    expect(catalog.tools.map((tool) => tool.name)).not.toContain("import_attachment");
    expect(catalog.tools.map((tool) => tool.name)).not.toContain("read");
    const advertised = (await (await request("/read")).json()) as { tool: { name: string } };
    expect(advertised.tool.name).toBe("read");

    const bytes = Buffer.from(secret, "utf8");
    const imported = (await attach(host, bot.id, "notes.md", "text/markdown", bytes)) as {
      status: string;
      relativePath: string;
    };
    expect(imported).toMatchObject({
      status: "imported",
      relativePath: "attachments/notes.md",
      size: bytes.byteLength,
    });
    expect(readFileSync(join(workspace, "attachments", "notes.md"), "utf8")).toBe(secret);
    expect(existsSync(join(workspace, "notes.md"))).toBe(false);
    expect(await pendingApprovals(host)).toEqual([]);
    const listed = (await host.handleMethod("artifacts.list", { botId: bot.id })) as {
      artifacts: Array<{ relativePath: string }>;
    };
    expect(listed.artifacts.map((item) => item.relativePath)).toContain("attachments/notes.md");
    expect(
      await host.handleMethod("artifacts.read", { botId: bot.id, path: "attachments/notes.md" }),
    ).toMatchObject({
      kind: "text",
      content: secret,
    });
    expect(
      await (
        await request("/read/call", {
          sessionId,
          callId: randomUUID(),
          tool: "read",
          params: { file_path: "attachments/notes.md" },
        })
      ).json(),
    ).toMatchObject({
      ok: true,
      result: { kind: "text", content: secret, truncated: false },
    });
    expect(
      await (
        await request("/read/call", {
          sessionId,
          callId: randomUUID(),
          tool: "read",
          params: { file_path: "attachments/notes.md", botId: bot.id },
        })
      ).json(),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(
      await (
        await request("/app-tools/call", {
          sessionId,
          callId: randomUUID(),
          tool: "read",
          params: { file_path: "attachments/notes.md" },
        })
      ).json(),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });

    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await attach(host, bot.id, "shot.png", "image/png", image)).toMatchObject({
      status: "imported",
      relativePath: "attachments/shot.png",
    });
    expect(
      await (
        await request("/read/call", {
          sessionId,
          callId: randomUUID(),
          tool: "read",
          params: { file_path: "attachments/shot.png" },
        })
      ).json(),
    ).toMatchObject({
      ok: true,
      result: { kind: "image", mediaType: "image/png", size: image.byteLength },
    });
    expect(
      await host.handleMethod("artifacts.read", { botId: bot.id, path: "attachments/shot.png" }),
    ).toMatchObject({
      kind: "blocked",
    });

    const binary = Buffer.from([0, 1, 2, 3]);
    expect(
      await attach(host, bot.id, "blob.bin", "application/octet-stream", binary),
    ).toMatchObject({
      relativePath: "attachments/blob.bin",
    });
    expect(
      await (
        await request("/read/call", {
          sessionId,
          callId: randomUUID(),
          tool: "read",
          params: { file_path: "attachments/blob.bin" },
        })
      ).json(),
    ).toMatchObject({ ok: true, result: { kind: "binary", size: 4 } });

    const html = Buffer.from("<p>hello</p>", "utf8");
    expect(await attach(host, bot.id, "page.html", "text/html", html)).toMatchObject({
      relativePath: "attachments/page.html",
    });
    expect(
      await (
        await request("/read/call", {
          sessionId,
          callId: randomUUID(),
          tool: "read",
          params: { file_path: "attachments/page.html" },
        })
      ).json(),
    ).toMatchObject({ ok: true, result: { kind: "text", content: "<p>hello</p>" } });
    expect(
      await host.handleMethod("artifacts.read", { botId: bot.id, path: "attachments/page.html" }),
    ).toMatchObject({
      kind: "blocked",
    });

    const escaped = Buffer.from("kept inside", "utf8");
    expect(await attach(host, bot.id, "../../outside.txt", "text/plain", escaped)).toMatchObject({
      relativePath: "attachments/outside.txt",
    });
    expect(existsSync(join(workspace, "outside.txt"))).toBe(false);
    expect(readFileSync(join(workspace, "attachments", "outside.txt"), "utf8")).toBe("kept inside");
    await expect(
      attach(host, bot.id, "..", "text/plain", Buffer.from("no", "utf8")),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });

    const mismatched = Buffer.from("real bytes", "utf8");
    await expect(
      attach(
        host,
        bot.id,
        "bad.md",
        "text/markdown",
        mismatched,
        createHash("sha256").update("other").digest("hex"),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(existsSync(join(workspace, "attachments", "bad.md"))).toBe(false);

    await expect(
      host.handleMethod("tool.invoke", {
        tool: "import_attachment",
        callerBotId: bot.id,
        params: {
          uploadId: randomUUID(),
          name: "notes.md",
          mediaType: "text/plain",
          size: 1,
          checksum: "a".repeat(64),
        },
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });

    const wide = Buffer.alloc(ATTACHMENT_CHUNK_RAW_BYTES + 3, 7);
    expect(await attach(host, bot.id, "wide.bin", "application/octet-stream", wide)).toMatchObject({
      status: "imported",
      relativePath: "attachments/wide.bin",
      size: wide.byteLength,
    });

    const stranger = await otherBot(host);
    expect(
      await host.handleMethod("artifacts.read", { botId: stranger, path: "attachments/notes.md" }),
    ).toMatchObject({ kind: "text", content: secret });

    const audit = readFileSync(join(host.layout.logs, "agent-tools-audit.jsonl"), "utf8");
    expect(audit).toContain("import_attachment");
    expect(audit).toContain("read");
    expect(audit).not.toContain(secret);
  });
});
