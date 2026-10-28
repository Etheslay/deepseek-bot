/**
 * G2 (GAP_AUDIT): the approval bridge must be staged into the pinned "sdk"
 * profile once at Host startup. Chat turns staged it lazily and workflow
 * runs never did, so the mounted dsb-approval-bridge row had no package and
 * the pinned harness reported "entry did not activate". The copy-based
 * install is idempotent across restarts.
 */
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createHost, type DeepSeekBotHost } from "./host.js";

const roots: string[] = [];
const hosts: DeepSeekBotHost[] = [];
afterAll(async () => {
  for (const host of hosts.splice(0)) {
    await host.shutdown().catch(() => undefined);
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function stagedPath(host: DeepSeekBotHost): string {
  return join(
    host.layout.harnessHome,
    "profiles",
    "sdk",
    "node_modules",
    "@deepseek-bot",
    "harness-bridge",
  );
}

describe("approval bridge staging", () => {
  it("stages the bridge into the pinned sdk profile at startup", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsb-host-bridge-"));
    roots.push(root);
    const host = await createHost({
      dataRoot: root,
      resolveApiKey: async () => "test-key",
    });
    hosts.push(host);
    const staged = stagedPath(host);
    expect(existsSync(join(staged, "package.json"))).toBe(true);
    expect(existsSync(join(staged, "dist", "index.js"))).toBe(true);
  });

  it("restages idempotently when the host reopens the same data root", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsb-host-bridge-"));
    roots.push(root);
    const first = await createHost({
      dataRoot: root,
      resolveApiKey: async () => "test-key",
    });
    hosts.push(first);
    await first.shutdown();
    hosts.pop();
    const second = await createHost({
      dataRoot: root,
      resolveApiKey: async () => "test-key",
    });
    hosts.push(second);
    expect(existsSync(join(stagedPath(second), "dist", "index.js"))).toBe(true);
    await second.shutdown();
    hosts.pop();
    // One more open/close round keeps the install in place and does not
    // corrupt the staged package.
    const third = await createHost({
      dataRoot: root,
      resolveApiKey: async () => "test-key",
    });
    hosts.push(third);
    expect(existsSync(join(stagedPath(third), "dist", "index.js"))).toBe(true);
  });
});
