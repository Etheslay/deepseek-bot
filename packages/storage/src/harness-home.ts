/**
 * Dedicated Harness home (docs/SECURITY_DATA.md §2 `harness/`).
 *
 * D01 §5.1 verified that the upstream Harness relocates all of its state
 * (profiles, storages, `.credentials.yaml`) when `DSH_HOME` points elsewhere.
 * This module only resolves that directory inside our own data root; launching
 * the Harness process itself belongs to the runtime task.
 */
import path from "node:path";
import type { DataLayout } from "./layout.js";

export const HARNESS_HOME_ENV_VAR = "DSH_HOME";

export function resolveHarnessHome(layout: DataLayout): string {
  // Defensive containment check: the home must stay inside the app data root.
  const relative = path.relative(layout.root, layout.harnessHome);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("harness home escaped the data root");
  }
  return layout.harnessHome;
}

/**
 * Environment variables for launching the Harness with our dedicated home,
 * isolating it from any existing user CLI data. Callers merge this over the
 * child process environment.
 */
export function harnessLaunchEnv(
  layout: DataLayout,
  extra?: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {
    [HARNESS_HOME_ENV_VAR]: resolveHarnessHome(layout),
  };
  if (extra !== undefined) {
    for (const [key, value] of Object.entries(extra)) {
      env[key] = value;
    }
  }
  return env;
}
