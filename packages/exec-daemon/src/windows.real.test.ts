import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createScreenBackend } from "./backend.js";
import type { ListedWindow } from "./windows.js";

const script = fileURLToPath(new URL("./testing/self-window.ps1", import.meta.url));

const NO_VISIBLE_WINDOW =
  "no visible desktop, or the self-test window was not listed; real capture was not verified";

const NO_INTERACTIVE_DESKTOP =
  "self-test window did not open; real capture was not verified because this process has no interactive desktop";

// Hosted Windows runners do not always have an interactive desktop. WinForms
// Show() can then block before the fixture prints "ready", which failed the
// exec-daemon job on one PR runner while the same commit opened the window
// on the push runner. That is the runner session. Skip only when the window
// never opens. DSB_REQUIRE_REAL_SCREEN=1 still fails, and capture stays
// strict once "ready" has been printed.
function realScreenOutcome(
  windowOpened: boolean,
  requireRealScreen: boolean,
): "run" | "skip" | "fail" {
  if (windowOpened) return "run";
  return requireRealScreen ? "fail" : "skip";
}

describe("real capture when the self-test window cannot open", () => {
  it("skips that case and still runs once the window is open", () => {
    expect(realScreenOutcome(false, false)).toBe("skip");
    expect(realScreenOutcome(true, false)).toBe("run");
    expect(realScreenOutcome(true, true)).toBe("run");
    expect(realScreenOutcome(false, true)).toBe("fail");
  });
});

describe.skipIf(process.platform !== "win32")("real Windows capture", () => {
  it("captures its own visible window and rejects stale identities and minimization", async (context) => {
    const title = `dsb-screen-${randomUUID()}`;
    const child = spawn(
      process.env.SystemRoot
        ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
        : "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-File", script, title],
      // Only this owned WinForms fixture must be visible. Production capture
      // helpers retain their hidden, non-interactive launch configuration.
      { shell: false, windowsHide: false, stdio: ["pipe", "pipe", "pipe"] },
    );
    const resources = await mkdtemp(path.join(tmpdir(), "dsb-screen-real-"));
    const output = await mkdtemp(path.join(tmpdir(), "dsb-screen-real-out-"));
    const backend = createScreenBackend({ resourcesDirectory: resources });
    let ready = "";
    let diagnostics = "";
    let spawnError: Error | undefined;
    child.on("error", (error) => {
      spawnError = error;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      diagnostics += chunk;
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      ready += chunk;
    });
    try {
      const opened = await selfTestWindowOpened(() => {
        if (spawnError !== undefined) throw spawnError;
        if (child.exitCode !== null) return "exited";
        return ready.includes("ready") ? "ready" : "pending";
      });
      const outcome = realScreenOutcome(opened, process.env.DSB_REQUIRE_REAL_SCREEN === "1");
      if (outcome === "skip") {
        context.skip(NO_INTERACTIVE_DESKTOP);
        return;
      }
      if (outcome === "fail") {
        throw new Error(
          child.exitCode !== null
            ? `self-test window exited: ${diagnostics}`
            : "self-test window did not open",
        );
      }
      const found = await findSelf(backend, title);
      if (found === undefined) {
        const listed = realScreenOutcome(false, process.env.DSB_REQUIRE_REAL_SCREEN === "1");
        if (listed === "fail") throw new Error(NO_VISIBLE_WINDOW);
        context.skip(NO_VISIBLE_WINDOW);
        return;
      }
      expect(found.pid).toBe(child.pid);
      expect(found.title).toBe(title);
      expect(found.minimized).toBe(false);
      expect(found.protected).toBe(false);
      const identity = {
        hwnd: found.hwnd,
        pid: found.pid,
        processStartTime: found.processStartTime,
      };
      const captured = await backend.capture(identity, output, new AbortController().signal);
      expect(captured.width).toBe(found.width);
      expect(captured.height).toBe(found.height);
      expect(captured.width).toBeGreaterThanOrEqual(400);
      expect(captured.height).toBeGreaterThanOrEqual(240);
      expect(path.basename(captured.pngPath)).toBe("capture.png");
      const bytes = await readFile(captured.pngPath);
      expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(bytes.readUInt32BE(16)).toBe(captured.width);
      expect(bytes.readUInt32BE(20)).toBe(captured.height);
      expect(bytes.byteLength).toBe(captured.byteLength);

      for (const stale of [
        { ...identity, pid: identity.pid + 1 },
        { ...identity, processStartTime: String(BigInt(identity.processStartTime) + 1n) },
      ]) {
        await expect(
          backend.capture(stale, output, new AbortController().signal),
        ).rejects.toMatchObject({ code: "INVALID_INPUT", reason: "handle-reused" });
        await expect(readFile(captured.pngPath)).rejects.toMatchObject({ code: "ENOENT" });
      }
      child.stdin?.write("minimize\n");
      await waitUntil(() => ready.includes("minimized"));
      await expect(
        backend.capture(identity, output, new AbortController().signal),
      ).rejects.toMatchObject({ code: "INVALID_INPUT", reason: "minimized" });
      await expect(readFile(captured.pngPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      backend.close();
      const stopped = new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) resolve();
        else child.once("exit", () => resolve());
      });
      child.kill();
      await stopped;
      await rm(resources, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
    }
  }, 40_000);
});

async function findSelf(
  backend: ReturnType<typeof createScreenBackend>,
  title: string,
): Promise<ListedWindow | undefined> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const windows = await backend.listWindows(AbortSignal.timeout(8_000));
    const match = windows.find((item) => item.title === title);
    if (match !== undefined && windows.filter((item) => item.title === title).length === 1)
      return match;
    await delay(200);
  }
  return undefined;
}

type WindowSignal = "ready" | "pending" | "exited";

async function selfTestWindowOpened(signal: () => WindowSignal): Promise<boolean> {
  const deadline = Date.now() + 8_000;
  while (true) {
    const state = signal();
    if (state === "ready") return true;
    if (state === "exited" || Date.now() > deadline) return false;
    await delay(40);
  }
}

async function waitUntil(ready: () => boolean): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error("self-test window did not minimize");
    await delay(40);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
