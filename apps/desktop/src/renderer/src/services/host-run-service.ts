/**
 * Host-backed RunService (D09 wire-up): the monitor keeps the same view model
 * and event folding, but run state now comes from the real Host engine
 * (packages/host) and its SQLite storage instead of fixture playback.
 *
 * Differences from the fixture, kept explicit:
 * - the Host approval entity does not expose `generation`, `requestedAt` or a
 *   resolved record, so requestedAt is derived from the contract TTL
 *   (APPROVAL_DEFAULT_TTL_MS) and staleness is limited to expiry;
 * - there are no transient assistant deltas and no scripted playback: the
 *   "advance scenario" control is a fixture-only affordance and is rejected.
 */
import {
  APPROVAL_DEFAULT_TTL_MS,
  METHOD_CONTRACTS,
  type Approval,
  type Artifact,
  type AssistantDelta,
  type NodeRun,
  type Run,
} from "@deepseek-bot/contracts";
import { t } from "../i18n.js";
import { ServiceError } from "./desktop-service.js";
import type { HostCall } from "./host-call.js";
import type { ApprovalBaseline } from "../features/run-monitor/events/run-view.js";
import type {
  DecideApprovalInput,
  RunListQuery,
  RunServiceApi,
  SubscribeResult,
} from "../features/run-monitor/run-service.js";

/** Approval rows are created with the contract TTL, so askedAt ≈ expiresAt − TTL. */
function baselineOf(approval: Approval): ApprovalBaseline {
  const expiresAt = Date.parse(approval.expiresAt);
  const baseline: ApprovalBaseline = {
    approval,
    requestedAt: new Date(expiresAt - APPROVAL_DEFAULT_TTL_MS).toISOString(),
  };
  if (approval.status === "pending" && expiresAt <= Date.now()) {
    baseline.invalidReason = "expired";
  }
  return baseline;
}

export function createHostRunService(call: HostCall): RunServiceApi {
  const list = async (
    query: RunListQuery = {},
  ): Promise<{ runs: Run[]; nextCursor: string | null }> => {
    const payload: { limit: number; status?: Run["status"] } = {
      limit: query.limit ?? 50,
    };
    if (query.status !== undefined) {
      payload.status = query.status;
    }
    return METHOD_CONTRACTS["run.list"].response.parse(await call("run.list", payload));
  };

  const get = async (runId: string): Promise<Run> =>
    METHOD_CONTRACTS["run.get"].response.parse(await call("run.get", { runId }));

  const listApprovals = async (): Promise<ApprovalBaseline[]> => {
    const parsed = METHOD_CONTRACTS["approval.list"].response.parse(
      await call("approval.list", { limit: 100 }),
    );
    return parsed.approvals.map(baselineOf);
  };

  const snapshot = async (
    runId: string,
  ): Promise<{
    run: Run;
    nodeRuns: NodeRun[];
    approvals: ApprovalBaseline[];
    artifacts: Artifact[];
  }> => {
    const parsed = METHOD_CONTRACTS["run.snapshot"].response.parse(
      await call("run.snapshot", { runId }),
    );
    return {
      run: parsed.run,
      nodeRuns: parsed.nodeRuns,
      approvals: parsed.approvals.map(baselineOf),
      artifacts: parsed.artifacts,
    };
  };

  const subscribe = async (
    runId: string,
    afterSequence: number,
  ): Promise<SubscribeResult> => {
    const parsed = METHOD_CONTRACTS["events.subscribe"].response.parse(
      await call("events.subscribe", { runId, afterSequence }),
    );
    return { events: parsed.events, snapshotRequired: parsed.snapshotRequired };
  };

  return {
    playback: "host",

    list,

    get,

    listApprovals,

    snapshot,

    subscribe,

    async cancel(runId) {
      return METHOD_CONTRACTS["run.cancel"].response.parse(
        await call("run.cancel", { runId }),
      );
    },

    async retryNode(nodeRunId) {
      return METHOD_CONTRACTS["run.retryNode"].response.parse(
        await call("run.retryNode", { nodeRunId }),
      );
    },

    async resume(runId) {
      return METHOD_CONTRACTS["run.resume"].response.parse(
        await call("run.resume", { runId }),
      );
    },

    async decideApproval(input: DecideApprovalInput) {
      return METHOD_CONTRACTS["approval.decide"].response.parse(
        await call("approval.decide", input),
      );
    },

    async pullTransient(_runId): Promise<AssistantDelta[]> {
      // The real engine emits deltas inside console events, not through a
      // transient queue; the monitor simply has nothing to drain here.
      return [];
    },

    async advanceScenario(_runId): Promise<void> {
      throw new ServiceError("INVALID_INPUT", t("runs.fixtureOnlyControl"));
    },
  };
}
