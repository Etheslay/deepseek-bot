import { describe, expect, it } from "vitest";
import { WorkflowEdgeSchema, WorkflowNodeSchema } from "./entities.js";
import {
  validateWorkflowGraph,
  type WorkflowIssue,
} from "./workflow.js";

function botNode(id: string, botId: string) {
  return WorkflowNodeSchema.parse({
    id,
    type: "bot",
    botId,
    instructionTemplate: "Do things.",
  });
}

function approvalNode(id: string) {
  return WorkflowNodeSchema.parse({
    id,
    type: "approval",
    instructionTemplate: "Approve?",
  });
}

function edge(
  fromNodeId: string,
  toNodeId: string,
  outputKey = "out",
  inputKey = "in",
) {
  return WorkflowEdgeSchema.parse({ fromNodeId, outputKey, toNodeId, inputKey });
}

const BOT_A = "11111111-1111-4111-8111-111111111111";
const BOT_B = "12121212-1212-4121-8121-121212121212";

function codes(issues: WorkflowIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

describe("validateWorkflowGraph", () => {
  it("accepts a simple acyclic graph", () => {
    const issues = validateWorkflowGraph(
      [botNode("n1", BOT_A), botNode("n2", BOT_B)],
      [edge("n1", "n2")],
    );
    expect(issues).toEqual([]);
  });

  it("reports duplicate node ids", () => {
    const issues = validateWorkflowGraph(
      [botNode("n1", BOT_A), botNode("n1", BOT_B)],
      [],
    );
    expect(codes(issues)).toContain("INVALID_INPUT");
    const duplicate = issues.find((issue) => issue.code === "INVALID_INPUT");
    expect(duplicate?.nodeId).toBe("n1");
    expect(duplicate?.field).toBe("id");
  });

  it("reports duplicate edges", () => {
    const issues = validateWorkflowGraph(
      [botNode("n1", BOT_A), botNode("n2", BOT_B)],
      [edge("n1", "n2"), edge("n1", "n2")],
    );
    expect(codes(issues)).toContain("INVALID_INPUT");
    const duplicate = issues.find((issue) => issue.code === "INVALID_INPUT");
    expect(duplicate?.nodeId).toBe("n1");
    expect(duplicate?.field).toBe("edges");
  });

  it("reports edges referencing unknown nodes as MISSING_BINDING", () => {
    const issues = validateWorkflowGraph(
      [botNode("n1", BOT_A)],
      [edge("n1", "ghost"), edge("phantom", "n1")],
    );
    const dangling = issues.filter((issue) => issue.code === "MISSING_BINDING");
    expect(dangling).toHaveLength(2);
    expect(dangling.map((issue) => issue.field)).toEqual([
      "toNodeId",
      "fromNodeId",
    ]);
  });

  it("detects a two-node cycle", () => {
    const issues = validateWorkflowGraph(
      [botNode("n1", BOT_A), botNode("n2", BOT_B)],
      [edge("n1", "n2"), edge("n2", "n1")],
    );
    const cycles = issues.filter((issue) => issue.code === "WORKFLOW_CYCLE");
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.nodeId).toBeDefined();
    expect(cycles[0]?.message).toContain("cycle");
  });

  it("detects a self-loop cycle", () => {
    const issues = validateWorkflowGraph(
      [botNode("n1", BOT_A)],
      [edge("n1", "n1")],
    );
    const cycles = issues.filter((issue) => issue.code === "WORKFLOW_CYCLE");
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.nodeId).toBe("n1");
  });

  it("detects a cycle nested inside an otherwise valid graph", () => {
    const issues = validateWorkflowGraph(
      [
        botNode("start", BOT_A),
        approvalNode("gate"),
        botNode("a", BOT_B),
        botNode("b", BOT_A),
      ],
      [
        edge("start", "gate"),
        edge("gate", "a"),
        edge("a", "b"),
        edge("b", "a"),
      ],
    );
    const cycles = issues.filter((issue) => issue.code === "WORKFLOW_CYCLE");
    expect(cycles).toHaveLength(1);
    expect(issues.every((issue) => issue.code !== "MISSING_BINDING")).toBe(
      true,
    );
  });

  it("reports required inputs without incoming edges as MISSING_BINDING", () => {
    const n2 = WorkflowNodeSchema.parse({
      id: "n2",
      type: "bot",
      botId: BOT_B,
      instructionTemplate: "Write about {{topic}}.",
      inputBindings: [
        { inputKey: "topic", required: true },
        { inputKey: "hint", required: false },
      ],
    });
    const issues = validateWorkflowGraph(
      [botNode("n1", BOT_A), n2],
      [edge("n1", "n2", "out", "hint")],
    );
    const unbound = issues.filter((issue) => issue.code === "MISSING_BINDING");
    expect(unbound).toHaveLength(1);
    expect(unbound[0]?.nodeId).toBe("n2");
    expect(unbound[0]?.field).toBe("inputBindings.topic");
  });

  it("returns deterministic, sorted output", () => {
    const nodes = [botNode("n1", BOT_A), botNode("n1", BOT_A)];
    const edges = [edge("n1", "ghost"), edge("n1", "ghost")];
    const first = validateWorkflowGraph(nodes, edges);
    const second = validateWorkflowGraph(nodes, edges);
    expect(first).toEqual(second);
    const sorted = [...first].sort(
      (a, b) =>
        a.code.localeCompare(b.code) ||
        (a.nodeId ?? "").localeCompare(b.nodeId ?? "") ||
        a.message.localeCompare(b.message),
    );
    expect(first).toEqual(sorted);
  });
});
