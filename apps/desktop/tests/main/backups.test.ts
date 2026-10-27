/**
 * Backup manifest listing (D24 leftover): real temp directory, corrupted and
 * foreign entries must be skipped instead of failing the list.
 */
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listBackups } from "../../src/main/backups.js";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = fs.mkdtempSync(join(tmpdir(), "dsb-backups-"));
  roots.push(root);
  return root;
}

function writeBackup(
  root: string,
  id: string,
  manifest: Record<string, unknown> | string,
): void {
  const dir = join(root, "backups", id);
  fs.mkdirSync(dir, { recursive: true });
  const raw = typeof manifest === "string" ? manifest : JSON.stringify(manifest);
  fs.writeFileSync(join(dir, "manifest.json"), raw, { encoding: "utf8" });
}

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "deepseek-bot-backup",
    manifestVersion: 1,
    createdAt: "2026-10-26T00:00:00.000Z",
    schemaVersion: 11,
    files: [
      { path: "app.sqlite", bytes: 100 },
      { path: "artifacts/x.bin", bytes: 24 },
    ],
    ...overrides,
  };
}

describe("listBackups", () => {
  it("returns manifest summaries newest-first", () => {
    const root = makeRoot();
    writeBackup(root, "b-old", manifest({ createdAt: "2026-10-24T00:00:00.000Z" }));
    writeBackup(root, "b-new", manifest({ createdAt: "2026-10-26T08:00:00.000Z" }));
    const list = listBackups(root);
    expect(list.map((entry) => entry.backupId)).toEqual(["b-new", "b-old"]);
    expect(list[0]).toMatchObject({
      backupId: "b-new",
      createdAt: "2026-10-26T08:00:00.000Z",
      schemaVersion: 11,
      sizeBytes: 124,
    });
  });

  it("skips corrupted manifests, foreign kinds and stray files", () => {
    const root = makeRoot();
    writeBackup(root, "b-good", manifest());
    writeBackup(root, "b-broken-json", "{ not json");
    writeBackup(root, "b-foreign", manifest({ kind: "someone-else" }));
    writeBackup(root, "b-no-files", manifest({ files: "not-an-array" }));
    fs.mkdirSync(join(root, "backups", "b-empty"), { recursive: true });
    fs.writeFileSync(join(root, "backups", "loose.txt"), "not a backup");
    const list = listBackups(root);
    expect(list.map((entry) => entry.backupId)).toEqual(["b-good"]);
  });

  it("returns an empty list when the backups directory does not exist", () => {
    expect(listBackups(join(makeRoot(), "nowhere"))).toEqual([]);
  });
});
