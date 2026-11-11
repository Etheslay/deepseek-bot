/**
 * The desktop host runs dist/main.js, not the workspace sources. The
 * LibreOffice kit loads a sibling worker, so the bundle must leave the
 * package external and ship that worker beside main.js.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { buildDocx } from "./document-write.js";

const dist = join(import.meta.dirname, "..", "dist");
const main = join(dist, "main.js");
const worker = join(
  dist,
  "node_modules",
  "@deepseek-ai",
  "libreoffice-kit",
  "lib",
  "font-snapshot-worker.js",
);
const built = existsSync(main) && existsSync(worker);

describe("bundled LibreOffice kit", () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  it("keeps the kit external and ships its worker next to the host bundle", () => {
    if (!built) return;
    const source = readFileSync(main, "utf8");
    expect(source).toContain("@deepseek-ai/libreoffice-kit");
    expect(source).not.toContain("font-snapshot-worker.js");
  });

  it("converts a PDF through the copy that ships beside the host bundle", async () => {
    if (!built) return;
    const require = createRequire(main);
    const kit = pathToFileURL(require.resolve("@deepseek-ai/libreoffice-kit")).href;
    const { createConverter } = (await import(kit)) as {
      createConverter: (options: { timeoutMs: number; maxOutputBytes: number }) => Promise<{
        convert(request: { inputPath: string; outputPath: string }): Promise<void>;
        dispose(): Promise<void>;
      }>;
    };
    const root = mkdtempSync(join(tmpdir(), "office-bundle-"));
    roots.push(root);
    const input = join(root, "note.docx");
    const output = join(root, "note.pdf");
    writeFileSync(input, buildDocx("测试通过"));
    const converter = await createConverter({ timeoutMs: 120_000, maxOutputBytes: 20 * 1024 * 1024 });
    try {
      await converter.convert({ inputPath: input, outputPath: output });
    } finally {
      await converter.dispose();
    }
    expect(readFileSync(output).subarray(0, 5).toString()).toBe("%PDF-");
  }, 60_000);
});
