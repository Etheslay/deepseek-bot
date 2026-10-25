/**
 * D15 阶段一 gateway tests: registry, dispatch rejections (unknown capability,
 * denied grant, schema-invalid params), audit trail completeness, the JSONL
 * sink and the read tools' contract forwarding (SPRINTS §2.3 验收 1-3).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ToolGateway, ToolRegistry } from "./gateway.js";
import { JsonlAuditSink, MemoryAuditSink } from "./audit.js";
import { bindReadTools } from "./read-tools.js";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeGateway(grants?: { allowed: boolean; reason?: string }) {
  const audit = new MemoryAuditSink();
  const caller = vi.fn(async (method: string, payload: unknown) => {
    if (method === "bot.list") return { bots: [{ id: "bot-1" }] };
    if (method === "run.get") return { id: payload, status: "succeeded" };
    return {};
  });
  const registry = new ToolRegistry();
  for (const capability of bindReadTools(caller)) {
    registry.register(capability);
  }
  const grantCheck = vi.fn(async () => grants ?? { allowed: true });
  const gateway = new ToolGateway({
    registry,
    audit,
    grants: { check: grantCheck },
    now: () => new Date("2026-10-25T00:00:00Z"),
  });
  return { gateway, audit, caller, grantCheck };
}

describe("ToolGateway dispatch", () => {
  it("forwards a valid call to the contract method and audits ok with digests", async () => {
    const { gateway, audit, caller } = makeGateway();
    const result = await gateway.call({ id: "chat:s1/bot-1" }, "get_run", {
      runId: "12341234-1234-4123-8123-123412341234",
    });
    expect(result).toMatchObject({ status: "succeeded" });
    expect(caller).toHaveBeenCalledWith(
      "run.get",
      { runId: "12341234-1234-4123-8123-123412341234" },
    );
    expect(audit.records).toHaveLength(1);
    expect(audit.records[0]).toMatchObject({
      caller: "chat:s1/bot-1",
      tool: "get_run",
      outcome: "ok",
      timestamp: "2026-10-25T00:00:00.000Z",
    });
    expect(audit.records[0]?.paramsDigest).toHaveLength(64);
    expect(audit.records[0]?.resultDigest).toHaveLength(64);
  });

  it("rejects unknown capabilities with an audit trail", async () => {
    const { gateway, audit } = makeGateway();
    await expect(
      gateway.call({ id: "ui:1" }, "delete_everything", {}),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(audit.records[0]).toMatchObject({ outcome: "rejected", tool: "delete_everything" });
    expect(audit.records[0]?.resultDigest).toBe("-");
  });

  it("rejects schema-invalid parameters before execution", async () => {
    const { gateway, audit, caller } = makeGateway();
    await expect(
      gateway.call({ id: "ui:1" }, "get_run", { runId: "not-a-uuid" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(caller).not.toHaveBeenCalled();
    expect(audit.records[0]).toMatchObject({ outcome: "rejected", code: "INVALID_INPUT" });
  });

  it("applies the grant checkpoint before execution", async () => {
    const { gateway, audit, grantCheck } = makeGateway({ allowed: false, reason: "denied by policy" });
    await expect(
      gateway.call({ id: "ui:1" }, "list_bots", {}),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_PATH", message: "denied by policy" });
    expect(grantCheck).toHaveBeenCalledWith("list_bots", { id: "ui:1" });
    expect(audit.records[0]).toMatchObject({ outcome: "rejected", code: "UNAUTHORIZED_PATH" });
  });

  it("audits handler failures as errors and propagates them", async () => {
    const audit = new MemoryAuditSink();
    const registry = new ToolRegistry();
    registry.register({
      name: "boom",
      description: "always fails",
      inputSchema: z.object({}).strict(),
      handler: () => {
        throw new Error("host exploded");
      },
    });
    const gateway = new ToolGateway({ registry, audit, now: () => new Date() });
    await expect(gateway.call({ id: "ui:1" }, "boom", {})).rejects.toThrow("host exploded");
    expect(audit.records[0]).toMatchObject({ outcome: "error", code: "RUNTIME_ERROR" });
  });
});

describe("ToolRegistry", () => {
  it("rejects duplicate capability names", () => {
    const registry = new ToolRegistry();
    const capability = bindReadTools(async () => ({}))[0]!;
    registry.register(capability);
    expect(() => registry.register(capability)).toThrow(/already registered/);
  });
});

describe("bindReadTools", () => {
  it("exposes the four read capabilities of sprint one", () => {
    const tools = bindReadTools(async () => ({}));
    expect(tools.map((tool) => tool.name)).toEqual([
      "list_bots",
      "list_groups",
      "get_run",
      "get_run_events",
    ]);
  });

  it("list_groups returns an explicit empty set (no group entity in v0.1)", async () => {
    const tools = bindReadTools(async () => ({}));
    const groups = tools.find((tool) => tool.name === "list_groups")!;
    await expect(groups.handler({}, { caller: { id: "ui:1" } })).resolves.toEqual({
      groups: [],
    });
  });

  it("forwards list_bots and get_run_events with their contract payloads", async () => {
    const { gateway, caller } = makeGateway();
    await expect(gateway.call({ id: "chat:s1/b1" }, "list_bots", {})).resolves.toMatchObject({
      bots: [{ id: "bot-1" }],
    });
    const runId = "12341234-1234-4123-8123-123412341234";
    await gateway.call({ id: "chat:s1/b1" }, "get_run_events", { runId });
    expect(caller).toHaveBeenNthCalledWith(1, "bot.list", {});
    expect(caller).toHaveBeenNthCalledWith(2, "events.subscribe", {
      runId,
      afterSequence: 0,
    });
  });
});

describe("JsonlAuditSink", () => {
  it("appends one JSON record per line", async () => {
    const root = mkdtempSync(join(tmpdir(), "agent-tools-"));
    roots.push(root);
    const file = join(root, "logs", "agent-tools-audit.jsonl");
    const sink = new JsonlAuditSink(file);
    sink.append({
      timestamp: "2026-10-25T00:00:00.000Z",
      caller: "ui:1",
      tool: "list_bots",
      paramsDigest: "a".repeat(64),
      resultDigest: "-",
      outcome: "rejected",
      code: "INVALID_INPUT",
      reason: "unknown capability 'list_bots'",
    });
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ tool: "list_bots", outcome: "rejected" });
  });
});
