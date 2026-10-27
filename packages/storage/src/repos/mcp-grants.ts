/** Per-bot MCP authority. Every write clones its policy to preserve shared users and run snapshots. */
import { randomUUID } from "node:crypto";
import {
  McpServerGrantSchema,
  ToolPolicySchema,
  type McpServerGrant,
} from "@deepseek-bot/contracts";
import type { OpenedDatabase } from "../database.js";
import { invalidInput } from "../errors.js";
import { getBot } from "./bots.js";
import { getConnector } from "./connectors.js";
import { createToolPolicy, getToolPolicy } from "./tool-policies.js";
import { isoNow, runInTransaction } from "./shared.js";

function activeBot(db: OpenedDatabase, botId: string) {
  const bot = getBot(db, botId);
  if (bot === undefined || bot.archivedAt !== null) throw invalidInput("active bot was not found");
  return bot;
}

export function getBotMcpGrants(db: OpenedDatabase, botId: string): McpServerGrant[] {
  const bot = activeBot(db, botId);
  const policy = getToolPolicy(db, bot.toolPolicyId);
  if (policy === undefined) throw invalidInput("tool policy was not found");
  return policy.mcp.servers;
}

export function setBotMcpGrant(
  db: OpenedDatabase,
  input: { botId: string; connectorId: string; allowedTools: string[] },
): McpServerGrant[] {
  const grant = McpServerGrantSchema.safeParse({
    serverId: input.connectorId,
    allowedTools: input.allowedTools,
  });
  if (
    !grant.success ||
    new Set(input.allowedTools).size !== input.allowedTools.length ||
    input.allowedTools.some((tool) => tool.includes("*"))
  ) {
    throw invalidInput(
      "MCP tools must be unique explicit names, at most 200 tools of 200 characters each",
    );
  }
  return runInTransaction(db.raw, () => {
    const bot = activeBot(db, input.botId);
    if (getConnector(db, input.connectorId).kind !== "mcp-http")
      throw invalidInput("connector must be MCP HTTP");
    const current = getToolPolicy(db, bot.toolPolicyId);
    if (current === undefined) throw invalidInput("tool policy was not found");
    const servers = current.mcp.servers.filter((server) => server.serverId !== input.connectorId);
    if (grant.data.allowedTools.length > 0) servers.push(grant.data);
    const policy = ToolPolicySchema.parse({
      ...current,
      id: randomUUID(),
      revision: randomUUID(),
      mcp: { enabled: servers.length > 0, requireApproval: true, servers },
    });
    createToolPolicy(db, policy);
    db.raw
      .prepare("UPDATE bots SET tool_policy_id = ?, revision = ?, updated_at = ? WHERE id = ?")
      .run(policy.id, randomUUID(), isoNow(db.now), bot.id);
    return policy.mcp.servers;
  });
}
