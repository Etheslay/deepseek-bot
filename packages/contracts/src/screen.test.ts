import { describe, expect, it } from "vitest";
import {
  METHOD_CONTRACTS, METHODS, PROTOCOL_VERSION, WORKFLOW_SCHEMA_VERSION,
  RequestEnvelopeSchema, isWithinMessageSizeLimit, parseRequest,
  ScreenModeSchema, ScreenResultSchema, ScreenStatusSchema,
  defaultPermissionMode, requiresPerActionApproval,
} from "./index.js";

const id = "10000000-0000-4000-8000-000000000001";
const result = { id, mode: "ocr", at: "2026-10-27T00:00:00.000Z", width: 1920, height: 1080, hasOcr: true };
const status = { supported: true, enabled: true, target: { id, title: "测试窗口" }, busy: false };
const requests = {
  "screen.status": { botId: id },
  "screen.windows.list": {},
  "screen.target.set": { botId: id, id },
  "screen.request": { botId: id, mode: "image" },
  "screen.cancel": { botId: id },
  "screen.results.list": { botId: id },
  "screen.result.read": { botId: id, id },
  "screen.result.delete": { botId: id, id },
} as const;

describe("D21 screen contracts", () => {
  it("accepts protocol 0.14 and every previous sender without changing workflow documents", () => {
    expect(PROTOCOL_VERSION).toBe("0.14");
    expect(WORKFLOW_SCHEMA_VERSION).toBe("0.1");
    for (const protocolVersion of ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9", "0.10", "0.11", "0.12", "0.13"]) {
      expect(RequestEnvelopeSchema.safeParse({ protocolVersion, requestId: id, method: "bot.list", payload: {} }).success).toBe(true);
    }
  });

  for (const [method, payload] of Object.entries(requests) as [keyof typeof requests, unknown][]) {
    it(`whitelists ${method} with strict UUID-only resource selection`, () => {
      expect(METHODS).toContain(method);
      const contract = METHOD_CONTRACTS[method];
      expect(contract.request.safeParse(payload).success).toBe(true);
      expect(parseRequest({ protocolVersion: "0.6", requestId: id, method, payload }, method).success).toBe(true);
      for (const field of ["path", "command", "hwnd", "selectionId", "windowTitle"]) {
        expect(contract.request.safeParse({ ...payload as object, [field]: "unsafe" }).success).toBe(false);
      }
      if (method !== "screen.windows.list") {
        expect(contract.request.safeParse({ ...payload as object, botId: "../other" }).success).toBe(false);
      }
    });
  }

  it("only accepts image and OCR modes and nullable target tokens", () => {
    expect(ScreenModeSchema.safeParse("image").success).toBe(true);
    expect(ScreenModeSchema.safeParse("ocr").success).toBe(true);
    expect(ScreenModeSchema.safeParse("shell").success).toBe(false);
    expect(METHOD_CONTRACTS["screen.target.set"].request.safeParse({ botId: id, id: null }).success).toBe(true);
    expect(METHOD_CONTRACTS["screen.result.read"].request.safeParse({ botId: id, id: "../file" }).success).toBe(false);
    expect(METHOD_CONTRACTS["screen.request"].request.safeParse({ botId: id, mode: "desktop" }).success).toBe(false);
  });

  it("bounds result dimensions and only returns metadata from requests", () => {
    expect(ScreenResultSchema.safeParse(result).success).toBe(true);
    expect(ScreenResultSchema.safeParse({ ...result, width: 1, height: 8192 }).success).toBe(true);
    for (const width of [0, 8193, 1.5]) expect(ScreenResultSchema.safeParse({ ...result, width }).success).toBe(false);
    for (const height of [0, 8193, 1.5]) expect(ScreenResultSchema.safeParse({ ...result, height }).success).toBe(false);
    expect(ScreenResultSchema.safeParse({ ...result, at: "yesterday" }).success).toBe(false);
    expect(METHOD_CONTRACTS["screen.request"].response.safeParse({ ...result, text: "secret" }).success).toBe(false);
    expect(METHOD_CONTRACTS["screen.request"].response.safeParse(result).success).toBe(true);
  });

  it("bounds titles and catalogs", () => {
    expect(ScreenStatusSchema.safeParse(status).success).toBe(true);
    expect(ScreenStatusSchema.safeParse({ ...status, target: null }).success).toBe(true);
    for (const method of ["screen.status", "screen.target.set"] as const) expect(METHOD_CONTRACTS[method].response.safeParse(status).success).toBe(true);
    const window = { id, title: "a".repeat(512) };
    expect(METHOD_CONTRACTS["screen.windows.list"].response.safeParse({ windows: Array(200).fill(window) }).success).toBe(true);
    expect(METHOD_CONTRACTS["screen.windows.list"].response.safeParse({ windows: Array(201).fill(window) }).success).toBe(false);
    expect(ScreenStatusSchema.safeParse({ ...status, target: { ...window, title: "a".repeat(513) } }).success).toBe(false);
    expect(METHOD_CONTRACTS["screen.results.list"].response.safeParse({ results: Array(50).fill(result) }).success).toBe(true);
    expect(METHOD_CONTRACTS["screen.results.list"].response.safeParse({ results: Array(51).fill(result) }).success).toBe(false);
  });

  it("bounds trusted UI reads below the envelope budget including JSON escapes", () => {
    const response = { result, imageBase64: "A".repeat(360000), text: "\u0000".repeat(65536) };
    const schema = METHOD_CONTRACTS["screen.result.read"].response;
    expect(schema.safeParse(response).success).toBe(true);
    expect(isWithinMessageSizeLimit(response)).toBe(true);
    expect(schema.safeParse({ ...response, text: null }).success).toBe(true);
    expect(schema.safeParse({ ...response, imageBase64: "A".repeat(360001) }).success).toBe(false);
    expect(schema.safeParse({ ...response, text: "a".repeat(65537) }).success).toBe(false);
  });

  it("pins cancellation/deletion responses and existing default-deny per-action capability", () => {
    expect(METHOD_CONTRACTS["screen.cancel"].response.safeParse({ cancelled: false }).success).toBe(true);
    expect(METHOD_CONTRACTS["screen.result.delete"].response.safeParse({ deleted: true }).success).toBe(true);
    expect(METHOD_CONTRACTS["screen.result.delete"].response.safeParse({ deleted: false }).success).toBe(false);
    expect(defaultPermissionMode("screen.capture")).toBe("deny");
    expect(requiresPerActionApproval("screen.capture")).toBe(true);
  });
});
