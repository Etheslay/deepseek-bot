import { describe, expect, it } from "vitest";
import { JsonRpcResponseError } from "@deepseek-ai/dsh-sdk-protocol";
import { NodeExecutionError } from "@deepseek-bot/runtime";
import { nodeExecutionErrorFromHarness } from "./errors.js";

const base = { cancelRequested: false, exitCode: undefined, stderrTail: [] };

describe("nodeExecutionErrorFromHarness", () => {
  it("passes existing NodeExecutionErrors through unchanged", () => {
    const original = new NodeExecutionError({
      code: "INVALID_INPUT",
      message: "bad input",
      retryable: false,
    });
    expect(nodeExecutionErrorFromHarness(original, base)).toBe(original);
  });

  it("reports CANCELLED when cancellation was requested before the failure", () => {
    const error = nodeExecutionErrorFromHarness(
      new Error("JSON-RPC transport closed"),
      { ...base, cancelRequested: true },
    );
    expect(error.code).toBe("CANCELLED");
    expect(error.retryable).toBe(false);
  });

  it("classifies rate-limit responses and carries Retry-After hints", () => {
    const error = nodeExecutionErrorFromHarness(
      new JsonRpcResponseError(-32000, "model route rate limited (429)", { retryAfterMs: 1500 }),
      base,
    );
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(1500);
  });

  it("classifies authentication failures as non-retryable", () => {
    const error = nodeExecutionErrorFromHarness(
      new JsonRpcResponseError(-32001, "authentication failed: invalid api key"),
      base,
    );
    expect(error.code).toBe("AUTH_FAILED");
    expect(error.retryable).toBe(false);
  });

  it("classifies model route failures as MODEL_UNAVAILABLE", () => {
    const error = nodeExecutionErrorFromHarness(
      new JsonRpcResponseError(-32002, "unknown model 'nope' for provider route"),
      base,
    );
    expect(error.code).toBe("MODEL_UNAVAILABLE");
    expect(error.retryable).toBe(true);
  });

  it("falls back to retryable RUNTIME_UNAVAILABLE for unknown wire errors", () => {
    const error = nodeExecutionErrorFromHarness(
      new JsonRpcResponseError(-32003, "something unexpected"),
      base,
    );
    expect(error.code).toBe("RUNTIME_UNAVAILABLE");
    expect(error.retryable).toBe(true);
  });

  it("includes exit code and stderr tail for transport loss", () => {
    const error = nodeExecutionErrorFromHarness(
      new Error("harness runtime exited (process exit code 1)"),
      { ...base, exitCode: 1, stderrTail: ["boom: bad config"] },
    );
    expect(error.code).toBe("RUNTIME_UNAVAILABLE");
    expect(error.retryable).toBe(true);
    expect(error.message).toContain("exit code 1");
    expect(error.message).toContain("bad config");
  });

  it("treats unknown failure shapes as retryable runtime failures", () => {
    const error = nodeExecutionErrorFromHarness(42, base);
    expect(error.code).toBe("RUNTIME_UNAVAILABLE");
    expect(error.message).toContain("42");
  });
});
