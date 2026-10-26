/**
 * Bot create/edit form (D05 UI brief §2.6).
 *
 * Label-free soft fields: centered name (44px) and role textarea (96px) on
 * #1b1f26; contract selects collapse into an "高级设置" <details>. Slots let
 * the modal inject avatar preview/picker and the group row without breaking
 * validation ownership. Validation still runs the real BotSchema from
 * contracts and maps issues onto fields.
 */
import { useEffect, useState, type JSX, type ReactNode } from "react";
import { validateBot } from "../../services/contract-validation.js";
import type { BotDraft } from "../../services/desktop-service.js";
import { CustomSelect } from "../../components/custom-select.js";

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

/** Common tone presets (UI-only; merged into instructions on submit). */
export const TONE_PRESETS: readonly string[] = [
  "傲娇",
  "撒娇",
  "可爱",
  "呆萌",
  "严肃",
  "凶悍",
  "幽默",
  "温柔",
  "毒舌",
  "冷静",
  "热血",
] as const;

/** Create dialog keeps only the lighter, positive presets. */
const MINIMAL_TONES = TONE_PRESETS.filter(
  (tone) => !["傲娇", "严肃", "凶悍", "毒舌"].includes(tone),
);

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
    /** Rendered above the name field (avatar preview). */
    previewSlot?: ReactNode;
    /** Rendered between name and role (avatar picker slot). */
    avatarSlot?: ReactNode;
    /** Rendered after role (group select row). */
    groupSlot?: ReactNode;
    /** Rendered after the group row (skill bindings, D17). */
    skillsSlot?: ReactNode;
    /** Create mode: keep the dialog focused on name + avatar. */
    minimal?: boolean;
    /**
     * Create mode: the name to pre-fill. The caller supplies a number that is
     * actually free (Bot01, Bot02 …) so Enter is a complete action; an edit or a
     * template always wins because those arrive through `initial`.
     */
    defaultName?: string;
  },
): JSX.Element {
  const [draft, setDraft] = useState<BotDraft>(
    props.initial ?? {
      name: props.defaultName ?? "",
      instructions: "",
      modelProfileId: MODEL_OPTIONS[0]!.id,
      workspaceId: WORKSPACE_OPTIONS[0]!.id,
      toolPolicyId: TOOL_POLICY_OPTIONS[0]!.id,
    },
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [selectedTones, setSelectedTones] = useState<string[]>([]);
  const [customDraft, setCustomDraft] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Template pre-fill (D17): when the parent hands a new initial object,
  // adopt it wholesale (the parent owns when this happens).
  useEffect(() => {
    if (props.initial) {
      setDraft(props.initial);
    }
  }, [props.initial]);

  const set = (field: keyof BotDraft, value: string): void => {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  };


  const toggleTone = (tone: string): void => {
    setSelectedTones((prev) =>
      prev.includes(tone) ? prev.filter((t) => t !== tone) : [...prev, tone],
    );
  };


  const instructionsWithTones = (instructions: string): string => {
    const custom = customDraft.trim();
    const tones = selectedTones
      .filter((t) => t !== "自定义" || custom.length > 0)
      .map((t) => (t === "自定义" ? custom : t));
    if (tones.length === 0) {
      return instructions;
    }
    const suffix = `（语气：${tones.join("、")}）`;
    return instructions.includes(suffix) ? instructions : instructions + suffix;
  };

  const submit = async (): Promise<void> => {
    const merged: BotDraft = {
      ...draft,
      instructions: instructionsWithTones(draft.instructions),
    };
    const errors = validateBotDraft(merged);
    if (Object.values(errors).some(Boolean)) {
      setFieldErrors(errors);
      return;
    }
    setBusy(true);
    setSubmitError(null);
    const result = await props.onSubmit(merged);
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
    <div className={"bot-form" + (props.minimal ? " minimal" : "")}>
      {props.previewSlot}

      <input
        className="form-name"
        value={draft.name}
        maxLength={60}
        autoFocus
        placeholder="给你的 Bot 起个名字"
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

      {props.avatarSlot}

      <textarea
        className="form-role"
        value={draft.instructions}
        maxLength={4000}
        rows={4}
        placeholder="描述这个 Bot 的角色、语气和边界…"
        aria-label="角色说明"
        aria-invalid={Boolean(fieldErrors.instructions)}
        onChange={(e) => set("instructions", e.target.value)}
      />
      {fieldErrors.instructions && <em className="field-error">{fieldErrors.instructions}</em>}
      <span className="form-hint">可选：说明它能做什么、不能做什么；最大 4000 字。</span>

      <span className="tone-label">性格</span>
      <div className="tone-picker" role="group" aria-label="语气选择（可多选）">
        {(props.minimal ? MINIMAL_TONES : TONE_PRESETS).map((tone) => (
          <button
            key={tone}
            type="button"
            className={"tone-chip" + (selectedTones.includes(tone) ? " selected" : "")}
            aria-pressed={selectedTones.includes(tone)}
            onClick={() => toggleTone(tone)}
          >
            {tone}
          </button>
        ))}
        <button
          type="button"
          className={"tone-chip" + (selectedTones.includes("自定义") ? " selected" : "")}
          aria-pressed={selectedTones.includes("自定义")}
          onClick={() => toggleTone("自定义")}
        >
          自定义
        </button>
      </div>
      {selectedTones.includes("自定义") && (
        <div className="tone-custom">
          <input
            value={customDraft}
            maxLength={12}
            placeholder="输入你的自定义语气"
            aria-label="自定义语气"
            onChange={(e) => setCustomDraft(e.target.value)}
          />
        </div>
      )}

      {props.groupSlot}

      {props.skillsSlot}

      <details className="advanced">
        <summary>高级设置</summary>
        {/* 不能用 label 包裹：label 会把点击转发给内部触发按钮，选中后菜单立即重开（假死） */}
        <div className="form-field">
          <span>模型配置</span>
          <CustomSelect
            value={draft.modelProfileId}
            options={MODEL_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
            onChange={(v) => set("modelProfileId", v)}
            ariaLabel="模型配置"
          />
        </div>
        <div className="form-field">
          <span>工作目录</span>
          <CustomSelect
            value={draft.workspaceId}
            options={WORKSPACE_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
            onChange={(v) => set("workspaceId", v)}
            ariaLabel="工作目录"
          />
        </div>
        <div className="form-field">
          <span>工具授权</span>
          <CustomSelect
            value={draft.toolPolicyId}
            options={TOOL_POLICY_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
            onChange={(v) => set("toolPolicyId", v)}
            ariaLabel="工具授权"
          />
        </div>
      </details>

      {submitError && <p className="form-error" role="alert">{submitError}</p>}

      <div className="modal-foot">
        <button type="button" className="ghost-btn" onClick={props.onCancel}>
          取消
        </button>
        <button
          type="button"
          className="primary-btn"
          disabled={busy || draft.name.trim().length === 0}
          onClick={() => void submit()}
        >
          {props.submitLabel}
        </button>
      </div>
    </div>
  );
}
