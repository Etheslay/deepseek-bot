import { describe, expect, it } from "vitest";
import {
  autoLayout,
  edgeKeyOf,
  initialEditorState,
  newWorkflowDraft,
  reduceWorkflowEditor,
} from "../../src/renderer/src/features/workflow-editor/workflow-reducer.js";
import { duplicateDraft } from "../../src/renderer/src/features/workflow-editor/workflow-service.js";
import type { WorkflowDraft } from "@deepseek-bot/contracts";

const BOT_A = "11111111-1111-4111-8111-111111111111";
const BOT_B = "12121212-1212-4121-8121-121212121212";

function twoNodeDraft(): WorkflowDraft {
  return {
    name: "draft",
    schemaVersion: "0.1",
    nodes: [
      {
        id: "n1",
        type: "bot",
        botId: BOT_A,
        instructionTemplate: "one",
        inputBindings: [],
        retryPolicy: { maxRetries: 0 },
      },
      {
        id: "n2",
        type: "bot",
        botId: BOT_B,
        instructionTemplate: "two",
        inputBindings: [],
        retryPolicy: { maxRetries: 0 },
      },
    ],
    edges: [],
    limits: { maxConcurrentNodes: 2 },
  };
}

describe("workflow-reducer", () => {
  it("creates a minimal starter draft with one bot node", () => {
    const draft = newWorkflowDraft(BOT_A);
    expect(draft.nodes).toHaveLength(1);
    expect(draft.nodes[0]).toMatchObject({ id: "n1", type: "bot", botId: BOT_A });
    expect(draft.limits).toEqual({ maxConcurrentNodes: 2 });
  });

  it("initialEditorState lays out nodes and starts unsaved", () => {
    const state = initialEditorState(BOT_A);
    expect(state.loadedFrom).toBeNull();
    expect(state.selection).toBeNull();
    expect(state.positions.n1).toEqual(autoLayout(state.draft).n1);
  });

  it("addNode(bot) carries a botId; addNode(approval) never carries one", () => {
    let state = initialEditorState();
    state = reduceWorkflowEditor(state, {
      type: "addNode",
      nodeType: "bot",
      at: { x: 0, y: 0 },
      botId: BOT_A,
    });
    expect(state.draft.nodes[1]).toMatchObject({ type: "bot", botId: BOT_A });
    expect(state.selection).toEqual({ kind: "node", nodeId: "n2" });

    state = reduceWorkflowEditor(state, {
      type: "addNode",
      nodeType: "approval",
      at: { x: 0, y: 0 },
      botId: BOT_A,
    });
    const approval = state.draft.nodes[2]!;
    expect(approval.type).toBe("approval");
    expect("botId" in approval).toBe(false);
  });

  it("addNode generates ids that never collide with existing ones", () => {
    let state = initialEditorState();
    // load a draft whose node already claims n2
    const seeded: WorkflowDraft = {
      ...twoNodeDraft(),
      nodes: [
        twoNodeDraft().nodes[0]!,
        { ...twoNodeDraft().nodes[1]!, id: "n2" },
      ],
    };
    state = reduceWorkflowEditor(state, { type: "load", draft: seeded, from: null });
    state = reduceWorkflowEditor(state, {
      type: "addNode",
      nodeType: "bot",
      at: { x: 0, y: 0 },
    });
    const ids = state.draft.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("n3");
  });

  it("moveNode only touches positions", () => {
    let state = initialEditorState();
    state = reduceWorkflowEditor(state, { type: "moveNode", nodeId: "n1", to: { x: 320, y: 240 } });
    expect(state.positions.n1).toEqual({ x: 320, y: 240 });
    expect(state.draft.nodes).toHaveLength(1);
  });

  it("removeNode also removes attached edges and prunes the selection", () => {
    let state = initialEditorState();
    state = reduceWorkflowEditor(state, { type: "load", draft: twoNodeDraft(), from: null });
    state = reduceWorkflowEditor(state, {
      type: "addEdge",
      edge: { fromNodeId: "n1", outputKey: "out", toNodeId: "n2", inputKey: "in" },
    });
    expect(state.draft.edges).toHaveLength(1);

    state = reduceWorkflowEditor(state, { type: "select", selection: { kind: "node", nodeId: "n2" } });
    state = reduceWorkflowEditor(state, { type: "removeNode", nodeId: "n2" });
    expect(state.draft.nodes.map((node) => node.id)).toEqual(["n1"]);
    expect(state.draft.edges).toHaveLength(0);
    expect(state.selection).toBeNull();
    expect(state.positions.n2).toBeUndefined();
  });

  it("refuses to remove the last node (schema needs 1..500)", () => {
    let state = initialEditorState();
    state = reduceWorkflowEditor(state, { type: "removeNode", nodeId: "n1" });
    expect(state.draft.nodes).toHaveLength(1);
  });

  it("updateNode patches bot fields and clears timeout with null", () => {
    let state = initialEditorState();
    state = reduceWorkflowEditor(state, {
      type: "updateNode",
      nodeId: "n1",
      patch: { botId: BOT_A, instructionTemplate: "hello {{input}}", timeoutSeconds: 60 },
    });
    expect(state.draft.nodes[0]).toMatchObject({
      botId: BOT_A,
      instructionTemplate: "hello {{input}}",
      timeoutSeconds: 60,
    });

    state = reduceWorkflowEditor(state, {
      type: "updateNode",
      nodeId: "n1",
      patch: { timeoutSeconds: null },
    });
    expect("timeoutSeconds" in state.draft.nodes[0]!).toBe(false);
  });

  it("updateNode never sets botId on an approval node", () => {
    let state = initialEditorState();
    state = reduceWorkflowEditor(state, {
      type: "addNode",
      nodeType: "approval",
      at: { x: 0, y: 0 },
    });
    state = reduceWorkflowEditor(state, {
      type: "updateNode",
      nodeId: "n2",
      patch: { botId: BOT_A },
    });
    expect("botId" in state.draft.nodes[1]!).toBe(false);
  });

  it("inputBindings can be added, edited and removed", () => {
    let state = initialEditorState();
    state = reduceWorkflowEditor(state, { type: "addBinding", nodeId: "n1" });
    expect(state.draft.nodes[0]!.inputBindings).toEqual([{ inputKey: "input1", required: true }]);

    state = reduceWorkflowEditor(state, {
      type: "updateBinding",
      nodeId: "n1",
      index: 0,
      patch: { inputKey: "topic", required: false },
    });
    expect(state.draft.nodes[0]!.inputBindings).toEqual([{ inputKey: "topic", required: false }]);

    state = reduceWorkflowEditor(state, { type: "removeBinding", nodeId: "n1", index: 0 });
    expect(state.draft.nodes[0]!.inputBindings).toHaveLength(0);
  });

  it("addEdge ignores exact duplicates and selects new edges", () => {
    const edge = { fromNodeId: "n1", outputKey: "out", toNodeId: "n2", inputKey: "in" };
    let state = initialEditorState();
    state = reduceWorkflowEditor(state, { type: "load", draft: twoNodeDraft(), from: null });
    state = reduceWorkflowEditor(state, { type: "addEdge", edge });
    expect(state.selection).toEqual({ kind: "edge", edgeKey: edgeKeyOf(edge) });

    state = reduceWorkflowEditor(state, { type: "addEdge", edge });
    expect(state.draft.edges).toHaveLength(1);
  });

  it("updateEdge re-keys the edge and the selection follows", () => {
    let state = initialEditorState();
    state = reduceWorkflowEditor(state, { type: "load", draft: twoNodeDraft(), from: null });
    state = reduceWorkflowEditor(state, {
      type: "addEdge",
      edge: { fromNodeId: "n1", outputKey: "out", toNodeId: "n2", inputKey: "in" },
    });
    const selected = state.selection;
    const oldKey = selected !== null && selected.kind === "edge" ? selected.edgeKey : "";
    state = reduceWorkflowEditor(state, {
      type: "updateEdge",
      edgeKey: oldKey,
      patch: { outputKey: "summary", inputKey: "topic" },
    });
    expect(state.draft.edges[0]).toMatchObject({ outputKey: "summary", inputKey: "topic" });
    expect(state.selection).toEqual({
      kind: "edge",
      edgeKey: 'n1(summary)->n2(topic)',
    });
  });

  it("removeEdge drops the edge and clears a selection pointing at it", () => {
    const edge = { fromNodeId: "n1", outputKey: "out", toNodeId: "n2", inputKey: "in" };
    let state = initialEditorState();
    state = reduceWorkflowEditor(state, { type: "load", draft: twoNodeDraft(), from: null });
    state = reduceWorkflowEditor(state, { type: "addEdge", edge });
    state = reduceWorkflowEditor(state, { type: "removeEdge", edgeKey: edgeKeyOf(edge) });
    expect(state.draft.edges).toHaveLength(0);
    expect(state.selection).toBeNull();
  });

  it("updateMeta edits workflow name and limits", () => {
    let state = initialEditorState();
    state = reduceWorkflowEditor(state, {
      type: "updateMeta",
      patch: { name: "renamed", maxConcurrentNodes: 4 },
    });
    expect(state.draft.name).toBe("renamed");
    expect(state.draft.limits.maxConcurrentNodes).toBe(4);
  });
});

describe("duplicateDraft (copy with id remapping)", () => {
  it("remaps node ids, rewires edges, keeps limits and adds the 副本 suffix", () => {
    const draft = twoNodeDraft();
    draft.edges.push({ fromNodeId: "n1", outputKey: "out", toNodeId: "n2", inputKey: "in" });
    const { draft: copy, idMap } = duplicateDraft(draft);

    expect(copy.name).toBe("draft 副本");
    expect(idMap).toEqual({ n1: "n1-copy", n2: "n2-copy" });
    expect(copy.nodes.map((node) => node.id)).toEqual(["n1-copy", "n2-copy"]);
    expect(copy.edges[0]).toMatchObject({ fromNodeId: "n1-copy", toNodeId: "n2-copy" });
    expect(copy.limits).toEqual({ maxConcurrentNodes: 2 });
    // inputBindings/retryPolicy are deep-copied, not shared references
    expect(copy.nodes[0]!.retryPolicy).not.toBe(draft.nodes[0]!.retryPolicy);
  });
});
