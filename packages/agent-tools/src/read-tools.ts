/**
 * D15 read-layer capabilities (SPRINTS §2.3: 默认允许、零契约变更 when
 * introduced; list_groups now forwards to group.list since the group model
 * landed with the write layer).
 *
 * Every tool forwards to an existing contract method through an injected
 * caller — the host wires this to its own method surface; no direct storage
 * access.
 */
import { z } from "zod";
import type { ToolCapability } from "./types.js";

/** The contract method surface the read layer forwards to. */
export type ContractCaller = (method: string, payload: unknown) => Promise<unknown>;

type CapabilityShape = Pick<ToolCapability, "name" | "description" | "inputSchema">;

const listBotsShape: CapabilityShape = {
  name: "list_bots",
  description: "List registered bots (bot.list contract method).",
  inputSchema: z.object({}).strict(),
};

const listGroupsShape: CapabilityShape = {
  name: "list_groups",
  description: "List bot groups (group.list contract method, D15 write layer).",
  inputSchema: z.object({}).strict(),
};

const getRunShape: CapabilityShape = {
  name: "get_run",
  description: "Read one run (run.get contract method).",
  inputSchema: z.object({ runId: z.string().uuid() }).strict(),
};

const getRunEventsShape: CapabilityShape = {
  name: "get_run_events",
  description: "Replay persisted events for one run (events.subscribe).",
  inputSchema: z
    .object({
      runId: z.string().uuid(),
      afterSequence: z.number().int().nonnegative().default(0),
    })
    .strict(),
};

/** Bind the four read capabilities to a contract caller. */
export function bindReadTools(caller: ContractCaller): ToolCapability[] {
  return [
    {
      ...listBotsShape,
      // The gateway validates parameters against the capability schema before
      // the handler runs, so handlers forward the parsed payload as-is.
      handler: async (params) => caller("bot.list", params),
    },
    {
      ...listGroupsShape,
      handler: async (params) => caller("group.list", params),
    },
    {
      ...getRunShape,
      handler: async (params) => caller("run.get", params),
    },
    {
      ...getRunEventsShape,
      handler: async (params) => caller("events.subscribe", params),
    },
  ];
}
