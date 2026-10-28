/**
 * Workflow editor controller (D07 brief §3): owns the reducer state, the
 * service calls and the issue→node/field locate behavior. Components stay
 * presentational; everything here is testable through the reducer + service.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Dispatch } from "react";
import type { Bot, NodeType, Workflow, WorkflowDraft, WorkflowIssue } from "@deepseek-bot/contracts";
import { ServiceError } from "../../services/desktop-service.js";
import { useService } from "../../services/service-context.js";
import {
  initialEditorState,
  newWorkflowDraft,
  edgeKeyOf,
  reduceWorkflowEditor,
  type NodePosition,
  type WorkflowEditorAction,
  type WorkflowEditorState,
} from "./workflow-reducer.js";
import type { WorkflowImportResult, WorkflowSummary } from "./workflow-service.js";
import {
  deleteWorkflowTemplate,
  listWorkflowTemplates,
  MAX_WORKFLOW_TEMPLATES,
  saveWorkflowTemplate,
  type WorkflowTemplate,
} from "./template/workflow-templates.js";
import { collectIssues, inspectorFieldId } from "./validation/issues.js";
import { t } from "../../i18n.js";

/** Drop id/revision so an imported/copied draft saves as a brand-new workflow. */
export function stripRevision(draft: WorkflowDraft): WorkflowDraft {
  const { id: _id, revision: _revision, ...rest } = draft;
  return rest;
}

function workflowToDraft(
  workflow: Pick<Workflow, "name" | "schemaVersion" | "nodes" | "edges" | "limits">,
): WorkflowDraft {
  return {
    name: workflow.name,
    schemaVersion: workflow.schemaVersion,
    nodes: workflow.nodes,
    edges: workflow.edges,
    limits: workflow.limits,
  };
}

export type WorkflowEditorController = {
  state: WorkflowEditorState;
  bots: Bot[] | null;
  catalog: WorkflowSummary[];
  issues: WorkflowIssue[];
  issueCounts: Record<string, number>;
  conflict: boolean;
  busy: boolean;
  toast: string | null;
  remoteResult: { valid: boolean; count: number } | null;
  pendingConnectFrom: string | null;
  edgeDialog: { from: string; to: string } | null;
  importOpen: boolean;
  importText: string;
  importResult: WorkflowImportResult | null;
  importBusy: boolean;
  exportJson: string | null;
  templatesOpen: boolean;
  templates: WorkflowTemplate[];
  nodeEls: React.RefObject<Map<string, HTMLElement>>;
  dispatch: Dispatch<WorkflowEditorAction>;
  addNode: (nodeType: NodeType) => void;
  dropNode: (nodeType: NodeType, at: NodePosition) => void;
  connectNodes: (from: string, to: string) => void;
  confirmEdgeDialog: (outputKey: string, inputKey: string) => void;
  cancelEdgeDialog: () => void;
  keyboardConnect: (nodeId: string) => void;
  cancelPendingConnect: () => void;
  locate: (issue: WorkflowIssue) => void;
  save: () => void;
  copyWorkflow: () => void;
  newWorkflow: () => void;
  runValidate: () => void;
  selectWorkflow: (id: string) => void;
  refreshAfterConflict: () => void;
  dismissConflict: () => void;
  openImport: () => void;
  closeImport: () => void;
  setImportText: (text: string) => void;
  submitImport: () => void;
  confirmImport: () => void;
  openExport: () => void;
  closeExport: () => void;
  saveAsTemplate: () => void;
  openTemplates: () => void;
  closeTemplates: () => void;
  applyTemplate: (id: string) => void;
  removeTemplate: (id: string) => void;
  deleteSelection: () => void;
  showToast: (message: string) => void;
};

export function useWorkflowEditor(): WorkflowEditorController {
  const desktop = useService();
  const [state, dispatch] = useReducer(
    reduceWorkflowEditor,
    undefined,
    () => initialEditorState(),
  );
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [catalog, setCatalog] = useState<WorkflowSummary[]>([]);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [remoteResult, setRemoteResult] = useState<{ valid: boolean; count: number } | null>(null);
  const [pendingConnectFrom, setPendingConnectFrom] = useState<string | null>(null);
  const [edgeDialog, setEdgeDialog] = useState<{ from: string; to: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState<WorkflowImportResult | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [exportJson, setExportJson] = useState<string | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const nodeEls = useRef<Map<string, HTMLElement>>(new Map());

  const showToast = useCallback((message: string) => {
    setToast(message);
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [list, summaries] = await Promise.all([
          desktop.bots.list(),
          desktop.workflows.list(),
        ]);
        if (!cancelled) {
          setBots(list);
          setCatalog(summaries);
        }
      } catch {
        if (!cancelled) {
          setBots([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  const refreshCatalog = useCallback(async () => {
    try {
      setCatalog(await desktop.workflows.list());
    } catch {
      /* catalog refresh is best-effort */
    }
  }, [desktop]);

  const issues = useMemo(() => collectIssues(state.draft, bots ?? []), [state.draft, bots]);
  const issueCounts = useMemo(
    () =>
      issues.reduce<Record<string, number>>((counts, issue) => {
        if (issue.nodeId !== undefined) {
          counts[issue.nodeId] = (counts[issue.nodeId] ?? 0) + 1;
        }
        return counts;
      }, {}),
    [issues],
  );

  const addNode = useCallback(
    (nodeType: NodeType) => {
      const maxX = state.draft.nodes.reduce(
        (max, node) => Math.max(max, state.positions[node.id]?.x ?? 0),
        0,
      );
      const firstActiveBot = bots?.find((bot) => bot.archivedAt === null);
      dispatch({
        type: "addNode",
        nodeType,
        at: { x: maxX + 240, y: 40 },
        botId: nodeType === "bot" ? firstActiveBot?.id : undefined,
      });
    },
    [state.draft.nodes, state.positions, bots],
  );

  const dropNode = useCallback((nodeType: NodeType, at: NodePosition) => {
    dispatch({ type: "addNode", nodeType, at });
  }, []);

  const connectNodes = useCallback((from: string, to: string) => {
    setEdgeDialog({ from, to });
  }, []);

  const confirmEdgeDialog = useCallback(
    (outputKey: string, inputKey: string) => {
      if (!edgeDialog) {
        return;
      }
      const key = edgeKeyOf({
        fromNodeId: edgeDialog.from,
        outputKey,
        toNodeId: edgeDialog.to,
        inputKey,
      });
      if (state.draft.edges.some((edge) => edgeKeyOf(edge) === key)) {
        setToast(t("workflow.edgeAlreadyExists"));
        setEdgeDialog(null);
        return;
      }
      dispatch({
        type: "addEdge",
        edge: {
          fromNodeId: edgeDialog.from,
          outputKey,
          toNodeId: edgeDialog.to,
          inputKey,
        },
      });
      setEdgeDialog(null);
    },
    [edgeDialog, state.draft.edges],
  );

  const cancelEdgeDialog = useCallback(() => setEdgeDialog(null), []);

  const keyboardConnect = useCallback(
    (nodeId: string) => {
      if (pendingConnectFrom === null) {
        setPendingConnectFrom(nodeId);
        setToast(t("workflow.connectModeHint"));
        return;
      }
      if (pendingConnectFrom === nodeId) {
        setPendingConnectFrom(null);
        return;
      }
      setEdgeDialog({ from: pendingConnectFrom, to: nodeId });
      setPendingConnectFrom(null);
    },
    [pendingConnectFrom],
  );

  const cancelPendingConnect = useCallback(() => {
    setPendingConnectFrom(null);
  }, []);

  /** Click a validation issue: select the node, scroll it into view and focus
   * the inspector field the issue points at. */
  const locate = useCallback(
    (issue: WorkflowIssue) => {
      if (issue.nodeId !== undefined) {
        dispatch({ type: "select", selection: { kind: "node", nodeId: issue.nodeId } });
        const el = nodeEls.current.get(issue.nodeId);
        if (el) {
          el.scrollIntoView({ block: "center", inline: "center" });
          el.focus({ preventScroll: true });
        }
      } else if (issue.field === "edges") {
        dispatch({ type: "select", selection: null });
      }
      const fieldId = inspectorFieldId(issue);
      if (fieldId !== null) {
        requestAnimationFrame(() => {
          document.getElementById(fieldId)?.focus({ preventScroll: true });
        });
      }
    },
    [],
  );

  const save = useCallback(() => {
    if (issues.length > 0 || busy) {
      return;
    }
    setBusy(true);
    void (async () => {
      try {
        const saved = await desktop.workflows.save(
          state.loadedFrom ? state.draft : stripRevision(state.draft),
          state.loadedFrom?.revision,
        );
        dispatch({
          type: "load",
          draft: workflowToDraft(saved),
          from: { id: saved.id, revision: saved.revision },
          positions: state.positions,
        });
        setToast(t("workflow.savedInMemoryFixture"));
        void refreshCatalog();
      } catch (error) {
        if (error instanceof ServiceError && error.code === "REVISION_CONFLICT") {
          setConflict(true);
        } else if (error instanceof ServiceError) {
          setToast(t("shell.saveFailed", [error.message]));
        } else {
          setToast(t("workflow.saveFailed"));
        }
      } finally {
        setBusy(false);
      }
    })();
  }, [issues.length, busy, desktop, state.loadedFrom, state.draft, state.positions, refreshCatalog]);

  const copyWorkflow = useCallback(() => {
    const loaded = state.loadedFrom;
    if (!loaded) {
      setToast(t("workflow.saveBeforeCopy"));
      return;
    }
    setBusy(true);
    void (async () => {
      try {
        const copy = await desktop.workflows.copy(loaded.id);
        dispatch({
          type: "load",
          draft: workflowToDraft(copy),
          from: { id: copy.id, revision: copy.revision },
        });
        setToast(t("workflow.copyCreated"));
        void refreshCatalog();
      } catch (error) {
        setToast(error instanceof ServiceError ? t("workflow.copyFailedWithReason", [error.message]) : t("shell.copyFailed"));
      } finally {
        setBusy(false);
      }
    })();
  }, [desktop, state.loadedFrom, refreshCatalog]);

  const newWorkflow = useCallback(() => {
    const firstActiveBot = bots?.find((bot) => bot.archivedAt === null);
    dispatch({ type: "load", draft: newWorkflowDraft(firstActiveBot?.id), from: null });
    setConflict(false);
    setRemoteResult(null);
    setToast(t("workflow.draftCreated"));
  }, [bots]);

  const runValidate = useCallback(() => {
    setBusy(true);
    void (async () => {
      try {
        const result = await desktop.workflows.validate(state.draft);
        setRemoteResult({ valid: result.valid, count: result.errors.length });
      } catch {
        setRemoteResult(null);
        setToast(t("workflow.validateRequestFailed"));
      } finally {
        setBusy(false);
      }
    })();
  }, [desktop, state.draft]);

  const selectWorkflow = useCallback(
    (id: string) => {
      if (!id || id === state.loadedFrom?.id) {
        return;
      }
      setBusy(true);
      void (async () => {
        try {
          const workflow = await desktop.workflows.get(id);
          dispatch({
            type: "load",
            draft: workflowToDraft(workflow),
            from: { id: workflow.id, revision: workflow.revision },
          });
          setConflict(false);
          setRemoteResult(null);
        } catch (error) {
          setToast(error instanceof ServiceError ? t("workflow.openFailedWithReason", [error.message]) : t("workflow.openFailed"));
        } finally {
          setBusy(false);
        }
      })();
    },
    [desktop, state.loadedFrom],
  );

  const refreshAfterConflict = useCallback(() => {
    const loaded = state.loadedFrom;
    if (!loaded) {
      setConflict(false);
      return;
    }
    setBusy(true);
    void (async () => {
      try {
        const workflow = await desktop.workflows.get(loaded.id);
        dispatch({
          type: "load",
          draft: workflowToDraft(workflow),
          from: { id: workflow.id, revision: workflow.revision },
        });
        setConflict(false);
        setToast(t("workflow.refreshedAfterConflict"));
      } finally {
        setBusy(false);
      }
    })();
  }, [desktop, state.loadedFrom]);

  const dismissConflict = useCallback(() => setConflict(false), []);

  const openImport = useCallback(() => {
    setImportOpen(true);
    setImportResult(null);
    setImportText("");
  }, []);

  const closeImport = useCallback(() => {
    setImportOpen(false);
    setImportResult(null);
    setImportText("");
  }, []);

  const submitImport = useCallback(() => {
    setImportBusy(true);
    void (async () => {
      try {
        let parsed: unknown;
        try {
          parsed = JSON.parse(importText);
        } catch {
          setImportResult({
            accepted: false,
            errors: [{ code: "INVALID_INPUT", message: t("workflow.invalidJsonText") }],
            errorCode: "INVALID_INPUT",
          });
          return;
        }
        setImportResult(await desktop.workflows.importTemplate(parsed));
      } finally {
        setImportBusy(false);
      }
    })();
  }, [desktop, importText]);

  const confirmImport = useCallback(() => {
    if (!importResult?.accepted || !importResult.draft) {
      return;
    }
    dispatch({ type: "load", draft: stripRevision(importResult.draft), from: null });
    setImportOpen(false);
    setImportResult(null);
    setImportText("");
    setToast(t("workflow.templateLoaded"));
  }, [importResult]);

  const openExport = useCallback(() => {
    const loaded = state.loadedFrom;
    if (!loaded) {
      setToast(t("workflow.saveBeforeExport"));
      return;
    }
    setBusy(true);
    void (async () => {
      try {
        const { workflow } = await desktop.workflows.exportTemplate(loaded.id, loaded.revision);
        const template = {
          schemaVersion: workflow.schemaVersion,
          workflow: workflowToDraft(workflow),
        };
        setExportJson(JSON.stringify(template, null, 2));
      } catch (error) {
        setToast(error instanceof ServiceError ? t("workflow.exportFailedWithReason", [error.message]) : t("workflow.exportFailed"));
      } finally {
        setBusy(false);
      }
    })();
  }, [desktop, state.loadedFrom]);

  const closeExport = useCallback(() => setExportJson(null), []);

  /**
   * G11': the local template shelf. Saving stores the schema-normalized
   * draft (contract-invalid drafts are refused); applying loads it back as
   * an unsaved draft — the same inert path as template import. No id/revision
   * is carried over, so applying never hijacks another workflow's identity.
   */
  const saveAsTemplate = useCallback(() => {
    const result = saveWorkflowTemplate(window.localStorage, {
      name: state.draft.name,
      workflow: state.draft,
    });
    if (result.ok) {
      setToast(t("workflow.templateSaved"));
      return;
    }
    setToast(
      result.reason === "limit"
        ? t("workflow.templateSaveLimit", [MAX_WORKFLOW_TEMPLATES])
        : result.reason === "duplicate"
          ? t("workflow.templateDuplicateName")
          : t("workflow.templateSaveInvalid"),
    );
  }, [state.draft]);

  const openTemplates = useCallback(() => {
    setTemplates(listWorkflowTemplates(window.localStorage));
    setTemplatesOpen(true);
  }, []);

  const closeTemplates = useCallback(() => setTemplatesOpen(false), []);

  const applyTemplate = useCallback(
    (id: string) => {
      const template = templates.find((item) => item.id === id);
      if (template === undefined) {
        return;
      }
      dispatch({ type: "load", draft: template.workflow, from: null });
      setTemplatesOpen(false);
      setConflict(false);
      setRemoteResult(null);
      setToast(t("workflow.templateLoaded"));
    },
    [templates],
  );

  const removeTemplate = useCallback((id: string) => {
    setTemplates(deleteWorkflowTemplate(window.localStorage, id));
  }, []);

  const deleteSelection = useCallback(() => {
    if (state.selection?.kind === "node") {
      dispatch({ type: "removeNode", nodeId: state.selection.nodeId });
    } else if (state.selection?.kind === "edge") {
      dispatch({ type: "removeEdge", edgeKey: state.selection.edgeKey });
    }
  }, [state.selection]);

  // Canvas-wide keyboard: Delete removes the selection, Esc cancels a pending
  // connect. Never fire while typing in a field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (typing) {
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && state.selection) {
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (event.key === "Escape" && pendingConnectFrom !== null) {
        setPendingConnectFrom(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.selection, deleteSelection, pendingConnectFrom]);

  return {
    state,
    bots,
    catalog,
    issues,
    issueCounts,
    conflict,
    busy,
    toast,
    remoteResult,
    pendingConnectFrom,
    edgeDialog,
    importOpen,
    importText,
    importResult,
    importBusy,
    exportJson,
    templatesOpen,
    templates,
    nodeEls,
    dispatch,
    addNode,
    dropNode,
    connectNodes,
    confirmEdgeDialog,
    cancelEdgeDialog,
    keyboardConnect,
    cancelPendingConnect,
    locate,
    save,
    copyWorkflow,
    newWorkflow,
    runValidate,
    selectWorkflow,
    refreshAfterConflict,
    dismissConflict,
    openImport,
    closeImport,
    setImportText,
    submitImport,
    confirmImport,
    openExport,
    closeExport,
    saveAsTemplate,
    openTemplates,
    closeTemplates,
    applyTemplate,
    removeTemplate,
    deleteSelection,
    showToast,
  };
}
