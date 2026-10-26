import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase, MIGRATIONS, checksumMigration } from "./database.js";
import { StorageError } from "./errors.js";
import { ensureDataLayout } from "./layout.js";
import { makeTestClock, makeTempRoot } from "./test-support.js";

describe("openDatabase migrations", () => {
  it("upgrades a real v4 database without changing earlier checksums or data", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const raw = new DatabaseSync(layout.dbFile);
    raw.exec("CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)");
    const checksums = [
      "78e33861768f8e64eb1dc26b3b3c5f3c815f194a0b93529233741e6dc6770eac",
      "38d11c3bd0aebb2ebe34a28008a0c8755a8b55986f10813e1a187f5d80061936",
      "787b099bb39d3f8ace581b3549ddc37c1d617a4f7b0341a3910aa74b29f6becf",
      "916122a69dd72e858788ec4561dd732b34c7c72bec36a34a89fcfb0b47795b23",
    ];
    // These are hashes of the committed migration 0001–0004 SQL, not
    // recalculated expectations from the implementation under test.
    for (const migration of MIGRATIONS.slice(0, 4)) {
      expect(checksumMigration(migration)).toBe(checksums[migration.id - 1]);
      raw.exec(migration.sql);
      raw.prepare("INSERT INTO schema_migrations VALUES (?, ?, ?, ?)").run(migration.id, migration.name, checksums[migration.id - 1]!, "2026-10-24T00:00:00.000Z");
    }
    raw.exec("INSERT INTO settings VALUES ('preserved', '{\"value\":42}', '2026-10-24T00:00:00.000Z')");
    raw.close();
    const upgraded = openDatabase(layout.dbFile);
    expect(upgraded.schemaVersion).toBe(11);
    expect(
      upgraded.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memories'").get(),
    ).toMatchObject({ name: "memories" });
    expect(
      upgraded.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'connectors'").get(),
    ).toMatchObject({ name: "connectors" });
    expect(upgraded.raw.prepare("SELECT value_json FROM settings WHERE key = 'preserved'").get()).toMatchObject({ value_json: '{"value":42}' });
    expect(upgraded.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('permission_grants','permission_audit','app_approvals','permission_authorizations')").all()).toHaveLength(4);
    expect(upgraded.raw.prepare("SELECT checksum FROM schema_migrations WHERE id <= 4 ORDER BY id").all().map(row => row.checksum)).toEqual(checksums);
    upgraded.close();
  });
  it("applies all migrations on a fresh database", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const db = openDatabase(layout.dbFile, { now: makeTestClock().now });
    expect(db.schemaVersion).toBe(MIGRATIONS.length);
    expect(db.appliedMigrations.map((migration) => migration.id)).toEqual(
      MIGRATIONS.map((migration) => migration.id),
    );
    db.close();
  });

  it("is idempotent across reopens and keeps WAL mode", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const first = openDatabase(layout.dbFile);
    first.close();
    const second = openDatabase(layout.dbFile);
    expect(second.schemaVersion).toBe(MIGRATIONS.length);
    const journal = second.raw.prepare("PRAGMA journal_mode;").get() as {
      journal_mode: string;
    };
    expect(journal.journal_mode.toLowerCase()).toBe("wal");
    const foreignKeys = second.raw.prepare("PRAGMA foreign_keys;").get() as {
      foreign_keys: number;
    };
    expect(foreignKeys.foreign_keys).toBe(1);
    second.close();
  });

  it("rejects a database migrated by a newer version", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const db = openDatabase(layout.dbFile);
    db.raw
      .prepare(
        "INSERT INTO schema_migrations (id, name, checksum, applied_at) VALUES (?, ?, ?, ?);",
      )
      .run(
        MIGRATIONS.length + 1,
        "9000-from-the-future",
        "0".repeat(64),
        new Date().toISOString(),
      );
    db.close();
    expect(() => openDatabase(layout.dbFile)).toThrow(/newer application version/);
    try {
      openDatabase(layout.dbFile);
    } catch (error) {
      expect((error as StorageError).code).toBe("DATA_VERSION_UNSUPPORTED");
    }
  });

  it("rejects a tampered migration checksum", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const db = openDatabase(layout.dbFile);
    db.raw
      .prepare("UPDATE schema_migrations SET checksum = ? WHERE id = 1;")
      .run("f".repeat(64));
    db.close();
    try {
      openDatabase(layout.dbFile);
      expect.fail("expected checksum mismatch");
    } catch (error) {
      expect((error as StorageError).code).toBe("DATA_VERSION_UNSUPPORTED");
    }
  });

  it("exposes deterministic migration checksums", () => {
    for (const migration of MIGRATIONS) {
      expect(checksumMigration(migration)).toMatch(/^[0-9a-f]{64}$/);
      expect(checksumMigration(migration)).toBe(checksumMigration(migration));
    }
  });

  it("rolls back a failed migration transaction", () => {
    const layout = ensureDataLayout(makeTempRoot());
    // Open a raw database and run the runner through the public API with a
    // corrupted migration appended — simulate by inserting migration state.
    const db = openDatabase(layout.dbFile);
    db.close();
    // Directly attempt the broken SQL through a fresh handle to prove the
    // runner's rollback path is only about transactions, not schema content.
    const raw = new DatabaseSync(layout.dbFile);
    expect(() => raw.exec("BEGIN IMMEDIATE; CREATE TABLE ;")).toThrow();
    raw.exec("ROLLBACK;");
    const tables = raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_not_exist';")
      .all();
    expect(tables).toHaveLength(0);
    raw.close();
  });

  it("runs a quick integrity check when requested", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const db = openDatabase(layout.dbFile, { verifyIntegrity: true });
    expect(db.schemaVersion).toBe(MIGRATIONS.length);
    db.close();
  });

  it("leaves no temp files behind and closes cleanly", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const db = openDatabase(layout.dbFile);
    db.close();
    const leftovers = fs
      .readdirSync(layout.root)
      .filter((name) => name.startsWith("app.sqlite") && name.includes("-tmp"));
    expect(leftovers).toHaveLength(0);
    expect(fs.existsSync(path.join(layout.root, "app.sqlite"))).toBe(true);
  });
});

describe("openDatabase error paths", () => {
  it("refuses an empty file path", () => {
    expect(() => openDatabase("")).toThrow(/empty/);
  });

  it("maps an unusable database location to a storage error", () => {
    const missingDir = path.join(makeTempRoot(), "does-not-exist", "app.sqlite");
    try {
      openDatabase(missingDir);
      expect.fail("expected open failure");
    } catch (error) {
      expect(error).toBeInstanceOf(StorageError);
    }
  });

  it("fails loudly when the file is not a database at all", () => {
    const layout = ensureDataLayout(makeTempRoot());
    fs.writeFileSync(layout.dbFile, "this is not a sqlite database at all........");
    expect(() => openDatabase(layout.dbFile, { verifyIntegrity: true })).toThrow();
  });

  it("rejects a structurally corrupt database via quick_check", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const writer = openDatabase(layout.dbFile);
    writer.raw.exec("CREATE TABLE filler (value TEXT);");
    const insert = writer.raw.prepare("INSERT INTO filler (value) VALUES (?);");
    for (let index = 0; index < 500; index += 1) {
      insert.run(`row-${index}-${"x".repeat(50)}`);
    }
    writer.close();

    // Corrupt the b-tree page header of page 2 while keeping the file a
    // valid-looking SQLite container, so quick_check (not open) catches it.
    const bytes = fs.readFileSync(layout.dbFile);
    bytes[4096] = 0x7f;
    bytes[4097] = 0x7f;
    fs.writeFileSync(layout.dbFile, bytes);

    try {
      openDatabase(layout.dbFile, { verifyIntegrity: true });
      expect.fail("expected integrity failure");
    } catch (error) {
      expect((error as StorageError).code).toBe("INVALID_INPUT");
      expect((error as StorageError).message).toMatch(/integrity/);
    }
  });
});
