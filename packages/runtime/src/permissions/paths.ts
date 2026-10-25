/**
 * Path canonicalization and containment (D08, SECURITY_DATA.md §3, QA-08).
 *
 * Grant checks are segment-aware containment over canonical paths, never a
 * bare string prefix: `C:\work` does not contain `C:\worker`. Canonicalization
 * resolves symlinks/junctions of the deepest EXISTING ancestor via realpath,
 * so a link pointing outside a grant cannot masquerade as inside; segments
 * that do not exist yet are appended lexically. Device namespaces (`\\.\`,
 * `\\?\`) are rejected outright.
 *
 * Residual boundary (documented, not hidden): a path that starts existing
 * only between check and execution is a TOCTOU race JavaScript cannot close;
 * the gate re-canonicalizes at authorize time and v0.1 relies on that plus
 * the shell policy (no unattended shell) rather than claiming a full sandbox.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { AbsolutePathSchema } from "@deepseek-bot/contracts";

export class InvalidToolPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidToolPathError";
  }
}

export interface PathCheckOptions {
  /** Injectable realpath (defaults to `fs.promises.realpath`). */
  readonly realpath?: (p: string) => Promise<string>;
  /** Force case-insensitive comparison; defaults to the host platform. */
  readonly caseInsensitive?: boolean;
}

function defaultRealpath(p: string): Promise<string> {
  return fsp.realpath(p);
}

/**
 * Canonicalize a tool-supplied path for policy checks. Lexical `.`/`..` are
 * resolved against the deepest existing ancestor's real location, so a
 * non-existent path under a symlinked directory is judged by where the link
 * actually points.
 */
export async function canonicalizeToolPath(
  input: string,
  options: PathCheckOptions = {},
): Promise<string> {
  const parsed = AbsolutePathSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidToolPathError("tool path must be an absolute path");
  }
  // Device namespaces bypass the filesystem layout grants describe.
  if (/^\\\\[.?]\\/u.test(parsed.data)) {
    throw new InvalidToolPathError("device paths are not valid tool paths");
  }
  const realpath = options.realpath ?? defaultRealpath;
  const missing: string[] = [];
  let candidate = path.normalize(parsed.data);
  for (;;) {
    try {
      const real = await realpath(candidate);
      if (missing.length === 0) {
        return real;
      }
      // missing is child→parent order; re-join parent→child and resolve
      // remaining `.`/`..` lexically against the real existing ancestor.
      return path.resolve(real, ...missing.reverse());
    } catch {
      const parent = path.dirname(candidate);
      if (parent === candidate) {
        throw new InvalidToolPathError(
          `tool path has no existing ancestor to canonicalize against: ${parsed.data}`,
        );
      }
      missing.push(path.basename(candidate));
      candidate = parent;
    }
  }
}

/**
 * Canonicalize a stored grant scope through the SAME function tool paths use
 * (canonicalizeToolPath), falling back to lexical normalization when no
 * existing ancestor can be canonicalized. Gates must run scopes and children
 * through one shared implementation: fs.realpathSync (JS impl) and
 * fs.promises.realpath disagree on Windows 8.3 short names — the JS impl
 * keeps `RUNNER~1` while the promises/native path returns `runneradmin` —
 * so mixing them silently breaks every containment check.
 */
export async function canonicalizeScopePath(
  input: string,
  options: PathCheckOptions = {},
): Promise<string> {
  try {
    return await canonicalizeToolPath(input, options);
  } catch (error) {
    if (error instanceof InvalidToolPathError) {
      return path.normalize(input);
    }
    throw error;
  }
}

/**
 * Segment-aware containment of `child` under `scope`. Both paths are
 * lexically normalized; comparison is case-insensitive on Windows
 * (case-preserving filesystems) unless overridden.
 */
export function isPathWithinScope(
  child: string,
  scope: string,
  options: PathCheckOptions = {},
): boolean {
  const caseInsensitive =
    options.caseInsensitive ?? process.platform === "win32";
  const normalize = (value: string): string => {
    let normalized = path.normalize(value);
    const stripped = normalized.replace(/[\\/]+$/u, "");
    // Keep a bare root ("/") intact instead of stripping it to "".
    normalized = stripped === "" ? normalized : stripped;
    if (caseInsensitive) {
      normalized = normalized.toLowerCase();
    }
    return normalized;
  };
  const childPath = normalize(child);
  const scopePath = normalize(scope);
  if (childPath === scopePath) {
    return true;
  }
  // Root scopes: POSIX "/" contains every absolute path below it. The
  // Windows marker "\\" is drive-relative and ambiguous — fail closed.
  if (scopePath === "\\" || (scopePath === "/" && path.sep === "\\")) {
    return false;
  }
  if (scopePath === "/") {
    return childPath.startsWith("/");
  }
  return childPath.startsWith(`${scopePath}${path.sep}`);
}
