/**
 * Host-backed WorkflowService (D07 wire-up): same editor-facing API as the
 * fixture, but every call goes through the contract bridge to the real Host
 * (packages/host handlers) and through the storage repository.
 *
 * Boundary rules kept by this layer:
 * - every response is re-parsed with the contract's Zod response schema, so a
 *   drifted Host payload fails here instead of leaking into the editor;
 * - copy reuses the editor's id remapping (duplicateDraft) and then saves a
 *   brand-new document — the Host never clones;
 * - import stays lazy like the editor brief requires: the template is
 *   validated through `workflow.validate` and handed back as a draft, and it is
 *   never persisted by this call. The Host's `workflow.import` *does* persist,
 *   so the editor path deliberately does not use it (see the wiring report).
 */
import {
  METHOD_CONTRACTS,
  WORKFLOW_SCHEMA_VERSION,
  WorkflowDraftSchema,
  isWithinMessageSizeLimit,
  validateWorkflowDraft,
  type ErrorCode,
  type Workflow,
  type WorkflowDraft,
  type WorkflowIssue,
} from "@deepseek-bot/contracts";
import { t } from "../i18n.js";
import {
  duplicateDraft,
  schemaIssuesToWorkflowIssues,
  type WorkflowImportResult,
  type WorkflowServiceApi,
  type WorkflowSummary,
} from "../features/workflow-editor/workflow-service.js";
import type { HostCall } from "./host-call.js";

function invalid(message: string, field?: string): WorkflowImportResult {
  const issue: WorkflowIssue = { code: "INVALID_INPUT", message };
  if (field !== undefined) {
    issue.field = field;
  }
  return { accepted: false, errors: [issue], errorCode: "INVALID_INPUT" };
}

export function createHostWorkflowService(call: HostCall): WorkflowServiceApi {
  const list = async (): Promise<WorkflowSummary[]> => {
    const parsed = METHOD_CONTRACTS["workflow.list"].response.parse(
      await call("workflow.list", {}),
    );
    return parsed.workflows;
  };

  const get = async (id: string): Promise<Workflow> =>
    METHOD_CONTRACTS["workflow.get"].response.parse(await call("workflow.get", { id }));

  const save = async (
    draft: WorkflowDraft,
    expectedRevision?: string,
  ): Promise<Workflow> => {
    const payload: { workflow: WorkflowDraft; expectedRevision?: string } = {
      workflow: draft,
    };
    if (expectedRevision !== undefined) {
      payload.expectedRevision = expectedRevision;
    }
    return METHOD_CONTRACTS["workflow.save"].response.parse(
      await call("workflow.save", payload),
    );
  };

  const validate = async (
    draft: unknown,
  ): Promise<{ valid: boolean; errors: WorkflowIssue[] }> =>
    METHOD_CONTRACTS["workflow.validate"].response.parse(
      await call("workflow.validate", { workflow: draft }),
    );

  return {
    list,

    get,

    save,

    async copy(id) {
      const source = await get(id);
      const { draft } = duplicateDraft(source);
      return save(draft);
    },

    validate,

    async exportTemplate(id, expectedRevision) {
      return METHOD_CONTRACTS["workflow.export"].response.parse(
        await call("workflow.export", { id, expectedRevision }),
      );
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
      const localErrors = validateWorkflowDraft(parsed.data);
      if (localErrors.length > 0) {
        return { accepted: false, errors: localErrors, errorCode: localErrors[0]!.code };
      }
      const remote = await validate(parsed.data);
      if (!remote.valid) {
        const errorCode: ErrorCode = remote.errors[0]?.code ?? "INVALID_INPUT";
        return { accepted: false, errors: remote.errors, errorCode };
      }
      return { accepted: true, errors: [], draft: parsed.data };
    },
  };
}
