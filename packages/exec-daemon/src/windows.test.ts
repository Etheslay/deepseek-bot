import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_EDGE, MAX_PIXELS, MAX_PNG_BYTES, MAX_WINDOWS } from "./limits.js";
import { ProcessRunError } from "./process.js";
import {
  createPowerShellRunner,
  helperLaunch,
  parseCaptureSize,
  parseHelperFailure,
  parseWindowList,
  windowsHelperScriptPath,
} from "./windows.js";

const identity = { hwnd: "100", pid: 20, processStartTime: "300" };

describe("PowerShell helper contract", () => {
  it("launches the fixed script with an argument array and no shell", () => {
    const launch = helperLaunch({ op: "capture", ...identity, outputDirectory: "/tmp/out" });
    expect(launch.command).toBe("powershell.exe");
    expect(launch.shell).toBe(false);
    expect(launch.windowsHide).toBe(true);
    expect(launch.args).toContain("-File");
    expect(launch.args).toContain("-WindowStyle");
    expect(launch.args).toContain("Hidden");
    expect(launch.args).not.toContain("-Command");
    expect(launch.args.at(-5)).toBe("capture");
    expect(launch.args.slice(-4)).toEqual(["100", "20", "300", "/tmp/out"]);
    expect(helperLaunch({ op: "list" }).args.at(-1)).toBe("list");
  });

  it("rejects helper arguments that could break the parameter array", () => {
    expect(() =>
      helperLaunch({
        op: "capture",
        ...identity,
        outputDirectory: "/tmp/line\nnext",
      }),
    ).toThrow(/helper argument/);
  });

  it("keeps the script free of shell, desktop capture, and network fallbacks", async () => {
    const script = await readFile(windowsHelperScriptPath(), "utf8");
    for (const token of [
      "Invoke-Expression",
      "Start-Process",
      "cmd.exe",
      "CopyFromScreen",
      "GetDesktopWindow",
      "BitBlt",
      "SetForegroundWindow",
      "ShowWindow",
      "SendInput",
      "Invoke-WebRequest",
      "Invoke-RestMethod",
      "DownloadString",
      "-Command",
    ]) {
      expect(script.includes(token)).toBe(false);
    }
    for (const token of [
      "PrintWindow",
      "EnumWindows",
      "GetProcessTimes",
      "GetWindowDisplayAffinity",
      "IsIconic",
    ]) {
      expect(script.includes(token)).toBe(true);
    }
    expect(script.includes(String(MAX_EDGE))).toBe(true);
    expect(script.includes(String(MAX_PIXELS))).toBe(true);
    expect(script.includes(String(MAX_PNG_BYTES))).toBe(true);
    expect(script.includes(String(MAX_WINDOWS))).toBe(true);
    expect(script.includes("capture.png")).toBe(true);
  });

  it("maps helper refusals onto stable reasons and drops helper prose", () => {
    expect(
      parseHelperFailure('{"ok":false,"code":"MINIMIZED","message":"secret title"}'),
    ).toMatchObject({
      code: "INVALID_INPUT",
      reason: "minimized",
    });
    expect(parseHelperFailure('{"ok":false,"code":"CLOSED","message":"x"}')?.reason).toBe(
      "target-closed",
    );
    expect(parseHelperFailure('{"ok":false,"code":"REUSED","message":"x"}')?.reason).toBe(
      "handle-reused",
    );
    expect(parseHelperFailure('{"ok":false,"code":"PROTECTED","message":"x"}')?.reason).toBe(
      "protected",
    );
    expect(parseHelperFailure('{"ok":false,"code":"SIZE","message":"x"}')?.reason).toBe("size");
    expect(parseHelperFailure('{"ok":false,"code":"UNCONFIRMED","message":"x"}')?.reason).toBe(
      "unconfirmed",
    );
    expect(parseHelperFailure('{"ok":false,"code":"RUNTIME","message":"x"}')?.code).toBe(
      "RUNTIME_UNAVAILABLE",
    );
    expect(parseHelperFailure('{"ok":true}')).toBeUndefined();
  });

  it("rejects a malformed or oversized window list", () => {
    const window = {
      hwnd: "100",
      pid: 20,
      processStartTime: "300",
      title: "测试窗口",
      minimized: false,
      width: 10,
      height: 12,
      isProtected: true,
    };
    expect(parseWindowList(JSON.stringify({ ok: true, windows: [window] }))).toEqual([
      {
        hwnd: "100",
        pid: 20,
        processStartTime: "300",
        title: "测试窗口",
        minimized: false,
        width: 10,
        height: 12,
        protected: true,
      },
    ]);
    expect(() =>
      parseWindowList(JSON.stringify({ ok: true, windows: Array(MAX_WINDOWS + 1).fill(window) })),
    ).toThrow(/malformed/);
    expect(() =>
      parseWindowList(JSON.stringify({ ok: true, windows: [{ ...window, pid: 0 }] })),
    ).toThrow(/malformed/);
    expect(() => parseCaptureSize('{"ok":true,"width":1.5,"height":1}')).toThrow(/malformed/);
  });

  it("reports that PowerShell did not start", async () => {
    const started = Date.now();
    const runner = createPowerShellRunner("/missing/win32-capture.ps1");
    await expect(
      runner.run({ op: "list" }, new AbortController().signal, 1_000),
    ).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
      reason: "helper",
      message: "Windows capture helper is unavailable",
    });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("does not launch when the helper script is missing", async () => {
    let calls = 0;
    const runner = createPowerShellRunner("/missing/win32-capture.ps1", {
      async runProcess() {
        calls += 1;
        throw new ProcessRunError("timeout", "helper timed out");
      },
    });
    await expect(
      runner.run({ op: "list" }, new AbortController().signal, 1_000),
    ).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
    });
    expect(calls).toBe(0);
  });

  it("reports a helper path that is not a file as unavailable", async () => {
    const runner = createPowerShellRunner(fileURLToPath(new URL(".", import.meta.url)));
    await expect(
      runner.run({ op: "list" }, new AbortController().signal, 1_000),
    ).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
      message: "Windows capture helper is unavailable",
    });
  });

  it("reports cancellation before starting a missing helper", async () => {
    const controller = new AbortController();
    controller.abort();
    const runner = createPowerShellRunner("/missing/win32-capture.ps1");
    await expect(runner.run({ op: "list" }, controller.signal, 1_000)).rejects.toMatchObject({
      code: "CANCELLED",
    });
  });

  it("reports a timeout when an existing helper hangs", async () => {
    const scriptPath = windowsHelperScriptPath();
    let timeoutMs = 0;
    const runner = createPowerShellRunner(scriptPath, {
      async runProcess(options) {
        timeoutMs = options.timeoutMs;
        expect(options.command).toBe("powershell.exe");
        expect(options.args).toContain(scriptPath);
        throw new ProcessRunError("timeout", "helper timed out");
      },
    });
    await expect(
      runner.run({ op: "list" }, new AbortController().signal, 1_000),
    ).rejects.toMatchObject({
      code: "TOOL_TIMEOUT",
      message: "capture helper timed out",
    });
    expect(timeoutMs).toBe(2_000);
  });

  it("maps a helper that exits without a refusal onto unavailable", async () => {
    const runner = createPowerShellRunner(windowsHelperScriptPath(), {
      async runProcess() {
        throw new ProcessRunError("exit", "helper exited with a failure", "not json");
      },
    });
    await expect(
      runner.run({ op: "list" }, new AbortController().signal, 1_000),
    ).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
      message: "capture helper failed",
    });
  });

  it.skipIf(process.platform === "win32")(
    "reports an unavailable runtime when powershell.exe cannot be spawned",
    async () => {
      const runner = createPowerShellRunner(windowsHelperScriptPath());
      await expect(
        runner.run({ op: "list" }, new AbortController().signal, 1_000),
      ).rejects.toMatchObject({
        code: "RUNTIME_UNAVAILABLE",
        message: "Windows capture helper is unavailable",
      });
    },
  );
});
