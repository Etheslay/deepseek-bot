import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
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
  it("captures a window this test created", async (context) => {
    const title = `dsb-screen-${randomUUID()}`;
    const child = spawn(
      process.env.SystemRoot
        ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
        : "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-File", script, title],
      { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const resources = await mkdtemp(path.join(tmpdir(), "dsb-screen-real-"));
    const output = await mkdtemp(path.join(tmpdir(), "dsb-screen-real-out-"));
    const backend = createScreenBackend({ resourcesDirectory: resources });
    let ready = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      ready += chunk;
    });
    try {
      await waitUntil(() => ready.includes("ready"));
      const found = await findSelf(backend, title);
      if (found === undefined) {
        context.skip(NO_VISIBLE_WINDOW);
        return;
      }
      const captured = await backend.capture(
        { hwnd: found.hwnd, pid: found.pid, processStartTime: found.processStartTime },
        output,
        new AbortController().signal,
      );
      expect(captured.width).toBeGreaterThan(0);
      expect(captured.height).toBeGreaterThan(0);
      expect(path.basename(captured.pngPath)).toBe("capture.png");
    } finally {
      backend.close();
      child.kill();
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
