import { describe, expect, it } from "vitest";
import {
  CAPABILITY_IDS,
  CapabilityPolicySchema,
  MethodSchema,
  PERMISSION_METHODS,
  PermissionDecisionRequestSchema,
  PermissionGrantIssueRequestSchema,
  PermissionGrantSchema,
  defaultPermissionMode,
  requiresPerActionApproval,
} from "./index.js";

describe("D16 human control methods", () => {
  it("exposes policy and approval control methods through the contract", () => {
    expect(MethodSchema.safeParse("permission.policy.set").success).toBe(true);
    expect(MethodSchema.safeParse("permission.approval.decide").success).toBe(true);
  });
});

const id = "10000000-0000-4000-8000-000000000001";
const now = "2026-10-26T00:00:00.000Z";
const sessionGrant = {
  id,
  capability: "app.create_bot",
  botId: id,
  mode: "allow",
  scope: "session",
  sessionId: "session-one",
  generation: 1,
  approvalId: null,
  maxUses: 5,
  uses: 1,
  expiresAt: "2026-10-26T02:00:00.000Z",
  createdAt: now,
  revokedAt: null,
};

describe("permission schemas", () => {
  it("gives safe defaults and cannot silently allow per-action capabilities", () => {
    expect(new Set(CAPABILITY_IDS).size).toBe(CAPABILITY_IDS.length);
    expect(defaultPermissionMode("app.read")).toBe("allow");
    expect(defaultPermissionMode("interaction.ask_user")).toBe("allow");
    expect(defaultPermissionMode("memory.read")).toBe("allow");
    expect(defaultPermissionMode("memory.write")).toBe("ask");
    expect(defaultPermissionMode("app.create_bot")).toBe("ask");
    expect(defaultPermissionMode("screen.capture")).toBe("deny");
    expect(defaultPermissionMode("device.action")).toBe("deny");
    expect(requiresPerActionApproval("app.start_run")).toBe(true);
    expect(requiresPerActionApproval("device.action")).toBe(true);
    for (const capability of ["app.start_run", "exec.shell", "screen.capture", "device.action"]) {
      expect(CapabilityPolicySchema.safeParse({ capability, mode: "allow" }).success).toBe(false);
    }
    expect(
      CapabilityPolicySchema.safeParse({ capability: "app.start_run", mode: "deny" }).success,
    ).toBe(false);
    expect(
      CapabilityPolicySchema.safeParse({ capability: "screen.capture", mode: "ask" }).success,
    ).toBe(true);
    expect(
      CapabilityPolicySchema.safeParse({ capability: "device.action", mode: "ask" }).success,
    ).toBe(true);
    expect(
      CapabilityPolicySchema.safeParse({ capability: "device.action", mode: "deny" }).success,
    ).toBe(true);
    expect(CapabilityPolicySchema.safeParse({ capability: "unknown", mode: "allow" }).success).toBe(
      false,
    );
  });

  it("requires session grants to bind identity, generation, expiry and use limit", () => {
    expect(PermissionGrantSchema.safeParse(sessionGrant).success).toBe(true);
    for (const invalid of [
      { botId: null },
      { generation: null },
      { sessionId: null },
      { expiresAt: null },
      { maxUses: null },
      { uses: 6 },
      { mode: "deny" },
      { capability: "app.start_run" },
    ]) {
      expect(PermissionGrantSchema.safeParse({ ...sessionGrant, ...invalid }).success).toBe(false);
    }
  });

  it("distinguishes permanent, single approval and global policy records", () => {
    const permanent = {
      ...sessionGrant,
      scope: "permanent",
      generation: null,
      sessionId: null,
      maxUses: null,
      expiresAt: null,
    };
    expect(PermissionGrantSchema.safeParse(permanent).success).toBe(true);
    expect(PermissionGrantSchema.safeParse({ ...permanent, generation: 1 }).success).toBe(false);
    const once = { ...sessionGrant, scope: "once", sessionId: null, maxUses: 1, approvalId: id };
    expect(PermissionGrantSchema.safeParse(once).success).toBe(true);
    expect(PermissionGrantSchema.safeParse({ ...once, approvalId: null }).success).toBe(false);
    const policy = { ...permanent, scope: "policy", botId: null, mode: "ask", uses: 0 };
    expect(PermissionGrantSchema.safeParse(policy).success).toBe(true);
    expect(PermissionGrantSchema.safeParse({ ...policy, botId: id }).success).toBe(false);
  });

  it("validates human decision scope and count limits, with strict shapes", () => {
    const decision = { approvalId: id, expectedActionDigest: "a".repeat(64), decision: "approved" };
    expect(PermissionDecisionRequestSchema.parse(decision).scope).toBe("once");
    expect(
      PermissionDecisionRequestSchema.safeParse({
        ...decision,
        scope: "session",
        maxUses: 5,
        ttlMinutes: 120,
      }).success,
    ).toBe(true);
    for (const patch of [
      { maxUses: 3 },
      { scope: "session", maxUses: 0 },
      { scope: "session", ttlMinutes: 1_441 },
      { botId: id },
      { expectedActionDigest: "bad" },
    ]) {
      expect(PermissionDecisionRequestSchema.safeParse({ ...decision, ...patch }).success).toBe(
        false,
      );
    }
    expect(
      PERMISSION_METHODS["permission.policy.set"].request.safeParse({
        capability: "app.read",
        mode: "allow",
        grantSelf: true,
      }).success,
    ).toBe(false);
  });

  it("accepts one session or permanent chat grant and rejects per-action capabilities", () => {
    expect(MethodSchema.safeParse("permission.grant.issue").success).toBe(true);
    expect(
      PermissionGrantIssueRequestSchema.parse({
        botId: id,
        capability: "app.create_group",
        scope: "session",
      }),
    ).toEqual({ botId: id, capability: "app.create_group", scope: "session" });
    expect(
      PermissionGrantIssueRequestSchema.safeParse({
        botId: id,
        capability: "app.create_bot",
        scope: "permanent",
      }).success,
    ).toBe(true);
    for (const capability of [
      "app.start_run",
      "exec.shell",
      "screen.capture",
      "device.action",
      "mcp.call",
    ]) {
      expect(
        PermissionGrantIssueRequestSchema.safeParse({ botId: id, capability, scope: "session" })
          .success,
      ).toBe(false);
    }
    for (const patch of [
      { scope: "once" },
      { scope: "policy" },
      { sessionId: "chat:spoofed" },
      { maxUses: 5 },
      { capability: "unknown" },
    ]) {
      expect(
        PermissionGrantIssueRequestSchema.safeParse({
          botId: id,
          capability: "app.create_group",
          scope: "session",
          ...patch,
        }).success,
      ).toBe(false);
    }
  });
});
