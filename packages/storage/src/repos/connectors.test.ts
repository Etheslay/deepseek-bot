import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase, type OpenedDatabase } from "../database.js";
import { listConnectors, registerConnector, setConnectorEnabled } from "./connectors.js";

const CREDENTIAL_REF = "cred:11111111-1111-4111-8111-111111111111";

function tempDb(): { db: OpenedDatabase; file: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "dsb-connector-"));
  const file = join(root, "app.sqlite");
  const db = openDatabase(file);
  return {
    db,
    file,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("connector registry", () => {
  it("stores a disabled connector and can enable or disable it without using the credential", () => {
    const { db, cleanup } = tempDb();
    try {
      const before = db.raw.prepare("SELECT COUNT(*) AS n FROM credentials").get() as { n: number };
      const saved = registerConnector(db, {
        name: "  local drawer  ",
        credentialRef: CREDENTIAL_REF,
      });
      expect(saved).toMatchObject({
        name: "local drawer",
        enabled: false,
        credentialRef: CREDENTIAL_REF,
      });
      expect(listConnectors(db)).toEqual([saved]);
      const enabled = setConnectorEnabled(db, { id: saved.id, enabled: true });
      expect(enabled).toMatchObject({ id: saved.id, enabled: true, credentialRef: CREDENTIAL_REF });
      expect(setConnectorEnabled(db, { id: saved.id, enabled: true }).enabled).toBe(true);
      const disabled = setConnectorEnabled(db, { id: saved.id, enabled: false });
      expect(disabled.enabled).toBe(false);
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM credentials").get()).toEqual(before);
      const missing = "22222222-2222-4222-8222-222222222222";
      expect(() => setConnectorEnabled(db, { id: missing, enabled: true })).toThrow(/not found/);
      expect(listConnectors(db)).toEqual([disabled]);
    } finally {
      db.close();
      cleanup();
    }
  });

  it("rejects a raw secret and keeps a connector with no credential reference", () => {
    const { db, file, cleanup } = tempDb();
    try {
      expect(() =>
        registerConnector(db, { name: "leak", credentialRef: "sk-live-secret" }),
      ).toThrow(/credential ref/);
      expect(listConnectors(db)).toEqual([]);
      const saved = registerConnector(db, { name: "bare" });
      expect(saved.credentialRef).toBeNull();
      expect(saved.enabled).toBe(false);
      expect(() => registerConnector(db, { name: "   " })).toThrow(/200/);
      db.close();
      const reopened = openDatabase(file);
      try {
        expect(listConnectors(reopened)).toEqual([saved]);
      } finally {
        reopened.close();
      }
    } finally {
      cleanup();
    }
  });
});
