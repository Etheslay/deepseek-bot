import { describe, expect, it } from "vitest";
import { DeviceInputSchema } from "@deepseek-bot/contracts";
import { bindDeviceInputTool } from "./device-input.js";

const pointer = {
  kind: "pointer" as const,
  gesture: "move" as const,
  button: "right" as const,
  x: 3,
  y: 4,
};
const key = {
  kind: "key" as const,
  name: "tab" as const,
  action: "tap" as const,
  shift: false,
  ctrl: false,
  alt: true,
};

describe("device_input tool", () => {
  it("forwards one bounded input and rejects a command or unknown key", async () => {
    expect(DeviceInputSchema.safeParse(pointer).success).toBe(true);
    expect(DeviceInputSchema.safeParse({ ...pointer, command: "calc" }).success).toBe(false);
    expect(DeviceInputSchema.safeParse({ ...key, name: "win" }).success).toBe(false);
    const calls: unknown[] = [];
    const tool = bindDeviceInputTool({
      perform(caller, input) {
        calls.push({ caller, input });
        return Promise.resolve({
          id: "00000000-0000-4000-8000-000000000001",
          at: "2026-10-28T00:00:00.000Z",
          kind: input.kind,
        });
      },
    });
    const caller = { id: "chat:session", botId: "00000000-0000-4000-8000-000000000002" };
    const result = await tool.handler(key, { caller });
    expect(calls).toEqual([{ caller, input: key }]);
    expect(result).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      at: "2026-10-28T00:00:00.000Z",
      kind: "key",
    });
  });
});
