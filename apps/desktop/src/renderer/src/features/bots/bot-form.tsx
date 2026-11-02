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

/**
 * Built-in model profiles seeded by the Host (host.ts): the UUIDs mirror the
 * well-known ids across the process boundary (the renderer never imports the
 * host package). deepseek-flash is the pinned catalog's only image-input
 * model (open-defects §2.1, plan 乙) — selecting it is what makes image
 * recognition work.
 */
const MODEL_OPTIONS = [
  { id: "44444444-4444-4444-8444-444444444444", label: "DeepSeek · deepseek-chat" },
  { id: "8d5a5e30-0000-4000-8000-000000000005", label: "DeepSeek · deepseek-reasoner" },
  { id: "8d5a5e30-0000-4000-8000-000000000006", label: "DeepSeek · deepseek-flash (vision)" },
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
  /**
   * Model-facing persona directive (性格单选): one strong, style-carrying
   * sentence — a bare word like 「呆萌」 never survives the model's
   * indifference, so every preset tells the model exactly how to talk.
   */
  readonly instruction: string;
  /** The pre-2026-10 single word stored by the old multi-select suffixes. */
  readonly word: string;
};

export const CUSTOM_TONE_ID = "custom";
/** 众生平等默认性格：创建弹窗预选「正常」，保存时写入自然的日常口语提示。 */
export const NORMAL_TONE_ID = "normal";

export const TONE_PRESETS: readonly TonePreset[] = [
  // 人格指令里不出现全角括号「（）」：后缀标记 `（语气：…）` 依赖第一个 `）`
  // 收尾，指令文本携带括号会被截断解析——引用一律用「」，停顿用——。
  {
    id: "normal",
    labelKey: "bots.toneNormal",
    word: "正常", // i18n-ignore: model-facing legacy word
    instruction: "自然平和的日常口语，不刻意卖萌也不过分正式", // i18n-ignore: model-facing
  },
  {
    id: "tsundere",
    labelKey: "bots.toneTsundere",
    word: "傲娇", // i18n-ignore: model-facing legacy word
    instruction:
      // i18n-ignore: model-facing persona directive
      "傲娇：嘴硬心软、句句口是心非——先否认「才、才不是为了你！」再用行动偷偷关心；被戳穿时慌张炸毛、句尾拖长音；偶尔漏出一句真心话后立刻恼羞成怒地找补，语气里永远带着一点别扭的骄傲。",
  },
  {
    id: "coquettish",
    labelKey: "bots.toneCoquettish",
    word: "撒娇", // i18n-ignore: model-facing legacy word
    instruction:
      // i18n-ignore: model-facing persona directive
      "撒娇：软软糯糯又黏人的语气，多用「嘛」「啦」「～」和叠词，爱讨关注、撒小任性「就一次嘛～」，被答应会开心得冒泡，被拒绝就瘪着嘴再撒娇一次，凶不起来。",
  },
  {
    id: "cute",
    labelKey: "bots.toneCute",
    word: "可爱", // i18n-ignore: model-facing legacy word
    instruction:
      // i18n-ignore: model-facing persona directive
      "元气可爱：语气软糯活泼，句尾自带「～」，爱用叠词「好哒」「惹」「叭叭」和颜文字或 emoji，为一点点小事就欢呼雀跃，偶尔俏皮地哼两句歌，整个人热乎乎、亮晶晶的。",
  },
  {
    id: "adorkable",
    labelKey: "bots.toneAdorkable",
    word: "呆萌", // i18n-ignore: model-facing legacy word
    instruction:
      // i18n-ignore: model-facing persona directive
      "呆萌可爱，每一句回复都要体现：反应永远慢半拍——先愣一下「诶？……哦哦！」，常常一脸认真地理解错题目，再歪着头理直气壮地说出歪答案；口癖「呜哇」「诶诶？！」「唔…让我想想哦」；发现自己说错了会鼓起脸小小声道歉，但下一秒就忘；说话用短句、自带省略号停顿，软乎乎、迷糊又元气，像一只努力帮忙的小仓鼠——呆是萌的一部分，答案最终还是要给对。",
  },
  {
    id: "serious",
    labelKey: "bots.toneSerious",
    word: "严肃", // i18n-ignore: model-facing legacy word
    instruction:
      // i18n-ignore: model-facing persona directive
      "严肃：用词精确克制、句子完整，先结论后依据，不闲聊不玩梗，要点分条罗列；语气沉稳但不冷漠，重要事项单独强调。",
  },
  {
    id: "fierce",
    labelKey: "bots.toneFierce",
    word: "凶悍", // i18n-ignore: model-facing legacy word
    instruction:
      // i18n-ignore: model-facing persona directive
      "凶悍：气势压人、句子短促有力，直接指出问题不留情面，惯用反问和感叹号施压——但始终对事不对人，吼完一定给得出解决办法。",
  },
  {
    id: "humorous",
    labelKey: "bots.toneHumorous",
    word: "幽默", // i18n-ignore: model-facing legacy word
    instruction:
      // i18n-ignore: model-facing persona directive
      "幽默：轻松机智，善用比喻、反差和自嘲来抖包袱，每条回复都藏一个小笑点——但关键信息永远准确，正事从不拿来开玩笑。",
  },
  {
    id: "gentle",
    labelKey: "bots.toneGentle",
    word: "温柔", // i18n-ignore: model-facing legacy word
    instruction:
      // i18n-ignore: model-facing persona directive
      "温柔：语速放缓、多用请求式和安抚句「没关系哦」「慢慢来」，先共情再给建议，措辞柔软、句尾温和，让人感觉被稳稳接住。",
  },
  {
    id: "sharp",
    labelKey: "bots.toneSharpTongued",
    word: "毒舌", // i18n-ignore: model-facing legacy word
    instruction:
      // i18n-ignore: model-facing persona directive
      "毒舌：犀利吐槽、一针见血，损得让人会心一笑而不是人身攻击，吐槽完依然给出靠谱的结论和方案。",
  },
  {
    id: "calm",
    labelKey: "bots.toneCalm",
    word: "冷静", // i18n-ignore: model-facing legacy word
    instruction:
      // i18n-ignore: model-facing persona directive
      "冷静：情绪零波动，条理化输出——第一、其次——先拆解问题再给方案，措辞中性克制，几乎不用感叹号和语气词。",
  },
  {
    id: "hot-blooded",
    labelKey: "bots.toneHotBlooded",
    word: "热血", // i18n-ignore: model-facing legacy word
    instruction:
      // i18n-ignore: model-facing persona directive
      "热血：干劲十足、句句带感叹号，爱用「上吧」「燃烧起来」式的打气，把每个任务都当征程，先冲再调整，永远先看到可能性。",
  },
];

/** Create dialog keeps the default plus the lighter, positive presets. */
export const MINIMAL_TONE_IDS = new Set([
  "normal",
  "coquettish",
  "cute",
  "adorkable",
  "humorous",
  "gentle",
  "calm",
  "hot-blooded",
]);

/** The literal tone marker the form appends to instructions (model-facing). */
const TONE_SUFFIX_PATTERN = /（语气：([^）]*)）/;

/** Remove any existing 语气 suffix so a save reflects exactly the current chips. */
export function stripToneSuffix(instructions: string): string {
  return instructions.replace(new RegExp(TONE_SUFFIX_PATTERN.source, "g"), "").trimEnd();
}

/** Build the suffix from the single resolved tone phrase (custom included by the caller). */
export function toneSuffix(phrases: readonly string[]): string {
  const parts = phrases.map((phrase) => phrase.trim()).filter((phrase) => phrase.length > 0);
  // i18n-ignore: model-facing prompt text
  return parts.length === 0 ? "" : `（语气：${parts.join("、")}）`;
}

/** The instructions as they will be stored: old suffix replaced, new one appended. */
export function mergeToneInstructions(instructions: string, phrases: readonly string[]): string {
  const base = stripToneSuffix(instructions);
  const suffix = toneSuffix(phrases);
  return suffix === "" ? base : `${base}${suffix}`;
}

export type ParsedToneSelection = {
  /** The selected preset id, or null when the tone is custom / absent. */
  id: string | null;
  /** The selected custom phrase, or null when a preset is selected / absent. */
  custom: string | null;
};

/**
 * Recover the single-select state from stored instructions. The old
 * multi-select suffixes (`语气：傲娇、可爱`) carry bare preset words — they
 * map back through `word`, the first preset wins and the rest are dropped
 * (one personality at a time from now on), and any non-preset phrase is the
 * custom tone.
 */
export function parseToneSelection(instructions: string): ParsedToneSelection {
  const match = instructions.match(TONE_SUFFIX_PATTERN);
  if (match === null) {
    return { id: null, custom: null };
  }
  const phrase = match[1]!.trim();
  if (phrase.length === 0) {
    return { id: null, custom: null };
  }
  // Rich single-tone directives contain 、 themselves — match the whole
  // phrase first; the 、-split below is only for legacy bare-word lists.
  const whole = TONE_PRESETS.find((tone) => tone.instruction === phrase);
  if (whole !== undefined) {
    return { id: whole.id, custom: null };
  }
  let custom: string | null = null;
  for (const part of phrase.split("、")) {
    if (part.length === 0) continue;
    const preset =
      TONE_PRESETS.find((tone) => tone.instruction === part) ??
      TONE_PRESETS.find((tone) => tone.word === part);
    if (preset !== undefined) {
      return { id: preset.id, custom: null };
    }
    if (custom === null) {
      custom = part;
    }
  }
  return { id: null, custom };
}

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
    /** Rendered after the name field (avatar picker slot). */
    avatarSlot?: ReactNode;
    /** Rendered after the avatar (skill bindings, D17). */
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
  // 性格单选：一次只有一个性格——preset id 或 custom；再点已选中的即取消。
  // 创建弹窗预选「正常」。
  const [selectedTone, setSelectedTone] = useState<string | null>(() =>
    props.minimal ? NORMAL_TONE_ID : null,
  );
  const [customDraft, setCustomDraft] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Template pre-fill (D17): when the parent hands a new initial object,
  // adopt it wholesale (the parent owns when this happens) and echo the
  // stored tone suffix back onto the chip (custom text re-fills the box).
  // A legacy multi-tone suffix collapses to its first preset.
  useEffect(() => {
    if (props.initial) {
      setDraft(props.initial);
      const parsed = parseToneSelection(props.initial.instructions);
      if (parsed.id !== null) {
        setSelectedTone(parsed.id);
      } else if (parsed.custom !== null) {
        setSelectedTone(CUSTOM_TONE_ID);
        setCustomDraft(parsed.custom);
      } else {
        setSelectedTone(props.minimal ? NORMAL_TONE_ID : null);
      }
    }
  }, [props.initial, props.minimal]);

  const set = (field: keyof BotDraft, value: string): void => {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  // Interop (TASK_BOT_INTEROP.md): the coordinator role picker is gone — any
  // bot may dispatch now, so the role confers nothing. An existing role label
  // rides along in `draft`/`initial` untouched and is never edited here. The
  // group row left with it (众生平等): new bots are ungrouped.


  const selectTone = (id: string): void => {
    // Single-select: picking one clears the others; picking it again clears
    // the personality entirely (the instructions stand bare).
    setSelectedTone((prev) => (prev === id ? null : id));
  };


  const instructionsWithTones = (instructions: string): string => {
    const phrase =
      selectedTone === null
        ? ""
        : selectedTone === CUSTOM_TONE_ID
          ? // The suffix marker closes at the first full-width ）: free text
            // may not carry one, or the stored suffix would truncate.
            customDraft.replace(/[（）]/g, "").trim()
          : (TONE_PRESETS.find((tone) => tone.id === selectedTone)?.instruction ?? "");
    // Deterministic: the stored suffix always mirrors the current chip, so
    // editing can accumulate neither duplicates nor leftovers.
    return mergeToneInstructions(instructions, phrase.length > 0 ? [phrase] : []);
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

      <span className="tone-label">{t("bots.personality")}</span>
      <div className="tone-picker" role="group" aria-label={t("bots.toneSelection")}>
        {(props.minimal
          ? TONE_PRESETS.filter((tone) => MINIMAL_TONE_IDS.has(tone.id))
          : TONE_PRESETS
        ).map((tone) => (
          <button
            key={tone.id}
            type="button"
            className={"tone-chip" + (selectedTone === tone.id ? " selected" : "")}
            aria-pressed={selectedTone === tone.id}
            onClick={() => selectTone(tone.id)}
          >
            {t(tone.labelKey)}
          </button>
        ))}
        <button
          type="button"
          className={"tone-chip" + (selectedTone === CUSTOM_TONE_ID ? " selected" : "")}
          aria-pressed={selectedTone === CUSTOM_TONE_ID}
          onClick={() => selectTone(CUSTOM_TONE_ID)}
        >
          {t("bots.custom")}
        </button>
      </div>
      {selectedTone === CUSTOM_TONE_ID && (
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
      <span className="form-hint">{t("bots.toneSingleHint")}</span>

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
