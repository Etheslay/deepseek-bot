/**
 * Path canonicalization and containment tests (D08, QA-08).
 *
 * Real temp directories with junctions/dir-symlinks exercise the
 * symlink-escape scenario; containment cases run platform-independent by
 * forcing the case-sensitivity flag.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalizeScopePath,
  canonicalizeToolPath,
  InvalidToolPathError,
  isPathWithinScope,
} from "./permissions/paths.js";

function makeTempTree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsb-paths-"));
  fs.mkdirSync(path.join(root, "work", "sub"), { recursive: true });
  fs.mkdirSync(path.join(root, "outside"), { recursive: true });
  return root;
}

function makeDirLink(target: string, linkPath: string): void {
  try {
    fs.symlinkSync(target, linkPath, "junction");
  } catch {
    // POSIX: junction unsupported, plain dir symlink behaves the same here.
    fs.symlinkSync(target, linkPath, "dir");
  }
}

describe("isPathWithinScope", () => {
  it("requires a separator boundary, not a string prefix (POSIX)", () => {
    expect(isPathWithinScope("/srv/work/sub", "/srv/work", { caseInsensitive: false })).toBe(true);
    expect(isPathWithinScope("/srv/work", "/srv/work", { caseInsensitive: false })).toBe(true);
    expect(isPathWithinScope("/srv/worker", "/srv/work", { caseInsensitive: false })).toBe(false);
    expect(isPathWithinScope("/srv/workshop/a", "/srv/work", { caseInsensitive: false })).toBe(false);
    expect(isPathWithinScope("/other/work/sub", "/srv/work", { caseInsensitive: false })).toBe(false);
    // A POSIX root scope contains everything; on Windows a bare "/" is a
    // drive-relative marker and fails closed.
    expect(isPathWithinScope("/file", "/", { caseInsensitive: false })).toBe(
      process.platform === "win32" ? false : true,
    );
  });

  it("compares case-insensitively when asked", () => {
    expect(isPathWithinScope("/srv/WORK/Sub", "/srv/work", { caseInsensitive: true })).toBe(true);
    expect(isPathWithinScope("/srv/WORK/Sub", "/srv/work", { caseInsensitive: false })).toBe(false);
  });

  // Windows drive-letter paths, mixed separators and UNC roots are win32
  // semantics; path.normalize treats backslashes as separators only there.
  describe.skipIf(process.platform !== "win32")("windows path semantics", () => {
    it("requires a separator boundary, not a string prefix", () => {
      expect(isPathWithinScope("C:\\work\\sub", "C:\\work", { caseInsensitive: true })).toBe(true);
      expect(isPathWithinScope("C:\\work", "C:\\work", { caseInsensitive: true })).toBe(true);
      expect(isPathWithinScope("C:\\worker", "C:\\work", { caseInsensitive: true })).toBe(false);
      expect(isPathWithinScope("C:\\workshop\\a", "C:\\work", { caseInsensitive: true })).toBe(false);
      expect(isPathWithinScope("D:\\work\\sub", "C:\\work", { caseInsensitive: true })).toBe(false);
    });

    it("compares case-insensitively by default on Windows", () => {
      expect(isPathWithinScope("C:\\WORK\\Sub\\File.txt", "c:\\work")).toBe(true);
    });

    it("handles mixed separators and trailing slashes", () => {
      expect(isPathWithinScope("C:/work/sub/file", "C:\\work\\", { caseInsensitive: true })).toBe(true);
      expect(isPathWithinScope("C:\\work\\..\\elsewhere", "C:\\work", { caseInsensitive: true })).toBe(false);
    });

    it("fails closed for ambiguous roots", () => {
      expect(isPathWithinScope("C:\\anything", "\\", { caseInsensitive: true })).toBe(false);
    });

    it("covers UNC scopes segment-wise", () => {
      expect(isPathWithinScope("\\\\srv\\share\\file", "\\\\srv\\share", { caseInsensitive: true })).toBe(true);
      expect(isPathWithinScope("\\\\srv\\sharex\\file", "\\\\srv\\share", { caseInsensitive: true })).toBe(false);
    });
  });
});

describe("canonicalizeToolPath", () => {
  it("resolves real paths through the filesystem", async () => {
    const root = makeTempTree();
    try {
      const existing = path.join(root, "work", "sub");
      expect(await canonicalizeToolPath(existing)).toBe(
        await fs.promises.realpath(existing),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves junction/dir-symlink escapes to the real target (QA-08)", async () => {
    const root = makeTempTree();
    try {
      makeDirLink(path.join(root, "outside"), path.join(root, "work", "link"));
      const throughLink = await canonicalizeToolPath(
        path.join(root, "work", "link", "secret.txt"),
      );
      expect(throughLink.toLowerCase()).toBe(
        (await fs.promises.realpath(path.join(root, "outside")) + path.sep + "secret.txt").toLowerCase(),
      );
      // The canonical location is outside the workspace scope.
      expect(isPathWithinScope(throughLink, path.join(root, "work"))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("canonicalizes non-existent paths against their deepest existing ancestor", async () => {
    const root = makeTempTree();
    try {
      const link = path.join(root, "work", "link");
      makeDirLink(path.join(root, "outside"), link);
      // Scopes must be compared in canonical form (canonicalizeScopePath),
      // mirroring what the gate does with stored grant scopes.
      const workScope = await canonicalizeToolPath(path.join(root, "work"));
      const outsideScope = await canonicalizeToolPath(path.join(root, "outside"));
      // Two missing levels below the link: judged by the link's real target.
      const target = await canonicalizeToolPath(
        path.join(root, "work", "link", "a", "b", "file.txt"),
      );
      expect(isPathWithinScope(target, workScope)).toBe(false);
      expect(isPathWithinScope(target, outsideScope)).toBe(true);

      // Missing directory inside the plain workspace stays inside.
      const inside = await canonicalizeToolPath(
        path.join(root, "work", "newdir", "out.txt"),
      );
      expect(isPathWithinScope(inside, workScope)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("resolves lexical .. against the real ancestor", async () => {
    const root = makeTempTree();
    try {
      const resolved = await canonicalizeToolPath(
        path.join(root, "work", "sub", "..", "out.txt"),
      );
      const workScope = await canonicalizeToolPath(path.join(root, "work"));
      expect(isPathWithinScope(resolved, workScope)).toBe(true);
      expect(resolved.toLowerCase()).toBe(
        path.join(workScope, "out.txt").toLowerCase(),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps scope and child forms identical when realpath longifies 8.3 names", async () => {
    // CI runners expose TEMP via 8.3 short names (RUNNER~1) and the JS
    // fs.realpathSync keeps them while promises.realpath longifies. With an
    // injected realpath that behaves like the runner, a short-named scope and
    // a canonicalized child must still agree once both go through
    // canonicalizeScopePath / canonicalizeToolPath.
    const real = "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\dsb-8dot3";
    const short = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\dsb-8dot3";
    const fakeRealpath = async (p: string) => p.replaceAll("RUNNER~1", "runneradmin");
    const scope = await canonicalizeScopePath(short, { realpath: fakeRealpath });
    expect(scope).toBe(real);
    const child = await canonicalizeToolPath(path.join(short, "missing", "out.txt"), {
      realpath: fakeRealpath,
    });
    expect(child).toBe(path.join(real, "missing", "out.txt"));
    expect(isPathWithinScope(child, scope)).toBe(true);
    // Raw short-form scope against a long child mismatches — the reason the
    // gate canonicalizes scopes instead of trusting stored strings.
    expect(isPathWithinScope(child, short, { caseInsensitive: true })).toBe(false);
  });

  it("rejects relative paths and device namespaces", async () => {
    await expect(canonicalizeToolPath("relative\\path.txt")).rejects.toBeInstanceOf(
      InvalidToolPathError,
    );
    await expect(canonicalizeToolPath("\\\\.\\pipe\\evil")).rejects.toBeInstanceOf(
      InvalidToolPathError,
    );
    await expect(canonicalizeToolPath("")).rejects.toBeInstanceOf(InvalidToolPathError);
  });

  it.skipIf(process.platform !== "win32")("reports paths on a missing drive", async () => {
    await expect(canonicalizeToolPath("Q:\\missing\\file.txt")).rejects.toBeInstanceOf(
      InvalidToolPathError,
    );
  });
});
