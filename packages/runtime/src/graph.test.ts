import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Workflow, WorkflowEdge, WorkflowNode } from "@deepseek-bot/contracts";
import { buildSnapshotGraph } from "./graph.js";
import { approvalNode, botNode } from "./test-support.js";

function makeWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): Workflow {
  return {
    id: randomUUID(),
    revision: randomUUID(),
    name: "graph test",
    schemaVersion: "0.1",
    nodes,
    edges,
    limits: { maxConcurrentNodes: 2 },
  };
}

describe("buildSnapshotGraph", () => {
  it("keeps snapshot declaration order and node lookup", () => {
    const botId = randomUUID();
    const workflow = makeWorkflow(
      [botNode("a", botId), botNode("b", botId), approvalNode("gate")],
      [],
    );
    const graph = buildSnapshotGraph(workflow);
    expect(graph.nodeOrder).toEqual(["a", "b", "gate"]);
    expect(graph.nodes.get("gate")?.type).toBe("approval");
  });

  it("deduplicates dependencies from multiple edges of one predecessor", () => {
    const botId = randomUUID();
    const workflow = makeWorkflow(
      [botNode("a", botId), botNode("b", botId)],
      [
        { fromNodeId: "a", outputKey: "x", toNodeId: "b", inputKey: "x" },
        { fromNodeId: "a", outputKey: "y", toNodeId: "b", inputKey: "y" },
      ],
    );
    const graph = buildSnapshotGraph(workflow);
    expect(graph.dependencies.get("b")).toEqual(["a"]);
    expect(graph.incomingEdges.get("b")).toHaveLength(2);
  });

  it("computes the transitive descendant closure", () => {
    const botId = randomUUID();
    const workflow = makeWorkflow(
      [botNode("a", botId), botNode("b", botId), botNode("c", botId), botNode("d", botId)],
      [
        { fromNodeId: "a", outputKey: "o", toNodeId: "b", inputKey: "i" },
        { fromNodeId: "b", outputKey: "o", toNodeId: "d", inputKey: "i" },
        { fromNodeId: "a", outputKey: "o", toNodeId: "c", inputKey: "i" },
        { fromNodeId: "c", outputKey: "o", toNodeId: "d", inputKey: "i" },
      ],
    );
    const graph = buildSnapshotGraph(workflow);
    // Diamond: a → (b, c) → d, descendants in declaration order.
    expect(graph.descendants.get("a")).toEqual(["b", "c", "d"]);
    expect(graph.descendants.get("b")).toEqual(["d"]);
    expect(graph.descendants.get("c")).toEqual(["d"]);
    expect(graph.descendants.get("d")).toEqual([]);
    expect(graph.dependencies.get("d")).toEqual(["b", "c"]);
  });
});
