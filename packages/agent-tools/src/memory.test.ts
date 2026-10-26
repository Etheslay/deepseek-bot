import { describe, expect, it } from "vitest";
import { MemoryAuditSink } from "./audit.js";
import { ToolGateway, ToolRegistry } from "./gateway.js";
import { bindMemoryTools, type MemoryRecord } from "./memory.js";

const secret = "Private note Alpha";
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

function setup() {
  const notes = new Map<string, MemoryRecord[]>();
  const audit = new MemoryAuditSink();
  const registry = new ToolRegistry();
  for (const tool of bindMemoryTools({
    write(botId, text) {
      const row = { id: `${botId}-1`, text, at: "2026-10-26T12:00:00.000Z" };
      notes.set(botId, [...(notes.get(botId) ?? []), row]);
      return row;
    },
    search(botId, query) {
      const needle = query.trim().toLocaleLowerCase();
      return (notes.get(botId) ?? []).filter((row) =>
        needle.length === 0 ? true : row.text.toLocaleLowerCase().includes(needle),
      );
    },
  })) {
    registry.register(tool);
  }
  return {
    notes,
    audit,
    gateway: new ToolGateway({
      registry,
      audit,
      grants: { check: async () => ({ allowed: true }) },
    }),
  };
}

describe("memory tools", () => {
  it("stores and finds a note only for the bound bot", async () => {
    const { notes, audit, gateway } = setup();
    await expect(
      gateway.call({ id: "chat:owner", botId: owner }, "memory_write", { text: `  ${secret}  ` }),
    ).resolves.toEqual({ id: `${owner}-1`, text: secret, at: "2026-10-26T12:00:00.000Z" });
    await expect(
      gateway.call({ id: "chat:owner", botId: owner }, "memory_search", { query: "alpha" }),
    ).resolves.toEqual({
      memories: [{ id: `${owner}-1`, text: secret, at: "2026-10-26T12:00:00.000Z" }],
    });
    await expect(
      gateway.call({ id: "chat:other", botId: other }, "memory_search", { query: "alpha" }),
    ).resolves.toEqual({ memories: [] });
    expect(notes.get(other)).toBeUndefined();
    expect(JSON.stringify(audit.records)).not.toContain(secret);
    expect(audit.records.every((record) => record.paramsDigest.length === 64)).toBe(true);
  });

  it("rejects a model-supplied bot id, a delete tool, and a caller without a bot", async () => {
    const { notes, gateway } = setup();
    await gateway.call({ id: "chat:owner", botId: owner }, "memory_write", { text: secret });
    await expect(
      gateway.call({ id: "chat:owner", botId: owner }, "memory_write", {
        text: secret,
        botId: other,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      gateway.call({ id: "chat:owner", botId: owner }, "memory_delete", { memoryId: `${owner}-1` }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      gateway.call({ id: "chat:anon" }, "memory_search", { query: "alpha" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH" });
    expect(notes.get(owner)).toHaveLength(1);
    expect(notes.has(other)).toBe(false);
  });
});
