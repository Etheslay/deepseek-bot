import { describe, expect, it } from "vitest";
import type { Bot, WorkflowDraft } from "@deepseek-bot/contracts";
import cycleFixture from "@deepseek-bot/contracts/fixtures/workflow-cycle.json";
import missingBindingFixture from "@deepseek-bot/contracts/fixtures/workflow-missing-binding.json";
import {
  collectIssues,
  editorRuleIssues,
  groupIssuesByNode,
  inspectorFieldId,
} from "../../src/renderer/src/features/workflow-editor/validation/issues.js";
import {
  activeBotOptions,
  archivedBotOption,
} from "../../src/renderer/src/features/workflow-editor/inspector/node-inspector.js";

const BOT_A = "11111111-1111-4111-8111-111111111111";
const BOT_B = "12121212-1212-4121-8121-121212121212";

const LIVE_BOT: Bot = {
  id: BOT_A,
  revision: "22222222-2222-4222-8222-222222222222",
  name: "note-summarizer",
  instructions: "You summarize notes.",
  modelProfileId: "44444444-4444-4444-8444-444444444444",
  workspaceId: "55555555-5555-4555-8555-555555555555",
  toolPolicyId: "66666666-6666-4666-8666-666666666666",
  archivedAt: null,
};

const ARCHIVED_BOT: Bot = {
  ...LIVE_BOT,
  id: BOT_B,
  revision: "33333333-3333-4333-8333-333333333333",
  name: "legacy-bot",
  archivedAt: "2026-10-01T00:00:00Z",
};

const cycleDraft = cycleFixture.interactions[0]!.envelope.payload
  .workflow as unknown as WorkflowDraft;
const missingBindingDraft = missingBindingFixture.interactions[0]!.envelope.payload
  .workflow as unknown as WorkflowDraft;

describe("collectIssues (schema + contracts graph + editor rules)", () => {
  it("surfaces WORKFLOW_CYCLE located on a cycle node (fixture-driven)", () => {
    const issues = collectIssues(cycleDraft, [LIVE_BOT, ARCHIVED_BOT]);
    const cycle = issues.find((issue) => issue.code === "WORKFLOW_CYCLE");
    expect(cycle).toBeDefined();
    expect(cycle!.field).toBe("edges");
    expect(cycle!.nodeId).toBeOneOf(["n1", "n2"]);
  });

  it("surfaces MISSING_BINDING with nodeId + inputBindings.<key> (fixture-driven)", () => {
    const issues = collectIssues(missingBindingDraft, [LIVE_BOT, ARCHIVED_BOT]);
    const binding = issues.find((issue) => issue.code === "MISSING_BINDING");
    expect(binding).toMatchObject({ nodeId: "n2", field: "inputBindings.topic" });
  });

  it("flags a bot node whose bot got archived (save must be blocked)", () => {
    const draft: WorkflowDraft = {
      name: "d",
      schemaVersion: "0.1",
      nodes: [
        {
          id: "n1",
          type: "bot",
          botId: BOT_B,
          instructionTemplate: "",
          inputBindings: [],
          retryPolicy: { maxRetries: 0 },
        },
      ],
      edges: [],
      limits: { maxConcurrentNodes: 2 },
    };
    const issues = editorRuleIssues(draft, [LIVE_BOT, ARCHIVED_BOT]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "INVALID_INPUT",
      nodeId: "n1",
      field: "botId",
    });
    expect(issues[0]!.message).toContain("legacy-bot");
  });

  it("flags unknown bot ids and missing bot selection", () => {
    const unknown: WorkflowDraft = {
      name: "d",
      schemaVersion: "0.1",
      nodes: [
        {
          id: "x",
          type: "bot",
          botId: "99999999-9999-4999-8999-999999999999",
          instructionTemplate: "",
          inputBindings: [],
          retryPolicy: { maxRetries: 0 },
        },
        {
          id: "y",
          type: "bot",
          instructionTemplate: "",
          inputBindings: [],
          retryPolicy: { maxRetries: 0 },
        },
      ],
      edges: [],
      limits: { maxConcurrentNodes: 2 },
    };
    const issues = editorRuleIssues(unknown, [LIVE_BOT]);
    expect(issues).toHaveLength(2);
    expect(issues.some((issue) => issue.nodeId === "x" && issue.message.includes("不存在"))).toBe(true);
    expect(issues.some((issue) => issue.nodeId === "y" && issue.message.includes("尚未选择"))).toBe(true);
  });

  it("flags duplicate inputBinding keys per node", () => {
    const draft: WorkflowDraft = {
      name: "d",
      schemaVersion: "0.1",
      nodes: [
        {
          id: "n1",
          type: "approval",
          instructionTemplate: "",
          inputBindings: [
            { inputKey: "topic", required: true },
            { inputKey: "topic", required: false },
          ],
          retryPolicy: { maxRetries: 0 },
        },
      ],
      edges: [],
      limits: { maxConcurrentNodes: 2 },
    };
    const issues = collectIssues(draft, []);
    expect(issues.some((issue) => issue.field === "inputBindings.topic")).toBe(true);
  });

  it("returns zero issues for a fully valid draft", () => {
    const draft: WorkflowDraft = {
      name: "ok",
      schemaVersion: "0.1",
      nodes: [
        {
          id: "n1",
          type: "bot",
          botId: BOT_A,
          instructionTemplate: "step",
          inputBindings: [],
          retryPolicy: { maxRetries: 0 },
        },
      ],
      edges: [],
      limits: { maxConcurrentNodes: 2 },
    };
    expect(collectIssues(draft, [LIVE_BOT, ARCHIVED_BOT])).toEqual([]);
  });
});

describe("issue grouping and focus mapping", () => {
  it("groups issues by node with workflow-level first key ''", () => {
    const groups = groupIssuesByNode([
      { code: "WORKFLOW_CYCLE", message: "a", nodeId: "n2", field: "edges" },
      { code: "INVALID_INPUT", message: "name needed" },
      { code: "MISSING_BINDING", message: "b", nodeId: "n1", field: "inputBindings.topic" },
    ]);
    expect(groups.map((group) => group.nodeId)).toEqual(["", "n1", "n2"]);
    expect(groups[0]!.issues).toHaveLength(1);
  });

  it("maps fields to inspector element ids", () => {
    expect(inspectorFieldId({ code: "INVALID_INPUT", message: "", nodeId: "n1", field: "botId" })).toBe(
      "wf-insp-botId",
    );
    expect(
      inspectorFieldId({ code: "MISSING_BINDING", message: "", nodeId: "n1", field: "inputBindings.topic" }),
    ).toBe("wf-insp-binding-topic");
    expect(inspectorFieldId({ code: "INVALID_INPUT", message: "", field: "name" })).toBe("wf-insp-name");
    // graph issues point at the node itself; there is no single field to focus
    expect(
      inspectorFieldId({ code: "WORKFLOW_CYCLE", message: "", nodeId: "n1", field: "edges" }),
    ).toBeNull();
  });
});

describe("bot picker options (archived bots are not selectable)", () => {
  it("offers only live bots", () => {
    const options = activeBotOptions([LIVE_BOT, ARCHIVED_BOT]);
    expect(options).toEqual([{ value: BOT_A, label: "note-summarizer" }]);
  });

  it("shows an already-selected archived bot as a labelled non-option entry", () => {
    expect(activeBotOptions([ARCHIVED_BOT])).toEqual([]);
    expect(archivedBotOption([LIVE_BOT, ARCHIVED_BOT], BOT_B)).toEqual({
      value: BOT_B,
      label: "legacy-bot（已归档）",
    });
    expect(archivedBotOption([LIVE_BOT, ARCHIVED_BOT], BOT_A)).toBeNull();
  });
});
