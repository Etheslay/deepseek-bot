import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";

const execute = promisify(execFile);
const hostRoot = fileURLToPath(new URL("..", import.meta.url));
const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

it("ships screen helpers and starts a copied Host without the exec-daemon workspace package", async () => {
  const root = await mkdtemp(join(tmpdir(), "dsb-screen-distribution-"));
  roots.push(root);
  const distribution = join(root, "host");
  await execute(process.execPath, ["scripts/build.mjs", distribution], { cwd: hostRoot });
  expect(
    await readFile(join(distribution, "screen-assets", "win32-capture.ps1"), "utf8"),
  ).toContain("PrintWindow");
  expect(
    await readFile(join(distribution, "screen-assets", "win32-input.ps1"), "utf8"),
  ).toContain("SendInput");
  const manifest = JSON.parse(
    await readFile(join(distribution, "screen-assets", "ocr", "manifest.json"), "utf8"),
  ) as { pins: Record<string, string> };
  expect(manifest.pins["tesseract.js"]).toBe("7.0.0");
  expect(
    JSON.parse(await readFile(join(distribution, "screen-assets", "ocr", "package.json"), "utf8")),
  ).toEqual({ type: "commonjs" });
  const child = spawn(process.execPath, [join(distribution, "main.js")], {
    cwd: root,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      DEEPSEEK_BOT_DATA_ROOT: join(root, "data"),
      NODE_OPTIONS: "",
      NODE_PATH: join(hostRoot, "..", "harness-adapter", "node_modules"),
    },
  });
  const id = randomUUID();
  let stdout = "";
  let stderr = "";
  let stopping = false;
  child.stdout.on("data", (bytes: Buffer) => {
    stdout += bytes.toString();
    if (
      !stopping &&
      stdout
        .split("\n")
        .slice(0, -1)
        .some((line) => line.includes(id))
    ) {
      stopping = true;
      child.stdin.end(
        JSON.stringify({ jsonrpc: "2.0", id: "shutdown", method: "host/shutdown" }) + "\n",
      );
    }
  });
  child.stderr.on("data", (bytes: Buffer) => {
    stderr += bytes.toString();
  });
  child.stdin.on("error", () => {
    /* Startup failure is asserted using exit/stderr. */
  });
  child.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "contract/call",
      params: { protocolVersion: "0.7", requestId: id, method: "bot.list", payload: {} },
    }) + "\n",
  );
  const timeout = setTimeout(() => child.kill(), 15_000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    expect(stderr).not.toContain("Cannot find module");
    expect(code).toBe(0);
    const response = stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { id?: string; result?: unknown })
      .find((frame) => frame.id === id);
    expect(response).toHaveProperty("result");
  } finally {
    clearTimeout(timeout);
    child.kill();
  }
}, 60_000);
