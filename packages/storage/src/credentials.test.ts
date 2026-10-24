import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  FileCredentialBlobStore,
  StorageError,
  createCredentialRef,
  isValidCredentialRef,
  listMissingCredentialRefs,
  listCredentialRefs,
  registerCredential,
  removeCredential,
  createModelProfile,
} from "./index.js";
import { ensureDataLayout } from "./layout.js";
import {
  makeLayout,
  makeTempRoot,
  openTestDatabase,
  seedProfileAndWorkspace,
} from "./test-support.js";

describe("credential refs", () => {
  it("generates and validates the cred:<uuid> format", () => {
    const ref = createCredentialRef();
    expect(isValidCredentialRef(ref)).toBe(true);
    expect(ref.startsWith("cred:")).toBe(true);
    expect(isValidCredentialRef("cred:not-a-uuid")).toBe(false);
    expect(isValidCredentialRef("sk-plain-key")).toBe(false);
    expect(isValidCredentialRef("")).toBe(false);
  });
});

describe("FileCredentialBlobStore", () => {
  it("stores and reads opaque ciphertext bytes", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const store = new FileCredentialBlobStore(layout.credentials);
    const ref = createCredentialRef();
    // Simulated safeStorage ciphertext — opaque to this package.
    const ciphertext = new Uint8Array([1, 2, 3, 250, 251]);
    store.put(ref, ciphertext);
    expect(store.exists(ref)).toBe(true);
    expect(Array.from(store.get(ref))).toEqual([1, 2, 3, 250, 251]);
    expect(store.listRefs()).toEqual([ref]);
  });

  it("writes atomically without leaving temp files", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const store = new FileCredentialBlobStore(layout.credentials);
    const ref = createCredentialRef();
    store.put(ref, new Uint8Array([9, 9, 9]));
    const leftovers = fs
      .readdirSync(layout.credentials)
      .filter((name) => name.includes(".tmp-"));
    expect(leftovers).toHaveLength(0);
    expect(fs.readdirSync(layout.credentials)).toEqual([`${ref.slice("cred:".length)}.blob`]);
  });

  it("rejects bad refs and empty blobs, and reports missing blobs", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const store = new FileCredentialBlobStore(layout.credentials);
    expect(() => store.put("cred:nope", new Uint8Array([1]))).toThrow(StorageError);
    expect(() => store.put(createCredentialRef(), new Uint8Array([]))).toThrow(/empty/);
    expect(store.exists(createCredentialRef())).toBe(false);
    expect(() => store.get(createCredentialRef())).toThrow(/does not exist/);
    expect(store.delete(createCredentialRef())).toBe(false);
  });

  it("deletes blobs and stops listing them", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const store = new FileCredentialBlobStore(layout.credentials);
    const ref = createCredentialRef();
    store.put(ref, new Uint8Array([1]));
    expect(store.delete(ref)).toBe(true);
    expect(store.exists(ref)).toBe(false);
    expect(store.listRefs()).toEqual([]);
  });
});

describe("credential registry", () => {
  it("registers, lists and removes refs; removal is blocked while referenced", () => {
    const db = openTestDatabase(makeLayout(makeTempRoot()));
    const { credentialRef } = seedProfileAndWorkspace(db);
    expect(listCredentialRefs(db).map((row) => row.ref)).toContain(credentialRef);

    expect(() => removeCredential(db, credentialRef)).toThrow(/referenced/);
    expect(() => removeCredential(db, "sk-nope")).toThrow(StorageError);

    const spare = createCredentialRef();
    registerCredential(db, { ref: spare, label: "备用" });
    expect(removeCredential(db, spare).removed).toBe(true);
    db.close();
  });

  it("detects missing blobs after a restore-like state", () => {
    const layout = ensureDataLayout(makeTempRoot());
    const db = openTestDatabase(layout);
    const { credentialRef, profile } = seedProfileAndWorkspace(db);
    const store = new FileCredentialBlobStore(layout.credentials);
    expect(listMissingCredentialRefs(db, store)).toEqual([credentialRef]);

    store.put(credentialRef, new Uint8Array([7]));
    expect(listMissingCredentialRefs(db, store)).toEqual([]);
    expect(createModelProfile(db, profile).created).toBe(false);
    db.close();
  });
});
