/**
 * D15 write-layer tests (FR-12): the draft tool stays side-effect-free, the
 * group/batch/revoke tools forward with their contract payloads, and the
 * gateway audits every write call (rejections included).
 */
import { describe, expect, it, vi } from "vitest";
import { ToolGateway, ToolRegistry } from "./gateway.js";
import { MemoryAuditSink } from "./audit.js";
import { bindReadTools } from "./read-tools.js";
import { bindWriteTools } from "./write-tools.js";

const BATCH_ID = "88888888-8888-4888-8888-888888888888";
const PROFILE_ID = "44444444-4444-4444-8444-444444444444";
const WORKSPACE_ID = "55555555-5555-4555-8555-555555555555";
const POLICY_ID = "66666666-6666-4666-8666-666666666666";

function makeGateway() {
  const audit = new MemoryAuditSink();
  const caller = vi.fn(async (method: string, payload: unknown) => {
    if (method === "group.create") return { id: "g-1", name: (payload as { name: string }).name };
    if (method === "bot.batchCreate") {
      return { batchId: BATCH_ID, group: null, bots: [] };
    }
    if (method === "creation.revoke") {
      return { revokedBotIds: ["b-1"], revokedGroupId: null };
    }
    return {};
  });
  const registry = new ToolRegistry();
  for (const capability of [...bindReadTools(caller), ...bindWriteTools(caller)]) {
    registry.register(capability);
  }
  const gateway = new ToolGateway({
    registry,
    audit,
    now: () => new Date("2026-10-25T00:00:00Z"),
  });
  return { gateway, audit, caller };
}

describe("bindWriteTools", () => {
  it("exposes the four write capabilities", () => {
    expect(bindWriteTools(async () => ({})).map((tool) => tool.name)).toEqual([
      "create_bot_draft",
      "create_group",
      "create_bots_batch",
      "revoke_batch",
    ]);
  });

  it("create_bot_draft returns the draft without touching any contract method", async () => {
    const { gateway, caller, audit } = makeGateway();
    const result = (await gateway.call({ id: "chat:s1/b1" }, "create_bot_draft", {
      name: "scout",
      instructions: "Look things up.",
      avatar: { shape: "egg", color: "#f0b429" },
    })) as { draft: { name: string } };
    expect(result.draft).toMatchObject({ name: "scout" });
    expect(caller).not.toHaveBeenCalled();
    // 草案不落库 — but the generation itself is audited like every call.
    expect(audit.records[0]).toMatchObject({ tool: "create_bot_draft", outcome: "ok" });
  });

  it("create_bot_draft rejects drafts outside the contract schema", async () => {
    const { gateway, audit } = makeGateway();
    await expect(
      gateway.call({ id: "ui:1" }, "create_bot_draft", {
        avatar: { shape: "moon-slice", color: "#a3a3a3" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(audit.records[0]).toMatchObject({ outcome: "rejected" });
  });

  it("forwards create_group, create_bots_batch and revoke_batch", async () => {
    const { gateway, caller } = makeGateway();

    await gateway.call({ id: "chat:s1/b1" }, "create_group", { name: "ops" });
    expect(caller).toHaveBeenCalledWith("group.create", { name: "ops" });

    const batch = {
      newGroup: { name: "research-squad" },
      defaults: {
        modelProfileId: PROFILE_ID,
        workspaceId: WORKSPACE_ID,
        toolPolicyId: POLICY_ID,
      },
      bots: [{ name: "scout", instructions: "Look things up." }],
      idempotencyKey: BATCH_ID,
    };
    await expect(
      gateway.call({ id: "chat:s1/b1" }, "create_bots_batch", batch),
    ).resolves.toMatchObject({ batchId: BATCH_ID });
    expect(caller).toHaveBeenCalledWith("bot.batchCreate", batch);

    await gateway.call({ id: "chat:s1/b1" }, "revoke_batch", { batchId: BATCH_ID });
    expect(caller).toHaveBeenCalledWith("creation.revoke", { batchId: BATCH_ID });
  });

  it("rejects a batch that names both groupId and newGroup before dispatch", async () => {
    const { gateway, caller, audit } = makeGateway();
    await expect(
      gateway.call({ id: "ui:1" }, "create_bots_batch", {
        groupId: "77777777-7777-4777-8777-777777777777",
        newGroup: { name: "duplicate" },
        bots: [{ name: "scout", instructions: "x" }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(caller).not.toHaveBeenCalled();
    expect(audit.records[0]).toMatchObject({ outcome: "rejected", code: "INVALID_INPUT" });
  });

  it("rejects unknown extra keys on write calls (strict tool schemas)", async () => {
    const { gateway } = makeGateway();
    await expect(
      gateway.call({ id: "ui:1" }, "revoke_batch", {
        batchId: BATCH_ID,
        alsoDeleteEverything: true,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("audits successful write calls with digests", async () => {
    const { gateway, audit } = makeGateway();
    await gateway.call({ id: "chat:s1/b1" }, "create_group", { name: "ops" });
    expect(audit.records[0]).toMatchObject({
      caller: "chat:s1/b1",
      tool: "create_group",
      outcome: "ok",
    });
    expect(audit.records[0]?.paramsDigest).toHaveLength(64);
    expect(audit.records[0]?.resultDigest).toHaveLength(64);
  });
});
