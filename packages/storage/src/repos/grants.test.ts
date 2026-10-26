import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase, type OpenedDatabase } from "../database.js";
import { consumeGrant, createGrant, findValidGrant, listGrants, revokeGrant } from "./grants.js";

function tempDb(): { db: OpenedDatabase; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "dsb-grants-"));
  const db = openDatabase(join(root, "app.sqlite"));
  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("grants repository", () => {
  it("finds and consumes once grants", () => {
    const { db, cleanup } = tempDb();
    try {
      const grant = createGrant(db, { capability: "app.write", scope: "once" });
      const found = findValidGrant(db, "app.write", null, db.now());
      expect(found?.id).toBe(grant.id);
      expect(consumeGrant(db, grant.id, db.now())).toBe(true);
      expect(findValidGrant(db, "app.write", null, db.now())).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("respects bot scoping and revocation", () => {
    const { db, cleanup } = tempDb();
    try {
      const botA = "11111111-1111-4111-8111-111111111111";
      const botB = "22222222-2222-4222-8222-222222222222";
      const grant = createGrant(db, { capability: "app.write", botId: botA, scope: "session", maxUses: 0 });
      expect(findValidGrant(db, "app.write", botB, db.now())).toBeUndefined();
      expect(findValidGrant(db, "app.write", botA, db.now())?.id).toBe(grant.id);
      expect(revokeGrant(db, grant.id)).toBe(true);
      expect(findValidGrant(db, "app.write", botA, db.now())).toBeUndefined();
      expect(listGrants(db, "app.write")).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it("expires grants", () => {
    const { db, cleanup } = tempDb();
    try {
      const grant = createGrant(db, { capability: "connector.invoke", scope: "session", expiresInSeconds: 60 });
      expect(grant.expiresAt).not.toBeNull();
      const future = new Date(db.now().getTime() + 120_000);
      expect(findValidGrant(db, "connector.invoke", null, future)).toBeUndefined();
    } finally {
      cleanup();
    }
  });
});
