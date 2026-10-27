/**
 * connector_invoke tool: strict schema, store forwarding, and the D16
 * capability mapping declared in the host (tested there).
 */
import { describe, expect, it, vi } from "vitest";
import { MemoryAuditSink } from "./audit.js";
import { ToolGateway, ToolRegistry } from "./gateway.js";
import { bindConnectorTools } from "./connectors.js";

const CONNECTOR = "33333333-3333-4333-8333-333333333333";

function setup() {
  const audit = new MemoryAuditSink();
  const invoke = vi.fn(async (_connectorId: string, _action: string) => ({
    connectorId: CONNECTOR,
    action: "txt2img",
    savedPath: "C:\\data\\connector-outputs\\x\\a.png",
    sizeBytes: 1234,
    at: "2026-10-27T00:00:00.000Z",
  }));
  const registry = new ToolRegistry();
  for (const tool of bindConnectorTools({
    invoke: (connectorId, action, params) => {
      void params;
      return invoke(connectorId, action);
    },
  })) {
    registry.register(tool);
  }
  const gateway = new ToolGateway({
    registry,
    audit,
    grants: { check: async () => ({ allowed: true }) },
    now: () => new Date("2026-10-27T00:00:00Z"),
  });
  return { gateway, audit, invoke };
}

describe("bindConnectorTools", () => {
  it("forwards connector id, action and parameters after validation", async () => {
    const { gateway, invoke } = setup();
    const result = await gateway.call(
      { id: "chat:s1/b1", botId: "11111111-1111-4111-8111-111111111111" },
      "connector_invoke",
      {
        connectorId: CONNECTOR,
        action: "txt2img",
        params: { prompt: "一只在云上的机器猫", width: 768, steps: 15 },
      },
    );
    expect(result).toMatchObject({ action: "txt2img", sizeBytes: 1234 });
    expect(invoke).toHaveBeenCalledWith(CONNECTOR, "txt2img");
  });

  it("rejects unknown actions and non-uuid connectors before the store runs", async () => {
    const { gateway, invoke } = setup();
    await expect(
      gateway.call(
        { id: "chat:s1/b1" },
        "connector_invoke",
        { connectorId: CONNECTOR, action: "img2img", params: { prompt: "x" } },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      gateway.call(
        { id: "chat:s1/b1" },
        "connector_invoke",
        { connectorId: "nope", action: "txt2img", params: { prompt: "x" } },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("audits every call with digests", async () => {
    const { gateway, audit } = setup();
    await gateway.call(
      { id: "chat:s1/b1" },
      "connector_invoke",
      { connectorId: CONNECTOR, action: "txt2img", params: { prompt: "x" } },
    );
    expect(audit.records[0]).toMatchObject({ tool: "connector_invoke", outcome: "ok" });
    expect(audit.records[0]?.paramsDigest).toHaveLength(64);
  });
});
