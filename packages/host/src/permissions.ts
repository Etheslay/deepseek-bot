/**
 * Three-layer permission gate (D16, docs/PERMISSIONS.md §1–§3).
 *
 * Layer 1 policy: per-capability default (always / ask / never) stored in the
 * settings table; a few capabilities are forced (start_run always asks,
 * screen capture never) and cannot be loosened from the UI.
 * Layer 2 grants: human-issued rows in `grants`; the gate consumes them.
 * Layer 3 denial: everything else rejects with a stable reason the UI turns
 * into an authorization card.
 */
import type { GrantCheckpoint, ToolCaller } from "@deepseek-bot/agent-tools";
import {
  consumeGrant,
  findValidGrant,
  getSettingRaw,
  type OpenedDatabase,
} from "@deepseek-bot/storage";

export type PolicyLevel = "always" | "ask" | "never";

/** Gateway tool → capability (PERMISSIONS §2). Unknown tools default to app.write. */
export const TOOL_CAPABILITY: Readonly<Record<string, string>> = {
  list_bots: "app.read",
  list_groups: "app.read",
  get_run: "app.read",
  get_run_events: "app.read",
  ask_user: "app.read",
  create_bot_draft: "app.write",
  create_group: "app.write",
  create_bots_batch: "app.write",
  revoke_batch: "app.write",
  web_search: "connector.web_search",
};

export const DEFAULT_POLICY: Readonly<Record<string, PolicyLevel>> = {
  "app.read": "always",
  "app.write": "ask",
  "connector.invoke": "ask",
  "connector.web_search": "always",
};

/** Policies the user cannot loosen (PERMISSIONS §3). */
export const FORCED_POLICY: Readonly<Record<string, PolicyLevel>> = {
  "app.start_run": "ask",
  "screen.capture": "never",
};

export const KNOWN_CAPABILITIES = [
  "app.read",
  "app.write",
  "connector.invoke",
  "connector.web_search",
  "app.start_run",
  "screen.capture",
] as const;

export function policyKey(capability: string): string {
  return `policy:${capability}`;
}

export function readPolicy(db: OpenedDatabase, capability: string): PolicyLevel {
  const forced = FORCED_POLICY[capability];
  if (forced !== undefined) {
    return forced;
  }
  const stored = getSettingRaw(db, policyKey(capability));
  if (stored === "always" || stored === "ask" || stored === "never") {
    return stored;
  }
  return DEFAULT_POLICY[capability] ?? "ask";
}

/** Extract a bot uuid from a caller id like `chat:<botId>` / `agent:<botId>`. */
export function callerBotId(callerId: string): string | null {
  const match =
    /(?:chat|agent|ui):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
      callerId,
    );
  return match?.[1] ?? null;
}

export class PolicyGate implements GrantCheckpoint {
  constructor(
    private readonly db: OpenedDatabase,
    private readonly now: () => Date,
    private readonly hooks: { readonly isClosed?: () => boolean } = {},
  ) {}

  async check(tool: string, caller: ToolCaller): Promise<{ allowed: boolean; reason?: string }> {
    if (this.hooks.isClosed?.() === true) {
      // Host is tearing down; the downstream service raises the proper
      // RUNTIME_UNAVAILABLE instead of a raw sqlite error from this gate.
      return { allowed: true };
    }
    const capability = TOOL_CAPABILITY[tool] ?? "app.write";
    const policy = readPolicy(this.db, capability);
    if (policy === "always") {
      return { allowed: true };
    }
    if (policy === "never") {
      return { allowed: false, reason: `grant required: ${capability} (policy: never)` };
    }
    const grant = findValidGrant(this.db, capability, callerBotId(caller.id), this.now());
    if (grant === undefined) {
      return { allowed: false, reason: `grant required: ${capability}` };
    }
    consumeGrant(this.db, grant.id, this.now());
    return { allowed: true };
  }
}
