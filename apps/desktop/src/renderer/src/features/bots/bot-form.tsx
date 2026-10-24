/**
 * Bot create/edit form (D05 brief §2.1 机器人工作区).
 *
 * Validation runs the real `BotSchema` from contracts on the assembled
 * entity; issues are mapped back to form fields so errors point at the
 * exact input (D5-3: 非法输入被拒并定位字段).
 */
import { useState, type JSX } from "react";
import { validateBot } from "../../services/contract-validation.js";
import type { BotDraft } from "../../services/desktop-service.js";

const MODEL_OPTIONS = [
  { id: "44444444-4444-4444-8444-444444444444", label: "DeepSeek · deepseek-chat" },
];

const WORKSPACE_OPTIONS = [
  { id: "55555555-5555-4555-8555-555555555555", label: "工作区 A（样例）" },
  { id: "55555555-5555-4555-8555-555555555556", label: "工作区 B（样例）" },
];

const TOOL_POLICY_OPTIONS = [
  { id: "66666666-6666-4666-8666-666666666666", label: "默认工具策略（只读）" },
];

export type FieldErrors = Partial<Record<keyof BotDraft, string>>;

export function validateBotDraft(draft: BotDraft): FieldErrors {
  const entity = {
    id: crypto.randomUUID(),
    revision: crypto.randomUUID(),
    archivedAt: null,
    ...draft,
  };
  const checked = validateBot(entity);
  if (checked.ok) {
    return {};
  }
  const errors: FieldErrors = {};
  for (const issue of checked.issues) {
    const field = issue.path[0] as keyof BotDraft | undefined;
    if (field && !errors[field]) {
      errors[field] = issue.message;
    }
  }
  return errors;
}

export function BotForm(
  props: {
    initial?: { name: string; instructions: string; modelProfileId: string; workspaceId: string; toolPolicyId: string };
    submitLabel: string;
    onSubmit: (draft: BotDraft) => Promise<{ ok: boolean; errorCode?: string }>;
    onCancel: () => void;
  },
): JSX.Element {
  const [draft, setDraft] = useState<BotDraft>(
    props.initial ?? {
      name: "",
      instructions: "",
      modelProfileId: MODEL_OPTIONS[0]!.id,
      workspaceId: WORKSPACE_OPTIONS[0]!.id,
      toolPolicyId: TOOL_POLICY_OPTIONS[0]!.id,
    },
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (field: keyof BotDraft, value: string): void => {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const submit = async (): Promise<void> => {
    const errors = validateBotDraft(draft);
    if (Object.values(errors).some(Boolean)) {
      setFieldErrors(errors);
      return;
    }
    setBusy(true);
    setSubmitError(null);
    const result = await props.onSubmit(draft);
    setBusy(false);
    if (!result.ok) {
      setSubmitError(
        result.errorCode === "REVISION_CONFLICT"
          ? "保存冲突：机器人已被其他窗口修改，已刷新为最新数据。"
          : `保存失败（${result.errorCode ?? "INVALID_INPUT"}）`,
      );
    }
  };

  return (
    <div className="bot-form">
      <label className="form-field">
        <span>名称</span>
        <input
          value={draft.name}
          maxLength={60}
          autoFocus
          aria-label="机器人名称"
          aria-invalid={Boolean(fieldErrors.name)}
          onChange={(e) => set("name", e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void submit();
            }
          }}
        />
        {fieldErrors.name && <em className="field-error">{fieldErrors.name}</em>}
      </label>

      <label className="form-field">
        <span>角色说明（instructions）</span>
        <textarea
          value={draft.instructions}
          maxLength={4000}
          rows={4}
          aria-label="角色说明"
          aria-invalid={Boolean(fieldErrors.instructions)}
          onChange={(e) => set("instructions", e.target.value)}
        />
        {fieldErrors.instructions && (
          <em className="field-error">{fieldErrors.instructions}</em>
        )}
      </label>

      <label className="form-field">
        <span>模型配置</span>
        <select
          value={draft.modelProfileId}
          aria-label="模型配置"
          onChange={(e) => set("modelProfileId", e.target.value)}
        >
          {MODEL_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="form-field">
        <span>工作目录</span>
        <select
          value={draft.workspaceId}
          aria-label="工作目录"
          onChange={(e) => set("workspaceId", e.target.value)}
        >
          {WORKSPACE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="form-field">
        <span>工具授权</span>
        <select
          value={draft.toolPolicyId}
          aria-label="工具授权"
          onChange={(e) => set("toolPolicyId", e.target.value)}
        >
          {TOOL_POLICY_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {submitError && <p className="form-error" role="alert">{submitError}</p>}

      <div className="modal-foot">
        <button type="button" className="ghost-btn" onClick={props.onCancel}>
          取消
        </button>
        <button
          type="button"
          className="primary-btn"
          disabled={busy}
          onClick={() => void submit()}
        >
          {props.submitLabel}
        </button>
      </div>
    </div>
  );
}
