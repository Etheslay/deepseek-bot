import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { createBot } from "@deepseek-bot/storage";
import { createHost, type DeepSeekBotHost } from "./host.js";
import {
  collectAttachmentParsePaths,
  composeAttachmentParseBlocks,
  extractDocxBody,
  extractPdfBody,
  PARSE_INLINE_BYTES,
  parseAndStoreAttachment,
} from "./attachment-parse.js";

const fakeHarness = fileURLToPath(
  new URL("../../harness-adapter/src/testing/fake-harness.mjs", import.meta.url),
);

/** Build a minimal single-page PDF whose text layer says `text`. */
function buildPdf(text: string): Uint8Array {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = pdf.length;
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

function docxWithBody(bodyXml: string): Uint8Array {
  return zipSync({
    "word/document.xml": new TextEncoder().encode(
      `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${bodyXml}</w:body></w:document>`,
    ),
    "[Content_Types].xml": new TextEncoder().encode("<Types/>"),
  });
}

describe("attachment body extraction (B4')", () => {
  it("extracts the PDF text layer with its page count", async () => {
    const body = await extractPdfBody(buildPdf("Hello B4 body"), { aborted: false });
    expect(body.text).toContain("Hello B4 body");
    expect(body.pages).toBe(1);
    expect(body.truncated).toBe(false);
  });

  it("reports an empty text layer for a scanned pdf (no body invented)", async () => {
    const body = await extractPdfBody(buildPdf(""), { aborted: false });
    expect(body.text).toBe("");
  });

  it("fails loudly on a corrupt pdf instead of inventing text", async () => {
    await expect(
      extractPdfBody(new TextEncoder().encode("definitely not a pdf"), { aborted: false }),
    ).rejects.toThrow();
  });

  it("extracts docx runs with tabs, breaks and entity decoding", () => {
    const body = extractDocxBody(
      docxWithBody(
        "<w:p><w:r><w:t>Hello &amp; B4</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>world</w:t></w:r></w:p>" +
          "<w:p><w:r><w:t>second &#20013; line</w:t></w:r></w:p>",
      ),
    );
    expect(body.text).toBe("Hello & B4\tworld\nsecond 中 line");
    expect(body.paragraphs).toBe(2);
  });

  it("refuses a docx whose body entry declares a decompressed size beyond the bomb guard", () => {
    const huge = new TextEncoder().encode("A".repeat(17 * 1024 * 1024));
    const zip = zipSync({ "word/document.xml": huge });
    expect(() => extractDocxBody(zip)).toThrowError(/word\/document\.xml/);
  });

  it("rejects a docx without a body entry explicitly", () => {
    const zip = zipSync({ "not-the-body.xml": new TextEncoder().encode("<x/>") });
    expect(() => extractDocxBody(zip)).toThrowError(/word\/document\.xml/);
  });
});

const roots: string[] = [];
const hosts: DeepSeekBotHost[] = [];

afterAll(async () => {
  for (const host of hosts.splice(0)) {
    await host.shutdown().catch(() => undefined);
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function hostWithBot(): Promise<{
  host: DeepSeekBotHost;
  botId: string;
  workspacePath: string;
}> {
  const root = mkdtempSync(join(tmpdir(), "dsb-attachment-parse-"));
  roots.push(root);
  const host = await createHost({
    dataRoot: root,
    resolveApiKey: async () => "sk-test-only",
    dshBin: fakeHarness,
    childEnv: (parent) => ({ ...parent, FAKE_SCENARIO: "ok" }),
  });
  hosts.push(host);
  const now = host.db.now().toISOString();
  const ref = `cred:${randomUUID()}`;
  host.db.raw
    .prepare("INSERT INTO credentials (ref, label, created_at, updated_at) VALUES (?, 't', ?, ?);")
    .run(ref, now, now);
  const profileId = randomUUID();
  host.db.raw
    .prepare(
      "INSERT INTO model_profiles (id, provider, model, endpoint, credential_ref, limits_json, created_at, updated_at) " +
        "VALUES (?, 'deepseek', 'deepseek-chat', 'https://api.deepseek.com', ?, '{}', ?, ?);",
    )
    .run(profileId, ref, now, now);
  const workspaceId = randomUUID();
  host.db.raw
    .prepare(
      "INSERT INTO workspaces (id, canonical_path, grants_json, created_at, updated_at) VALUES (?, ?, '[]', ?, ?);",
    )
    .run(workspaceId, join(root, "ws"), now, now);
  mkdirSync(join(root, "ws"), { recursive: true });
  const policyId = randomUUID();
  host.db.raw
    .prepare(
      "INSERT INTO tool_policies (id, revision, name, policy_json, created_at, updated_at) VALUES (?, ?, 't', ?, ?, ?);",
    )
    .run(
      policyId,
      randomUUID(),
      JSON.stringify({
        filesystem: { enabled: false, operations: [] },
        shell: { mode: "disabled" },
        network: { mode: "disabled" },
        mcp: { enabled: false, requireApproval: false, servers: [] },
      }),
      now,
      now,
    );
  const bot = createBot(host.db, {
    bot: {
      id: randomUUID(),
      revision: randomUUID(),
      name: "parse-bot",
      instructions: "be helpful",
      modelProfileId: profileId,
      workspaceId,
      toolPolicyId: policyId,
      role: "standard",
      archivedAt: null,
    },
  });
  return { host, botId: bot.bot.id, workspacePath: join(root, "ws") };
}

describe("attachment parse cache and chat injection (B4')", () => {
  it("injects the extracted pdf body into the turn the prompt names", async () => {
    const { host, botId, workspacePath } = await hostWithBot();
    mkdirSync(join(workspacePath, "attachments"), { recursive: true });
    writeFileSync(join(workspacePath, "attachments", "manual.pdf"), buildPdf("Parsed manual body"));
    const row = await parseAndStoreAttachment(
      host.db,
      botId,
      "attachments/manual.pdf",
      randomUUID(),
    );
    expect(row.status).toBe("ok");
    await host.handleMethod("chat.send", {
      botId,
      text: "【附件 manual.pdf · 1.0 KB · attachments/manual.pdf】\n请使用 read 工具读取该工作区文件后再回答。",
    });
    const history = (await host.handleMethod("chat.history", { botId, limit: 10 })) as {
      messages: Array<{ role: string; text: string }>;
    };
    const userRow = history.messages.find((message) => message.role === "user");
    expect(userRow?.text).toContain("【附件正文 manual.pdf】");
    expect(userRow?.text).toContain("Parsed manual body");
  });

  it("answers 无法提取正文 in the block when the file is corrupt", async () => {
    const { host, botId, workspacePath } = await hostWithBot();
    mkdirSync(join(workspacePath, "attachments"), { recursive: true });
    writeFileSync(join(workspacePath, "attachments", "broken.pdf"), Buffer.from("not a pdf"));
    await host.handleMethod("chat.send", {
      botId,
      text: "【附件 broken.pdf · 1.0 KB · attachments/broken.pdf】",
    });
    const history = (await host.handleMethod("chat.history", { botId, limit: 10 })) as {
      messages: Array<{ role: string; text: string }>;
    };
    const userRow = history.messages.find((message) => message.role === "user");
    expect(userRow?.text).toContain("无法提取正文：");
    // The conversation itself is untouched: the next send works normally.
    await expect(host.handleMethod("chat.send", { botId, text: "再次尝试" })).resolves.toMatchObject({
      text: expect.any(String),
    });
  });

  it("inlines at most 16 KiB and marks the truncation with the original size", async () => {
    const { host, botId, workspacePath } = await hostWithBot();
    mkdirSync(join(workspacePath, "attachments"), { recursive: true });
    const longText = "字".repeat(20_000);
    writeFileSync(
      join(workspacePath, "attachments", "long.docx"),
      docxWithBody(`<w:p><w:r><w:t>${longText}</w:t></w:r></w:p>`),
    );
    const row = await parseAndStoreAttachment(host.db, botId, "attachments/long.docx", randomUUID());
    expect(row.status).toBe("ok");
    expect(row.originalChars).toBe(20_000);
    const blocks = await composeAttachmentParseBlocks(
      host.db,
      botId,
      collectAttachmentParsePaths("【附件 long.docx · 1.0 KB · attachments/long.docx】"),
    );
    // The collector reads exactly the paths the renderer's block names.
    expect(collectAttachmentParsePaths("没有附件的普通消息")).toEqual([]);
    expect(
      collectAttachmentParsePaths(
        "【附件 a.pdf · 1 KB · attachments/a.pdf】【附件 b.docx · 2 KB · attachments/b.docx】",
      ),
    ).toEqual(["attachments/a.pdf", "attachments/b.docx"]);
    expect(
      collectAttachmentParsePaths(
        "【附件 实验报告.pdf · 30 kB · attachments/实验报告.pdf】【附件 my report.docx · 2 KB · attachments/my report.docx】",
      ),
    ).toEqual(["attachments/实验报告.pdf", "attachments/my report.docx"]);
    expect(blocks).toContain("附件正文已截断：原始 20000 字符");
    expect(blocks).toContain("read_workspace_file");
    // The body block's inline payload stays inside the 16 KiB budget: the
    // CJK text slices to ~5.4k chars before hitting the byte ceiling, and the
    // scaffolding adds only the header and marker.
    const inlineStart = blocks.indexOf("```\n") + 4;
    const inlineEnd = blocks.indexOf("\n```", inlineStart);
    expect(
      new TextEncoder().encode(blocks.slice(inlineStart, inlineEnd)).byteLength,
    ).toBeLessThanOrEqual(PARSE_INLINE_BYTES);
  });

  it("records parse_failed with the reason for an unsupported type", async () => {
    const { host, botId, workspacePath } = await hostWithBot();
    mkdirSync(join(workspacePath, "attachments"), { recursive: true });
    writeFileSync(join(workspacePath, "attachments", "data.bin"), Buffer.from([1, 2, 3]));
    const row = await parseAndStoreAttachment(
      host.db,
      botId,
      "attachments/data.bin",
      randomUUID(),
    );
    expect(row.status).toBe("parse_failed");
    expect(row.errorReason).toContain("不支持的附件类型");
  });
});
