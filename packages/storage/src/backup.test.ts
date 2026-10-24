import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  FileCredentialBlobStore,
  StorageError,
  appendEvent,
  createBackup,
  createRun,
  getWorkflow,
  listEvents,
  listWorkflows,
  readBackupManifest,
  restoreBackup,
  saveWorkflow,
  transitionRun,
  BACKUP_DATABASE_FILE,
} from "./index.js";
import { ensureDataLayout } from "./layout.js";
import {
  makeEvent,
  makeRun,
  makeTempRoot,
  makeTestClock,
  makeWorkflow,
  openTestDatabase,
  seedProfileAndWorkspace,
} from "./test-support.js";

function sha256File(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Seed a database with one workflow, one finished run and two events. */
function seedData(db: ReturnType<typeof openTestDatabase>): { workflowId: string; runId: string } {
  const workflow = saveWorkflow(db, makeWorkflow()).workflow;
  const run = createRun(db, makeRun(workflow)).run;
  transitionToSucceeded(db, run.id);
  appendEvent(db, makeEvent(run.id, 0));
  appendEvent(db, makeEvent(run.id, 1, {
    eventId: randomUUID(),
    type: "run.statusChanged",
    payload: { from: "queued", to: "running" },
  }));
  return { workflowId: workflow.id, runId: run.id };
}

function transitionToSucceeded(
  db: ReturnType<typeof openTestDatabase>,
  runId: string,
): void {
  transitionRun(db, { id: runId, to: "running" });
  transitionRun(db, { id: runId, to: "succeeded" });
}

describe("createBackup", () => {
  it("refuses to run while runs are active", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const db = openTestDatabase(layout);
    createRun(db, makeRun(makeWorkflow()));
    const destination = path.join(layout.backups, "backup-1");
    expect(() => createBackup({ db, layout, destinationDir: destination })).toThrow(
      /active runs/,
    );
    db.close();
  });

  it("refuses an existing destination", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const db = openTestDatabase(layout);
    const destination = path.join(layout.backups, "backup-1");
    fs.mkdirSync(destination);
    expect(() => createBackup({ db, layout, destinationDir: destination })).toThrow(
      /already exists/,
    );
    db.close();
  });

  it("writes a manifest that describes exclusions and sensitivity", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const db = openTestDatabase(layout);
    const destination = path.join(layout.backups, "backup-manifest");
    const manifest = createBackup({ db, layout, destinationDir: destination });
    expect(manifest.kind).toBe("deepseek-bot-backup");
    expect(manifest.schemaVersion).toBe(db.schemaVersion);
    expect(manifest.files.map((file) => file.path)).toEqual([BACKUP_DATABASE_FILE]);
    expect(manifest.notes.excluded).toContain("credentials/");
    expect(manifest.notes.excluded).toContain("harness/");
    expect(manifest.notes.sensitive).toMatch(/chat/i);
    const onDisk = readBackupManifest(destination);
    expect(onDisk.createdAt).toBe(manifest.createdAt);
    db.close();
  });

  it("optionally includes the artifacts tree with hashes", () => {
    const layout = ensureDataLayout(makeTempRoot());
    fs.writeFileSync(path.join(layout.artifacts, "report.txt"), "产物内容");
    const db = openTestDatabase(layout);
    const destination = path.join(layout.backups, "backup-artifacts");
    const manifest = createBackup({ db, layout, destinationDir: destination, includeArtifacts: true });
    expect([...manifest.files].map((file) => file.path).sort()).toEqual([
      "app.sqlite",
      "artifacts/report.txt",
    ]);
    db.close();
  });
});

describe("restoreBackup", () => {
  it("round-trips metadata and preserves the previous database", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const db = openTestDatabase(layout);
    const seeded = seedData(db);
    const destination = path.join(layout.backups, "backup-full");
    const manifest = createBackup({ db, layout, destinationDir: destination });
    db.close();

    const result = restoreBackup({ layout, sourceDir: destination });
    expect(result.manifest.createdAt).toBe(manifest.createdAt);
    expect(result.artifactConflicts).toEqual([]);
    expect(getWorkflow(result.db, seeded.workflowId)?.name).toBe("存储测试工作流");
    expect(listEvents(result.db, seeded.runId)).toHaveLength(2);
    expect(result.db.schemaVersion).toBe(manifest.schemaVersion);
    result.db.close();

    // The pre-restore stash keeps the original database bytes.
    const stashFiles = fs.readdirSync(result.stashDir);
    expect(stashFiles).toContain("app.sqlite");
    expect(fs.statSync(path.join(result.stashDir, "app.sqlite")).size).toBeGreaterThan(0);
  });

  it("reports credentials that need re-entry after restore", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const db = openTestDatabase(layout);
    const { credentialRef } = seedProfileAndWorkspace(db);
    new FileCredentialBlobStore(layout.credentials).put(credentialRef, new Uint8Array([1]));
    const destination = path.join(layout.backups, "backup-creds");
    createBackup({ db, layout, destinationDir: destination });
    db.close();

    // Restore into a fresh root: the blob does not travel with the backup.
    const freshRoot = makeTempRoot();
    const freshLayout = ensureDataLayout(freshRoot);
    const result = restoreBackup({ layout: freshLayout, sourceDir: destination });
    expect(result.missingCredentialRefs).toEqual([credentialRef]);
    result.db.close();
  });

  it("refuses a tampered database snapshot", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const db = openTestDatabase(layout);
    const destination = path.join(layout.backups, "backup-tamper");
    createBackup({ db, layout, destinationDir: destination });
    db.close();

    // Flip one byte in place: size stays valid, the checksum must catch it.
    const snapshot = path.join(destination, BACKUP_DATABASE_FILE);
    const bytes = fs.readFileSync(snapshot);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
    fs.writeFileSync(snapshot, bytes);
    const freshLayout = ensureDataLayout(makeTempRoot());
    try {
      restoreBackup({ layout: freshLayout, sourceDir: destination });
      expect.fail("expected checksum rejection");
    } catch (error) {
      expect((error as StorageError).code).toBe("INVALID_INPUT");
      expect((error as StorageError).message).toMatch(/checksum/);
    }
  });

  it("rejects backups from a newer schema version", () => {
    const sourceDir = makeTempRoot();
    fs.writeFileSync(
      path.join(sourceDir, "manifest.json"),
      JSON.stringify({
        kind: "deepseek-bot-backup",
        manifestVersion: 1,
        createdAt: "2026-10-24T00:00:00.000Z",
        schemaVersion: 999,
        storagePackageVersion: "0.1.0",
        includes: { database: true, artifacts: false },
        files: [],
        notes: { sensitive: "x", excluded: [] },
      }),
    );
    const layout = ensureDataLayout(makeTempRoot());
    try {
      restoreBackup({ layout, sourceDir });
      expect.fail("expected version rejection");
    } catch (error) {
      expect((error as StorageError).code).toBe("DATA_VERSION_UNSUPPORTED");
    }
  });

  it("rejects manifest paths that escape the backup directory", () => {
    const sourceDir = makeTempRoot();
    fs.writeFileSync(
      path.join(sourceDir, "manifest.json"),
      JSON.stringify({
        kind: "deepseek-bot-backup",
        manifestVersion: 1,
        createdAt: "2026-10-24T00:00:00.000Z",
        schemaVersion: 1,
        storagePackageVersion: "0.1.0",
        includes: { database: true, artifacts: false },
        files: [{ path: "../outside.txt", bytes: 1, sha256: "0".repeat(64) }],
        notes: { sensitive: "x", excluded: [] },
      }),
    );
    const layout = ensureDataLayout(makeTempRoot());
    try {
      restoreBackup({ layout, sourceDir });
      expect.fail("expected traversal rejection");
    } catch (error) {
      expect((error as StorageError).code).toBe("INVALID_INPUT");
      expect((error as StorageError).message).toMatch(/traversal/);
    }
  });

  it("rejects a manifest whose listed file is missing", () => {
    const sourceDir = makeTempRoot();
    const content = Buffer.from("pretend database");
    fs.writeFileSync(
      path.join(sourceDir, "manifest.json"),
      JSON.stringify({
        kind: "deepseek-bot-backup",
        manifestVersion: 1,
        createdAt: "2026-10-24T00:00:00.000Z",
        schemaVersion: 1,
        storagePackageVersion: "0.1.0",
        includes: { database: true, artifacts: false },
        files: [
          { path: "app.sqlite", bytes: content.length, sha256: sha256Buffer(content) },
          { path: "artifacts/gone.txt", bytes: 3, sha256: "a".repeat(64) },
        ],
        notes: { sensitive: "x", excluded: [] },
      }),
    );
    fs.writeFileSync(path.join(sourceDir, "app.sqlite"), content);
    const layout = ensureDataLayout(makeTempRoot());
    expect(() => restoreBackup({ layout, sourceDir })).toThrow(/missing/);
  });

  it("rolls back to the previous database when the snapshot cannot be opened", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const db = openTestDatabase(layout);
    const seeded = seedData(db);
    db.close();

    // Craft a fake backup whose database is "from the future" for the
    // migration runner: file verification passes, open fails after the stash.
    const sourceDir = path.join(makeTempRoot(), "crafted-backup");
    fs.mkdirSync(sourceDir);
    const broken = new DatabaseSync(path.join(sourceDir, "app.sqlite"));
    broken.exec("CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);");
    broken
      .prepare("INSERT INTO schema_migrations (id, name, checksum, applied_at) VALUES (9999, 'future', 'x', 'now');")
      .run();
    broken.close();
    const bytes = fs.statSync(path.join(sourceDir, "app.sqlite")).size;
    fs.writeFileSync(
      path.join(sourceDir, "manifest.json"),
      JSON.stringify({
        kind: "deepseek-bot-backup",
        manifestVersion: 1,
        createdAt: "2026-10-24T00:00:00.000Z",
        schemaVersion: 1,
        storagePackageVersion: "0.1.0",
        includes: { database: true, artifacts: false },
        files: [
          {
            path: "app.sqlite",
            bytes,
            sha256: sha256File(path.join(sourceDir, "app.sqlite")),
          },
        ],
        notes: { sensitive: "x", excluded: [] },
      }),
    );

    try {
      restoreBackup({ layout, sourceDir });
      expect.fail("expected restore failure");
    } catch (error) {
      expect((error as StorageError).code).toBe("DATA_VERSION_UNSUPPORTED");
    }

    // The original database must be back in place with its data intact.
    const recovered = openTestDatabase(layout);
    expect(listWorkflowsCount(recovered)).toBe(1);
    recovered.close();
    void seeded;
  });

  it("reports artifact conflicts instead of overwriting user files", () => {
    const layout = ensureDataLayout(makeTempRoot());
    fs.writeFileSync(path.join(layout.artifacts, "report.txt"), "旧内容");
    const db = openTestDatabase(layout);
    const destination = path.join(layout.backups, "backup-conflict");
    createBackup({ db, layout, destinationDir: destination, includeArtifacts: true });
    db.close();

    fs.writeFileSync(path.join(layout.artifacts, "report.txt"), "被用户改过的内容");
    const result = restoreBackup({ layout, sourceDir: destination });
    expect(result.artifactConflicts).toEqual(["artifacts/report.txt"]);
    expect(fs.readFileSync(path.join(layout.artifacts, "report.txt"), "utf8")).toBe(
      "被用户改过的内容",
    );
    result.db.close();
  });
});

describe("readBackupManifest", () => {
  it("rejects directories without a manifest and non-JSON manifests", () => {
    const empty = makeTempRoot();
    expect(() => readBackupManifest(empty)).toThrow(/no manifest/);
    const garbage = makeTempRoot();
    fs.writeFileSync(path.join(garbage, "manifest.json"), "{not json");
    expect(() => readBackupManifest(garbage)).toThrow(/not valid JSON/);
  });

  it("rejects files that are not DeepSeekBot backups", () => {
    const sourceDir = makeTempRoot();
    fs.writeFileSync(path.join(sourceDir, "manifest.json"), JSON.stringify({ kind: "other" }));
    expect(() => readBackupManifest(sourceDir)).toThrow(/not a DeepSeekBot backup/);
  });
});

function sha256Buffer(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function listWorkflowsCount(db: ReturnType<typeof openTestDatabase>): number {
  return listWorkflows(db).length;
}

describe("restore manifest validation branches", () => {
  function writeManifest(sourceDir: string, manifest: Record<string, unknown>): void {
    fs.writeFileSync(path.join(sourceDir, "manifest.json"), JSON.stringify(manifest));
  }

  const baseManifest = {
    kind: "deepseek-bot-backup",
    manifestVersion: 1,
    createdAt: "2026-10-24T00:00:00.000Z",
    schemaVersion: 1,
    storagePackageVersion: "0.1.0",
    includes: { database: true, artifacts: false },
    files: [] as unknown[],
    notes: { sensitive: "x", excluded: [] },
  };

  it("rejects unknown manifest versions", () => {
    const sourceDir = makeTempRoot();
    writeManifest(sourceDir, { ...baseManifest, manifestVersion: 2 });
    const layout = ensureDataLayout(makeTempRoot());
    expect(() => restoreBackup({ layout, sourceDir })).toThrow(/manifest version/);
  });

  it("rejects invalid schema versions and missing file lists", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const noSchema = makeTempRoot();
    writeManifest(noSchema, { ...baseManifest, schemaVersion: 0 });
    expect(() => restoreBackup({ layout, sourceDir: noSchema })).toThrow(/schemaVersion/);
    const noFiles = makeTempRoot();
    writeManifest(noFiles, { ...baseManifest, files: "not-an-array" });
    expect(() => readBackupManifest(noFiles)).toThrow(/file list/);
  });

  it("rejects paths with backslashes, dot segments, drive letters or unknown roots", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const cases = [
      "artifacts" + String.fromCharCode(92) + "evil.txt",
      "artifacts/./evil.txt",
      "artifacts/sub/../evil.txt",
      "D:artifacts/evil.txt",
      "secrets/keys.txt",
      "",
    ];
    for (const entryPath of cases) {
      const sourceDir = makeTempRoot();
      writeManifest(sourceDir, {
        ...baseManifest,
        files: [{ path: entryPath, bytes: 1, sha256: "0".repeat(64) }],
      });
      try {
        restoreBackup({ layout, sourceDir });
        expect.fail("expected path rejection");
      } catch (error) {
        expect((error as StorageError).code).toBe("INVALID_INPUT");
      }
    }
  });

  it("rejects restores without the database entry and oversized files", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const sourceDir = makeTempRoot();
    const content = Buffer.from("db");
    writeManifest(sourceDir, {
      ...baseManifest,
      files: [{ path: "artifacts/only.txt", bytes: content.length, sha256: sha256Buffer(content) }],
    });
    fs.mkdirSync(path.join(sourceDir, "artifacts"));
    fs.writeFileSync(path.join(sourceDir, "artifacts", "only.txt"), content);
    try {
      restoreBackup({ layout, sourceDir });
      expect.fail("expected missing database rejection");
    } catch (error) {
      expect((error as StorageError).message).toMatch(/database file/);
    }

    const oversized = makeTempRoot();
    writeManifest(oversized, {
      ...baseManifest,
      files: [{ path: "app.sqlite", bytes: 100, sha256: "0".repeat(64) }],
    });
    expect(() =>
      restoreBackup({ layout, sourceDir: oversized, maxFileBytes: 10 }),
    ).toThrow(/size limit/);
    expect(() =>
      restoreBackup({ layout, sourceDir: oversized, maxTotalBytes: 10 }),
    ).toThrow(/size limit/);
  });

  it("refuses restore while runs are active", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const db = openTestDatabase(layout);
    const finished = createRun(db, makeRun(makeWorkflow())).run;
    transitionRun(db, { id: finished.id, to: "running" });
    transitionRun(db, { id: finished.id, to: "succeeded" });
    const destination = path.join(layout.backups, "backup-active");
    createBackup({ db, layout, destinationDir: destination });

    createRun(db, makeRun(makeWorkflow())); // becomes active again
    try {
      restoreBackup({ layout, sourceDir: destination });
      expect.fail("expected active-run refusal");
    } catch (error) {
      expect((error as StorageError).message).toMatch(/active runs/);
    }
    db.close();
  });

  it("fails when a restore reuses an existing stash timestamp", () => {
    const clock = makeTestClock("2026-10-24T12:00:00.000Z");
    const layout = ensureDataLayout(makeTempRoot());
    const db = openTestDatabase(layout, clock);
    const destination = path.join(layout.backups, "backup-stash");
    createBackup({ db, layout, destinationDir: destination });
    db.close();

    const first = restoreBackup({ layout, sourceDir: destination, now: clock.now });
    first.db.close();
    // The stash directory from the first restore still occupies the stamp.
    expect(() => restoreBackup({ layout, sourceDir: destination, now: clock.now })).toThrow(
      /stash/,
    );
  });
});
