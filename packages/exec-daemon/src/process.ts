import { spawn, type ChildProcess } from "node:child_process";

/** How a fixed helper process ended when it did not return stdout. */
export type ProcessStopKind = "timeout" | "cancelled" | "exit" | "spawn" | "output";

export class ProcessRunError extends Error {
  readonly kind: ProcessStopKind;
  readonly stdout: string;

  constructor(kind: ProcessStopKind, message: string, stdout = "") {
    super(message);
    this.name = "ProcessRunError";
    this.kind = kind;
    this.stdout = stdout;
  }
}

/**
 * Start one fixed executable with an argument array.
 * `shell` stays false: the caller cannot pass a command line.
 * Timeout and cancellation kill the process group (and, on Windows, the task tree).
 */
export async function runFixedProcess(options: {
  command: string;
  args: readonly string[];
  signal: AbortSignal;
  timeoutMs: number;
  maxStdoutBytes: number;
}): Promise<string> {
  if (options.signal.aborted) {
    throw new ProcessRunError("cancelled", "helper cancelled before start");
  }
  const child = spawn(options.command, [...options.args], {
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stop: ProcessStopKind | undefined;

  const kill = (reason: "timeout" | "cancelled" | "output"): void => {
    if (stop === undefined) stop = reason;
    killProcessTree(child);
  };

  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: ProcessRunError, value?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener("abort", onAbort);
      if (error !== undefined) reject(error);
      else resolve(value ?? "");
    };
    const onAbort = (): void => kill("cancelled");
    const timer = setTimeout(() => kill("timeout"), options.timeoutMs);
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > options.maxStdoutBytes) {
        kill("output");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 16 * 1024) kill("output");
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      const message =
        error.code === "ENOENT" ? "helper executable is unavailable" : "helper failed to start";
      finish(new ProcessRunError("spawn", message));
    });
    child.once("close", (code) => {
      if (stop === "timeout") {
        finish(new ProcessRunError("timeout", "helper timed out"));
        return;
      }
      if (stop === "cancelled") {
        finish(new ProcessRunError("cancelled", "helper cancelled"));
        return;
      }
      if (stop === "output") {
        finish(new ProcessRunError("output", "helper output exceeded the limit"));
        return;
      }
      const text = Buffer.concat(stdout)
        .toString("utf8")
        .replace(/^\uFEFF/, "");
      if (code !== 0) {
        finish(new ProcessRunError("exit", "helper exited with a failure", text));
        return;
      }
      finish(undefined, text);
    });
  });
}

function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === "win32") {
    spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}
