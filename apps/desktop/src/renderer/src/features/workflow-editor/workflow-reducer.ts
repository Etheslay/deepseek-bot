/**
 * Pure editor state transforms (D07 brief §4). No React, no service calls —
 * fully unit-testable. Positions and selection are UI state and deliberately
 * stay OUT of any contract type: only `draft` ever reaches the service layer.
 */
import {
  WORKFLOW_SCHEMA_VERSION,
  type NodeType,
  type WorkflowDraft,
  type WorkflowEdge,
  type WorkflowNode,
} from "@deepseek-bot/contracts";

export type NodePosition = { x: number; y: number };

export type EdgeSelectionRef = { kind: "edge"; edgeKey: string };
export type NodeSelectionRef = { kind: "node"; nodeId: string };
export type EditorSelection = NodeSelectionRef | EdgeSelectionRef | null;

/** Identity of an edge: identical to the graph validator's duplicate key. */
export function edgeKeyOf(edge: WorkflowEdge): string {
  return `${edge.fromNodeId}(${edge.outputKey})->${edge.toNodeId}(${edge.inputKey})`;
}

export type WorkflowEditorState = {
  draft: WorkflowDraft;
  positions: Record<string, NodePosition>;
  selection: EditorSelection;
  /** Saved workflow this draft was loaded from; null when unsaved. */
  loadedFrom: { id: string; revision: string } | null;
  /** Monotonic counter for human-readable node ids. */
  nodeSeq: number;
};

export type WorkflowNodePatch = {
  /** Only applied to bot nodes; approval nodes must never carry botId. */
  botId?: string;
  instructionTemplate?: string;
  /** null clears the optional timeout. */
  timeoutSeconds?: number | null;
  retryMaxRetries?: number;
};

export type WorkflowEditorAction =
  | {
      type: "load";
      draft: WorkflowDraft;
      from: { id: string; revision: string } | null;
      positions?: Record<string, NodePosition>;
    }
  | { type: "addNode"; nodeType: NodeType; at: NodePosition; botId?: string | undefined }
  | { type: "moveNode"; nodeId: string; to: NodePosition }
  | { type: "removeNode"; nodeId: string }
  | { type: "updateNode"; nodeId: string; patch: WorkflowNodePatch }
  | { type: "addBinding"; nodeId: string }
  | { type: "updateBinding"; nodeId: string; index: number; patch: { inputKey?: string; required?: boolean } }
  | { type: "removeBinding"; nodeId: string; index: number }
  | { type: "addEdge"; edge: WorkflowEdge }
  | { type: "removeEdge"; edgeKey: string }
  | { type: "updateEdge"; edgeKey: string; patch: { outputKey?: string; inputKey?: string } }
  | { type: "select"; selection: EditorSelection }
  | { type: "updateMeta"; patch: { name?: string; maxConcurrentNodes?: number } };

/** Grid layout for drafts without stored positions (imports, loads, copies). */
export function autoLayout(draft: WorkflowDraft): Record<string, NodePosition> {
  const positions: Record<string, NodePosition> = {};
  draft.nodes.forEach((node, index) => {
    positions[node.id] = {
      x: 48 + (index % 4) * 232,
      y: 40 + Math.floor(index / 4) * 150,
    };
  });
  return positions;
}

/** Minimal valid starter draft: one bot node bound to the first live bot. */
export function newWorkflowDraft(botId?: string): WorkflowDraft {
  const node: WorkflowNode = {
    id: "n1",
    type: "bot",
    instructionTemplate: "",
    inputBindings: [],
    retryPolicy: { maxRetries: 0 },
  };
  if (botId !== undefined) {
    node.botId = botId;
  }
  return {
    name: "未命名工作流",
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    nodes: [node],
    edges: [],
    limits: { maxConcurrentNodes: 2 },
  };
}

export function initialEditorState(botId?: string): WorkflowEditorState {
  const draft = newWorkflowDraft(botId);
  return {
    draft,
    positions: autoLayout(draft),
    selection: null,
    loadedFrom: null,
    nodeSeq: 1,
  };
}

function nextNodeId(state: WorkflowEditorState): { id: string; nodeSeq: number } {
  const used = new Set(state.draft.nodes.map((node) => node.id));
  let seq = state.nodeSeq;
  let id = `n${seq}`;
  while (used.has(id)) {
    seq += 1;
    id = `n${seq}`;
  }
  return { id, nodeSeq: seq + 1 };
}

function selectionStillValid(
  selection: EditorSelection,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): EditorSelection {
  if (selection === null) {
    return null;
  }
  if (selection.kind === "node") {
    return nodes.some((node) => node.id === selection.nodeId) ? selection : null;
  }
  return edges.some((edge) => edgeKeyOf(edge) === selection.edgeKey) ? selection : null;
}

export function reduceWorkflowEditor(
  state: WorkflowEditorState,
  action: WorkflowEditorAction,
): WorkflowEditorState {
  switch (action.type) {
    case "load": {
      const positions = action.positions ?? autoLayout(action.draft);
      return {
        draft: action.draft,
        positions,
        selection: null,
        loadedFrom: action.from,
        nodeSeq: action.draft.nodes.length,
      };
    }
    case "addNode": {
      const { id, nodeSeq } = nextNodeId(state);
      const node: WorkflowNode = {
        id,
        type: action.nodeType,
        instructionTemplate: "",
        inputBindings: [],
        retryPolicy: { maxRetries: 0 },
      };
      // The contract forbids botId on approval nodes; never set it there.
      if (action.nodeType === "bot" && action.botId !== undefined) {
        node.botId = action.botId;
      }
      return {
        ...state,
        draft: { ...state.draft, nodes: [...state.draft.nodes, node] },
        positions: { ...state.positions, [id]: action.at },
        selection: { kind: "node", nodeId: id },
        nodeSeq,
      };
    }
    case "moveNode": {
      return {
        ...state,
        positions: { ...state.positions, [action.nodeId]: action.to },
      };
    }
    case "removeNode": {
      const nodes = state.draft.nodes.filter((node) => node.id !== action.nodeId);
      if (nodes.length === state.draft.nodes.length) {
        return state;
      }
      // A draft needs at least one node (WorkflowDraftSchema min(1)); deleting
      // the last node would produce an unpersistable draft, so keep it and let
      // validation flag whatever is wrong instead of breaking the invariant.
      if (nodes.length === 0) {
        return state;
      }
      const edges = state.draft.edges.filter(
        (edge) => edge.fromNodeId !== action.nodeId && edge.toNodeId !== action.nodeId,
      );
      const positions = { ...state.positions };
      delete positions[action.nodeId];
      return {
        ...state,
        draft: { ...state.draft, nodes, edges },
        positions,
        selection: selectionStillValid(state.selection, nodes, edges),
      };
    }
    case "updateNode": {
      const nodes = state.draft.nodes.map((node): WorkflowNode => {
        if (node.id !== action.nodeId) {
          return node;
        }
        const patch = action.patch;
        const next: WorkflowNode = {
          ...node,
          inputBindings: node.inputBindings.map((binding) => ({ ...binding })),
        };
        if (patch.botId !== undefined && node.type === "bot") {
          next.botId = patch.botId;
        }
        if (patch.instructionTemplate !== undefined) {
          next.instructionTemplate = patch.instructionTemplate;
        }
        if (patch.timeoutSeconds !== undefined) {
          if (patch.timeoutSeconds === null) {
            delete next.timeoutSeconds;
          } else {
            next.timeoutSeconds = patch.timeoutSeconds;
          }
        }
        if (patch.retryMaxRetries !== undefined) {
          next.retryPolicy = { maxRetries: patch.retryMaxRetries };
        }
        return next;
      });
      return { ...state, draft: { ...state.draft, nodes } };
    }
    case "addBinding": {
      const nodes = state.draft.nodes.map((node) => {
        if (node.id !== action.nodeId) {
          return node;
        }
        const used = new Set(node.inputBindings.map((binding) => binding.inputKey));
        let index = node.inputBindings.length + 1;
        let key = `input${index}`;
        while (used.has(key)) {
          index += 1;
          key = `input${index}`;
        }
        return {
          ...node,
          inputBindings: [...node.inputBindings, { inputKey: key, required: true }],
        };
      });
      return { ...state, draft: { ...state.draft, nodes } };
    }
    case "updateBinding": {
      const nodes = state.draft.nodes.map((node) => {
        if (node.id !== action.nodeId) {
          return node;
        }
        const inputBindings = node.inputBindings.map((binding, index) =>
          index === action.index ? { ...binding, ...action.patch } : { ...binding },
        );
        return { ...node, inputBindings };
      });
      return { ...state, draft: { ...state.draft, nodes } };
    }
    case "removeBinding": {
      const nodes = state.draft.nodes.map((node) => {
        if (node.id !== action.nodeId) {
          return node;
        }
        return {
          ...node,
          inputBindings: node.inputBindings.filter((_, index) => index !== action.index),
        };
      });
      return { ...state, draft: { ...state.draft, nodes } };
    }
    case "addEdge": {
      if (state.draft.edges.some((edge) => edgeKeyOf(edge) === edgeKeyOf(action.edge))) {
        return state;
      }
      const edges = [...state.draft.edges, action.edge];
      return {
        ...state,
        draft: { ...state.draft, edges },
        selection: { kind: "edge", edgeKey: edgeKeyOf(action.edge) },
      };
    }
    case "removeEdge": {
      const edges = state.draft.edges.filter((edge) => edgeKeyOf(edge) !== action.edgeKey);
      if (edges.length === state.draft.edges.length) {
        return state;
      }
      return {
        ...state,
        draft: { ...state.draft, edges },
        selection: selectionStillValid(state.selection, state.draft.nodes, edges),
      };
    }
    case "updateEdge": {
      let newKey: string | null = null;
      const edges = state.draft.edges.map((edge) => {
        if (edgeKeyOf(edge) !== action.edgeKey) {
          return edge;
        }
        const next: WorkflowEdge = {
          ...edge,
          outputKey: action.patch.outputKey ?? edge.outputKey,
          inputKey: action.patch.inputKey ?? edge.inputKey,
        };
        newKey = edgeKeyOf(next);
        return next;
      });
      if (newKey !== null && state.selection?.kind === "edge" && state.selection.edgeKey === action.edgeKey) {
        return {
          ...state,
          draft: { ...state.draft, edges },
          selection: { kind: "edge", edgeKey: newKey },
        };
      }
      return { ...state, draft: { ...state.draft, edges } };
    }
    case "select": {
      return { ...state, selection: action.selection };
    }
    case "updateMeta": {
      const patch = action.patch;
      const draft: WorkflowDraft = { ...state.draft };
      if (patch.name !== undefined) {
        draft.name = patch.name;
      }
      if (patch.maxConcurrentNodes !== undefined) {
        draft.limits = { ...draft.limits, maxConcurrentNodes: patch.maxConcurrentNodes };
      }
      return { ...state, draft };
    }
  }
}
