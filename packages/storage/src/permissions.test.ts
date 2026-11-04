import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { CAPABILITY_IDS, defaultPermissionMode } from "@deepseek-bot/contracts";
import * as storage from "./index.js";
import { makeBot, makeTestClock, makeTempRoot, seedProfileAndWorkspace } from "./test-support.js";

const opened: storage.OpenedDatabase[] = [];
function fixture(options: { pinAsk?: boolean } = {}) {
  const clock = makeTestClock();
  const db = storage.openDatabase(":memory:", { now: clock.now });
  opened.push(db);
  const { profile, workspaceId } = seedProfileAndWorkspace(db);
  const bot = makeBot(profile, workspaceId);
  storage.createBot(db, { bot });
  // Approval-path tests pin ask. The product default is allow; a fresh
  // database without this pin is covered by the default-policy test.
  if (options.pinAsk !== false) {
    storage.setPermissionPolicy(db, { capability: "app.create_bot", mode: "ask" });
    storage.setPermissionPolicy(db, { capability: "app.create_group", mode: "ask" });
  }
  const call = {
    invocationId: randomUUID(),
    callerId: "caller",
    botId: bot.id,
    sessionId: "s1",
    tool: "create",
    capabilities: ["app.create_bot"] as import("@deepseek-bot/contracts").CapabilityId[],
    params: { secret: "preview-only" },
    actionDigest: "a".repeat(64),
    generation: 1,
  };
  const approve = (scope: "once" | "session" | "permanent" = "once", overrides = {}) => {
    const approval = storage.requestPermissionApproval(
      db,
      call,
      new Date(clock.now().getTime() + 600_000).toISOString(),
    );
    return storage.decidePermissionApproval(
      db,
      {
        approvalId: approval.id,
        expectedActionDigest: call.actionDigest,
        decision: "approved",
        scope,
        ...overrides,
      },
      1,
    );
  };
  return { db, clock, bot, call, approve };
}
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});
describe("D16 permissions persistence", () => {
  it("adds migration 0005 and global default policies", () => {
    const { db, call } = fixture({ pinAsk: false });
    expect(db.schemaVersion).toBe(storage.MIGRATIONS.length);
    expect(storage.listPermissionPolicies(db)).toEqual(
      CAPABILITY_IDS.map((capability) => ({ capability, mode: defaultPermissionMode(capability) })),
    );
    expect(storage.authorizePermissionCall(db, call)).toMatchObject({
      allowed: true,
      grantIds: [],
    });
    storage.setPermissionPolicy(db, { capability: "app.create_bot", mode: "deny" });
    expect(storage.listPermissionPolicies(db)).toContainEqual({
      capability: "app.create_bot",
      mode: "deny",
    });
    expect(
      storage.authorizePermissionCall(db, { ...call, invocationId: randomUUID() }),
    ).toMatchObject({
      allowed: false,
      code: "UNAUTHORIZED_PATH",
    });
    storage.setPermissionPolicy(db, { capability: "fs.write", mode: "deny" });
    expect(
      storage.authorizePermissionCall(db, {
        ...call,
        invocationId: randomUUID(),
        tool: "import_attachment",
        capabilities: ["fs.write"],
      }).code,
    ).toBe("UNAUTHORIZED_PATH");
    storage.setPermissionPolicy(db, { capability: "app.start_run", mode: "allow" });
    expect(() =>
      storage.setPermissionPolicy(db, { capability: "screen.capture", mode: "allow" }),
    ).toThrow();
    expect(() =>
      storage.setPermissionPolicy(db, { capability: "device.action", mode: "allow" }),
    ).toThrow();
  });
  it("allows anonymous reads but requires identity for writes and approvals", () => {
    const { db, call } = fixture();
    expect(
      storage.authorizePermissionCall(db, { ...call, botId: null, capabilities: ["app.read"] })
        .allowed,
    ).toBe(true);
    expect(storage.authorizePermissionCall(db, { ...call, botId: null }).code).toBe(
      "UNAUTHORIZED_PATH",
    );
    expect(storage.authorizePermissionCall(db, call)).toMatchObject({
      allowed: false,
      code: "APPROVAL_REQUIRED",
      missing: call.capabilities,
    });
  });
  it("consumes once for its exact approval and revalidates without charging twice", () => {
    const { db, call, approve } = fixture();
    const result = approve();
    expect(result.authorization?.allowed).toBe(true);
    expect(result.approval.status).toBe("consumed");
    expect(result.grants[0]?.uses).toBe(1);
    storage.revalidatePermissionAuthorization(db, call, result.authorization!);
    expect(
      storage.authorizePermissionCall(db, { ...call, invocationId: randomUUID() }).allowed,
    ).toBe(false);
    storage.revokePermissionGrant(db, result.grants[0]!.id);
    expect(() =>
      storage.revalidatePermissionAuthorization(db, call, result.authorization!),
    ).toThrow();
    expect(storage.revokePermissionGrant(db, result.grants[0]!.id).revokedAt).not.toBeNull();
  });
  it("atomically avoids charging a session grant when another capability is missing", () => {
    const { db, call, approve } = fixture();
    approve("session", { maxUses: 3 });
    expect(
      storage.authorizePermissionCall(db, {
        ...call,
        invocationId: randomUUID(),
        capabilities: ["app.create_bot", "app.create_group"],
      }).allowed,
    ).toBe(false);
    expect(storage.listPermissionGrants(db, { generation: 1 })[0]?.uses).toBe(1);
    expect(
      storage.authorizePermissionCall(db, { ...call, invocationId: randomUUID() }).allowed,
    ).toBe(true);
    expect(
      storage.authorizePermissionCall(db, {
        ...call,
        invocationId: randomUUID(),
        sessionId: "other",
      }).allowed,
    ).toBe(false);
    expect(
      storage.authorizePermissionCall(db, { ...call, invocationId: randomUUID(), generation: 2 })
        .allowed,
    ).toBe(false);
    storage.setPermissionPolicy(db, { capability: "app.create_bot", mode: "deny" });
    expect(storage.authorizePermissionCall(db, call).code).toBe("UNAUTHORIZED_PATH");
  });
  it("rejects digest mismatch and per-action persistent scopes without issuing any grants", () => {
    const { db, call } = fixture();
    call.capabilities = ["app.start_run"];
    const approval = storage.requestPermissionApproval(db, call, "2026-10-24T00:10:00.000Z");
    const request = {
      approvalId: approval.id,
      expectedActionDigest: "b".repeat(64),
      decision: "approved" as const,
      scope: "once" as const,
    };
    expect(() => storage.decidePermissionApproval(db, request, 1)).toThrow();
    expect(() =>
      storage.decidePermissionApproval(
        db,
        { ...request, expectedActionDigest: call.actionDigest, scope: "permanent" },
        1,
      ),
    ).toThrow();
    expect(storage.getPermissionApproval(db, approval.id)?.status).toBe("pending");
    expect(storage.listPermissionGrants(db, { generation: 1 })).toEqual([]);
  });
  it("durably expires stale decisions and preserves permanent grants on restart", () => {
    const { db, call, approve } = fixture();
    approve("permanent");
    const pending = storage.requestPermissionApproval(
      db,
      { ...call, invocationId: randomUUID() },
      "2026-10-24T00:10:00.000Z",
    );
    expect(() =>
      storage.decidePermissionApproval(
        db,
        {
          approvalId: pending.id,
          expectedActionDigest: call.actionDigest,
          decision: "approved",
          scope: "once",
        },
        2,
      ),
    ).toThrow();
    expect(storage.getPermissionApproval(db, pending.id)?.status).toBe("expired");
    storage.expirePermissionState(db, 2);
    expect(
      storage.authorizePermissionCall(db, { ...call, invocationId: randomUUID(), generation: 2 })
        .allowed,
    ).toBe(true);
  });
  it("persists ordered append-only audit without raw preview parameters", () => {
    const { db, approve } = fixture();
    approve();
    const records = storage.listPermissionAudit(db, {});
    expect(records.length).toBeGreaterThan(2);
    expect(records.map((record) => record.sequence)).toEqual(
      [...records.map((record) => record.sequence)].sort((a, b) => a - b),
    );
    expect(JSON.stringify(records)).not.toContain("preview-only");
    expect(storage.listPermissionAudit(db, { afterSequence: records[0]!.sequence })).toEqual(
      records.slice(1),
    );
    expect(() => db.raw.exec("DELETE FROM permission_audit")).toThrow();
  });
  it("expires session grants and pending approvals by clock and cancellation is terminal", () => {
    const { db, call, clock, approve } = fixture();
    approve("session", { ttlMinutes: 1 });
    clock.advanceMs(60_000);
    expect(
      storage.authorizePermissionCall(db, { ...call, invocationId: randomUUID() }).allowed,
    ).toBe(false);
    const approval = storage.requestPermissionApproval(
      db,
      { ...call, invocationId: randomUUID() },
      "2026-10-24T00:10:00.000Z",
    );
    expect(storage.cancelPermissionApproval(db, approval.id, "cancelled", 1)?.status).toBe(
      "cancelled",
    );
    expect(storage.cancelPermissionApproval(db, approval.id, "expired", 1)?.status).toBe(
      "cancelled",
    );
  });
});

it("rejects revoked consumed grants even if policy later changes to allow", () => {
  const { db, call, approve } = fixture();
  const result = approve("session");
  storage.revokePermissionGrant(db, result.grants[0]!.id);
  storage.setPermissionPolicy(db, { capability: "app.create_bot", mode: "allow" });
  expect(() =>
    storage.revalidatePermissionAuthorization(db, call, result.authorization!),
  ).toThrow();
});
it("rejects changed identity, receipt forgery and duplicate invocation consumption", () => {
  const { db, call, approve } = fixture();
  const result = approve("session");
  expect(() =>
    storage.revalidatePermissionAuthorization(
      db,
      { ...call, sessionId: "other" },
      result.authorization!,
    ),
  ).toThrow();
  expect(() =>
    storage.revalidatePermissionAuthorization(db, call, { ...result.authorization!, grantIds: [] }),
  ).toThrow();
  expect(() => storage.authorizePermissionCall(db, call)).toThrow();
  expect(storage.listPermissionGrants(db, { generation: 1 })[0]?.uses).toBe(1);
});
it("restart expires all pending approvals and revokes temporary grants while preserving policies", () => {
  const { db, call, approve } = fixture();
  approve("session");
  const pending = storage.requestPermissionApproval(
    db,
    { ...call, invocationId: randomUUID() },
    "2026-10-24T00:10:00.000Z",
  );
  storage.setPermissionPolicy(db, { capability: "app.read", mode: "ask" });
  storage.expirePermissionState(db, 2);
  expect(storage.getPermissionApproval(db, pending.id)?.status).toBe("expired");
  expect(storage.listPermissionGrants(db, { generation: 2 })).toEqual([]);
  expect(
    storage.listPermissionGrants(db, { generation: 2, includeInactive: true })[0]?.revokedAt,
  ).not.toBeNull();
  expect(storage.listPermissionPolicies(db)).toContainEqual({
    capability: "app.read",
    mode: "ask",
  });
});
it("denial and changed policies or inactive owner never issue grants", () => {
  const { db, call } = fixture();
  const pending = storage.requestPermissionApproval(db, call, "2026-10-24T00:10:00.000Z");
  const request = {
    approvalId: pending.id,
    expectedActionDigest: call.actionDigest,
    decision: "approved" as const,
    scope: "once" as const,
  };
  storage.setPermissionPolicy(db, { capability: "app.create_bot", mode: "deny" });
  expect(() => storage.decidePermissionApproval(db, request, 1)).toThrow();
  expect(
    storage.decidePermissionApproval(db, { ...request, decision: "denied" }, 1).approval.status,
  ).toBe("denied");
  expect(storage.listPermissionGrants(db, { generation: 1 })).toEqual([]);
});
it("retains human and restart revocations in the bot audit query", () => {
  const human = fixture();
  const grant = human.approve("session").grants[0]!;
  storage.revokePermissionGrant(human.db, grant.id);
  expect(
    storage
      .listPermissionAudit(human.db, { botId: human.bot.id })
      .filter((row) => row.decision === "grant.revoked"),
  ).toMatchObject([{ actor: "human", botId: human.bot.id, grantIds: [grant.id] }]);
  const restart = fixture();
  const temporary = restart.approve("session").grants[0]!;
  storage.expirePermissionState(restart.db, 2);
  expect(
    storage
      .listPermissionAudit(restart.db, { botId: restart.bot.id })
      .filter((row) => row.decision === "grant.revoked"),
  ).toMatchObject([{ actor: "host", botId: restart.bot.id, grantIds: [temporary.id] }]);
});
it("persists denied audit when synchronous dispatch revalidation fails", () => {
  const { db, call, approve } = fixture();
  const result = approve();
  storage.revokePermissionGrant(db, result.grants[0]!.id);
  expect(() =>
    storage.revalidatePermissionAuthorization(db, call, result.authorization!),
  ).toThrow();
  expect(storage.listPermissionAudit(db, {}).at(-1)).toMatchObject({
    actor: "agent",
    decision: "denied",
    actionDigest: call.actionDigest,
    grantIds: result.authorization!.grantIds,
  });
});
it("enforces the final session use across separate SQLite connections", () => {
  const clock = makeTestClock();
  const layout = storage.ensureDataLayout(makeTempRoot());
  const db = storage.openDatabase(layout.dbFile, { now: clock.now });
  opened.push(db);
  const { profile, workspaceId } = seedProfileAndWorkspace(db);
  const bot = makeBot(profile, workspaceId);
  storage.createBot(db, { bot });
  storage.setPermissionPolicy(db, { capability: "app.create_bot", mode: "ask" });
  const call: storage.PermissionCall = {
    invocationId: randomUUID(),
    callerId: "caller",
    botId: bot.id,
    sessionId: "shared",
    tool: "create",
    capabilities: ["app.create_bot"],
    params: {},
    actionDigest: "a".repeat(64),
    generation: 1,
  };
  const approval = storage.requestPermissionApproval(db, call, "2026-10-24T00:10:00.000Z");
  storage.decidePermissionApproval(
    db,
    {
      approvalId: approval.id,
      expectedActionDigest: call.actionDigest,
      decision: "approved",
      scope: "session",
      maxUses: 2,
    },
    1,
  );
  const second = storage.openDatabase(layout.dbFile, { now: clock.now });
  opened.push(second);
  expect(
    storage.authorizePermissionCall(second, { ...call, invocationId: randomUUID() }).allowed,
  ).toBe(true);
  expect(storage.authorizePermissionCall(db, { ...call, invocationId: randomUUID() }).allowed).toBe(
    false,
  );
  expect(storage.listPermissionGrants(db, { generation: 1, includeInactive: true })[0]?.uses).toBe(
    2,
  );
});
it("persists expiry at the exact approval TTL boundary and validates filtered approval lists", () => {
  const { db, call, clock, bot } = fixture();
  const approval = storage.requestPermissionApproval(db, call, "2026-10-24T00:10:00.000Z");
  expect(
    storage.listPermissionApprovals(db, { botId: bot.id, status: "pending", limit: 1 }),
  ).toEqual([approval]);
  clock.advanceMs(600_000);
  expect(() =>
    storage.decidePermissionApproval(
      db,
      {
        approvalId: approval.id,
        expectedActionDigest: call.actionDigest,
        decision: "approved",
        scope: "once",
      },
      1,
    ),
  ).toThrow(/expired/);
  expect(storage.getPermissionApproval(db, approval.id)?.status).toBe("expired");
  expect(storage.listPermissionApprovals(db, { status: "pending" })).toEqual([]);
  expect(storage.listPermissionGrants(db, { generation: 1, includeInactive: true })).toEqual([]);
});
it("archives the owner before dispatch and blocks policy allow from authorizing newly asked capabilities", () => {
  const active = fixture();
  const result = active.approve("permanent");
  storage.archiveBot(active.db, { id: active.bot.id, expectedRevision: active.bot.revision });
  expect(() =>
    storage.revalidatePermissionAuthorization(active.db, active.call, result.authorization!),
  ).toThrow();
  const changed = fixture();
  storage.setPermissionPolicy(changed.db, { capability: "app.create_bot", mode: "allow" });
  const authorization = storage.authorizePermissionCall(changed.db, changed.call);
  storage.setPermissionPolicy(changed.db, { capability: "app.create_bot", mode: "ask" });
  expect(() =>
    storage.revalidatePermissionAuthorization(changed.db, changed.call, authorization),
  ).toThrow();
});

describe("chat capability grant", () => {
  const issue = (
    fx: ReturnType<typeof fixture>,
    capability: import("@deepseek-bot/contracts").CapabilityId = "app.create_group",
    scope: "session" | "permanent" = "session",
    sessionId: string | null = "s1",
    generation = 1,
  ) =>
    storage.issuePermissionGrant(
      fx.db,
      { botId: fx.bot.id, capability, scope, sessionId: scope === "session" ? sessionId : null },
      generation,
    );

  it("issues one session grant the gateway consumes, then stops after revoke", () => {
    const fx = fixture();
    const grant = issue(fx);
    expect(grant).toMatchObject({
      capability: "app.create_group",
      botId: fx.bot.id,
      scope: "session",
      sessionId: "s1",
      generation: 1,
      approvalId: null,
      maxUses: 5,
      uses: 0,
      mode: "allow",
      revokedAt: null,
    });
    expect(grant.expiresAt).toBe(new Date(fx.clock.now().getTime() + 120 * 60_000).toISOString());
    expect(issue(fx).id).toBe(grant.id);
    const call = {
      ...fx.call,
      invocationId: randomUUID(),
      tool: "create_group",
      capabilities: ["app.create_group"] as import("@deepseek-bot/contracts").CapabilityId[],
      sessionId: "s1",
    };
    const authorization = storage.authorizePermissionCall(fx.db, call);
    expect(authorization).toMatchObject({ allowed: true, grantIds: [grant.id] });
    expect(storage.listPermissionGrants(fx.db, { generation: 1 })[0]?.uses).toBe(1);
    expect(issue(fx).uses).toBe(1);
    expect(
      storage.authorizePermissionCall(fx.db, {
        ...call,
        invocationId: randomUUID(),
        sessionId: "other-session",
      }).code,
    ).toBe("APPROVAL_REQUIRED");
    storage.revokePermissionGrant(fx.db, grant.id);
    expect(() => storage.revalidatePermissionAuthorization(fx.db, call, authorization)).toThrow();
    expect(
      storage.authorizePermissionCall(fx.db, { ...call, invocationId: randomUUID() }).code,
    ).toBe("APPROVAL_REQUIRED");
    expect(
      storage
        .listPermissionAudit(fx.db, { botId: fx.bot.id })
        .some((row) => row.decision === "grant.issued" && row.grantIds[0] === grant.id),
    ).toBe(true);
    expect(JSON.stringify(storage.listPermissionAudit(fx.db, { botId: fx.bot.id }))).not.toContain(
      "preview-only",
    );
  });

  it("expires a session grant with its TTL and host generation, and keeps a permanent grant", () => {
    const fx = fixture();
    const session = issue(fx);
    fx.clock.advanceMs(120 * 60_000 + 1);
    expect(
      storage.authorizePermissionCall(fx.db, {
        ...fx.call,
        invocationId: randomUUID(),
        capabilities: ["app.create_group"],
        sessionId: "s1",
      }).allowed,
    ).toBe(false);
    expect(storage.listPermissionGrants(fx.db, { generation: 1 })).toEqual([]);
    const renewed = issue(fx);
    expect(renewed.id).not.toBe(session.id);
    const permanent = issue(fx, "app.create_bot", "permanent");
    storage.expirePermissionState(fx.db, 2);
    expect(storage.listPermissionGrants(fx.db, { generation: 2 }).map((grant) => grant.id)).toEqual(
      [permanent.id],
    );
    expect(
      storage.authorizePermissionCall(fx.db, {
        ...fx.call,
        invocationId: randomUUID(),
        capabilities: ["app.create_bot"],
        sessionId: "anywhere",
        generation: 2,
      }).allowed,
    ).toBe(true);
  });

  it("refuses per-action capabilities, non-ask policies and an archived bot", () => {
    const fx = fixture();
    for (const capability of [
      "app.start_run",
      "exec.shell",
      "screen.capture",
      "device.action",
      "mcp.call",
    ] as const) {
      expect(() => issue(fx, capability)).toThrow();
    }
    storage.setPermissionPolicy(fx.db, { capability: "device.action", mode: "ask" });
    expect(() => issue(fx, "device.action")).toThrow();
    storage.setPermissionPolicy(fx.db, { capability: "app.create_group", mode: "deny" });
    expect(() => issue(fx)).toThrow();
    expect(() =>
      storage.issuePermissionGrant(
        fx.db,
        {
          botId: fx.bot.id,
          capability: "app.create_bot",
          scope: "permanent",
          sessionId: "not-allowed",
        },
        1,
      ),
    ).toThrow();
    const allowed = fixture();
    storage.setPermissionPolicy(allowed.db, { capability: "app.create_bot", mode: "allow" });
    expect(() => issue(allowed, "app.create_bot")).toThrow();
    const archived = fixture();
    const granted = issue(archived);
    storage.setPermissionPolicy(archived.db, { capability: "app.create_group", mode: "deny" });
    expect(
      storage.authorizePermissionCall(archived.db, {
        ...archived.call,
        invocationId: randomUUID(),
        capabilities: ["app.create_group"],
        sessionId: "s1",
      }),
    ).toMatchObject({ allowed: false, code: "UNAUTHORIZED_PATH" });
    expect(storage.listPermissionGrants(archived.db, { generation: 1 })[0]?.id).toBe(granted.id);
    storage.archiveBot(archived.db, {
      id: archived.bot.id,
      expectedRevision: archived.bot.revision,
    });
    expect(() => issue(archived, "app.create_bot")).toThrow();
  });
});
