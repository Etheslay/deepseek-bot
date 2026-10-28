import { describe, expect, it } from "vitest";
import {
  DEVICE_METHODS,
  DeviceActionKindSchema,
  DeviceActionResultSchema,
  METHOD_CONTRACTS,
  METHODS,
  defaultPermissionMode,
  requiresPerActionApproval,
} from "./index.js";

const id = "10000000-0000-4000-8000-000000000001";
const result = { id, at: "2026-10-27T00:00:00.000Z" };

describe("D21 device action contracts", () => {
  it("defaults to deny and accepts only one exact ask-or-deny policy", () => {
    expect(defaultPermissionMode("device.action")).toBe("deny");
    expect(requiresPerActionApproval("device.action")).toBe(true);
    expect(METHODS).toContain("device.action.request");
    expect(METHODS).toContain("device.action.list");
    expect(DeviceActionKindSchema.safeParse("pointer").success).toBe(true);
    expect(DeviceActionKindSchema.safeParse("key").success).toBe(true);
    expect(DeviceActionKindSchema.safeParse("shell").success).toBe(false);
  });

  it("accepts a kind and a bot, and returns only an id and a timestamp", () => {
    const contract = METHOD_CONTRACTS["device.action.request"];
    expect(contract.request.safeParse({ botId: id, kind: "pointer" }).success).toBe(true);
    expect(contract.request.safeParse({ botId: id, kind: "key" }).success).toBe(true);
    expect(DeviceActionResultSchema.safeParse(result).success).toBe(true);
    expect(contract.response.safeParse(result).success).toBe(true);
    for (const extra of [
      { x: 1 },
      { y: 2 },
      { key: "Enter" },
      { text: "hello" },
      { command: "calc" },
      { path: "C:\\Windows" },
    ]) {
      expect(contract.request.safeParse({ botId: id, kind: "pointer", ...extra }).success).toBe(
        false,
      );
      expect(contract.response.safeParse({ ...result, ...extra }).success).toBe(false);
    }
    expect(contract.response.safeParse({ ...result, kind: "pointer" }).success).toBe(false);
    expect(DEVICE_METHODS["device.action.request"].response.safeParse(result).success).toBe(true);
  });

  it("lists one bot's stored action names and rejects an unknown name", () => {
    const list = METHOD_CONTRACTS["device.action.list"];
    const parsed = list.request.safeParse({ botId: id });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.limit).toBe(50);
    expect(list.request.safeParse({ botId: id, limit: 1 }).success).toBe(true);
    expect(list.request.safeParse({ botId: id, action: "shell" }).success).toBe(false);
    expect(list.request.safeParse({ botId: id, x: 1 }).success).toBe(false);
    const record = { id, botId: id, action: "key", at: "2026-10-27T00:00:00.000Z" };
    expect(list.response.safeParse({ records: [record] }).success).toBe(true);
    expect(list.response.safeParse({ records: [{ ...record, action: "click" }] }).success).toBe(
      false,
    );
    expect(list.response.safeParse({ records: [{ ...record, key: "Enter" }] }).success).toBe(
      false,
    );
    expect(list.response.safeParse({ records: [] }).success).toBe(true);
  });
});
