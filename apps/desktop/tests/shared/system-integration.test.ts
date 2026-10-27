import { describe, expect, it } from "vitest";
import {
  IpcDeniedError,
  assertValidLanguagePreference,
} from "../../src/shared/ipc-channels.js";
import {
  CHROME_IMPORT_MAX,
  TRAY_ICON_MAX_BASE64_LENGTH,
  TRAY_MAX_BOTS,
  assertValidChromeToken,
  assertValidNotificationRequest,
  assertValidTraySync,
  normalizeTraySync,
} from "../../src/shared/system-integration.js";

const PNG = "data:image/png;base64,AANA====";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "bot-1",
    name: "Alpha",
    status: "idle",
    unread: false,
    icon: PNG,
    ...overrides,
  };
}

function expectDenied(payload: unknown, message?: string): void {
  try {
    assertValidTraySync(payload);
    expect.unreachable(`expected rejection: ${message ?? ""}`);
  } catch (error) {
    expect(error).toBeInstanceOf(IpcDeniedError);
    expect((error as IpcDeniedError).code).toBe("INVALID_PAYLOAD");
  }
}

describe("tray sync payload validation", () => {
  it("accepts a well-formed payload", () => {
    expect(() => assertValidTraySync({ activeBotId: "bot-1", bots: [entry()] })).not.toThrow();
    expect(() => assertValidTraySync({ activeBotId: null, bots: [] })).not.toThrow();
  });

  it.each([
    ["null", null],
    ["a string", "tray"],
    ["missing bots", { activeBotId: null }],
    ["bots not an array", { activeBotId: null, bots: "all" }],
    ["activeBotId numeric", { activeBotId: 7, bots: [] }],
    ["bot without id", { activeBotId: null, bots: [entry({ id: "" })] }],
    ["bot name too long", { activeBotId: null, bots: [entry({ name: "x".repeat(61) })] }],
    ["unknown status", { activeBotId: null, bots: [entry({ status: "asleep" })] }],
    ["unread not boolean", { activeBotId: null, bots: [entry({ unread: "yes" })] }],
    ["icon not a data url", { activeBotId: null, bots: [entry({ icon: "https://x.test/a.png" })] }],
    ["svg icon", { activeBotId: null, bots: [entry({ icon: "data:image/svg+xml;base64,AAA=" })] }],
    [
      "oversized icon",
      {
        activeBotId: null,
        bots: [entry({ icon: `data:image/png;base64,${"A".repeat(TRAY_ICON_MAX_BASE64_LENGTH)}` })],
      },
    ],
  ])("rejects %s", (_label, payload) => {
    expectDenied(payload, _label);
  });

  it("rejects more bots than the tray cap", () => {
    const bots = Array.from({ length: TRAY_MAX_BOTS + 1 }, (_unused, index) =>
      entry({ id: `bot-${index}`, name: `Bot ${index}` }),
    );
    expectDenied({ activeBotId: null, bots }, "cap");
  });

  it("normalizes into a fresh object that drops unknown fields", () => {
    const input = {
      activeBotId: "bot-1",
      bots: [entry({ extra: "leak" })],
    } as unknown as Parameters<typeof normalizeTraySync>[0];
    const normalized = normalizeTraySync(input);
    expect(normalized).toEqual({
      activeBotId: "bot-1",
      bots: [{ id: "bot-1", name: "Alpha", status: "idle", unread: false, icon: PNG }],
    });
    expect(normalized.bots[0]).not.toHaveProperty("extra");
    expect(normalized.bots[0]).not.toBe(input.bots[0]);
  });
});

describe("notification request validation", () => {
  const base = { botId: null, title: "DeepSeek Bot", body: "hello", icon: null, silent: false };

  it("accepts a minimal request", () => {
    expect(() => assertValidNotificationRequest(base)).not.toThrow();
    expect(() =>
      assertValidNotificationRequest({ ...base, botId: "bot-1", icon: PNG }),
    ).not.toThrow();
  });

  it.each([
    ["missing title", { ...base, title: "" }],
    ["long title", { ...base, title: "x".repeat(121) }],
    ["long body", { ...base, body: "x".repeat(301) }],
    ["non-string body", { ...base, body: 42 }],
    ["non-null-string botId", { ...base, botId: 3 }],
    ["html icon", { ...base, icon: "<svg onload=alert(1)>" }],
    ["silent missing", { botId: null, title: "t", body: "", icon: null }],
  ])("rejects %s", (_label, payload) => {
    expect(() => assertValidNotificationRequest(payload)).toThrow(IpcDeniedError);
  });
});

describe("chrome token validation", () => {
  it.each([
    ["Default", "Default"],
    ["Profile 2", "Profile 2"],
  ])("accepts %s", (_label, token) => {
    expect(() => assertValidChromeToken(token)).not.toThrow();
  });

  it.each([
    ["path escape", "../../etc/passwd"],
    ["absolute path", "C:/Windows"],
    ["empty", ""],
    ["non-string", 7],
    ["too long", "x".repeat(81)],
    ["separator", "Default/Sub"],
    ["backslash", "Default\\Sub"],
    ["leading dot", ".Default"],
    ["parent inside name", "Default/../../x"],
  ])("rejects %s", (_label, token) => {
    expect(() => assertValidChromeToken(token)).toThrow(IpcDeniedError);
  });
});

describe("language preference validation", () => {
  it("accepts only the three known preferences", () => {
    for (const value of ["system", "zh", "en"]) {
      expect(() => assertValidLanguagePreference(value)).not.toThrow();
    }
    for (const value of ["fr", "ZH", "", null, undefined]) {
      expect(() => assertValidLanguagePreference(value)).toThrow(IpcDeniedError);
    }
  });
});

it("keeps the chrome import cap inside what the tray and payload accept", () => {
  expect(CHROME_IMPORT_MAX).toBeGreaterThan(0);
  expect(TRAY_MAX_BOTS).toBeLessThan(CHROME_IMPORT_MAX);
});
