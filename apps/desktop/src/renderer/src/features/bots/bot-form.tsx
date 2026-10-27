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
import { t, type MessageKey } from "../../i18n.js";

const MODEL_OPTIONS = [
  { id: "44444444-4444-4444-8444-444444444444", label: "DeepSeek · deepseek-chat" },
];

/**
 * Sample workspace / policy fixtures. `labelKey` is UI copy (so the labels can
 * switch language), `id` is the contract value that gets stored.
 */
const WORKSPACE_OPTIONS: readonly { id: string; labelKey: MessageKey }[] = [
  { id: "55555555-5555-4555-8555-555555555555", labelKey: "bots.workspaceASample" },
  { id: "55555555-5555-4555-8555-555555555556", labelKey: "bots.workspaceBSample" },
];

const TOOL_POLICY_OPTIONS: readonly { id: string; labelKey: MessageKey }[] = [
  { id: "66666666-6666-4666-8666-666666666666", labelKey: "bots.defaultToolPolicyReadOnly" },
];

export type FieldErrors = Partial<Record<keyof BotDraft, string>>;

/**
 * Tone presets (D22): `id` is stable UI state, `labelKey` is what the user reads
 * and `instruction` is the literal merged into the bot instructions for the
 * model. The instruction text stays Chinese on purpose — it is model-facing
 * input, not interface copy, and re-wording it would silently change bot output.
 */
export type TonePreset = {
  readonly id: string;
  readonly labelKey: MessageKey;
  readonly instruction: string;
};

export const CUSTOM_TONE_ID = "custom";

export const TONE_PRESETS: readonly TonePreset[] = [
  { id: "tsundere", labelKey: "bots.toneTsundere", instruction: "傲娇" }, // i18n-ignore: model-facing
  { id: "coquettish", labelKey: "bots.toneCoquettish", instruction: "撒娇" }, // i18n-ignore: model-facing
  { id: "cute", labelKey: "bots.toneCute", instruction: "可爱" }, // i18n-ignore: model-facing
  { id: "adorkable", labelKey: "bots.toneAdorkable", instruction: "呆萌" }, // i18n-ignore: model-facing
  { id: "serious", labelKey: "bots.toneSerious", instruction: "严肃" }, // i18n-ignore: model-facing
  { id: "fierce", labelKey: "bots.toneFierce", instruction: "凶悍" }, // i18n-ignore: model-facing
  { id: "humorous", labelKey: "bots.toneHumorous", instruction: "幽默" }, // i18n-ignore: model-facing
  { id: "gentle", labelKey: "bots.toneGentle", instruction: "温柔" }, // i18n-ignore: model-facing
  { id: "sharp", labelKey: "bots.toneSharpTongued", instruction: "毒舌" }, // i18n-ignore: model-facing
  { id: "calm", labelKey: "bots.toneCalm", instruction: "冷静" }, // i18n-ignore: model-facing
  { id: "hot-blooded", labelKey: "bots.toneHotBlooded", instruction: "热血" }, // i18n-ignore: model-facing
];

/** Create dialog keeps only the lighter, positive presets. */
const MINIMAL_TONE_IDS = new Set([
  "coquettish",
  "cute",
  "adorkable",
  "humorous",
  "gentle",
  "calm",
  "hot-blooded",
]);

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
    initial?: {
      name: string;
      instructions: string;
      modelProfileId: string;
      workspaceId: string;
      toolPolicyId: string;
      role?: "standard" | "coordinator";
    };
    submitLabel: string;
    onSubmit: (draft: BotDraft) => Promise<{ ok: boolean; errorCode?: string; errorMessage?: string }>;
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

  // FR-1: the coordinator role is a human-only switch. It renders as a chip
  // pair like the tone picker; the model-facing batch path never carries it.
  const role: "standard" | "coordinator" =
    draft.role === "coordinator" ? "coordinator" : "standard";
  const setRole = (next: "standard" | "coordinator"): void => {
    setDraft((prev) => ({ ...prev, role: next }));
  };


  const toggleTone = (id: string): void => {
    setSelectedTones((prev) =>
      prev.includes(id) ? prev.filter((toneId) => toneId !== id) : [...prev, id],
    );
  };


  const instructionsWithTones = (instructions: string): string => {
    const custom = customDraft.trim();
    const tones = selectedTones
      .filter((id) => id !== CUSTOM_TONE_ID || custom.length > 0)
      .map((id) =>
        id === CUSTOM_TONE_ID ? custom : (TONE_PRESETS.find((tone) => tone.id === id)?.instruction ?? ""),
      )
      .filter((value) => value.length > 0);
    if (tones.length === 0) {
      return instructions;
    }
    // Model-facing suffix: the phrasing is part of the prompt, not interface copy.
    const suffix = `（语气：${tones.join("、")}）`; // i18n-ignore: model-facing prompt text
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
      // The code alone lies: anything that crosses IPC without a structured
      // code arrives as INVALID_INPUT, so show the message too — it is the only
      // part of the failure that survives the boundary.
      const detail =
        result.errorMessage !== undefined && result.errorMessage.length > 0
          ? `：${result.errorMessage}`
          : "";
      setSubmitError(
        result.errorCode === "REVISION_CONFLICT"
          ? t("bots.saveConflictReloaded")
          : t("bots.saveFailedDetail", [result.errorCode ?? "UNKNOWN", detail]),
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
        placeholder={t("bots.namePlaceholder")}
        aria-label={t("bots.botName")}
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
        placeholder={t("bots.instructionsPlaceholder")}
        aria-label={t("bots.roleDescription")}
        aria-invalid={Boolean(fieldErrors.instructions)}
        onChange={(e) => set("instructions", e.target.value)}
      />
      {fieldErrors.instructions && <em className="field-error">{fieldErrors.instructions}</em>}
      <span className="form-hint">{t("bots.instructionsHint")}</span>

      <span className="tone-label">{t("bots.roleLabel")}</span>
      <div className="role-picker" role="group" aria-label={t("bots.roleGroupAria")}>
        <button
          type="button"
          className={"role-chip" + (role === "standard" ? " selected" : "")}
          aria-pressed={role === "standard"}
          onClick={() => setRole("standard")}
        >
          {t("bots.roleStandard")}
        </button>
        <button
          type="button"
          className={"role-chip coordinator" + (role === "coordinator" ? " selected" : "")}
          aria-pressed={role === "coordinator"}
          onClick={() => setRole("coordinator")}
        >
          {t("bots.roleCoordinator")}
        </button>
      </div>
      <span className="form-hint">
        {t("bots.roleHint")}
      </span>
      <span className="tone-label">{t("bots.personality")}</span>
      <div className="tone-picker" role="group" aria-label={t("bots.toneSelection")}>
        {(props.minimal
          ? TONE_PRESETS.filter((tone) => MINIMAL_TONE_IDS.has(tone.id))
          : TONE_PRESETS
        ).map((tone) => (
          <button
            key={tone.id}
            type="button"
            className={"tone-chip" + (selectedTones.includes(tone.id) ? " selected" : "")}
            aria-pressed={selectedTones.includes(tone.id)}
            onClick={() => toggleTone(tone.id)}
          >
            {t(tone.labelKey)}
          </button>
        ))}
        <button
          type="button"
          className={"tone-chip" + (selectedTones.includes(CUSTOM_TONE_ID) ? " selected" : "")}
          aria-pressed={selectedTones.includes(CUSTOM_TONE_ID)}
          onClick={() => toggleTone(CUSTOM_TONE_ID)}
        >
          {t("bots.custom")}
        </button>
      </div>
      {selectedTones.includes(CUSTOM_TONE_ID) && (
        <div className="tone-custom">
          <input
            value={customDraft}
            maxLength={12}
            placeholder={t("bots.customToneInputPlaceholder")}
            aria-label={t("bots.customTone")}
            onChange={(e) => setCustomDraft(e.target.value)}
          />
        </div>
      )}

      {props.groupSlot}

      {props.skillsSlot}

      <details className="advanced">
        <summary>{t("bots.advancedSettings")}</summary>
        {/* 不能用 label 包裹：label 会把点击转发给内部触发按钮，选中后菜单立即重开（假死） */}
        <div className="form-field">
          <span>{t("bots.modelProfile")}</span>
          <CustomSelect
            value={draft.modelProfileId}
            options={MODEL_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
            onChange={(v) => set("modelProfileId", v)}
            ariaLabel={t("bots.modelProfile")}
          />
        </div>
        <div className="form-field">
          <span>{t("bots.workspace")}</span>
          <CustomSelect
            value={draft.workspaceId}
            options={WORKSPACE_OPTIONS.map((option) => ({
              value: option.id,
              label: t(option.labelKey),
            }))}
            onChange={(v) => set("workspaceId", v)}
            ariaLabel={t("bots.workspace")}
          />
        </div>
        <div className="form-field">
          <span>{t("bots.toolPolicy")}</span>
          <CustomSelect
            value={draft.toolPolicyId}
            options={TOOL_POLICY_OPTIONS.map((option) => ({
              value: option.id,
              label: t(option.labelKey),
            }))}
            onChange={(v) => set("toolPolicyId", v)}
            ariaLabel={t("bots.toolPolicy")}
          />
        </div>
      </details>

      {submitError && <p className="form-error" role="alert">{submitError}</p>}

      <div className="modal-foot">
        <button type="button" className="ghost-btn" onClick={props.onCancel}>
          {t("shell.cancel")}
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
