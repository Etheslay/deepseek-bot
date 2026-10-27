/**
 * list_automations tool: read-only overview, strict empty input, audited.
 */
import { describe, expect, it, vi } from "vitest";
import { MemoryAuditSink } from "./audit.js";
import { ToolGateway, ToolRegistry } from "./gateway.js";
import { bindAutomationTools } from "./automation.js";

function setup() {
  const audit = new MemoryAuditSink();
  const overview = vi.fn(() => ({
    rules: [
      { id: "r1", name: "失败即修复", eventType: "run.failed", enabled: true },
    ],
    pendingFirings: [
      { id: "f1", ruleName: "失败即修复", reason: "missed", at: "2026-10-27T00:00:00.000Z" },
    ],
  }));
  const registry = new ToolRegistry();
  for (const tool of bindAutomationTools({ overview })) {
    registry.register(tool);
  }
  const gateway = new ToolGateway({
    registry,
    audit,
    grants: { check: async () => ({ allowed: true }) },
    now: () => new Date("2026-10-27T00:00:00Z"),
  });
  return { gateway, audit, overview };
}

describe("bindAutomationTools", () => {
  it("returns the rules and pending firings overview", async () => {
    const { gateway, overview } = setup();
    const result = (await gateway.call({ id: "chat:s1/b1" }, "list_automations", {})) as {
      rules: Array<{ name: string }>;
      pendingFirings: Array<{ reason: string }>;
    };
    expect(result.rules).toEqual([
      { id: "r1", name: "失败即修复", eventType: "run.failed", enabled: true },
    ]);
    expect(result.pendingFirings[0]).toMatchObject({ reason: "missed" });
    expect(overview).toHaveBeenCalledTimes(1);
  });

  it("rejects any parameters — the tool takes none", async () => {
    const { gateway, overview } = setup();
    await expect(
      gateway.call({ id: "ui:1" }, "list_automations", { ruleId: "x" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(overview).not.toHaveBeenCalled();
  });
});
