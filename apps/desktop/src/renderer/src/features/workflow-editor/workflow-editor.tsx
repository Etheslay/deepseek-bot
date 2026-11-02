/**
 * Workflow editor root (D07 brief §3.1). Toolbar / palette / canvas /
 * inspector / validation panel composition plus the edge-key, import and
 * export dialogs and the revision-conflict banner.
 */
import { useCallback, type JSX } from "react";
import { CustomSelect } from "../../components/custom-select.js";
import { useWorkflowEditor } from "./use-workflow-editor.js";
import type { WorkflowNodePatch } from "./workflow-reducer.js";
import { EdgeKeyDialog, WorkflowCanvas } from "./canvas/workflow-canvas.js";
import { InspectorPanel } from "./inspector/node-inspector.js";
import { ValidationPanel } from "./validation/validation-panel.js";
import { ExportDialog, ImportDialog, TemplateLibraryDialog } from "./template/template-io.js";
import { t } from "../../i18n.js";

export function WorkflowEditor(props: { onClose: () => void }): JSX.Element {
  const editor = useWorkflowEditor();
  const { state, dispatch } = editor;
  const canSave = editor.issues.length === 0 && !editor.busy;
  const saveTitle =
    editor.issues.length > 0 ? t("workflow.validationBlockSave", [editor.issues.length]) : undefined;

  const onUpdateNode = useCallback(
    (nodeId: string, patch: WorkflowNodePatch) => {
      dispatch({ type: "updateNode", nodeId, patch });
    },
    [dispatch],
  );

  const registerNodeEl = useCallback(
    (nodeId: string, el: HTMLElement | null) => {
      if (el) {
        editor.nodeEls.current.set(nodeId, el);
      } else {
        editor.nodeEls.current.delete(nodeId);
      }
    },
    [editor.nodeEls],
  );

  const edgeDialogTarget = state.draft.nodes.find((node) => node.id === editor.edgeDialog?.to);
  const defaultInputKey =
    edgeDialogTarget?.inputBindings.find((binding) => binding.required)?.inputKey ??
    edgeDialogTarget?.inputBindings[0]?.inputKey ??
    "in";

  return (
    <div className="wf-editor">
      <header className="wf-toolbar">
        <button type="button" className="ghost-btn" onClick={props.onClose}>
          {t("workflow.backToChat")}
        </button>
        <span className="wf-toolbar-divider" aria-hidden="true" />
        <span className="wf-catalog">
          <CustomSelect
            value={state.loadedFrom?.id ?? ""}
            options={[
              { value: "", label: state.loadedFrom ? state.draft.name : t("workflow.unsavedDraft") },
              ...editor.catalog
                .filter((entry) => entry.id !== state.loadedFrom?.id)
                .map((entry) => ({ value: entry.id, label: entry.name })),
            ]}
            onChange={editor.selectWorkflow}
            ariaLabel={t("workflow.selectWorkflow")}
          />
        </span>
        <span className="wf-toolbar-actions">
          <button type="button" className="ghost-btn" onClick={editor.newWorkflow}>
            {t("workflow.newWorkflow")}
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={!canSave}
            title={saveTitle}
            onClick={editor.save}
          >
            {t("shell.save")}{editor.issues.length > 0 ? t("workflow.errorCountSuffix", [editor.issues.length]) : ""}
          </button>
          <button type="button" className="ghost-btn" onClick={editor.copyWorkflow}>
            {t("shell.copy")}
          </button>
          <button type="button" className="ghost-btn" onClick={editor.openImport}>
            {t("skills.import")}
          </button>
          <button type="button" className="ghost-btn" onClick={editor.openExport}>
            {t("skills.export")}
          </button>
          <button type="button" className="ghost-btn" onClick={editor.saveAsTemplate}>
            {t("workflow.saveAsTemplate")}
          </button>
          <button type="button" className="ghost-btn" onClick={editor.openTemplates}>
            {t("workflow.templateLibrary")}
          </button>
        </span>
      </header>

      {editor.conflict && (
        <div className="wf-conflict" role="alert">
          <span>
            {t("workflow.revisionConflictBanner")}
          </span>
          <span className="wf-conflict-actions">
            <button type="button" className="primary-btn" onClick={editor.refreshAfterConflict}>
              {t("workflow.refreshAndRetry")}
            </button>
            <button type="button" className="ghost-btn" onClick={editor.dismissConflict}>
              {t("workflow.later")}
            </button>
          </span>
        </div>
      )}

      <div className="wf-body">
        <aside className="wf-palette" aria-label={t("workflow.nodePalette")}>
          <div className="wf-palette-title">{t("workflow.node")}</div>
          <button
            type="button"
            className="wf-palette-item"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("application/x-wf-node", "bot");
              event.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => editor.addNode("bot")}
          >
            <span className="wf-palette-badge bot">Bot</span>
            <span>{t("workflow.botNode")}</span>
          </button>
          <button
            type="button"
            className="wf-palette-item"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("application/x-wf-node", "approval");
              event.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => editor.addNode("approval")}
          >
            <span className="wf-palette-badge approval">{t("runs.approval")}</span>
            <span>{t("workflow.manualApprovalNode")}</span>
          </button>
        </aside>

        <WorkflowCanvas
          state={state}
          bots={editor.bots ?? []}
          issueCounts={editor.issueCounts}
          pendingConnectFrom={editor.pendingConnectFrom}
          onSelect={(selection) => dispatch({ type: "select", selection })}
          onMoveNode={(nodeId, to) => dispatch({ type: "moveNode", nodeId, to })}
          onConnect={editor.connectNodes}
          onDropNode={editor.dropNode}
          onKeyboardConnect={editor.keyboardConnect}
          registerNodeEl={registerNodeEl}
        />

        <aside className="wf-inspector-wrap" aria-label={t("workflow.parameterInspector")}>
          <InspectorPanel
            state={state}
            bots={editor.bots}
            issues={editor.issues}
            callbacks={{
              onUpdateNode,
              onAddBinding: (nodeId) => dispatch({ type: "addBinding", nodeId }),
              onUpdateBinding: (nodeId, index, patch) =>
                dispatch({ type: "updateBinding", nodeId, index, patch }),
              onRemoveBinding: (nodeId, index) => dispatch({ type: "removeBinding", nodeId, index }),
              onUpdateMeta: (patch) => dispatch({ type: "updateMeta", patch }),
              onUpdateEdge: (edgeKey, patch) => dispatch({ type: "updateEdge", edgeKey, patch }),
              onRemoveEdge: (edgeKey) => dispatch({ type: "removeEdge", edgeKey }),
            }}
          />
        </aside>
      </div>

      <ValidationPanel
        issues={editor.issues}
        remoteResult={editor.remoteResult}
        onValidate={editor.runValidate}
        onLocate={editor.locate}
      />

      {editor.edgeDialog && (
        <EdgeKeyDialog
          from={editor.edgeDialog.from}
          to={editor.edgeDialog.to}
          defaultInputKey={defaultInputKey}
          onCancel={editor.cancelEdgeDialog}
          onConfirm={editor.confirmEdgeDialog}
        />
      )}

      {editor.importOpen && (
        <ImportDialog
          text={editor.importText}
          result={editor.importResult}
          busy={editor.importBusy}
          onTextChange={editor.setImportText}
          onSubmit={editor.submitImport}
          onConfirm={editor.confirmImport}
          onCancel={editor.closeImport}
        />
      )}

      {editor.exportJson !== null && (
        <ExportDialog
          json={editor.exportJson}
          workflowName={state.draft.name}
          onCopy={async (text) => {
            await navigator.clipboard.writeText(text);
          }}
          onClose={editor.closeExport}
        />
      )}

      {editor.templatesOpen && (
        <TemplateLibraryDialog
          templates={editor.templates}
          onApply={editor.applyTemplate}
          onDelete={editor.removeTemplate}
          onClose={editor.closeTemplates}
        />
      )}

      {editor.toast && (
        <div className="toast" role="status">
          {editor.toast}
        </div>
      )}
    </div>
  );
}
