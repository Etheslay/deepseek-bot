/**
 * Workflow graph validation (docs/CONTRACTS.md §2 Workflow/Node/Edge, §3
 * workflow.validate, §6 WORKFLOW_CYCLE / MISSING_BINDING / INVALID_INPUT).
 *
 * Structural (schema-level) issues surface as INVALID_INPUT here; graph
 * issues are reported with the offending node/field so editors can locate
 * them. Validation is deterministic: issues are sorted, so tests and UIs
 * see stable output. Import/save flows must run this before persisting;
 * the Host re-validates before execution.
 */
import { z } from "zod";
import type { WorkflowDraft, WorkflowEdge, WorkflowNode } from "./entities.js";

export const WORKFLOW_ISSUE_CODES = [
  "INVALID_INPUT",
  "WORKFLOW_CYCLE",
  "MISSING_BINDING",
] as const;

export type WorkflowIssueCode = (typeof WORKFLOW_ISSUE_CODES)[number];

export const WorkflowIssueSchema = z.object({
  code: z.enum(WORKFLOW_ISSUE_CODES),
  message: z.string().min(1).max(2_000),
  nodeId: z.string().optional(),
  field: z.string().optional(),
});

export type WorkflowIssue = z.infer<typeof WorkflowIssueSchema>;

export function validateWorkflowGraph(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];

  issues.push(...duplicateNodeIssues(nodes));
  issues.push(...duplicateEdgeIssues(edges));
  issues.push(...danglingEdgeIssues(nodes, edges));
  issues.push(...unboundInputIssues(nodes, edges));
  issues.push(...cycleIssues(nodes, edges));

  return sortIssues(issues);
}

function duplicateNodeIssues(nodes: readonly WorkflowNode[]): WorkflowIssue[] {
  const seen = new Set<string>();
  const issues: WorkflowIssue[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) {
      issues.push({
        code: "INVALID_INPUT",
        message: `duplicate node id: ${node.id}`,
        nodeId: node.id,
        field: "id",
      });
    }
    seen.add(node.id);
  }
  return issues;
}

function duplicateEdgeIssues(edges: readonly WorkflowEdge[]): WorkflowIssue[] {
  const seen = new Set<string>();
  const issues: WorkflowIssue[] = [];
  for (const edge of edges) {
    const key = `${edge.fromNodeId}(${edge.outputKey})->${edge.toNodeId}(${edge.inputKey})`;
    if (seen.has(key)) {
      issues.push({
        code: "INVALID_INPUT",
        message: `duplicate edge: ${key}`,
        nodeId: edge.fromNodeId,
        field: "edges",
      });
    }
    seen.add(key);
  }
  return issues;
}

function danglingEdgeIssues(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): WorkflowIssue[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const issues: WorkflowIssue[] = [];
  for (const edge of edges) {
    if (!nodeIds.has(edge.fromNodeId)) {
      issues.push({
        code: "MISSING_BINDING",
        message: `edge references unknown source node: ${edge.fromNodeId}`,
        nodeId: edge.fromNodeId,
        field: "fromNodeId",
      });
    }
    if (!nodeIds.has(edge.toNodeId)) {
      issues.push({
        code: "MISSING_BINDING",
        message: `edge references unknown target node: ${edge.toNodeId}`,
        nodeId: edge.toNodeId,
        field: "toNodeId",
      });
    }
  }
  return issues;
}

/**
 * Required input bindings must be supplied by an edge; optional bindings
 * may arrive from edges too but are not demanded.
 */
function unboundInputIssues(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): WorkflowIssue[] {
  const supplied = new Set(
    edges.map((edge) => `${edge.toNodeId}(${edge.inputKey})`),
  );
  const issues: WorkflowIssue[] = [];
  for (const node of nodes) {
    for (const binding of node.inputBindings) {
      if (binding.required && !supplied.has(`${node.id}(${binding.inputKey})`)) {
        issues.push({
          code: "MISSING_BINDING",
          message: `required input '${binding.inputKey}' of node '${node.id}' has no incoming edge`,
          nodeId: node.id,
          field: `inputBindings.${binding.inputKey}`,
        });
      }
    }
  }
  return issues;
}

/**
 * Iterative depth-first search with white/grey/black marking; a back edge
 * to a grey node means a cycle. Reports the cycle path so the editor can
 * highlight it.
 */
function cycleIssues(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): WorkflowIssue[] {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.fromNodeId)?.push(edge.toNodeId);
  }

  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(nodes.map((node) => [node.id, WHITE]));
  const parent = new Map<string, string | null>();
  const issues: WorkflowIssue[] = [];

  const reportCycle = (start: string): void => {
    const path: string[] = [start];
    let cursor: string | null = parent.get(start) ?? null;
    while (cursor !== null && cursor !== start) {
      path.unshift(cursor);
      cursor = parent.get(cursor) ?? null;
    }
    issues.push({
      code: "WORKFLOW_CYCLE",
      message: `workflow graph contains a cycle: ${path.join(" -> ")}`,
      nodeId: path[0],
      field: "edges",
    });
  };

  for (const node of nodes) {
    if ((color.get(node.id) ?? WHITE) !== WHITE) {
      continue;
    }
    const stack: { nodeId: string; edgeIndex: number }[] = [
      { nodeId: node.id, edgeIndex: 0 },
    ];
    color.set(node.id, GREY);
    parent.set(node.id, null);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) {
        break;
      }
      const successors = adjacency.get(frame.nodeId) ?? [];
      if (frame.edgeIndex >= successors.length) {
        color.set(frame.nodeId, BLACK);
        stack.pop();
        continue;
      }
      const next = successors[frame.edgeIndex];
      frame.edgeIndex += 1;
      if (next === undefined) {
        continue;
      }
      const nextColor = color.get(next) ?? WHITE;
      if (nextColor === GREY) {
        parent.set(next, frame.nodeId);
        reportCycle(next);
        continue;
      }
      if (nextColor === WHITE) {
        parent.set(next, frame.nodeId);
        color.set(next, GREY);
        stack.push({ nodeId: next, edgeIndex: 0 });
      }
    }
  }

  return issues;
}

function sortIssues(issues: WorkflowIssue[]): WorkflowIssue[] {
  return [...issues].sort((a, b) => {
    if (a.code !== b.code) {
      return a.code.localeCompare(b.code);
    }
    const nodeA = a.nodeId ?? "";
    const nodeB = b.nodeId ?? "";
    if (nodeA !== nodeB) {
      return nodeA.localeCompare(nodeB);
    }
    return a.message.localeCompare(b.message);
  });
}

/** Convenience wrapper: validate a draft end to end. */
export function validateWorkflowDraft(
  draft: WorkflowDraft,
): WorkflowIssue[] {
  return validateWorkflowGraph(draft.nodes, draft.edges);
}
