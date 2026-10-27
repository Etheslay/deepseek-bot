import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProcessRunError, runFixedProcess } from "./process.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("fixed helper processes", () => {
  it("kills the helper and a same-group child on cancel", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dsb-screen-proc-"));
    directories.push(directory);
    const pidFile = path.join(directory, "pids.json");
    const controller = new AbortController();
    const pending = runFixedProcess({
      command: process.execPath,
      args: ["-e", parentScript(), pidFile],
      signal: controller.signal,
      timeoutMs: 5_000,
      maxStdoutBytes: 1024,
    });
    const pids = await waitForPids(pidFile);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "ProcessRunError", kind: "cancelled" });
    await expect(dead(pids.parent)).resolves.toBe(true);
    await expect(dead(pids.child)).resolves.toBe(true);
  });

  it("kills the helper when the timeout elapses", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dsb-screen-proc-"));
    directories.push(directory);
    const pidFile = path.join(directory, "pid.txt");
    const pending = runFixedProcess({
      command: process.execPath,
      args: [
        "-e",
        "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);",
        pidFile,
      ],
      signal: new AbortController().signal,
      timeoutMs: 200,
      maxStdoutBytes: 1024,
    });
    const pid = Number(await waitForText(pidFile));
    await expect(pending).rejects.toBeInstanceOf(ProcessRunError);
    await expect(pending).rejects.toMatchObject({ kind: "timeout" });
    await expect(dead(pid)).resolves.toBe(true);
  });

  it("stops a helper that writes more than the stdout limit", async () => {
    await expect(
      runFixedProcess({
        command: process.execPath,
        args: ["-e", "process.stdout.write(Buffer.alloc(2 * 1024 * 1024, 97))"],
        signal: new AbortController().signal,
        timeoutMs: 5_000,
        maxStdoutBytes: 64 * 1024,
      }),
    ).rejects.toMatchObject({ kind: "output" });
  });

  it("does not start a command through a shell", async () => {
    const source = await readFile(new URL("./process.ts", import.meta.url), "utf8");
    expect(source.includes("shell: true")).toBe(false);
    expect(source.includes("shell:true")).toBe(false);
  });
});

function parentScript(): string {
  return `
    const { spawn } = require("node:child_process");
    const fs = require("node:fs");
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], { stdio: "ignore" });
    fs.writeFileSync(process.argv[1], JSON.stringify({ parent: process.pid, child: child.pid }));
    setInterval(() => {}, 1000);
  `;
}

async function waitForPids(pidFile: string): Promise<{ parent: number; child: number }> {
  return JSON.parse(await waitForText(pidFile)) as { parent: number; child: number };
}

async function waitForText(file: string): Promise<string> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      const text = await readFile(file, "utf8");
      if (text.length > 0) return text;
    } catch {
      // The helper has not written the file yet.
    }
    await delay(20);
  }
  throw new Error("helper did not record its process id");
}

async function dead(pid: number): Promise<boolean> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await delay(20);
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
