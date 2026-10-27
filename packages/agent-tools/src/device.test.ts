import { describe, expect, it } from "vitest";
import { DeviceActionInputSchema, bindDeviceActionTool } from "./device.js";

describe("device_action tool", () => {
  it("accepts only pointer or key and forwards the trusted caller", async () => {
    expect(DeviceActionInputSchema.safeParse({ kind: "pointer" }).success).toBe(true);
    expect(DeviceActionInputSchema.safeParse({ kind: "key" }).success).toBe(true);
    expect(DeviceActionInputSchema.safeParse({ kind: "pointer", x: 1 }).success).toBe(false);
    expect(DeviceActionInputSchema.safeParse({ kind: "shell" }).success).toBe(false);
    const calls: unknown[] = [];
    const tool = bindDeviceActionTool({
      accept(caller, kind) {
        calls.push({ caller, kind });
        return Promise.resolve({
          id: "00000000-0000-4000-8000-000000000001",
          at: "2026-10-27T00:00:00.000Z",
        });
      },
    });
    const caller = { id: "chat:session", botId: "00000000-0000-4000-8000-000000000002" };
    const result = await tool.handler({ kind: "key" }, { caller });
    expect(calls).toEqual([{ caller, kind: "key" }]);
    expect(result).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      at: "2026-10-27T00:00:00.000Z",
    });
  });
});
