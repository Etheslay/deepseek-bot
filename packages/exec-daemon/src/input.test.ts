import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cancelled } from "./errors.js";
import { MAX_EDGE } from "./limits.js";
import { ProcessRunError } from "./process.js";
import {
  allowedVirtualKeys,
  createDeviceInputBackend,
  createPowerShellInputRunner,
  helperRequest,
  inputLaunch,
  inputScriptPath,
  parseDeviceInputFailure,
  type DeviceHelperRequest,
  type DeviceInputRequest,
  type DeviceInputRunner,
} from "./input.js";

const pointer: DeviceInputRequest = {
  kind: "pointer",
  gesture: "click",
  button: "left",
  x: 12,
  y: 0,
};
const key: DeviceInputRequest = {
  kind: "key",
  name: "a",
  action: "tap",
  shift: false,
  ctrl: true,
  alt: false,
};

describe("device input helper", () => {
  it("launches the fixed script with an argument array and no shell", () => {
    const launch = inputLaunch(helperRequest(pointer));
    expect(launch.command).toBe("powershell.exe");
    expect(launch.shell).toBe(false);
    expect(launch.windowsHide).toBe(true);
    expect(launch.args).toContain("-File");
    expect(launch.args).not.toContain("-Command");
    expect(launch.args.slice(-5)).toEqual(["pointer", "click", "left", "12", "0"]);
    const keyLaunch = inputLaunch(helperRequest(key));
    expect(keyLaunch.args.slice(-5)).toEqual(["key", "65", "0", "1", "0"]);
    expect(keyLaunch.args).not.toContain("cmd.exe");
    expect(keyLaunch.args).not.toContain("calc");
  });

  it("rejects a helper argument that breaks the parameter array", () => {
    const broken = {
      op: "pointer",
      gesture: "move\nnext",
      button: "left",
      x: 1,
      y: 1,
    } as unknown as DeviceHelperRequest;
    expect(() => inputLaunch(broken)).toThrow(/helper argument/);
  });

  it("keeps the script on the same virtual-key allowlist and off the shell", async () => {
    const script = await readFile(inputScriptPath(), "utf8");
    const match = script.match(/\$AllowedVks = @\(([^)]+)\)/);
    expect(match?.[1]).toBe(allowedVirtualKeys().join(","));
    expect(allowedVirtualKeys()).not.toContain(0x5b);
    expect(allowedVirtualKeys()).not.toContain(0x5c);
    expect(script).toContain("SendInput");
    expect(script).toContain("SetCursorPos");
    expect(script).toContain(String(MAX_EDGE));
    for (const token of [
      "Invoke-Expression",
      "Start-Process",
      "cmd.exe",
      "Invoke-WebRequest",
      "Invoke-RestMethod",
      "-Command",
    ]) {
      expect(script.includes(token)).toBe(false);
    }
  });

  it("rejects an unknown key or an out-of-range pointer before a helper runs", () => {
    expect(() => helperRequest({ ...key, name: "win" })).toThrow(/unknown/);
    expect(() => helperRequest({ ...pointer, x: MAX_EDGE + 1 })).toThrow(/position/);
    expect(() =>
      helperRequest({ ...key, action: "hold" } as unknown as DeviceInputRequest),
    ).toThrow(/invalid/);
    expect(parseDeviceInputFailure('{"ok":false,"code":"INPUT","message":"secret"}')).toMatchObject(
      {
        code: "INVALID_INPUT",
        reason: "input",
      },
    );
    expect(parseDeviceInputFailure('{"ok":false,"code":"UNCONFIRMED"}')?.reason).toBe(
      "unconfirmed",
    );
    expect(parseDeviceInputFailure('{"ok":false,"code":"OTHER"}')?.code).toBe(
      "RUNTIME_UNAVAILABLE",
    );
    expect(parseDeviceInputFailure('{"ok":true}')).toBeUndefined();
  });

  it("does not launch when the helper script is missing", async () => {
    let calls = 0;
    const runner = createPowerShellInputRunner("/missing/win32-input.ps1", {
      async runProcess() {
        calls += 1;
        throw new ProcessRunError("timeout", "helper timed out");
      },
    });
    await expect(
      runner.run(helperRequest(pointer), new AbortController().signal, 1_000),
    ).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
      reason: "helper",
    });
    expect(calls).toBe(0);
  });

  it("reports a helper path that is not a file as unavailable", async () => {
    const runner = createPowerShellInputRunner(fileURLToPath(new URL(".", import.meta.url)));
    await expect(
      runner.run(helperRequest(key), new AbortController().signal, 1_000),
    ).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
    });
  });

  it("performs one accepted input and maps a helper refusal", async () => {
    const seen: DeviceHelperRequest[] = [];
    const backend = backendWith(async (request) => {
      seen.push(request);
      return '{"ok":true}';
    });
    await backend.perform(pointer, new AbortController().signal);
    await backend.perform({ ...key, name: "enter", shift: true }, new AbortController().signal);
    expect(seen.map((item) => item.op)).toEqual(["pointer", "key"]);
    const refusing = backendWith(async () => '{"ok":false,"code":"UNCONFIRMED"}');
    await expect(refusing.perform(pointer, new AbortController().signal)).rejects.toMatchObject({
      code: "INVALID_INPUT",
      reason: "unconfirmed",
    });
    const malformed = backendWith(async () => "not-json");
    await expect(malformed.perform(pointer, new AbortController().signal)).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
    });
    backend.close();
    refusing.close();
    malformed.close();
  });

  it("does not call the helper for an unknown key", async () => {
    let calls = 0;
    const backend = backendWith(async () => {
      calls += 1;
      return '{"ok":true}';
    });
    await expect(
      backend.perform({ ...key, name: "logo" }, new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(calls).toBe(0);
    backend.close();
  });

  it("times out and cancels without treating a late helper as success", async () => {
    const hanging = createDeviceInputBackend({
      timeoutMs: 30,
      helperRunner: {
        run(_request, signal) {
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(cancelled("device input cancelled")), {
              once: true,
            });
          });
        },
      },
    });
    await expect(hanging.perform(pointer, new AbortController().signal)).rejects.toMatchObject({
      code: "TOOL_TIMEOUT",
      message: "device input timed out",
    });
    hanging.close();

    let settled = false;
    const runner: DeviceInputRunner = {
      run(_request, signal) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            settled = true;
            reject(cancelled("device input cancelled"));
          });
        });
      },
    };
    const live = createDeviceInputBackend({ helperRunner: runner, timeoutMs: 5_000 });
    const pending = live.perform(key, new AbortController().signal);
    live.close();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(settled).toBe(true);
    await expect(live.perform(key, new AbortController().signal)).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
    });
  });

  it("stays unavailable where the Windows helper is not the production path", async () => {
    expect(() =>
      createDeviceInputBackend({
        timeoutMs: 0,
        helperRunner: {
          async run() {
            return "";
          },
        },
      }),
    ).toThrow(/timeout/);
    if (process.platform === "win32") return;
    const backend = createDeviceInputBackend();
    expect(backend.supported).toBe(false);
    await expect(backend.perform(pointer, new AbortController().signal)).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
    });
    backend.close();
  });
});

function backendWith(run: DeviceInputRunner["run"]) {
  return createDeviceInputBackend({ helperRunner: { run }, timeoutMs: 1_000 });
}
