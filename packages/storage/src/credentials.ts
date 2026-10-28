/**
 * Credential storage (FR-01 backend, docs/SECURITY_DATA.md §1).
 *
 * Plaintext API keys never enter this package. The desktop main process
 * encrypts the key with the OS credential store (Electron `safeStorage`,
 * DPAPI-backed on Windows — verified in the D04 report) and hands this module
 * an opaque ciphertext blob. The blob store persists it under
 * `<data root>/credentials/<ref>.blob`; the database only ever holds the
 * credential reference.
 *
 * If the OS cannot encrypt (e.g. `safeStorage.isEncryptionAvailable()` is
 * false), the caller must fail the save — plaintext fallback is forbidden.
 */
import fs from "node:fs";
import path from "node:path";
import type { OpenedDatabase } from "./database.js";
import { invalidInput, storageErrorFromFsError } from "./errors.js";
import { isoNow } from "./repos/shared.js";

const CREDENTIAL_REF_PATTERN = /^cred:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isValidCredentialRef(ref: string): boolean {
  return CREDENTIAL_REF_PATTERN.test(ref);
}

export function createCredentialRef(): string {
  const id = crypto.randomUUID();
  return `cred:${id}`;
}

function assertValidRef(ref: string): void {
  if (!isValidCredentialRef(ref)) {
    throw invalidInput("credential ref has an unexpected format", {
      // The ref is not secret, but keep the log surface narrow anyway.
      refPrefix: ref.slice(0, 5),
    });
  }
}

/** Register the reference in the database (metadata only, no secret bytes). */
export function registerCredential(
  db: OpenedDatabase,
  input: { ref: string; label?: string },
): { created: boolean } {
  assertValidRef(input.ref);
  const existing = db.raw
    .prepare("SELECT ref FROM credentials WHERE ref = ?;")
    .get(input.ref);
  if (existing !== undefined) {
    return { created: false };
  }
  const now = isoNow(db.now);
  db.raw
    .prepare(
      "INSERT INTO credentials (ref, label, created_at, updated_at) VALUES (?, ?, ?, ?);",
    )
    .run(input.ref, input.label ?? "", now, now);
  return { created: true };
}

export function listCredentialRefs(db: OpenedDatabase): Array<{ ref: string; label: string }> {
  const rows = db.raw
    .prepare("SELECT ref, label FROM credentials ORDER BY created_at ASC, ref ASC;")
    .all() as unknown as Array<{ ref: string; label: string }>;
  return rows;
}

export function removeCredential(db: OpenedDatabase, ref: string): { removed: boolean } {
  assertValidRef(ref);
  const referenced = db.raw
    .prepare("SELECT id FROM model_profiles WHERE credential_ref = ? LIMIT 1;")
    .get(ref);
  if (referenced !== undefined) {
    throw invalidInput("credential is still referenced by a model profile", { ref });
  }
  const connector = db.raw
    .prepare("SELECT id FROM connectors WHERE credential_ref = ? LIMIT 1;")
    .get(ref);
  if (connector !== undefined) {
    throw invalidInput("credential is still referenced by a connector", { ref });
  }
  const result = db.raw.prepare("DELETE FROM credentials WHERE ref = ?;").run(ref);
  return { removed: Number(result.changes) > 0 };
}

/**
 * Filesystem store for opaque encrypted blobs. Callers decide the encryption
 * (see module doc); this store never inspects, transforms or logs the bytes.
 */
export class FileCredentialBlobStore {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  get directory(): string {
    return this.#dir;
  }

  #blobPath(ref: string): string {
    assertValidRef(ref);
    // `cred:` contains a colon, which Windows forbids in file names (and
    // would silently turn into an NTFS alternate data stream) — use the UUID
    // part only.
    return path.join(this.#dir, `${ref.slice("cred:".length)}.blob`);
  }

  put(ref: string, ciphertext: Uint8Array): void {
    assertValidRef(ref);
    if (ciphertext.byteLength === 0) {
      throw invalidInput("credential blob must not be empty");
    }
    const final = this.#blobPath(ref);
    const temp = `${final}.tmp-${crypto.randomUUID()}`;
    try {
      fs.writeFileSync(temp, ciphertext, { flag: "wx" });
      fs.renameSync(temp, final);
    } catch (error) {
      try {
        fs.rmSync(temp, { force: true });
      } catch {
        // Best-effort temp cleanup; surface the original failure.
      }
      throw storageErrorFromFsError(error, `writing credential blob ${ref.slice(0, 9)}…`);
    }
  }

  get(ref: string): Uint8Array {
    const file = this.#blobPath(ref);
    try {
      return new Uint8Array(fs.readFileSync(file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
        throw invalidInput("credential blob does not exist", { ref });
      }
      throw storageErrorFromFsError(error, `reading credential blob ${ref.slice(0, 9)}…`);
    }
  }

  exists(ref: string): boolean {
    try {
      return fs.statSync(this.#blobPath(ref)).isFile();
    } catch {
      return false;
    }
  }

  delete(ref: string): boolean {
    const file = this.#blobPath(ref);
    try {
      fs.rmSync(file, { force: false });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
        return false;
      }
      throw storageErrorFromFsError(error, `deleting credential blob ${ref.slice(0, 9)}…`);
    }
  }

  listRefs(): string[] {
    const refs: string[] = [];
    let names: string[];
    try {
      names = fs.readdirSync(this.#dir);
    } catch {
      return refs;
    }
    for (const name of names) {
      if (!name.endsWith(".blob")) {
        continue;
      }
      const candidate = `cred:${name.slice(0, -".blob".length)}`;
      if (isValidCredentialRef(candidate)) {
        refs.push(candidate);
      }
    }
    return refs.sort();
  }
}

/**
 * Registry refs whose blob is gone — expected after a restore (blobs are
 * excluded from backups) or manual deletion. The UI must ask the user to
 * re-enter these keys (SECURITY_DATA.md §5: 恢复后的凭据须重新确认).
 */
export function listMissingCredentialRefs(
  db: OpenedDatabase,
  store: FileCredentialBlobStore,
): string[] {
  return listCredentialRefs(db)
    .map((row) => row.ref)
    .filter((ref) => !store.exists(ref))
    .sort();
}
