import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase, type OpenedDatabase } from "../database.js";
import {
  connectorEndpoint,
  listConnectors,
  registerConnector,
  setConnectorEnabled,
  setConnectorEndpoint,
} from "./connectors.js";

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

describe("connector endpoint (D19)", () => {
  it("accepts loopback http(s) URLs and rejects everything else", () => {
    expect(connectorEndpoint(" http://127.0.0.1:7860 ")).toBe("http://127.0.0.1:7860");
    expect(connectorEndpoint("http://localhost:7860/")).toBe("http://localhost:7860/");
    expect(connectorEndpoint(null)).toBeNull();
    expect(connectorEndpoint(undefined)).toBeNull();
    expect(connectorEndpoint("   ")).toBeNull();
    expect(() => connectorEndpoint("ftp://127.0.0.1")).toThrowError(/http or https/);
    expect(() => connectorEndpoint("http://192.168.1.5:7860")).toThrowError(/loopback/);
    expect(() => connectorEndpoint("http://example.com")).toThrowError(/loopback/);
    expect(() => connectorEndpoint("http://127.0.0.1/sdapi")).toThrowError(/must not carry a path/);
    expect(() => connectorEndpoint("not-a-url")).toThrowError(/absolute/);
  });

  it("registers and updates the endpoint without contacting anything", () => {
    const { db, cleanup } = tempDb();
    try {
      const saved = registerConnector(db, {
        name: "local-diffusion",
        endpoint: "http://127.0.0.1:7860",
      });
      expect(saved.endpoint).toBe("http://127.0.0.1:7860");
      expect(() =>
        registerConnector(db, { name: "bad", endpoint: "http://example.com" }),
      ).toThrowError(/loopback/);

      const cleared = setConnectorEndpoint(db, { id: saved.id, endpoint: null });
      expect(cleared.endpoint).toBeNull();
      const updated = setConnectorEndpoint(db, {
        id: saved.id,
        endpoint: "http://localhost:7860",
      });
      expect(updated.endpoint).toBe("http://localhost:7860");
      expect(() =>
        setConnectorEndpoint(db, { id: saved.id, endpoint: "https://remote.example.com" }),
      ).toThrowError(/loopback/);
    } finally {
      db.close();
      cleanup();
    }
  });
});
