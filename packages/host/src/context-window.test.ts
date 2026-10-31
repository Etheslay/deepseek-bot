/**
 * Context window resolution: env override parsing, per-model table hits, the
 * fallback for unknown models, and the provider context-overflow safety net.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineError } from "@deepseek-bot/runtime";
import {
  CONTEXT_WINDOW_ENV_VAR,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  MAX_ENV_CONTEXT_WINDOW_TOKENS,
  MODEL_CONTEXT_WINDOWS,
  isContextOverflowMessage,
  readEnvContextWindowTokens,
  reportContextOverflow,
  resolveContextWindowTokens,
} from "./context-window.js";

afterEach(() => {
  delete process.env[CONTEXT_WINDOW_ENV_VAR];
});

describe("readEnvContextWindowTokens", () => {
  it("accepts a plain decimal safe integer within the cap", () => {
    expect(readEnvContextWindowTokens({ [CONTEXT_WINDOW_ENV_VAR]: "200000" })).toBe(200_000);
    expect(readEnvContextWindowTokens({ [CONTEXT_WINDOW_ENV_VAR]: " 128000 " })).toBe(128_000);
    expect(readEnvContextWindowTokens({ [CONTEXT_WINDOW_ENV_VAR]: "1000000" })).toBe(
      MAX_ENV_CONTEXT_WINDOW_TOKENS,
    );
  });

  it("ignores invalid values instead of producing a NaN or zero denominator", () => {
    for (const raw of ["abc", "0", "-1", "9999999", "12.5", "", "0x10", "1e6"]) {
      expect(readEnvContextWindowTokens({ [CONTEXT_WINDOW_ENV_VAR]: raw })).toBeNull();
    }
    expect(readEnvContextWindowTokens({})).toBeNull();
  });
});

describe("resolveContextWindowTokens", () => {
  const fallback = 65_536;

  it("prefers the debug env value over the model table", () => {
    expect(
      resolveContextWindowTokens({
        model: "deepseek-chat",
        fallbackTokens: fallback,
        envTokens: 200_000,
      }),
    ).toBe(200_000);
  });

  it("uses the documented window for every model in the table", () => {
    for (const [model, window] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
      expect(
        resolveContextWindowTokens({ model, fallbackTokens: fallback, envTokens: null }),
      ).toBe(window);
    }
    expect(MODEL_CONTEXT_WINDOWS["deepseek-chat"]).toBe(128_000);
    expect(MODEL_CONTEXT_WINDOWS["deepseek-reasoner"]).toBe(128_000);
  });

  it("falls back for an unknown model or an invalid env value", () => {
    expect(
      resolveContextWindowTokens({ model: "deepseek-foo", fallbackTokens: fallback, envTokens: null }),
    ).toBe(fallback);
    expect(
      resolveContextWindowTokens({ model: null, fallbackTokens: fallback, envTokens: null }),
    ).toBe(fallback);
    expect(
      resolveContextWindowTokens({ model: undefined, fallbackTokens: fallback, envTokens: null }),
    ).toBe(fallback);
  });

  it("reads process.env at call time when no explicit env value is given", () => {
    process.env[CONTEXT_WINDOW_ENV_VAR] = "300000";
    expect(resolveContextWindowTokens({ model: "deepseek-chat", fallbackTokens: fallback })).toBe(
      300_000,
    );
    delete process.env[CONTEXT_WINDOW_ENV_VAR];
    expect(resolveContextWindowTokens({ model: "deepseek-chat", fallbackTokens: fallback })).toBe(
      128_000,
    );
  });

  it("keeps the host default at 65_536", () => {
    expect(DEFAULT_CONTEXT_WINDOW_TOKENS).toBe(65_536);
  });
});

describe("provider context-overflow safety net", () => {
  it("recognizes the usual provider phrasings", () => {
    expect(isContextOverflowMessage("This model's maximum context length is 131072 tokens")).toBe(
      true,
    );
    expect(isContextOverflowMessage("context length exceeded")).toBe(true);
    expect(isContextOverflowMessage("Request failed: too many tokens")).toBe(true);
    expect(isContextOverflowMessage("insufficient balance")).toBe(false);
    expect(isContextOverflowMessage("connection reset")).toBe(false);
  });

  it("writes one warn line carrying input tokens and windowTokens", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      reportContextOverflow(
        new EngineError({
          code: "RUNTIME_UNAVAILABLE",
          message: "maximum context length exceeded",
          retryable: false,
        }),
        {
          botId: "bot-1",
          model: "deepseek-chat",
          windowTokens: 128_000,
          lastInputTokens: 16_384,
        },
      );
      expect(write).toHaveBeenCalledTimes(1);
      const line = String(write.mock.calls[0]![0]);
      expect(line).toContain("bot-1");
      expect(line).toContain("deepseek-chat");
      expect(line).toContain("16384");
      expect(line).toContain("128000");
      // Non-overflow errors stay silent.
      write.mockClear();
      reportContextOverflow(
        new EngineError({ code: "RATE_LIMITED", message: "rate limited", retryable: true }),
        {
          botId: "bot-1",
          model: "deepseek-chat",
          windowTokens: 128_000,
          lastInputTokens: 16_384,
        },
      );
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });
});
