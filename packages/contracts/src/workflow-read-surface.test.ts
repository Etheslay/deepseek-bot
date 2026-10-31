import { describe, expect, it } from "vitest";
import {
  METHOD_CONTRACTS,
  METHODS,
  PROTOCOL_VERSION,
  isProtocolVersionSupported,
} from "./index.js";

const workflowId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";

describe("v0.12 workflow read surface", () => {
  it("is an additive protocol bump that still accepts 0.11 senders", () => {
    expect(PROTOCOL_VERSION).toBe("0.14");
    for (const version of ["0.1", "0.10", "0.11", "0.12", "0.13"]) {
      expect(isProtocolVersionSupported(version)).toBe(true);
    }
    expect(isProtocolVersionSupported("0.15")).toBe(false);
  });

  it("whitelists workflow.get as an id-only strict request", () => {
    expect(METHODS).toContain("workflow.get");
    const request = METHOD_CONTRACTS["workflow.get"].request;
    expect(request.safeParse({ id: workflowId }).success).toBe(true);
    // Export needs expectedRevision; opening the editor must not require it.
    expect(request.safeParse({ id: workflowId, expectedRevision: workflowId }).success).toBe(false);
    expect(request.safeParse({ id: "workflow-1" }).success).toBe(false);
    expect(request.safeParse({}).success).toBe(false);
  });

  it("exposes the whole run frame through run.snapshot", () => {
    expect(METHODS).toContain("run.snapshot");
    const contract = METHOD_CONTRACTS["run.snapshot"];
    expect(Object.keys(contract.response.shape).sort()).toEqual([
      "approvals",
      "artifacts",
      "nodeRuns",
      "run",
    ]);
    expect(contract.request.safeParse({ runId }).success).toBe(true);
    // Same ref shape as run.get/run.cancel: unknown keys are stripped, not
    // rejected, so a caller cannot smuggle nodeRuns/approvals into the frame.
    expect(contract.request.parse({ runId, nodeRuns: [] })).toEqual({ runId });
    expect(contract.request.safeParse({ runId: "run-1" }).success).toBe(false);
    expect(contract.request.safeParse({}).success).toBe(false);
  });

  it("defaults approval.list to 50 and rejects unknown statuses and extra keys", () => {
    expect(METHODS).toContain("approval.list");
    const contract = METHOD_CONTRACTS["approval.list"];
    expect(contract.request.parse({}).limit).toBe(50);
    expect(contract.request.safeParse({ status: "pending" }).success).toBe(true);
    expect(contract.request.safeParse({ status: "unknown" }).success).toBe(false);
    expect(contract.request.safeParse({ runId, limit: 0 }).success).toBe(false);
    expect(contract.request.safeParse({ runId, limit: 101 }).success).toBe(false);
    expect(contract.request.safeParse({ runId, unexpected: true }).success).toBe(false);
    expect(contract.request.safeParse({ runId: "run-1" }).success).toBe(false);
    expect(contract.response.safeParse({ approvals: [] }).success).toBe(true);
  });
});
