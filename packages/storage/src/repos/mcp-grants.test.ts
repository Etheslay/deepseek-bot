import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createBot, archiveBot, getBot } from "./bots.js";
import { createToolPolicy, getToolPolicy } from "./tool-policies.js";
import { registerConnector } from "./connectors.js";
import * as grants from "../index.js";
import {
  makeBot,
  makeLayout,
  makeTempRoot,
  openTestDatabase,
  seedProfileAndWorkspace,
} from "../test-support.js";
import { openDatabase } from "../database.js";

function setup() {
  const db = openTestDatabase(makeLayout(makeTempRoot()));
  const { profile, workspaceId } = seedProfileAndWorkspace(db);
  const policy = createToolPolicy(db, {
    id: randomUUID(),
    revision: randomUUID(),
    name: "shared",
    filesystem: { enabled: true, operations: ["read"] },
    shell: { mode: "disabled" },
    network: { mode: "disabled" },
    mcp: { enabled: false, requireApproval: false, servers: [] },
  }).policy;
  const bots = [0, 1].map(
    () => createBot(db, { bot: makeBot(profile, workspaceId, { toolPolicyId: policy.id }) }).bot,
  );
  const connector = registerConnector(db, {
    name: "MCP",
    kind: "mcp-http",
    endpoint: "http://127.0.0.1:8000/mcp",
  });
  return { db, policy, bots, connector };
}

describe("per-bot MCP grants", () => {
  it("clones shared policy and preserves original snapshots and other bot authority", () => {
    const {
      db,
      policy,
      bots: [bot, other],
      connector,
    } = setup();
    try {
      expect(grants).toHaveProperty("setBotMcpGrant");
      const saved = grants.setBotMcpGrant(db, {
        botId: bot!.id,
        connectorId: connector.id,
        allowedTools: ["search"],
      });
      expect(saved).toEqual([{ serverId: connector.id, allowedTools: ["search"] }]);
      expect(grants.getBotMcpGrants(db, bot!.id)).toEqual(saved);
      expect(grants.getBotMcpGrants(db, other!.id)).toEqual([]);
      expect(getToolPolicy(db, policy.id)).toEqual(policy);
      const changed = getBot(db, bot!.id)!;
      expect(changed.revision).not.toBe(bot!.revision);
      expect(changed.toolPolicyId).not.toBe(policy.id);
      expect(getBot(db, other!.id)).toEqual(other);
      const cloned = getToolPolicy(db, changed.toolPolicyId)!;
      expect(cloned.revision).not.toBe(policy.revision);
      expect(cloned.filesystem).toEqual(policy.filesystem);
      expect(cloned.shell).toEqual(policy.shell);
      expect(cloned.network).toEqual(policy.network);
      expect(cloned.mcp).toEqual({ enabled: true, requireApproval: true, servers: saved });
      db.close();
      const reopened = openDatabase(db.file);
      try {
        expect(grants.getBotMcpGrants(reopened, bot!.id)).toEqual(saved);
      } finally {
        reopened.close();
      }
    } finally {
      try {
        db.close();
      } catch {
        /* already closed */
      }
    }
  });

  it("preserves other servers and removes empty grants without changing previous policies", () => {
    const {
      db,
      bots: [bot],
      connector,
    } = setup();
    try {
      const second = registerConnector(db, { name: "second", kind: "mcp-http" });
      grants.setBotMcpGrant(db, {
        botId: bot!.id,
        connectorId: connector.id,
        allowedTools: ["search"],
      });
      const firstPolicy = getBot(db, bot!.id)!.toolPolicyId;
      grants.setBotMcpGrant(db, { botId: bot!.id, connectorId: second.id, allowedTools: ["read"] });
      expect(
        grants.setBotMcpGrant(db, { botId: bot!.id, connectorId: connector.id, allowedTools: [] }),
      ).toEqual([{ serverId: second.id, allowedTools: ["read"] }]);
      expect(getToolPolicy(db, firstPolicy)!.mcp.servers).toEqual([
        { serverId: connector.id, allowedTools: ["search"] },
      ]);
      expect(
        grants.setBotMcpGrant(db, { botId: bot!.id, connectorId: second.id, allowedTools: [] }),
      ).toEqual([]);
      expect(getToolPolicy(db, getBot(db, bot!.id)!.toolPolicyId)!.mcp).toEqual({
        enabled: false,
        requireApproval: true,
        servers: [],
      });
    } finally {
      db.close();
    }
  });

  it("rejects invalid bot, connector and tool selection atomically", () => {
    const {
      db,
      policy,
      bots: [bot],
      connector,
    } = setup();
    try {
      for (const allowedTools of [
        ["*"],
        ["search*"],
        ["same", "same"],
        [""],
        ["x".repeat(201)],
        Array.from({ length: 201 }, (_, i) => `t${i}`),
      ]) {
        expect(() =>
          grants.setBotMcpGrant(db, { botId: bot!.id, connectorId: connector.id, allowedTools }),
        ).toThrow();
      }
      const sd = registerConnector(db, { name: "sd" });
      for (const connectorId of [sd.id, randomUUID()]) {
        expect(() =>
          grants.setBotMcpGrant(db, { botId: bot!.id, connectorId, allowedTools: ["search"] }),
        ).toThrow();
      }
      expect(() => grants.getBotMcpGrants(db, randomUUID())).toThrow();
      expect(getBot(db, bot!.id)).toEqual(bot);
      expect(getToolPolicy(db, policy.id)).toEqual(policy);
      expect(db.raw.prepare("SELECT count(*) AS n FROM tool_policies").get()).toMatchObject({
        n: 1,
      });
      archiveBot(db, { id: bot!.id, expectedRevision: bot!.revision });
      expect(() =>
        grants.setBotMcpGrant(db, {
          botId: bot!.id,
          connectorId: connector.id,
          allowedTools: ["search"],
        }),
      ).toThrow(/active/);
      expect(() => grants.getBotMcpGrants(db, bot!.id)).toThrow(/active/);
    } finally {
      db.close();
    }
  });
});

it("rolls back the cloned policy when the bot assignment fails", () => {
  const {
    db,
    policy,
    bots: [bot],
    connector,
  } = setup();
  try {
    db.raw.exec(
      "CREATE TRIGGER reject_policy_assignment BEFORE UPDATE OF tool_policy_id ON bots BEGIN SELECT RAISE(ABORT, 'assignment rejected'); END",
    );
    expect(() =>
      grants.setBotMcpGrant(db, {
        botId: bot!.id,
        connectorId: connector.id,
        allowedTools: ["search"],
      }),
    ).toThrow(/assignment rejected/);
    expect(getBot(db, bot!.id)).toEqual(bot);
    expect(getToolPolicy(db, policy.id)).toEqual(policy);
    expect(db.raw.prepare("SELECT count(*) AS n FROM tool_policies").get()).toMatchObject({ n: 1 });
  } finally {
    db.close();
  }
});
