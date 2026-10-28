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
      await waitUntil(() => {
        if (spawnError !== undefined) throw spawnError;
        if (child.exitCode !== null) throw new Error(`self-test window exited: ${diagnostics}`);
        return ready.includes("ready");
      });
      const found = await findSelf(backend, title);
      if (found === undefined) {
        if (process.env.DSB_REQUIRE_REAL_SCREEN === "1") throw new Error(NO_VISIBLE_WINDOW);
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

async function waitUntil(ready: () => boolean): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error("self-test window did not open");
    await delay(40);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
