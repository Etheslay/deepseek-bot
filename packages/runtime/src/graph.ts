/**
 * Snapshot graph helpers (docs/CONTRACTS.md §2 Workflow/Edge).
 *
 * The engine always executes the immutable run snapshot, never the live
 * workflow row (CONTRACTS §2: 快照不可变). Dependencies, incoming edges and
 * the transitive-descendant closure are precomputed once per run; descendants
 * drive the stop-descendants failure policy and retry validation.
 */
import type { Workflow, WorkflowEdge, WorkflowNode } from "@deepseek-bot/contracts";

export interface SnapshotGraph {
  /** Node ids in snapshot declaration order — dispatch is deterministic. */
  readonly nodeOrder: readonly string[];
  readonly nodes: ReadonlyMap<string, WorkflowNode>;
  /** Deduplicated predecessor ids per node, in snapshot order. */
  readonly dependencies: ReadonlyMap<string, readonly string[]>;
  /** All edges targeting a node, in snapshot order. */
  readonly incomingEdges: ReadonlyMap<string, readonly WorkflowEdge[]>;
  /** Transitive closure of strict descendants per node, in snapshot order. */
  readonly descendants: ReadonlyMap<string, readonly string[]>;
}

export function buildSnapshotGraph(workflow: Workflow): SnapshotGraph {
  const nodes = new Map<string, WorkflowNode>();
  for (const node of workflow.nodes) {
    nodes.set(node.id, node);
  }
  const orderIndex = nodeOrderIndex(nodes);

  const dependencySets = new Map<string, Set<string>>();
  const incomingEdges = new Map<string, WorkflowEdge[]>();
  const directSuccessors = new Map<string, Set<string>>();
  for (const node of workflow.nodes) {
    dependencySets.set(node.id, new Set());
    incomingEdges.set(node.id, []);
    directSuccessors.set(node.id, new Set());
  }
  for (const edge of workflow.edges) {
    dependencySets.get(edge.toNodeId)?.add(edge.fromNodeId);
    incomingEdges.get(edge.toNodeId)?.push(edge);
    directSuccessors.get(edge.fromNodeId)?.add(edge.toNodeId);
  }

  const dependencies = new Map<string, readonly string[]>();
  for (const [nodeId, set] of dependencySets) {
    dependencies.set(nodeId, sortByOrder([...set], orderIndex));
  }

  return {
    nodeOrder: workflow.nodes.map((node) => node.id),
    nodes,
    dependencies,
    incomingEdges,
    descendants: transitiveDescendants(directSuccessors, orderIndex),
  };
}

function sortByOrder(
  nodeIds: string[],
  orderIndex: ReadonlyMap<string, number>,
): string[] {
  return nodeIds.sort(
    (a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0),
  );
}

function nodeOrderIndex(
  nodes: ReadonlyMap<string, WorkflowNode>,
): ReadonlyMap<string, number> {
  const index = new Map<string, number>();
  let i = 0;
  for (const nodeId of nodes.keys()) {
    index.set(nodeId, i);
    i += 1;
  }
  return index;
}

/**
 * Transitive closure per node; contract graphs are bounded at 500 nodes, so
 * the memoized expansion stays small and deterministic.
 */
function transitiveDescendants(
  directSuccessors: ReadonlyMap<string, Set<string>>,
  orderIndex: ReadonlyMap<string, number>,
): ReadonlyMap<string, readonly string[]> {
  const cache = new Map<string, Set<string>>();
  const closureOf = (nodeId: string): Set<string> => {
    const cached = cache.get(nodeId);
    if (cached !== undefined) {
      return cached;
    }
    const closure = new Set<string>();
    cache.set(nodeId, closure);
    const stack = [...(directSuccessors.get(nodeId) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop();
      if (next === undefined || closure.has(next)) {
        continue;
      }
      closure.add(next);
      stack.push(...(directSuccessors.get(next) ?? []));
    }
    return closure;
  };
  for (const nodeId of directSuccessors.keys()) {
    closureOf(nodeId);
  }
  const result = new Map<string, readonly string[]>();
  for (const [nodeId, closure] of cache) {
    result.set(nodeId, sortByOrder([...closure], orderIndex));
  }
  return result;
}
