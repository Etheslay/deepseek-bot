/**
 * G2 approval-bridge activation: the Host stages the bridge package into the
 * pinned profile at startup, the staging is idempotent, and an unbuilt
 * package is recorded as unavailable instead of stopping Host assembly.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureDataLayout } from "@deepseek-bot/storage";
import { createHost } from "./host.js";
import { stageApprovalBridge } from "./bridge-activation.js";

/** A minimal bridge package with the exact manifest prepareAppToolProfile demands. */
function fakeBridgePackage(root: string): string {
  const dir = join(root, "bridge-src");
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "@deepseek-bot/harness-bridge",
      version: "0.0.0",
      main: "./dist/index.js",
    }),
    "utf8",
  );
  writeFileSync(join(dir, "dist", "index.js"), "export const bridge = true;\n", "utf8");
  return dir;
}

function stagedPackageJson(harnessHome: string): string {
  return join(
    harnessHome,
    "profiles",
    "sdk",
    "node_modules",
    "@deepseek-bot",
    "harness-bridge",
    "package.json",
  );
}

function lastLogRecord(logFile: string): Record<string, unknown> {
  const lines = readFileSync(logFile, "utf8").trim().split("\n");
  return JSON.parse(lines[lines.length - 1] ?? "{}") as Record<string, unknown>;
}

describe("stageApprovalBridge", () => {
  it("stages the bridge into the pinned profile and records the install", () => {
    const root = mkdtempSync(join(tmpdir(), "dsb-bridge-ok-"));
    const source = fakeBridgePackage(root);
    const harnessHome = join(root, "harness");
    const logsDir = join(root, "logs");
    const now = new Date("2026-10-28T08:00:00.000Z");

    const outcome = stageApprovalBridge({
      harnessHome,
      bridgePackageDir: source,
      logsDir,
      now: () => now,
    });

    expect(outcome.result).toBe("installed");
    if (outcome.result !== "installed") return;
    expect(existsSync(outcome.stagedDir)).toBe(true);
    expect(JSON.parse(readFileSync(stagedPackageJson(harnessHome), "utf8"))).toMatchObject({
      name: "@deepseek-bot/harness-bridge",
    });
    expect(existsSync(join(outcome.stagedDir, "dist", "index.js"))).toBe(true);
    expect(lastLogRecord(outcome.logFile)).toMatchObject({
      at: "2026-10-28T08:00:00.000Z",
      result: "installed",
      profile: "sdk",
    });
  });

  it("is idempotent: an unchanged bridge is not rewritten", () => {
    const root = mkdtempSync(join(tmpdir(), "dsb-bridge-idem-"));
    const source = fakeBridgePackage(root);
    const options = {
      harnessHome: join(root, "harness"),
      bridgePackageDir: source,
      logsDir: join(root, "logs"),
    } as const;

    stageApprovalBridge(options);
    const staged = stagedPackageJson(options.harnessHome);
    const first = statSync(staged);

    const outcome = stageApprovalBridge(options);
    expect(outcome.result).toBe("installed");
    const second = statSync(staged);
    expect(second.mtimeMs).toBe(first.mtimeMs);
  });

  it("picks up changed bridge bytes on the next startup", () => {
    const root = mkdtempSync(join(tmpdir(), "dsb-bridge-upd-"));
    const source = fakeBridgePackage(root);
    const options = {
      harnessHome: join(root, "harness"),
      bridgePackageDir: source,
      logsDir: join(root, "logs"),
    } as const;

    stageApprovalBridge(options);
    writeFileSync(join(source, "dist", "index.js"), "export const bridge = 2;\n", "utf8");
    const outcome = stageApprovalBridge(options);

    expect(outcome.result).toBe("installed");
    if (outcome.result !== "installed") return;
    expect(readFileSync(join(outcome.stagedDir, "dist", "index.js"), "utf8")).toContain(
      "bridge = 2",
    );
  });

  it("records an unbuilt bridge as unavailable instead of throwing", () => {
    const root = mkdtempSync(join(tmpdir(), "dsb-bridge-bad-"));
    const empty = join(root, "bridge-src");
    mkdirSync(join(empty, "dist"), { recursive: true });
    writeFileSync(join(empty, "dist", "index.js"), "export {};\n", "utf8");
    const options = {
      harnessHome: join(root, "harness"),
      bridgePackageDir: empty,
      logsDir: join(root, "logs"),
    } as const;

    const outcome = stageApprovalBridge(options);

    expect(outcome.result).toBe("unavailable");
    if (outcome.result !== "unavailable") return;
    expect(outcome.detail).toContain("unavailable");
    expect(lastLogRecord(outcome.logFile)).toMatchObject({
      result: "unavailable",
      profile: "sdk",
    });
  });
});

describe("createHost bridge activation", () => {
  it("stages the bridge at startup and the Host still assembles", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsb-bridge-host-"));
    const host = await createHost({
      dataRoot: root,
      resolveApiKey: async () => "sk-test-only",
    });
    try {
      const layout = ensureDataLayout(root);
      expect(existsSync(stagedPackageJson(layout.harnessHome))).toBe(true);
      expect(lastLogRecord(join(layout.logs, "bridge-install.jsonl"))).toMatchObject({
        result: "installed",
      });
    } finally {
      await host.shutdown();
    }
  });
});
