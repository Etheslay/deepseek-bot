/**
 * WorkflowService (D07 brief §4): editor-facing API for the workflow.*
 * method contracts. The fixture implementation is in-memory session state —
 * persistence (D04), execution (D06), scheduling (D10) and approval runs
 * (D09) are NOT wired here and must not be implied as done.
 *
 * Boundary rules kept by this layer:
 * - every returned Workflow passes WorkflowSchema before it leaves;
 * - save re-validates and refuses "带病保存";
 * - import checks template.schemaVersion first, then workflow.schemaVersion,
 *   rejects unknown versions with DATA_VERSION_UNSUPPORTED *before* graph
 *   validation, never executes template content and never grants any
 *   permission (templates stay inert data).
 */
import {
  TEXT_LIMITS,
  WORKFLOW_SCHEMA_VERSION,
  WorkflowDraftSchema,
  WorkflowSchema,
  isWithinMessageSizeLimit,
  validateWorkflowDraft,
  type ErrorCode,
  type Workflow,
  type WorkflowDraft,
  type WorkflowIssue,
} from "@deepseek-bot/contracts";
import { ServiceError } from "../../services/desktop-service.js";
import { t } from "../../i18n.js";

export type WorkflowSummary = {
  id: string;
  revision: string;
  name: string;
};

/** Import result mirrors workflow.import plus the parsed draft for the canvas. */
export type WorkflowImportResult = {
  accepted: boolean;
  errors: WorkflowIssue[];
  errorCode?: ErrorCode;
  /** Present only when accepted; already passed WorkflowDraftSchema + graph validation. */
  draft?: WorkflowDraft;
};

export interface WorkflowServiceApi {
  list(): Promise<WorkflowSummary[]>;
  get(id: string): Promise<Workflow>;
  /**
   * Create (no draft.id) or update (draft.id + matching expectedRevision).
   * Throws ServiceError("REVISION_CONFLICT") when the revision moved; never
   * overwrites the newer revision.
   */
  save(draft: WorkflowDraft, expectedRevision?: string): Promise<Workflow>;
  /** New id/revision, name gets a "副本" suffix, node ids are remapped. */
  copy(id: string): Promise<Workflow>;
  validate(draft: WorkflowDraft): Promise<{ valid: boolean; errors: WorkflowIssue[] }>;
  exportTemplate(
    id: string,
    expectedRevision: string,
  ): Promise<{ workflow: Workflow; exportedAt: string }>;
  importTemplate(template: unknown): Promise<WorkflowImportResult>;
}

type ZodIssueLike = { path: PropertyKey[]; message: string };

/**
 * Map schema issues onto WorkflowIssue so failures locate a node + field:
 * path ["nodes", 1, "botId"] → nodeId of nodes[1], field "botId". Refinement
 * messages on the node object carry no field path; botId rules are the only
 * ones today, so infer that field from the message text.
 */
export function schemaIssuesToWorkflowIssues(
  issues: ZodIssueLike[],
  draft: unknown,
): WorkflowIssue[] {
  const nodes = (draft as { nodes?: { id?: string }[] } | null)?.nodes;
  return issues.map((issue) => {
    const path = issue.path.map((segment) => String(segment));
    let nodeId: string | undefined;
    let field: string | undefined;
    if (path[0] === "nodes") {
      const index = Number(path[1]);
      const candidate = Number.isInteger(index) ? nodes?.[index]?.id : undefined;
      nodeId = candidate;
      field = path.length > 2 ? path.slice(2).join(".") : undefined;
    } else {
      field = path.join(".") || undefined;
    }
    if (field === undefined && issue.message.includes("botId")) {
      field = "botId";
    }
    const located: WorkflowIssue = {
      code: "INVALID_INPUT",
      message: issue.message,
    };
    if (nodeId !== undefined) {
      located.nodeId = nodeId;
    }
    if (field !== undefined) {
      located.field = field;
    }
    return located;
  });
}

function invalid(message: string, field?: string): WorkflowImportResult {
  const issue: WorkflowIssue = { code: "INVALID_INPUT", message };
  if (field !== undefined) {
    issue.field = field;
  }
  return { accepted: false, errors: [issue], errorCode: "INVALID_INPUT" };
}

function truncated(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

/** Copy with fresh ids: node ids remapped so two copies never collide. */
export function duplicateDraft(source: WorkflowDraft): {
  draft: WorkflowDraft;
  idMap: Record<string, string>;
} {
  const idMap: Record<string, string> = {};
  for (const node of source.nodes) {
    idMap[node.id] = truncated(`${node.id}-copy`, TEXT_LIMITS.label);
  }
  const nodes = source.nodes.map((node) => ({
    ...node,
    inputBindings: node.inputBindings.map((binding) => ({ ...binding })),
    retryPolicy: { ...node.retryPolicy },
    id: idMap[node.id]!,
  }));
  const edges = source.edges.map((edge) => ({
    ...edge,
    fromNodeId: idMap[edge.fromNodeId] ?? edge.fromNodeId,
    toNodeId: idMap[edge.toNodeId] ?? edge.toNodeId,
  }));
  const draft: WorkflowDraft = {
    name: truncated(t("common.copyOf", [source.name]), TEXT_LIMITS.name),
    schemaVersion: source.schemaVersion,
    nodes,
    edges,
    limits: { ...source.limits },
  };
  return { draft, idMap };
}

function isoNow(): string {
  return new Date().toISOString();
}

const SEED_WORKFLOW: Workflow = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  revision: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "sample-review-flow",
  schemaVersion: WORKFLOW_SCHEMA_VERSION,
  nodes: [
    {
      id: "draft-bot",
      type: "bot",
      botId: "11111111-1111-4111-8111-111111111111",
      instructionTemplate: "Summarize the draft and emit a review.",
      inputBindings: [],
      retryPolicy: { maxRetries: 0 },
    },
    {
      id: "human-approve",
      type: "approval",
      instructionTemplate: "Approve the summary before delivery.",
      inputBindings: [{ inputKey: "summary", required: true }],
      retryPolicy: { maxRetries: 0 },
    },
  ],
  edges: [
    {
      fromNodeId: "draft-bot",
      outputKey: "summary",
      toNodeId: "human-approve",
      inputKey: "summary",
    },
  ],
  limits: { maxConcurrentNodes: 2 },
};

/**
 * FixtureWorkflowService: in-memory store seeded with the shared fixture IDs
 * (Bot A from the D03 fixture table). Graph fixtures (workflow-cycle.json /
 * workflow-missing-binding.json) are consumed by tests, not stored here.
 */
export function createFixtureWorkflowService(): WorkflowServiceApi {
  let store: Workflow[] = [WorkflowSchema.parse(SEED_WORKFLOW)];

  const find = (id: string): Workflow => {
    const stored = store.find((workflow) => workflow.id === id);
    if (!stored) {
      throw new ServiceError("INVALID_INPUT", `workflow not found: ${id}`);
    }
    return stored;
  };

  const parseDraft = (draft: WorkflowDraft): WorkflowDraft => {
    const parsed = WorkflowDraftSchema.safeParse(draft);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ServiceError(
        "INVALID_INPUT",
        `draft failed schema: ${issue ? `${issue.path.join(".")}: ${issue.message}` : "unknown"}`,
      );
    }
    return parsed.data;
  };

  return {
    async list() {
      return store.map(({ id, revision, name }) => ({ id, revision, name }));
    },

    async get(id) {
      return WorkflowSchema.parse(find(id));
    },

    async save(draft, expectedRevision) {
      const clean = parseDraft(draft);
      const issues = validateWorkflowDraft(clean);
      if (issues.length > 0) {
        throw new ServiceError(
          issues[0]!.code,
          `draft has ${issues.length} validation issue(s): ${issues
            .map((issue) => issue.message)
            .join("; ")}`,
        );
      }
      if (clean.id !== undefined) {
        const stored = find(clean.id);
        if (expectedRevision === undefined || expectedRevision !== stored.revision) {
          throw new ServiceError(
            "REVISION_CONFLICT",
            "workflow was modified elsewhere; refresh and retry",
          );
        }
        const saved: Workflow = WorkflowSchema.parse({
          ...clean,
          id: stored.id,
          revision: crypto.randomUUID(),
        });
        store = store.map((workflow) => (workflow.id === saved.id ? saved : workflow));
        return saved;
      }
      const saved: Workflow = WorkflowSchema.parse({
        ...clean,
        id: crypto.randomUUID(),
        revision: crypto.randomUUID(),
      });
      store = [...store, saved];
      return saved;
    },

    async copy(id) {
      const source = find(id);
      const { draft } = duplicateDraft(source);
      const copy: Workflow = WorkflowSchema.parse({
        ...draft,
        id: crypto.randomUUID(),
        revision: crypto.randomUUID(),
      });
      store = [...store, copy];
      return copy;
    },

    async validate(draft) {
      const parsed = WorkflowDraftSchema.safeParse(draft);
      if (!parsed.success) {
        return { valid: false, errors: schemaIssuesToWorkflowIssues(parsed.error.issues, draft) };
      }
      const errors = validateWorkflowDraft(parsed.data);
      return { valid: errors.length === 0, errors };
    },

    async exportTemplate(id, expectedRevision) {
      const stored = find(id);
      if (stored.revision !== expectedRevision) {
        throw new ServiceError(
          "REVISION_CONFLICT",
          "workflow was modified elsewhere; refresh and retry",
        );
      }
      return { workflow: WorkflowSchema.parse(stored), exportedAt: isoNow() };
    },

    async importTemplate(template): Promise<WorkflowImportResult> {
      if (!isWithinMessageSizeLimit(template)) {
        return invalid(t("workflow.templateTooLarge"));
      }
      if (typeof template !== "object" || template === null) {
        return invalid(t("workflow.templateMustBeObject"), "schemaVersion");
      }
      const outer = template as { schemaVersion?: unknown; workflow?: unknown };
      if (typeof outer.schemaVersion !== "string") {
        return invalid(t("workflow.templateSchemaVersion"), "schemaVersion");
      }
      if (outer.schemaVersion !== WORKFLOW_SCHEMA_VERSION) {
        // Unknown (higher or otherwise unsupported) version: refuse before
        // any schema/graph parsing so unknown fields never become data.
        return { accepted: false, errors: [], errorCode: "DATA_VERSION_UNSUPPORTED" };
      }
      const inner = outer.workflow;
      if (typeof inner !== "object" || inner === null) {
        return invalid(t("workflow.templateWorkflowObject"), "workflow");
      }
      const innerVersion = (inner as { schemaVersion?: unknown }).schemaVersion;
      if (innerVersion !== WORKFLOW_SCHEMA_VERSION) {
        if (typeof innerVersion !== "string") {
          return invalid(t("workflow.workflowSchemaVersion"), "workflow.schemaVersion");
        }
        return { accepted: false, errors: [], errorCode: "DATA_VERSION_UNSUPPORTED" };
      }
      const parsed = WorkflowDraftSchema.safeParse(inner);
      if (!parsed.success) {
        return {
          accepted: false,
          errors: schemaIssuesToWorkflowIssues(parsed.error.issues, inner),
          errorCode: "INVALID_INPUT",
        };
      }
      const errors = validateWorkflowDraft(parsed.data);
      if (errors.length > 0) {
        return { accepted: false, errors, errorCode: errors[0]!.code };
      }
      return { accepted: true, errors: [], draft: parsed.data };
    },
  };
}
