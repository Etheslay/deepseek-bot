/**
 * Pinned Harness runtime resolution (HARNESS_INTEGRATION §5).
 *
 * The adapter consumes `@deepseek-ai/dsh` at an exact version and asserts the
 * resolved manifest matches the pinned expectation before spawning: a drifted
 * or replaced runtime (pnpm override, hoisting accident, supply-chain
 * substitution) must refuse to run, not silently serve a different agent.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** The pinned upstream version this adapter line was verified against (D01). */
export const PINNED_DSH_VERSION = "0.2.1-rc.2";

export interface DshLaunchSpec {
  /** Node executable used to run the dsh CLI. */
  readonly command: string;
  /** Absolute path of the dsh CLI entry (`bin.dsh`). */
  readonly dshBin: string;
  /** Manifest version of the resolved package. */
  readonly version: string;
}

interface DshManifest {
  readonly version?: unknown;
  readonly bin?: unknown;
}

/**
 * Resolve the installed dsh CLI. `expectedVersion` defaults to the pinned
 * constant; an explicit override exists only for tests driving fake runtime
 * scripts (they pass their own `dshBin` instead and skip this resolver).
 */
export function resolveDshSpec(expectedVersion: string = PINNED_DSH_VERSION): DshLaunchSpec {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve("@deepseek-ai/dsh/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as DshManifest;
  if (typeof manifest.version !== "string") {
    throw new Error(`resolved @deepseek-ai/dsh manifest at ${manifestPath} declares no version`);
  }
  if (manifest.version !== expectedVersion) {
    throw new Error(
      `@deepseek-ai/dsh ${expectedVersion} is pinned for this adapter, resolved ${manifest.version}`,
    );
  }
  const bin =
    typeof manifest.bin === "object" && manifest.bin !== null
      ? (manifest.bin as Record<string, unknown>)["dsh"]
      : manifest.bin;
  if (typeof bin !== "string" || bin.length === 0) {
    throw new Error("@deepseek-ai/dsh manifest declares no dsh bin entry");
  }
  return {
    command: process.execPath,
    dshBin: join(dirname(manifestPath), bin),
    version: manifest.version,
  };
}
