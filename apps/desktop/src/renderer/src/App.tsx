import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
} from "react";
import { createPortal } from "react-dom";
import { useBots, type UiBot } from "./features/bots/use-bots.js";
import { PermissionChatCards } from "./features/permissions/permission-chat.js";
import { TaskFeedCards } from "./features/chat/task-feed.js";
import { SearchResultCards } from "./features/search/search-results.js";
import { MemoryPanel } from "./features/memory/memory-panel.js";
import { SearchSettings } from "./features/search/search-settings.js";
import { AutomationPanel } from "./features/automation/automation-panel.js";
import { ChatAutomationNotice } from "./features/automation/chat-automation-notice.js";
import { EventRuleSettings } from "./features/event-rules/event-rule-settings.js";
import { PermissionsPanel } from "./features/permissions/permissions-panel.js";
import { ScreenSettings } from "./features/screen/screen-settings.js";
import { UsagePanel } from "./features/usage/usage-panel.js";
import { SettingsNav, type SettingsSectionKey } from "./features/settings/settings-nav.js";
import { VoiceLanguageSettings } from "./features/settings/voice-language-settings.js";
import { VoiceSettingsPanel } from "./features/settings/voice-settings.js";
import { useHostDown } from "./features/settings/host-down.js";
import { BotForm } from "./features/bots/bot-form.js";
import { nextBotName } from "./features/bots/bot-names.js";
import { CustomSelect } from "./components/custom-select.js";
import type {
  BotDraft,
  ContextUsageView,
} from "./services/desktop-service.js";
import { useService } from "./services/service-context.jsx";
import { METHOD_CONTRACTS, type VoiceStatus, type VoiceTranscriptionLanguage } from "@deepseek-bot/contracts";
import {
  emptyStream,
  failureMessage,
} from "./features/chat/chat-reducer.js";
import {
  assemblePairRecords,
  type PairRecord,
} from "./features/chat/pair-transcript.js";
import {
  BotSessionSublist,
  scopeToBotConversation,
} from "./features/chat/one-conversation.js";
import {
  runChatStream,
  type StreamStateForBot,
} from "./features/chat/stream-runner.js";
import {
  CHAT_THREAD_HISTORY_LIMIT,
  historyThreadMessages,
  isSameStoredTurn,
  mergeOpenedThread,
  type ThreadOrigin,
} from "./features/chat/thread-history.js";
import type { StreamHandle } from "./services/desktop-service.js";
import { Avatar as AvatarView } from "./features/avatars/avatar.js";
import { AvatarPicker } from "./features/avatars/avatar-picker.js";
import { GazeAvatar } from "./features/avatars/gaze-avatar.js";
import {
  accountImageAvatar,
  avatarColor,
  bubbleInk,
  toContractAvatar,
  type Avatar as AvatarKind,
} from "./features/avatars/avatar-meta.js";
import { ChoiceCard, type ChoiceOption } from "./features/questions/choice-card.js";
import {
  answerSeedCard,
  canAnswerChoice,
  findPendingChoiceCard,
} from "./features/questions/choice-answer.js";
import { onboardingCardFor } from "./features/bots/onboarding.js";
import { ComposerMic } from "./features/voice/composer-mic.js";
import { appendTranscript } from "./features/voice/hold-to-talk.js";
import { speakButton } from "./features/voice/voice-ui.js";
import {
  QuestionChatCards,
  type AnsweredQuestion,
} from "./features/questions/question-chat.js";
import { WorkflowEditor } from "./features/workflow-editor/workflow-editor.js";
import { RunMonitor } from "./features/run-monitor/run-monitor.js";
import { CanvasSidecar } from "./features/canvas/canvas-sidecar.js";
import { ChatMarkdown } from "./features/chat/chat-markdown.js";
import { setMermaidTheme } from "./features/chat/mermaid.js";
import { ThinkingLine } from "./features/chat/thinking-line.js";
import {
  messageSlotOrder,
  streamSlotOrder,
  TimelineOrderProvider,
} from "./features/chat/timeline.js";
import { exportConversation } from "./features/chat/export-conversation.js";
import type { MentionTable } from "./features/chat/mentions.js";
import {
  attachmentAccept,
  buildAttachmentContext,
  classifyAttachment,
  composeAttachmentBlocks,
  composeAttachmentPrompt,
  formatAttachmentSize,
  MAX_ATTACHMENT_BYTES,
  type AttachmentDraft,
  type VisionNoteMode,
} from "./features/chat/attachments.js";
import { prepareVisionImage } from "./features/chat/image-vision.js";
import type { StreamOptions } from "./services/desktop-service.js";
import { GlobalSearch } from "./features/search/global-search.js";
import { ContextRing } from "./features/chat/context-ring.js";
import {
  deepThinkingTargetId,
  isDeepThinkingEnabled,
} from "./features/chat/reasoner.js";
import {
  loadPrimitiveModes,
  setPrimitiveMode,
} from "./features/chat/primitive-mode.js";
import {
  buildSearchIndex,
  remoteHitsToItems,
  type SearchItem,
} from "./features/search/search-core.js";
import {
  ACCENT_PRESETS,
  loadSettings,
  saveSettings,
  UNSET_ACCOUNT_NAME,
  type NotificationPrefs,
} from "./features/settings/settings-store.js";
import {
  currentLanguage,
  formatDate,
  formatTime,
  setLanguagePreference,
  t,
  useLanguage,
} from "./i18n.js";
import { SidebarResizer } from "./features/shell/sidebar-resizer.js";
import { syncTrayState } from "./features/system/tray-sync.js";
import {
  createFocusTracker,
  notificationRequest,
  notifyUser,
} from "./features/system/notify.js";
import { NotificationSettingsPanel } from "./features/system/notifications-panel.js";
import { ChromeImportPanel } from "./features/system/chrome-panel.js";
import type { TrayBotStatus } from "../../shared/system-integration.js";
import type { LanguagePreference } from "../../shared/i18n/types.js";
import {
  deleteTemplate,
  listTemplates,
  saveTemplate,
  type BotTemplate,
} from "./features/templates/bot-templates.js";
import {
  applySkill,
  deleteSkill,
  listSkills,
  upsertSkill,
  type Skill,
} from "./features/skills/skill-store.js";
import { BotSkillsPicker } from "./features/skills/bot-skills-picker.js";
import { SkillsPanel } from "./features/skills/skills-panel.js";
import {
  emptyLibrary,
  loadSkills,
  setBotSkills,
  skillsForInjection,
  toRendererLibrary,
  type SkillLibrary,
} from "./features/skills/skills.js";
import { migrateLegacyLibrary } from "./features/skills/library-migration.js";


type Group = {
  key: number;
  name: string;
  /** v0.14 分组实体化: the persisted group's UUID, null for 未分组. */
  groupId: string | null;
  /** Host-side revision for optimistic concurrency; null for 未分组. */
  revision: string | null;
};
const UNGROUPED = 1;

/**
 * Group names are UI state; the default group keeps an empty name so its label
 * follows the interface language instead of freezing at "未分组" (D22).
 */
function groupLabel(group: Group | undefined): string {
  if (group === undefined || group.name.trim().length === 0) {
    return t("shell.ungrouped");
  }
  return group.name;
}

const EMOJIS = ["👍", "👎", "❤️", "😂", "🎉"] as const;
type Emoji = (typeof EMOJIS)[number];

type Msg = {
  id: number;
  from: "bot" | "user";
  text: string;
  quote: { name: string; text: string } | null;
  reactions: Partial<Record<Emoji, number>>;
  mine: Emoji[];
  time: number;
  /** Which bot spoke; for `from: "bot"` messages defaults to the chat owner. */
  speakerKey?: number;
  /** Centered bot-to-bot delivery metadata line. */
  notice?: { label: string; otherKey: number } | null;
  /** Multi-bot delivery: stacked avatar chips, clickable per bot. */
  deliverTo?: number[];
  peerKey?: number;
  /** Files sent with the message (D26; path = workspace-relative after upload). */
  attachments?:
    | {
        name: string;
        size: number;
        kind: "text" | "image" | "binary";
        dataUrl?: string;
        /** Workspace path from attachment.commit. */
        path?: string;
        /** Same workspace path; opens the artifact preview. */
        relativePath?: string;
      }[]
    | undefined;
  /** Choice card the bot put to the user (D14 interaction slice). */
  choices?: {
    question: string;
    options: { id: string; label: string }[];
    other?: boolean;
    answered?: string | undefined;
  } | undefined;
  /** System notices (e.g. blocked cross-group requests) render as a centered muted line. */
  system?: boolean;
  /**
   * seed: welcome placeholder. history: host chat.history. live: this session's
   * composer. Absent means live (notices and older call sites).
   */
  origin?: ThreadOrigin;
  /**
   * True when this bubble was loaded from chat.history. Live composer turns
   * leave it unset so the pane can tell a replay from a new message.
   */
  history?: boolean;
  /** G6: the message re-enters the thread as 重新生成 / 编辑后重发, weakly labelled. */
  meta?: "regenerate" | "edited_resend";
};

type ChatState = Record<number, Msg[]>;

/**
 * A choice card waiting for the composer to supply its free-text answer
 * (seed-card "其他" and model-clarification "D / 以上都不是" both route here).
 * `forKey` scopes the pending answer to one chat so switching bots neither
 * fires it into the wrong thread nor loses it.
 */
type ClarifyTarget =
  | { forKey: number; kind: "seed"; msgId: number }
  | { forKey: number; kind: "ask"; requestId: string; question: string };

type AnsweredQuestionMap = Record<string, AnsweredQuestion>;


type MenuState = { x: number; y: number; botKey: number };
type DialogState = { type: "newGroup"; moveBot: number | null };

function pairKeyOf(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** 人类可读的备份体积（D24 保险库分区）。 */
function formatBackupSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatChatTime(value: number): string {
  const d = new Date(value);
  const time = formatTime(value);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return t("shell.today", [time]);
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return t("shell.yesterday", [time]);
  }
  // Intl carries the weekday and the date pattern; no hand-rolled weekday list.
  return t("shell.dateWeekdayTime", [formatDate(value), time]);
}

function BlobMark(): JSX.Element {
  return (
    <svg className="blob-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2.5c5.1 0 9.5 3.4 9.5 8.2 0 4.9-4.4 8.3-9.5 8.3-1 0-2-.1-2.9-.4l-3.6 1.6c-.5.2-1-.3-.8-.8l1-3C4.2 15 2.5 13 2.5 10.7c0-4.8 4.4-8.2 9.5-8.2Z"
        fill="currentColor"
      />
      <circle cx="9.2" cy="10.2" r="1.5" fill="var(--bg)" />
      <circle cx="14.8" cy="10.2" r="1.5" fill="var(--bg)" />
    </svg>
  );
}

function CloudDecor({ className = "" }: { className?: string }): JSX.Element {
  return (
    <svg className={"cloud-decor " + className} viewBox="0 0 120 44" aria-hidden="true">
      <g fill="currentColor">
        <ellipse cx="52" cy="30" rx="34" ry="13" />
        <circle cx="36" cy="24" r="12" />
        <circle cx="56" cy="19" r="14" />
        <circle cx="74" cy="26" r="10" />
      </g>
    </svg>
  );
}

function MenuIcon({ d }: { d: string }): JSX.Element {
  return (
    <svg className="menu-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function App(): JSX.Element {
  // Subscribing here means a language switch re-renders the whole tree, so
  // every `t()` call in the subtree reads the new catalogue (D22).
  useLanguage();
  const [version, setVersion] = useState<string>("…");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingBot, setEditingBot] = useState<UiBot | null>(null);

  const [shape, setShape] = useState(0);
  const [color, setColor] = useState(2);
  const [avatar, setAvatar] = useState<AvatarKind>(() => ({
    kind: "grok",
    shape: "blob",
    color: "#3b93f0",
  }));
  const [tplSeed, setTplSeed] = useState("new");
  /** Name suggested for the next bot, computed when the create dialog opens. */
  const [createName, setCreateName] = useState("");
  const [tplDraft, setTplDraft] = useState<BotDraft | null>(null);

  const [groups, setGroups] = useState<Group[]>([
    { key: UNGROUPED, name: "", groupId: null, revision: null },
  ]);
  const nextGroupKey = useRef(2);
  const {
    bots,
    hiddenBots,
    create: createBotEntity,
    update: updateBotEntity,
    duplicate: duplicateBotEntity,
    setUi,
    moveToTop,
    applyPersistedOrder,
    hide,
    unhide,
    forget,
  } = useBots(UNGROUPED);

  const [menu, setMenu] = useState<MenuState | null>(null);
  // Inline rename: the key of the sidebar row being edited and its draft name.
  // `renameScope` matters because the same bot is shown twice — once in the
  // sidebar row and once in the header plate — and only the place the gesture
  // came from may turn into a field, or two editors appear at once.
  const [renameKey, setRenameKey] = useState<number | null>(null);
  const [renameScope, setRenameScope] = useState<"row" | "header">("row");
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameOpenedAtRef = useRef(0);
  const [menuDialog, setMenuDialog] = useState<DialogState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UiBot | null>(null);
  const [dialogText, setDialogText] = useState("");

  const [selectedBot, setSelectedBot] = useState<number | null>(null);
  /**
   * 跨 bot 并行思考（每 bot 一条流）：live stream 状态按 bot 键控存放在 App，
   * 切换/重挂载聊天面板不再丢掉进行中的思考与流式文本。handles 同样按 bot
   * 键控，取消按钮只取消当前 bot 的回合。
   */
  const [streams, setStreams] = useState<Record<number, StreamStateForBot>>({});
  const streamHandles = useRef<Map<number, StreamHandle>>(new Map());
  const updateStreamState = (
    key: number,
    update: (prev: StreamStateForBot | null) => StreamStateForBot | null,
  ): void => {
    setStreams((prev) => {
      const current = prev[key] ?? null;
      const next = update(current === null ? null : { ...current, forKey: key });
      if (next === null) {
        if (prev[key] === undefined) return prev;
        const rest = { ...prev };
        delete rest[key];
        return rest;
      }
      return { ...prev, [key]: next };
    });
  };
  /**
   * The bot the sidebar header speaks for: whichever conversation is active,
   * falling back to the first bot before one is picked. The header used to be a
   * fixed "DeepSeek Bot" plate, which meant it contradicted the list under it as
   * soon as any bot existed.
   */
  const headerBot = bots.find((b) => b.key === selectedBot) ?? bots[0] ?? null;
  const [toast, setToast] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [artifactList, setArtifactList] = useState<
    import("@deepseek-bot/contracts").BotArtifact[] | null
  >(null);
  /** D28: the open co-edit sidecar (one workspace file beside the chat). */
  const [canvas, setCanvas] = useState<
    { botKey: number; botId: string; botName: string; path: string } | null
  >(null);
  const [chats, setChats] = useState<ChatState>({});
  /** Bots whose open thread already read chat.history this session. */
  const threadHistoryLoaded = useRef(new Set<number>());
  const [pairTranscripts, setPairTranscripts] = useState<
    Record<string, { id: number; speakerKey: number; text: string; time: number }[]>
  >({});
  const [quoteDraft, setQuoteDraft] = useState<{ name: string; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragOverGroup, setDragOverGroup] = useState<number | null>(null);
  const desktop = useService();
  const [collapsedGroups, setCollapsedGroups] = useState<number[]>([]);
  const [groupMenu, setGroupMenu] = useState<{ x: number; y: number; groupKey: number } | null>(
    null,
  );

  const toggleGroupCollapsed = (groupKey: number): void => {
    setCollapsedGroups((prev) =>
      prev.includes(groupKey) ? prev.filter((k) => k !== groupKey) : [...prev, groupKey],
    );
  };

  const menuRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) {
      return;
    }
    const el = menuRef.current;
    const r = el.getBoundingClientRect();
    const mw = r.width || 220;
    const mh = r.height || 320;
    const margin = 8;
    let x = menu.x;
    let y = menu.y;
    const flipX = x + mw > window.innerWidth - margin && x - mw >= margin;
    if (flipX) {
      x -= mw;
    }
    const flipY = y + mh > window.innerHeight - margin && y - mh >= margin;
    if (flipY) {
      y -= mh;
    }
    x = Math.min(Math.max(margin, x), Math.max(margin, window.innerWidth - mw - margin));
    y = Math.min(Math.max(margin, y), Math.max(margin, window.innerHeight - mh - margin));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.dataset.sub = x + mw + 200 > window.innerWidth - margin ? "left" : "right";
  }, [menu]);

  const groupMenuRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!groupMenu || !groupMenuRef.current) {
      return;
    }
    const el = groupMenuRef.current;
    const r = el.getBoundingClientRect();
    const margin = 8;
    let x = groupMenu.x;
    let y = groupMenu.y;
    if (x + r.width > window.innerWidth - margin) {
      x = Math.max(margin, window.innerWidth - r.width - margin);
    }
    if (y + r.height > window.innerHeight - margin) {
      y = Math.max(margin, window.innerHeight - r.height - margin);
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [groupMenu]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Which settings nav section is active (D24; grouping in features/settings). */
  const [settingsSection, setSettingsSection] = useState<SettingsSectionKey>("general");
  const hostDown = useHostDown();
  const [backups, setBackups] = useState<
    import("../../shared/ipc-channels.js").BackupSummary[] | null
  >(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [hwAccel, setHwAccel] = useState<{
    enabled: boolean;
    restartRequired: boolean;
  } | null>(null);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const initialSettings = useMemo(() => loadSettings(window.localStorage), []);
  const [theme, setTheme] = useState<"dark" | "light">(initialSettings.theme);
  /** D14 mermaid follow-up: diagrams rendered afterwards follow the theme. */
  useEffect(() => {
    setMermaidTheme(theme);
  }, [theme]);
  const [accountName, setAccountName] = useState(initialSettings.accountName);
  const [accountAvatar, setAccountAvatar] = useState<AvatarKind>(initialSettings.accountAvatar);
  const pickingAvatar = useRef(false);
  const [accent, setAccent] = useState(initialSettings.accent);
  const [language, setLanguage] = useState<LanguagePreference>(initialSettings.language);
  const [voiceLanguage, setVoiceLanguage] = useState<VoiceTranscriptionLanguage>(initialSettings.voiceLanguage);
  /** Bumps after Settings saves whisper paths so the open chat re-reads voice.status. */
  const [voiceConfigVersion, setVoiceConfigVersion] = useState(0);
  const [notifications, setNotifications] = useState<NotificationPrefs>(initialSettings.notifications);
  /** "" means the user never set a name — the UI shows the localized default (D22). */
  const displayName =
    accountName.trim().length > 0 ? accountName : t("d22.defaultAccountName");
  const [botTemplates, setBotTemplates] = useState<BotTemplate[]>(() =>
    listTemplates(window.localStorage),
  );
  const [skillLibrary, setSkillLibrary] = useState<SkillLibrary>(emptyLibrary);
  /** D17': any local edit wins over the in-flight boot load. */
  const skillLibraryTouchedRef = useRef(false);

  // D17': boot the skill library from the Host (via the service layer). When
  // the Host has none, the legacy localStorage copy migrates once behind an
  // idempotent marker; the composer prompt-template store (an array under the
  // same legacy key) is never migrated. A Host without the methods (or a
  // broken bridge) degrades to the legacy read; a failed import keeps the
  // legacy payload and says so.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const hostLibrary = await desktop.skills.getLibrary();
        if (!alive || skillLibraryTouchedRef.current) return;
        const migration = await migrateLegacyLibrary({
          storage: window.localStorage,
          hostLibrary,
          saveLibrary: (library) =>
            desktop.skills.saveLibrary(library).then(() => undefined),
        });
        if (!alive || skillLibraryTouchedRef.current) return;
        if (migration.outcome === "failed") {
          // The legacy payload stays in localStorage (retry next boot, or
          // re-import the export file from settings).
          setSkillLibrary(loadSkills(window.localStorage));
          setToast(t("skills.migrateFailed"));
          return;
        }
        setSkillLibrary(toRendererLibrary(migration.library));
      } catch {
        if (alive && !skillLibraryTouchedRef.current) {
          setSkillLibrary(loadSkills(window.localStorage));
          setToast(t("skills.hostDegraded"));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [desktop]);

  /**
   * D17': optimistic local update + whole-library Host save. A failed save
   * keeps the in-session library and says so — the same semantics the old
   * localStorage quota-loss path had.
   */
  const updateLibrary = useCallback((next: SkillLibrary) => {
    skillLibraryTouchedRef.current = true;
    setSkillLibrary(next);
    void desktop.skills
      .saveLibrary(next)
      .then(() => undefined)
      .catch(() => {
        setToast(t("skills.hostSaveFailed"));
      });
  }, [desktop]);

  const saveBotTemplate = (target: UiBot): void => {
    const result = saveTemplate(window.localStorage, {
      name: t("shell.templateNameFromBot", [target.bot.name]),
      bot: {
        name: target.bot.name,
        instructions: target.bot.instructions,
        avatarUi: { avatar: target.avatar, shape: target.shape, color: target.color },
      },
    });
    if (result.ok) {
      setBotTemplates(listTemplates(window.localStorage));
      setToast(t("shell.templateSaved", [result.template.name]));
    } else {
      setToast(
        result.reason === "limit" ? t("shell.templateLimitReached") : t("shell.templateNameExists"),
      );
    }
  };

  const [updateStatus, setUpdateStatus] = useState<
    { available: boolean; version: string | null; downloading: boolean; readyToInstall: boolean; error: string | null } | null
  >(null);

  useEffect(() => {
    saveSettings(window.localStorage, {
      theme,
      accountName,
      accountAvatar,
      accent,
      language,
      voiceLanguage,
      notifications,
    });
  }, [theme, accountName, accountAvatar, accent, language, voiceLanguage, notifications]);

  useEffect(() => {
    // Keeps the renderer store and the main process (tray, notifications) in sync.
    setLanguagePreference(language);
  }, [language]);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accent);
  }, [accent]);

  /* ---------------- D22: OS integration (tray, notifications) ---------------- */

  const focusTracker = useRef(createFocusTracker());
  const notifyClock = useRef<Map<string, number>>(new Map());
  const [botStatuses, setBotStatuses] = useState<Record<string, TrayBotStatus>>({});
  const activeBotId = bots.find((b) => b.key === selectedBot)?.bot.id ?? null;

  /* -------- G1': persisted interface state (ui.state v0.13/v0.14) -------- */

  /**
   * G1' 分组实体化: load the persisted groups once. The sidebar keeps its
   * numeric session keys for rendering, but each group now carries the
   * entity's UUID + revision from here on.
   */
  const [hostGroupsLoaded, setHostGroupsLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void desktop.groups
      .list()
      .then((hostGroups) => {
        if (cancelled || hostGroups.length === 0) {
          return;
        }
        setGroups((prev) => [
          ...prev,
          ...hostGroups.map((group) => ({
            key: nextGroupKey.current++,
            name: group.name,
            groupId: group.id,
            revision: group.revision,
          })),
        ]);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setHostGroupsLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  /**
   * Restore the persisted snapshot once the bot list AND the group list have
   * landed, in this order: members follow their contract `groupId`, groups
   * follow the snapshot's order (未分组 pinned first), collapse state comes
   * back, and finally the selected bot — only when it still exists (a stale
   * snapshot must not select an archived or deleted bot). Best-effort: a dead
   * host or corrupt row falls back to the default view.
   */
  const uiStateRestoredRef = useRef(false);
  useEffect(() => {
    if (uiStateRestoredRef.current || !hostGroupsLoaded || bots.length === 0) {
      return;
    }
    uiStateRestoredRef.current = true;
    void desktop.uiState
      .get()
      .then((state) => {
        const keyByGroupId = new Map(
          groups
            .filter((g) => g.groupId !== null)
            .map((g) => [g.groupId as string, g.key]),
        );
        for (const b of bots) {
          const wanted =
            b.bot.groupId !== undefined && b.bot.groupId !== null
              ? (keyByGroupId.get(b.bot.groupId) ?? UNGROUPED)
              : UNGROUPED;
          if (b.group !== wanted) {
            setUi(b.key, { group: wanted });
          }
        }
        setGroups((prev) => {
          const rank = new Map(
            state.groupOrder.map((id, index) => [id, index] as const),
          );
          const pinned = prev.filter((g) => g.groupId === null);
          const rest = prev.filter((g) => g.groupId !== null);
          rest.sort(
            (a, b) =>
              (rank.get(a.groupId ?? "") ?? Number.MAX_SAFE_INTEGER) -
              (rank.get(b.groupId ?? "") ?? Number.MAX_SAFE_INTEGER),
          );
          return [...pinned, ...rest];
        });
        const collapsed = [
          ...new Set(
            (state.collapsedGroupIds ?? [])
              .map((id) => keyByGroupId.get(id))
              .filter((key): key is number => key !== undefined),
          ),
        ];
        if (collapsed.length > 0) {
          setCollapsedGroups(collapsed);
        }
        applyPersistedOrder(state.botOrder);
        if (state.selectedBotId !== null) {
          const target = bots.find((b) => b.bot.id === state.selectedBotId);
          if (target !== undefined) {
            setSelectedBot(target.key);
          }
        }
      })
      .catch(() => undefined);
  }, [hostGroupsLoaded, bots, groups, desktop, applyPersistedOrder, setUi]);

  /**
   * Persist the sidebar snapshot with a debounce — one write per burst of
   * changes, last write wins on the Host. `selectedGroupId` stays null until
   * the sidebar grows an explicit group-selection interaction.
   */
  useEffect(() => {
    if (!hostGroupsLoaded || bots.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      void desktop.uiState
        .save({
          botOrder: bots.map((b) => b.bot.id),
          groupOrder: groups
            .filter((g) => g.groupId !== null)
            .map((g) => g.groupId as string),
          selectedBotId: activeBotId,
          selectedGroupId: null,
          collapsedGroupIds: collapsedGroups
            .map((key) => groups.find((g) => g.key === key)?.groupId)
            .filter((id): id is string => typeof id === "string"),
        })
        .catch(() => undefined);
    }, 500);
    return () => clearTimeout(timer);
  }, [hostGroupsLoaded, bots, groups, collapsedGroups, activeBotId, desktop]);


  const raiseNotice = useCallback(
    (input: {
      kind: "reply" | "approval" | "missed";
      botId: string | null;
      botName: string;
      count?: number;
    }): void => {
      void notifyUser(notifications, input, {
        focused: focusTracker.current.isFocused(),
        now: () => Date.now(),
        lastRaised: notifyClock.current,
      });
    },
    [notifications],
  );

  const reportBotStatus = useCallback((botId: string, status: TrayBotStatus): void => {
    setBotStatuses((previous) =>
      previous[botId] === status ? previous : { ...previous, [botId]: status },
    );
  }, []);

  const testNotification = useCallback(async (): Promise<{ shown: boolean; reason: string | null }> => {
    const bridge = window.deepseekBot;
    if (!bridge || !("system" in bridge)) {
      return { shown: false, reason: "unsupported" };
    }
    try {
      return await bridge.system.notifications.show(notificationRequest({ kind: "test", botId: null, botName: "" }));
    } catch {
      return { shown: false, reason: "unsupported" };
    }
  }, []);

  useEffect(() => {
    const bridge = window.deepseekBot;
    if (!bridge || !("system" in bridge)) {
      // Browser preview: there is no tray and no notification channel to track.
      return;
    }
    return focusTracker.current.attach(bridge);
  }, []);

  useEffect(() => {
    // The tray mirrors this window: bot list, which bot is open, unread flags,
    // live status and the rasterised avatar of each bot (re-rasterised on theme).
    void syncTrayState(
      bots.map((bot) => ({
        id: bot.bot.id,
        name: bot.bot.name,
        avatar: bot.avatar,
        unread: bot.unread,
        status: botStatuses[bot.bot.id] ?? "idle",
      })),
      activeBotId,
      { theme },
    );
  }, [bots, activeBotId, botStatuses, theme, language]);

  useEffect(() => {
    const bridge = window.deepseekBot;
    if (!bridge || !("system" in bridge)) {
      return;
    }
    const openBot = (botId: string): void => {
      const target = bots.find((bot) => bot.bot.id === botId);
      if (target === undefined) {
        return;
      }
      setSelectedBot(target.key);
      setUi(target.key, { unread: false });
    };
    const offTray = bridge.system.onTrayAction((event) => {
      if (event.kind === "settings") {
        setSettingsOpen(true);
        return;
      }
      openBot(event.botId);
    });
    const offClick = bridge.system.onNotificationClick((event) => {
      if (event.botId !== null) {
        openBot(event.botId);
      }
    });
    return () => {
      offTray();
      offClick();
    };
  }, [bots, setUi]);

  useEffect(() => {
    const bridge = window.deepseekBot;
    if (!bridge?.host?.onMissed) {
      return;
    }
    // FR-08: a missed schedule must be heard as well as written into the chat.
    return bridge.host.onMissed((notices) => {
      raiseNotice({ kind: "missed", botId: null, botName: "", count: notices.length });
    });
  }, [raiseNotice]);

  useEffect(() => {
    // Silent startup check; preview shims have no updates bridge.
    const bridge = window.deepseekBot;
    if (!bridge || !("updates" in bridge)) {
      return;
    }
    const timer = setTimeout(() => {
      void bridge.updates.check().then(setUpdateStatus).catch(() => undefined);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);
  const [editingName, setEditingName] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [testResult, setTestResult] = useState<
    { result: "success" | "failure" | "unverified"; ok: boolean; errorCode?: string } | null
  >(null);
  const [testing, setTesting] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // 窗口控制条由主进程 titleBarOverlay 绘制，随主题经白名单 IPC 同步颜色；
    // 无 preload 桥的环境（组件级取证页）直接跳过。
    const overlay =
      theme === "light"
        ? { color: "#ffffff", symbolColor: "#1a1a1e" }
        : { color: "#0f0f10", symbolColor: "#ececf1" };
    const bridge = window.deepseekBot;
    if (bridge !== undefined && bridge.window !== undefined) {
      void bridge.window.setTitleBarOverlay(overlay).catch(() => undefined);
    }
  }, [theme]);

  useEffect(() => {
    if (modalOpen && !editingBot) {
      setAvatar({ kind: "grok", shape: "blob", color: "#3b93f0" });
    }
  }, [modalOpen, editingBot]);
  useEffect(() => {
    if (!artifactsOpen || selectedBot === null) {
      return;
    }
    const bot = bots.find((b) => b.key === selectedBot);
    if (!bot) {
      return;
    }
    let cancelled = false;
    void desktop.artifacts
      .list(bot.bot.id)
      .then((list) => {
        if (!cancelled) {
          setArtifactList(list);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setArtifactList([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [artifactsOpen, selectedBot, bots, desktop, canvas]);

  // D24 leftover: vault and computer sections load their data lazily on open.
  useEffect(() => {
    if (!settingsOpen || settingsSection !== "vault") {
      return;
    }
    let cancelled = false;
    void desktop.vault
      .listBackups()
      .then((list) => {
        if (!cancelled) {
          setBackups(list);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBackups([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [settingsOpen, settingsSection, desktop]);

  useEffect(() => {
    if (!settingsOpen || settingsSection !== "computer" || hwAccel !== null) {
      return;
    }
    void desktop.hardwareAcceleration().then(setHwAccel).catch(() => undefined);
  }, [settingsOpen, settingsSection, desktop, hwAccel]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const appInfo = await window.deepseekBot.getAppInfo();
        if (!cancelled) {
          setVersion(`${appInfo.name} ${appInfo.version} · ${appInfo.platform}`);
        }
      } catch {
        if (!cancelled) {
          setVersion("app info unavailable");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(null);
        setMenuDialog(null);
        setModalOpen(false);
        setSettingsOpen(false);
        setEditingName(false);
        setGroupMenu(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const selectedBotEntry = bots.find((b) => b.key === selectedBot);
  const selectedBotName = selectedBotEntry?.bot.name ?? "DeepSeek Bot";
  /** GAP_AUDIT G5: deep-thinking ships as the bot's model profile. */
  const deepThinking =
    selectedBotEntry !== undefined && isDeepThinkingEnabled(selectedBotEntry.bot.modelProfileId);
  /** 原始人模式: per-bot renderer preference (localStorage shelf). */
  const [primitiveModes, setPrimitiveModes] = useState<Record<string, true>>(() =>
    loadPrimitiveModes(window.localStorage),
  );
  const primitiveMode =
    selectedBotEntry !== undefined && primitiveModes[selectedBotEntry.bot.id] === true;

  const togglePrimitiveMode = (): void => {
    if (selectedBotEntry === undefined) {
      return;
    }
    setPrimitiveModes(
      setPrimitiveMode(window.localStorage, selectedBotEntry.bot.id, !primitiveMode),
    );
  };

  const toggleDeepThinking = async (): Promise<void> => {
    if (selectedBotEntry === undefined) {
      return;
    }
    const enabled = !deepThinking;
    const result = await updateBotEntity(selectedBotEntry.bot.id, {
      modelProfileId: deepThinkingTargetId(enabled),
    });
    if (result.ok) {
      setToast(
        enabled
          ? t("reasoner.enabledToast")
          : t("reasoner.disabledToast"),
      );
    } else {
      setToast(t("reasoner.switchFailed", [result.errorCode ?? t("reasoner.unknownError")]));
    }
  };

  /**
   * Open the create dialog.
   *
   * A plain click leaves the name empty: naming is the user's business, and a
   * field that already holds a placeholder makes them clear it first. The
   * right-click entry (see the + button) pre-fills the next free BotNN instead,
   * for the times you just want a bot in a hurry.
   */
  const openCreateBotModal = (withSuggestedName = false) => {
    setTplDraft(null);
    // Unique per open, so the form remounts and picks up the freshly computed
    // suggestion even when the previous dialog was cancelled with a typed name.
    setTplSeed(`new-${Date.now()}`);
    setCreateName(
      withSuggestedName ? nextBotName(bots.map((b) => b.bot.name)) : "",
    );
    setShape(0);
    setColor(2);
    setAvatar({ kind: "grok", shape: "blob", color: "#3b93f0" });
    setEditingBot(null);
    setModalOpen(true);
  };

  const openEditBotModal = (bot: UiBot) => {
    setEditingBot(bot);
    setAvatar(bot.avatar);
    setModalOpen(true);
  };

  const submitBotDraft = async (
    draft: BotDraft,
  ): Promise<{ ok: boolean; errorCode?: string }> => {
    const look = toContractAvatar(avatar);
    if (editingBot) {
      const result = await updateBotEntity(editingBot.bot.id, { ...draft, avatar: look });
      if (result.ok) {
        setUi(editingBot.key, { avatar });
        setModalOpen(false);
        setToast(t("shell.saved"));
      }
      return result;
    }
    const result = await createBotEntity(look === null ? draft : { ...draft, avatar: look });
    if (result.ok && result.key !== undefined) {
      // 众生平等：弹窗不再选分组，新建 bot 一律进未分组（侧栏拖拽仍可整理）。
      setUi(result.key, { avatar, shape, color, group: UNGROUPED });
      setModalOpen(false);
      setToast(t("shell.created"));
    }
    return result;
  };

  /**
   * Open the inline rename field. Deferred by one task on purpose: mounting it
   * synchronously inside the double-click lets the tail of that click sequence
   * blur the fresh field, which fires the blur-commit and closes it again. The
   * deferral lets the click finish first.
   */
  const startRename = (botKey: number, name: string, scope: "row" | "header" = "row"): void => {
    window.setTimeout(() => {
      renameOpenedAtRef.current = performance.now();
      setRenameScope(scope);
      setRenameKey(botKey);
      setRenameDraft(name);
    }, 0);
  };

  /**
   * Blur handler for the rename field. A blur within the first moments of
   * opening is the tail of the opening gesture, not the user leaving, so the
   * caret goes back instead of the edit being committed away.
   */
  const handleRenameBlur = (uiBot: UiBot, raw: string): void => {
    if (performance.now() - renameOpenedAtRef.current < 400) {
      renameInputRef.current?.focus();
      return;
    }
    void commitRename(uiBot, raw);
  };

  /**
   * Commit an inline rename. The bot's other fields are untouched — the store
   * takes a partial patch — so renaming can never disturb the model profile or
   * the instructions. Empty and unchanged names are treated as a cancel.
   */
  const commitRename = async (uiBot: UiBot, raw: string): Promise<void> => {
    setRenameKey(null);
    const name = raw.trim();
    if (name === "" || name === uiBot.bot.name) {
      return;
    }
    const result = await updateBotEntity(uiBot.bot.id, { name });
    if (result.ok) {
      setToast(t("shell.renamed"));
    } else {
      setToast(result.errorCode === "REVISION_CONFLICT" ? t("shell.renameConflict") : t("shell.renameFailed"));
    }
  };

  const pinBot = (botKey: number): void => {
    moveToTop(botKey);
    setToast(t("shell.pinned"));
    setMenu(null);
  };

  const moveToGroup = (botKey: number, groupKey: number): void => {
    const g = groups.find((x) => x.key === groupKey);
    moveBotToGroup(botKey, groupKey);
    setToast(g ? t("shell.movedToGroup", [groupLabel(g)]) : t("shell.moved"));
    setMenu(null);
  };

  const toggleUnread = (botKey: number): void => {
    const b = bots.find((x) => x.key === botKey);
    setUi(botKey, { unread: !(b?.unread ?? false) });
    setMenu(null);
  };

  const copyText = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setToast(t("shell.copied"));
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.append(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        setToast(ok ? t("shell.copied") : t("shell.copyFailedPlaceholder"));
      } catch {
        setToast(t("shell.copyFailedPlaceholder"));
      }
    }
  };
  const copyBotId = async (botKey: number): Promise<void> => {
    const menuTarget = bots.find((b) => b.key === botKey);
    const id = menuTarget?.bot.id ?? `bot-${botKey}`;
    await copyText(id);
    setMenu(null);
  };

  const removeBot = (botKey: number, why: string): void => {
    forget(botKey);
    if (selectedBot === botKey) {
      setSelectedBot(null);
    }
    setToast(why);
    setMenu(null);
  };

  const hideFromSidebar = (botKey: number): void => {
    hide(botKey);
    if (selectedBot === botKey) {
      setSelectedBot(null);
    }
    setToast(t("shell.hiddenFromSidebar"));
    setMenu(null);
  };

  const restoreHiddenBot = (bot: UiBot): void => {
    unhide(bot.key);
    setSelectedBot(bot.key);
    setQuoteDraft(null);
    openThread(bot);
  };

    const sendUserMessage = (
    botKey: number,
    text: string,
    attachments?: Msg["attachments"],
    meta?: Msg["meta"],
  ): void => {
    const trimmed = text.trim();
    if (!trimmed && !(attachments && attachments.length > 0)) {
      return;
    }
    setChats((prev) => {
      const list = prev[botKey] ?? [];
      return {
        ...prev,
        [botKey]: [
          ...list,
          {
            id: Date.now(),
            from: "user",
            text: trimmed,
            quote: quoteDraft ? { ...quoteDraft } : null,
            reactions: {},
            mine: [],
            time: Date.now(),
            system: false,
            attachments: attachments && attachments.length > 0 ? attachments : undefined,
            origin: "live",
            ...(meta !== undefined ? { meta } : {}),
          },
        ],
      };
    });
    setQuoteDraft(null);
  };

  const toggleReaction = (botKey: number, msgId: number, emoji: Emoji): void => {
    setChats((prev) => ({
      ...prev,
      [botKey]: (prev[botKey] ?? []).map((m) => {
        if (m.id !== msgId) {
          return m;
        }
        const had = m.mine.includes(emoji);
        const count = (m.reactions[emoji] ?? 0) + (had ? -1 : 1);
        const reactions = { ...m.reactions, [emoji]: count };
        return {
          ...m,
          reactions,
          mine: had ? m.mine.filter((x) => x !== emoji) : [...m.mine, emoji],
        };
      }),
    }));
  };
  const talkTo = (fromKey: number, toKey: number): void => {
    const from = bots.find((b) => b.key === fromKey);
    const to = bots.find((b) => b.key === toKey);
    if (!from || !to) {
      return;
    }
    const now = Date.now();
    if (from.group !== to.group) {
      const g1 = groupLabel(groups.find((g) => g.key === from.group));
      const g2 = groupLabel(groups.find((g) => g.key === to.group));
      setChats((prev) => ({
        ...prev,
        [fromKey]: [
          ...(prev[fromKey] ?? []),
          {
            id: now + 2,
            from: "bot",
            text: t("shell.crossGroupChatBlocked", [g1, g2]),
            quote: null,
            reactions: {},
            mine: [],
            time: now,
            system: true,
          },
        ],
      }));
      return;
    }
    // Bot-to-bot dialogue: the transcript lives in the pair store; each main
    // timeline only gets a clickable delivery notice.
    const turns: { speaker: number; text: string }[] = [
      { speaker: fromKey, text: t("shell.botGreetingTurn", [to.bot.name, from.bot.name]) },
      { speaker: toKey, text: t("shell.botReplyTurn", [from.bot.name]) },
      {
        speaker: fromKey,
        text: t("shell.botPlaceholderTurn"),
      },
      { speaker: toKey, text: t("shell.botEagerTurn") },
    ];
    const pairKey = pairKeyOf(fromKey, toKey);
    setPairTranscripts((prev) => ({
      ...prev,
      [pairKey]: [
        ...(prev[pairKey] ?? []),
        ...turns.map((turn, index) => ({
          id: now + 1 + index,
          speakerKey: turn.speaker,
          text: turn.text,
          time: now,
        })),
      ],
    }));
    setChats((prev) => ({
      ...prev,
      [fromKey]: [
        ...(prev[fromKey] ?? []),
        {
          id: now + 9,
          from: "bot",
          text: "",
          quote: null,
          reactions: {},
          mine: [],
          time: now,
          system: true,
          notice: { label: t("shell.sentTo"), otherKey: toKey },
          deliverTo: [toKey],
          peerKey: toKey,
        },
      ],
      [toKey]: [
        ...(prev[toKey] ?? []),
        {
          id: now + 10,
          from: "bot",
          text: "",
          quote: null,
          reactions: {},
          mine: [],
          time: now,
          system: true,
          notice: { label: t("shell.repliedOnlyTo"), otherKey: fromKey },
          peerKey: fromKey,
        },
      ],
    }));
  };

  /**
   * G1' 分组实体化: membership persists through bot.update's `groupId` patch
   * (null = 未分组). The local UI moves first and reverts when the Host
   * refuses; REVISION_CONFLICT additionally triggers the hook's refresh.
   */
  const moveBotToGroup = (botKey: number, groupKey: number): void => {
    const b = bots.find((x) => x.key === botKey);
    const g = groups.find((x) => x.key === groupKey);
    if (!b || !g) {
      return;
    }
    const previousGroup = b.group;
    setUi(botKey, { group: groupKey });
    void updateBotEntity(b.bot.id, { groupId: g.groupId }).then((result) => {
      if (!result.ok) {
        setUi(botKey, { group: previousGroup });
        setToast(t("shell.moveFailed"));
      }
    });
  };

  /**
   * G1' 分组实体化: creating a group persists it (`group.create`) before it
   * shows up, so it survives restarts; an optional bot moves in through the
   * entity-backed move (bot.update's groupId patch).
   */
  const submitDialog = (): void => {
    if (!menuDialog) {
      return;
    }
    const name = dialogText.trim();
    if (!name) {
      return;
    }
    const moveBot = menuDialog.moveBot;
    setMenuDialog(null);
    void desktop.groups
      .create(name)
      .then((group) => {
        const key = nextGroupKey.current++;
        setGroups((prev) => [
          ...prev,
          { key, name: group.name, groupId: group.id, revision: group.revision },
        ]);
        if (moveBot !== null) {
          moveBotToGroup(moveBot, key);
          setToast(t("shell.groupCreatedAndMovedIn", [name]));
        } else {
          setToast(t("shell.groupCreated", [name]));
        }
      })
      .catch(() => {
        setToast(t("shell.moveFailed"));
      });
  };

  /**
   * Onboarding (对标学习): a freshly created bot greets the user by name and
   * offers a choice card whose options are derived from the name — no model
   * call, deterministic, and the trailing 「我自己说」/「其他」 always let the
   * user answer in their own words. One message: greeting text with the card
   * attached underneath.
   */
  const welcomeThread = (botKey: number, botName: string): Msg[] => {
    const now = Date.now();
    const card = onboardingCardFor(botName, currentLanguage());
    return [
      {
        id: botKey,
        from: "bot",
        text: card.greeting,
        quote: null,
        reactions: {},
        mine: [],
        time: now,
        system: false,
        speakerKey: botKey,
        origin: "seed",
        choices: {
          question: card.question,
          options: card.options,
          other: card.other,
        },
      },
    ];
  };

  const storedThread = (rows: Parameters<typeof historyThreadMessages>[0], botKey: number): Msg[] =>
    historyThreadMessages(rows, botKey).map((message) => ({
      id: message.id,
      from: message.from,
      text: message.text,
      quote: null,
      reactions: {},
      mine: [],
      time: message.time,
      system: false,
      origin: "history" as const,
      history: message.history,
      ...(message.speakerKey !== undefined ? { speakerKey: message.speakerKey } : {}),
      ...(message.choices !== undefined ? { choices: message.choices } : {}),
    }));

  /**
   * First open of a bot reads chat.history. The welcome seed shows immediately
   * and is replaced when stored rows exist. A later open in this session keeps
   * the in-memory thread, including sends appended after the load.
   */
  const openThread = (bot: UiBot): void => {
    if (threadHistoryLoaded.current.has(bot.key)) {
      return;
    }
    threadHistoryLoaded.current.add(bot.key);
    const botKey = bot.key;
    const botName = bot.bot.name;
    setChats((prev) => {
      if ((prev[botKey] ?? []).length > 0) {
        return prev;
      }
      return { ...prev, [botKey]: welcomeThread(botKey, botName) };
    });
    // Omit sessionId: the host reads this bot's one default conversation.
    // Stored extra sessions are not requested.
    const scoped = scopeToBotConversation({
      botId: bot.bot.id,
      limit: CHAT_THREAD_HISTORY_LIMIT,
    });
    void desktop.chat
      .history(scoped.botId, scoped.limit)
      .then((rows) => {
        const history = storedThread(rows, botKey);
        const seed = welcomeThread(botKey, botName);
        setChats((prev) => ({
          ...prev,
          [botKey]: mergeOpenedThread(history, prev[botKey] ?? [], seed),
        }));
      })
      .catch(() => {
        threadHistoryLoaded.current.delete(botKey);
      });
  };

  useEffect(() => {
    if (selectedBot === null) {
      return;
    }
    const bot = bots.find((candidate) => candidate.key === selectedBot);
    if (bot === undefined) {
      return;
    }
    openThread(bot);
  }, [selectedBot, bots, desktop]);

  const dropBotToGroup = (botKey: number, groupKey: number): void => {
    const b = bots.find((x) => x.key === botKey);
    const g = groups.find((x) => x.key === groupKey);
    if (!b || !g) {
      return;
    }
    if (b.group === groupKey) {
      setToast(t("shell.alreadyInGroup"));
      return;
    }
    moveBotToGroup(botKey, groupKey);
    setToast(t("shell.draggedToGroup", [b.bot.name, groupLabel(g)]));
  };

  const deleteGroup = (groupKey: number): void => {
    const g = groups.find((x) => x.key === groupKey);
    if (!g) {
      return;
    }
    const members = bots.filter((b) => b.group === groupKey);
    if (members.length > 0) {
      setToast(t("shell.groupNotEmpty"));
      setGroupMenu(null);
      return;
    }
    const removeLocal = (): void => {
      setGroups((prev) => prev.filter((x) => x.key !== groupKey));
      setCollapsedGroups((prev) => prev.filter((k) => k !== groupKey));
      setToast(t("shell.groupDeleted", [groupLabel(g)]));
      setGroupMenu(null);
    };
    // G1' 分组实体化: persisted groups archive through group.archive so the
    // deletion survives restarts; 未分组 (no UUID) stays local-only.
    if (g.groupId === null || g.revision === null) {
      removeLocal();
      return;
    }
    void desktop.groups
      .archive(g.groupId, g.revision)
      .then(removeLocal)
      .catch(() => {
        setToast(t("shell.groupDeleteFailed"));
        setGroupMenu(null);
      });
  };

  const pickAccountPhoto = (): void => {
    if (pickingAvatar.current) return;
    pickingAvatar.current = true;
    void window.deepseekBot.account
      .pickImage()
      .then((result) => {
        if (!result.ok) {
          if (result.code !== "cancelled") setToast(t("shell.avatarUnreadable"));
          return;
        }
        const avatar = accountImageAvatar(result.dataUrl);
        if (avatar === null) {
          setToast(t("shell.avatarUnreadable"));
          return;
        }
        setAccountAvatar(avatar);
      })
      .catch(() => setToast(t("shell.avatarUnreadable")))
      .finally(() => {
        pickingAvatar.current = false;
      });
  };

const logout = (): void => {
    setAccountName(UNSET_ACCOUNT_NAME);
    setTheme("dark");
    setEditingName(false);
    setSettingsOpen(false);
    setToast(t("shell.loggedOutPlaceholder"));
  };

  const saveName = (): void => {
    const n = nameDraft.trim();
    if (n) {
      setAccountName(n);
    }
    setEditingName(false);
  };

  const menuBot = menu ? bots.find((b) => b.key === menu.botKey) : undefined;

  const searchIndex = useMemo<SearchItem[]>(() => {
    const messages: {
      botKey: number;
      botId: string;
      botName: string;
      text: string;
      time: number;
    }[] = [];
    for (const [botKey, list] of Object.entries(chats)) {
      const entry = bots.find((b) => b.key === Number(botKey));
      // An orphan chat (bot archived/deleted) has no uuid to navigate by and
      // stays out of the index.
      if (entry === undefined) {
        continue;
      }
      for (const msg of list) {
        if (msg.system || msg.notice) {
          continue;
        }
        messages.push({
          botKey: Number(botKey),
          botId: entry.bot.id,
          botName: entry.bot.name,
          text: msg.text,
          time: msg.time,
        });
      }
    }
    return buildSearchIndex({
      bots: bots.map((b) => ({
        key: b.key,
        id: b.bot.id,
        name: b.bot.name,
        group: groupLabel(groups.find((g) => g.key === b.group)),
      })),
      messages,
      actions: [
        {
          id: "action-settings",
          kind: "action",
          title: t("shell.openSettings"),
          subtitle: t("shell.settingsSubtitle"),
          action: "settings",
        },
        {
          id: "action-monitor",
          kind: "action",
          title: t("shell.openRunMonitor"),
          subtitle: "FR-06/07",
          action: "monitor",
        },
        {
          id: "action-workflow",
          kind: "action",
          title: t("shell.openWorkflowEditor"),
          subtitle: "FR-04",
          action: "workflow",
        },
      ],
    });
  }, [bots, groups, chats]);

  const onSearchSelect = (item: SearchItem): void => {
    // Host hits carry the bot uuid; local items still navigate by bot key.
    if (item.kind === "bot" || item.kind === "message" || item.kind === "artifact") {
      const target =
        (item.botId !== undefined
          ? bots.find((b) => b.bot.id === item.botId)
          : undefined) ?? bots.find((b) => b.key === item.botKey);
      if (target) {
        setSelectedBot(target.key);
        setQuoteDraft(null);
        openThread(target);
        if (item.kind === "artifact" && item.path !== undefined && item.botId !== undefined) {
          setCanvas({
            botKey: target.key,
            botId: target.bot.id,
            botName: target.bot.name,
            path: item.path,
          });
        }
      }
      return;
    }
    // D25 host workflow hits: the editor has no external selection state, so
    // opening the view is the honest navigation (known boundary, TASK doc §4).
    if (item.kind === "workflow") {
      setMonitorOpen(false);
      setWorkflowOpen(true);
      return;
    }
    if (item.action === "settings") {
      setSettingsOpen(true);
    } else if (item.action === "monitor") {
      setWorkflowOpen(false);
      setMonitorOpen(true);
    } else if (item.action === "workflow") {
      setMonitorOpen(false);
      setWorkflowOpen(true);
    }
  };

  return (
    <div className="shell">
      <header className="top">
        <span className="page-chip" data-gaze-zone="">
          {selectedBotEntry ? (
            <GazeAvatar avatar={selectedBotEntry.avatar} variant="message-header" />
          ) : (
            <BlobMark />
          )}
          {selectedBotName}
        </span>
        <button
          type="button"
          className={"top-icon-btn" + (monitorOpen ? " active" : "")}
          aria-label={t("shell.runMonitorApprovals")}
          title={t("shell.runMonitorApprovals")}
          onClick={() => {
            setWorkflowOpen(false);
            setMonitorOpen((v) => !v);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M3 13h3.5l2-6 3 12 2.5-8 2 4.5H21"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className={"top-icon-btn" + (workflowOpen ? " active" : "")}
          aria-label={t("shell.workflowEditor")}
          title={t("shell.workflowEditor")}
          onClick={() => {
            setMonitorOpen(false);
            setWorkflowOpen((v) => !v);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="4" width="7" height="6" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <rect x="14" y="14" width="7" height="6" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M6.5 10v4a2 2 0 0 0 2 2H14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="6.5" cy="17" r="1.4" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className="top-icon-btn"
          aria-label={t("shell.recentSessions")}
          title={t("shell.recentSessions")}
          onClick={() => {
            setArtifactsOpen(false);
            setHistoryOpen((v) => !v);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="top-icon-btn artifacts-btn"
          aria-label={t("shell.artifacts")}
          title={t("shell.artifacts")}
          onClick={() => {
            setHistoryOpen(false);
            setArtifactsOpen((v) => !v);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a1.8 1.8 0 0 1-2.5-2.5L15 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="top-icon-btn"
          aria-label={t("shell.exportConversation")}
          title={t("shell.exportConversation")}
          onClick={() => {
            if (selectedBotEntry === undefined) return;
            exportConversation(
              selectedBotEntry.bot.name,
              chats[selectedBotEntry.key] ?? [],
            );
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {historyOpen && (
          <>
            <div className="menu-overlay" onClick={() => setHistoryOpen(false)} />
            <div className="top-popover" role="dialog" aria-label={t("shell.recentSessions")}>
              <div className="popover-title">{t("shell.recentSessions")}</div>
            </div>
          </>
        )}
        {artifactsOpen && (
          <>
            <div className="menu-overlay" onClick={() => setArtifactsOpen(false)} />
            <div className="top-popover artifacts-popover" role="dialog" aria-label={t("shell.artifacts")}>
              <div className="popover-title">{t("shell.artifactsWorkspaceTitle")}</div>
              {(artifactList ?? []).map((artifact) => (
                <div className="artifact-item" key={artifact.relativePath}>
                  <div className="artifact-meta">
                    <div className="tab-title">{artifact.relativePath}</div>
                    <div className="session-meta">
                      {artifact.mediaType} · {artifact.size} bytes
                    </div>
                  </div>
                  {selectedBotEntry !== undefined && selectedBot !== null && (
                    <button
                      type="button"
                      className="pill-btn"
                      onClick={() => {
                        setArtifactsOpen(false);
                        setCanvas({
                          botKey: selectedBot,
                          botId: selectedBotEntry.bot.id,
                          botName: selectedBotEntry.bot.name,
                          path: artifact.relativePath,
                        });
                      }}
                    >
                      {t("shell.openInCanvas")}
                    </button>
                  )}
                </div>
              ))}
              {(artifactList ?? []).length === 0 && <div className="sys-line">{t("shell.noArtifacts")}</div>}
            </div>
          </>
        )}
      </header>
      <div className="shell-main">
      <aside className="sidebar">
        <div className="top-left">
          <button
            type="button"
            className="circle-btn clickable"
            aria-label={t("shell.globalSearch")}
            title={t("shell.globalSearch")}
            onClick={() => setSearchOpen(true)}
          >
            <svg viewBox="0 0 24 24">
              <circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
              <line x1="15.5" y1="15.5" x2="20" y2="20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className="circle-btn clickable"
            aria-label={t("shell.createNewBot")}
            title={t("shell.createNewBotHint")}
            onClick={() => openCreateBotModal()}
            onContextMenu={(e) => {
              // The shortcut: right-click creates one that is already named.
              e.preventDefault();
              openCreateBotModal(true);
            }}
          >
            <svg viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="side-identity" data-gaze-zone="">
          <span className="big-avatar">
            <GazeAvatar
              avatar={headerBot?.avatar ?? { kind: "grok", shape: "circle", color: "#3b93f0" }}
              variant="preview"
              size={84}
            />
          </span>
          {headerBot !== null && renameKey === headerBot.key && renameScope === "header" ? (
            <input
              className="tab-rename identity-rename"
              value={renameDraft}
              /* A ref callback focuses and selects on mount. `autoFocus` alone
                 lost the race against the double-click that created the field,
                 so the text arrived unselected and unfocused. */
              ref={(el) => {
                renameInputRef.current = el;
                el?.focus();
                el?.select();
              }}
              maxLength={80}
              aria-label={t("shell.renameBot", [headerBot.bot.name])}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commitRename(headerBot, renameDraft);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setRenameKey(null);
                }
              }}
              onBlur={() => handleRenameBlur(headerBot, renameDraft)}
            />
          ) : (
            <span
              className="identity-name"
              title={headerBot === null ? undefined : t("shell.renameByDoubleClick")}
              onDoubleClick={() => {
                if (headerBot === null) {
                  return;
                }
                startRename(headerBot.key, headerBot.bot.name, "header");
              }}
            >
              {headerBot?.bot.name ?? "DeepSeek Bot"}
            </span>
          )}
        </div>
        {/* Only the bot list scrolls: the identity block above and the account
            row below stay put no matter how many bots are added. */}
        <div className="sidebar-scroll">
        {groups.map((g) => {
          const members = bots.filter((b) => b.group === g.key);
          return (
            <div
              key={g.key}
              className={"group-section" + (dragOverGroup === g.key ? " drag-over" : "")}
              onDragOver={(e) => {
                if (!dragging) {
                  return;
                }
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragOverGroup(g.key);
              }}
              onDragLeave={() => {
                if (dragOverGroup === g.key) {
                  setDragOverGroup(null);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                const k = Number(e.dataTransfer.getData("text/plain"));
                if (Number.isFinite(k) && k > 0) {
                  dropBotToGroup(k, g.key);
                }
                setDragOverGroup(null);
                setDragging(false);
              }}
            >
              <button
                type="button"
                className="group-label"
                aria-expanded={!collapsedGroups.includes(g.key)}
                onClick={() => toggleGroupCollapsed(g.key)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setGroupMenu({ x: e.clientX, y: e.clientY, groupKey: g.key });
                }}
              >
                <span
                  className={
                    "group-chevron" + (collapsedGroups.includes(g.key) ? " collapsed" : "")
                  }
                  aria-hidden="true"
                >
                  ›
                </span>
                {groupLabel(g)}
                {!collapsedGroups.includes(g.key) && members.length > 0 && (
                  <span className="group-count">{members.length}</span>
                )}
              </button>
              {!collapsedGroups.includes(g.key) && (
                <div className="tabs" aria-label={t("shell.botListAriaLabel", [groupLabel(g)])}>
                  {members.map((b) =>
                  renameKey === b.key && renameScope === "row" ? (
                    /* Inline rename: the row becomes an editable field in place.
                       Esc cancels, Enter or blur commits, and the store takes a
                       partial patch so nothing but the name can change. */
                    <div key={b.key} className="tab tab-renaming" data-gaze-zone="">
                      <GazeAvatar avatar={b.avatar} variant="sidebar" size={36} />
                      <input
                        className="tab-rename"
                        value={renameDraft}
                        ref={(el) => {
                          renameInputRef.current = el;
                          el?.focus();
                          el?.select();
                        }}
                        maxLength={80}
                        aria-label={t("shell.renameBot", [b.bot.name])}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void commitRename(b, renameDraft);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            setRenameKey(null);
                          }
                        }}
                        onBlur={() => handleRenameBlur(b, renameDraft)}
                      />
                    </div>
                  ) : (
                  <button
                    key={b.key}
                    data-gaze-zone=""
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", String(b.key));
                      e.dataTransfer.effectAllowed = "move";
                      setDragging(true);
                      const ghost = document.createElement("div");
                      ghost.className = "drag-ghost";
                      if (b.avatar.kind === "grok") {
                        const face = document.createElement("span");
                        face.className = "drag-ghost-avatar drag-ghost-minimal";
                        face.style.background =
                          b.avatar.color === "mono"
                            ? "var(--avatar-mono-bg)"
                            : b.avatar.color;
                        ghost.append(face);
                      } else {
                        const face = document.createElement("span");
                        face.className = "drag-ghost-avatar";
                        face.style.background = "var(--avatar-mono-bg)";
                        ghost.append(face);
                      }
                      document.body.append(ghost);
                      e.dataTransfer.setDragImage(ghost, 26, 26);
                      setTimeout(() => ghost.remove(), 0);
                    }}
                    onDragEnd={() => {
                      setDragging(false);
                      setDragOverGroup(null);
                    }}
                    className={selectedBot === b.key ? "tab active" : "tab"}

                    onClick={() => {
                      setSelectedBot(b.key);
                      setQuoteDraft(null);
                      openThread(b);
                    }}
                    onDoubleClick={() => startRename(b.key, b.bot.name)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, botKey: b.key });
                    }}
                  >
                    <GazeAvatar avatar={b.avatar} variant="sidebar" size={36} />
                    <span className="tab-label">
                      <span className="tab-title">
                        {b.bot.name}
                        {b.unread && <span className="unread-dot" aria-label={t("shell.unread")} />}
                      </span>

                    </span>
                  </button>
                  )
                )}
                {selectedBot !== null &&
                  members.some((member) => member.key === selectedBot) && (
                    <BotSessionSublist />
                  )}
                {dragging && members.length === 0 && (
                  <div className="drop-hint">{t("shell.dropToMove", [groupLabel(g)])}</div>
                )}
                </div>
              )}
            </div>
          );
        })}
        {hiddenBots.length > 0 && (
          <div className="group-section">
            <div className="group-label static" id="hidden-bots-label">
              {t("shell.hiddenBots")}
              <span className="group-count">{hiddenBots.length}</span>
            </div>
            <div className="tabs" role="list" aria-labelledby="hidden-bots-label">
              {hiddenBots.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  className="tab"
                  title={t("shell.showInSidebar")}
                  onClick={() => restoreHiddenBot(b)}
                >
                  <GazeAvatar avatar={b.avatar} variant="sidebar" size={36} />
                  <span className="tab-label">
                    <span className="tab-title">{b.bot.name}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        </div>
        {updateStatus?.available && (
          <button
            type="button"
            className="update-badge"
            title={t("shell.downloadAndInstall", [
              updateStatus.version ?? t("d22.newVersionFallback"),
            ])}
            onClick={() => {
              const bridge = window.deepseekBot;
              if (!bridge || !("updates" in bridge)) {
                return;
              }
              setUpdateStatus({ ...updateStatus, downloading: true });
              void bridge.updates
                .downloadInstall()
                .then(setUpdateStatus)
                .catch(() => setUpdateStatus({ ...updateStatus, downloading: false, error: t("shell.downloadFailed") }));
            }}
          >
            <span className="update-badge-dot" />
            {updateStatus.downloading ? t("shell.updateDownloading") : t("shell.updateAvailable")}
          </button>
        )}
        <div className="sidebar-foot">
          <button
            type="button"
            className="foot-account"
            title={t("shell.openSettings")}
            aria-label={t("shell.openSettings")}
            onClick={() => setSettingsOpen(true)}
          >
            <span className="avatar" aria-hidden="true">
              <AvatarView avatar={accountAvatar} variant="sidebar" size={34} />
            </span>
            <span className="foot-id">
              <span className="foot-name">{displayName}</span>
              <span className="foot-sub">{t("shell.localWorkspace")}</span>
            </span>
          </button>
          <button
            type="button"
            className="foot-gear"
            aria-label={t("shell.openSettings")}
            title={t("shell.openSettings")}
            onClick={() => setSettingsOpen(true)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path
                d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <SidebarResizer />
      </aside>
      <section className="content">
        <main className="panel">
          {monitorOpen ? (
            <RunMonitor onClose={() => setMonitorOpen(false)} />
          ) : workflowOpen ? (
            <WorkflowEditor onClose={() => setWorkflowOpen(false)} />
          ) : selectedBot !== null ? (
            <BotsPlaceholder
              key={selectedBot}
              bots={bots}
              groups={groups}
              selectedBot={selectedBot}
              stream={streams[selectedBot] ?? null}
              streamHandles={streamHandles.current}
              onStreamUpdate={(update) => updateStreamState(selectedBot, update)}
              msgs={chats[selectedBot] ?? []}
              pairTranscripts={pairTranscripts}
              quoteDraft={quoteDraft}
              primitiveMode={primitiveMode}
              onTogglePrimitive={togglePrimitiveMode}
              deepThinking={deepThinking}
              onToggleDeepThinking={() => {
                void toggleDeepThinking();
              }}
              onQuote={(m) => {
                const sender =
                  m.from === "bot"
                    ? bots.find((b) => b.key === (m.speakerKey ?? selectedBot))?.bot.name ?? "Bot"
                    : t("shell.me");
                setQuoteDraft({ name: sender, text: m.text.slice(0, 60) });
              }}
              onPairQuote={(name, text) => setQuoteDraft({ name, text: text.slice(0, 60) })}
              onCancelQuote={() => setQuoteDraft(null)}
              onSend={(text, attachments, meta) => sendUserMessage(selectedBot, text, attachments, meta)}
                onAnswerSeedCard={(botKey, msgId, text) =>
                  setChats((prev) => ({
                    ...prev,
                    [botKey]: answerSeedCard(prev[botKey] ?? [], msgId, text),
                  }))
                }
                onBotStatus={reportBotStatus}
                onReplyCompleted={(botId, botName) => {
                  raiseNotice({ kind: "reply", botId, botName });
                }}
                onApprovalPending={(botId, botName, count) => {
                  reportBotStatus(botId, count > 0 ? "waiting-approval" : "idle");
                  if (count > 0) {
                    raiseNotice({ kind: "approval", botId, botName });
                  }
                }}
                onAssistant={(assistantText) =>
                setChats((prev) => {
                  const list = prev[selectedBot] ?? [];
                  const now = Date.now();
                  const tail = list[list.length - 1];
                  if (
                    tail !== undefined &&
                    isSameStoredTurn(tail, { from: "bot", text: assistantText }, now)
                  ) {
                    return prev;
                  }
                  return {
                    ...prev,
                    [selectedBot]: [
                      ...list,
                      {
                        id: now + 1,
                        from: "bot",
                        text: assistantText,
                        quote: null,
                        reactions: {},
                        mine: [],
                        time: now,
                        system: false,
                        speakerKey: selectedBot,
                        origin: "live",
                      },
                    ],
                  };
                })
              }
              onReact={(msgId, emoji) => toggleReaction(selectedBot, msgId, emoji)}
              onTalkTo={(otherKey) => talkTo(selectedBot, otherKey)}
              onCopy={(text) => void copyText(text)}
              onNotify={(message) => setToast(message)}
              onOpenAttachment={(relativePath) => {
                const bot = bots.find((item) => item.key === selectedBot);
                if (bot === undefined || selectedBot === null) return;
                setCanvas({
                  botKey: selectedBot,
                  botId: bot.bot.id,
                  botName: bot.bot.name,
                  path: relativePath,
                });
              }}
              onOpenAutomation={() => {
                setSettingsOpen(true);
                setSettingsSection("general");
              }}
              skillContext={(botId) => skillsForInjection(botId, skillLibrary)}
              voiceLanguage={voiceLanguage}
              voiceConfigVersion={voiceConfigVersion}
              onOpenBot={(botKey) => {
                const target = bots.find((b) => b.key === botKey);
                if (target) {
                  setSelectedBot(botKey);
                  setQuoteDraft(null);
                  openThread(target);
                }
              }}
            />
          ) : (
            <div className="empty-state">
              <div className="empty-hero">
                <BlobMark />
                <CloudDecor />
              </div>
              <p>{t("shell.emptyStateHint")}</p>
              <button type="button" className="primary-btn" onClick={() => openCreateBotModal()}>
                {t("shell.createBot")}
              </button>
            </div>
          )}
        </main>
      </section>
      {canvas !== null && (
        <CanvasSidecar
          key={`${canvas.botId}:${canvas.path}`}
          service={desktop}
          botId={canvas.botId}
          botName={canvas.botName}
          relativePath={canvas.path}
          onClose={() => setCanvas(null)}
        />
      )}
      </div>

      {menu && menuBot && (
        <>
          <div className="menu-overlay" onClick={() => setMenu(null)} />
          <div
            ref={menuRef}
            className="menu"
            role="menu"
            aria-label={t("shell.botActionsMenuLabel", [menuBot.bot.name])}
            style={{ left: menu.x, top: menu.y }}
          >
            <button type="button" role="menuitem" className="menu-item" onClick={() => pinBot(menuBot.key)}>
              <MenuIcon d="M12 17v5M9 3h6l1 7 3 3H5l3-3 1-7Z" />
              {t("shell.pinToTop")}
            </button>
            <div className="menu-sub-wrap">
              <button type="button" role="menuitem" className="menu-item" onClick={(e) => e.currentTarget.focus()}>
                <MenuIcon d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
                {t("shell.moveTo")}
                <span className="menu-arrow">›</span>
              </button>
              <div className="submenu" role="menu" aria-label={t("shell.moveToGroup")}>
                {groups.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => moveToGroup(menuBot.key, g.key)}
                  >
                    {menuBot.group === g.key && <span className="menu-check">✓</span>}
                    {groupLabel(g)}
                  </button>
                ))}
                <div className="menu-sep" />
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    setDialogText("");
                    setMenuDialog({ type: "newGroup", moveBot: menuBot.key });
                    setMenu(null);
                  }}
                >
                  <MenuIcon d="M12 5v14M5 12h14" />
                  {t("shell.createGroupMenuItem")}
                </button>
              </div>
            </div>
            <button type="button" role="menuitem" className="menu-item" onClick={() => toggleUnread(menuBot.key)}>
              <MenuIcon d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M10.3 21a2 2 0 0 0 3.4 0" />
              {menuBot.unread ? t("shell.markRead") : t("shell.markUnread")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                // Same inline editor the double-click opens: renaming should not
                // require opening the whole edit dialog.
                startRename(menuBot.key, menuBot.bot.name);
                setMenu(null);
              }}
            >
              <MenuIcon d="M4 7h10M4 12h7M4 17h10M18 5v9M15 11l3 3 3-3" />
              {t("shell.renameAction")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                openEditBotModal(menuBot);
                setMenu(null);
              }}
            >
              <MenuIcon d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
              {t("shell.editBotMenuItem")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                void (async () => {
                  const result = await duplicateBotEntity(menuBot.bot.id);
                  setToast(result.ok ? t("shell.duplicatedCopy") : t("shell.copyFailed"));
                })();
                setMenu(null);
              }}
            >
              <MenuIcon d="M9 9h10v12H9zM5 15H3V3h12v2" />
              {t("shell.duplicateBot")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                saveBotTemplate(menuBot);
                setMenu(null);
              }}
            >
              <MenuIcon d="M4 5h16v4H4zM6 9v10h12V9M10 13h4" />
              {t("shell.saveAsTemplate")}
            </button>
            <button type="button" role="menuitem" className="menu-item" onClick={() => void copyBotId(menuBot.key)}>
              <MenuIcon d="M9 9h10v12H9zM5 15H3V3h12v2" />
              {t("shell.copyChatId")}
            </button>
            <div className="menu-sep" />
            <button type="button" role="menuitem" className="menu-item" onClick={() => hideFromSidebar(menuBot.key)}>
              <MenuIcon d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M7 11v-3a5 5 0 0 1 9.9-1M21 16v2a2 2 0 0 1-2 2H7" />
              {t("shell.hideFromSidebar")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item danger"
              onClick={() => {
                setMenu(null);
                setDeleteTarget(menuBot);
              }}
            >
              <MenuIcon d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13" />
              {t("shell.delete")}
            </button>
          </div>
        </>
      )}

      {menuDialog && (
        <div className="modal-backdrop" onClick={() => setMenuDialog(null)}>
          <div
            className="modal compact"
            role="dialog"
            aria-modal="true"
            aria-label={t("shell.createGroup")}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-head">
              <h3>{t("shell.createGroup")}</h3>
              <button type="button" className="modal-close" aria-label={t("shell.close")} onClick={() => setMenuDialog(null)}>
                ×
              </button>
            </header>
            <div className="modal-body">
              <input
                className="name-input"
                placeholder={t("shell.groupName")}
                value={dialogText}
                maxLength={40}
                autoFocus
                onChange={(e) => setDialogText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    submitDialog();
                  }
                }}
              />
            </div>
            <footer className="modal-foot">
              <button type="button" className="ghost-btn" onClick={() => setMenuDialog(null)}>
                {t("shell.cancel")}
              </button>
              <button type="button" className="primary-btn" disabled={!dialogText.trim()} onClick={submitDialog}>
                {t("shell.confirm")}
              </button>
            </footer>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-backdrop" onClick={() => setDeleteTarget(null)}>
          <div
            className="modal compact delete-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-bot-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-head">
              <h3 id="delete-bot-title">{t("shell.deleteConfirmTitle", [deleteTarget.bot.name])}</h3>
            </header>
            <div className="modal-body">
              <p className="delete-copy">{t("shell.deleteBotWarning")}</p>
            </div>
            <footer className="modal-foot delete-foot">
              <button type="button" className="ghost-btn" onClick={() => setDeleteTarget(null)}>
                {t("shell.cancel")}
              </button>
              <button
                type="button"
                className="danger-btn"
                onClick={() => {
                  removeBot(deleteTarget.key, t("shell.deleted"));
                  setDeleteTarget(null);
                }}
              >
                {t("shell.delete")}
              </button>
            </footer>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="modal-backdrop" onClick={() => setModalOpen(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={editingBot ? t("shell.editBot") : t("shell.createNewBot")}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-head">
              <h3>{editingBot ? t("shell.editBot") : t("shell.createNewBot")}</h3>
              <button type="button" className="modal-close" aria-label={t("shell.close")} onClick={() => setModalOpen(false)}>
                ×
              </button>
            </header>
            <div className="modal-body">
              {!editingBot && botTemplates.length > 0 && (
                <div className="tpl-row" role="group" aria-label={t("shell.startFromTemplate")}>
                  <span className="tpl-label">{t("shell.template")}</span>
                  {botTemplates.map((tpl) => (
                    <span className="tpl-chip-wrap" key={tpl.id}>
                      <button
                        type="button"
                        className="tpl-chip"
                        title={t("shell.fillWithTemplate", [tpl.name])}
                        onClick={() => {
                          setAvatar(tpl.bot.avatarUi.avatar as AvatarKind);
                          setShape(tpl.bot.avatarUi.shape);
                          setColor(tpl.bot.avatarUi.color);
                          const seed = bots[0]?.bot;
                          setTplDraft({
                            name: tpl.bot.name,
                            instructions: tpl.bot.instructions,
                            modelProfileId: seed?.modelProfileId ?? "44444444-4444-4444-8444-444444444444",
                            workspaceId: seed?.workspaceId ?? "55555555-5555-4555-8555-555555555555",
                            toolPolicyId: seed?.toolPolicyId ?? "66666666-6666-4666-8666-666666666666",
                          });
                          setTplSeed(tpl.id);
                        }}
                      >
                        {tpl.name}
                      </button>
                      <button
                        type="button"
                        className="tpl-chip-remove"
                        aria-label={t("shell.deleteTemplate", [tpl.name])}
                        onClick={() => {
                          setBotTemplates(deleteTemplate(window.localStorage, tpl.id));
                        }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <BotForm
                key={editingBot?.bot.id ?? tplSeed}
                {...(!editingBot && tplDraft ? { initial: tplDraft } : {})}
                {...(!editingBot && !tplDraft ? { defaultName: createName } : {})}
                {...(editingBot
                  ? {
                      initial: {
                        name: editingBot.bot.name,
                        instructions: editingBot.bot.instructions,
                        modelProfileId: editingBot.bot.modelProfileId,
                        workspaceId: editingBot.bot.workspaceId,
                        toolPolicyId: editingBot.bot.toolPolicyId,
                        role: editingBot.bot.role,
                      },
                    }
                  : {})}
                submitLabel={editingBot ? t("shell.save") : t("shell.create")}
                minimal={!editingBot}
                onSubmit={submitBotDraft}
                onCancel={() => setModalOpen(false)}
                previewSlot={
                  <div className="preview">
                    <AvatarView avatar={avatar} variant="preview" size={editingBot ? 100 : 80} />
                  </div>
                }
                avatarSlot={<AvatarPicker value={avatar} onChange={setAvatar} theme={theme} />}
                skillsSlot={
                  editingBot ? (
                    <BotSkillsPicker
                      skills={skillLibrary.skills}
                      selected={skillLibrary.bindings[editingBot.bot.id] ?? []}
                      onChange={(ids) =>
                        updateLibrary(
                          setBotSkills(skillLibrary, editingBot.bot.id, ids),
                        )
                      }
                    />
                  ) : undefined
                }
              />
            </div>
          </div>
        </div>
      )}

      {groupMenu && (
        <>
          <div className="menu-overlay" onClick={() => setGroupMenu(null)} />
          <div
            ref={groupMenuRef}
            className="menu"
            role="menu"
            aria-label={t("shell.groupActions")}
            style={{ left: groupMenu.x, top: groupMenu.y }}
          >
            <button
              type="button"
              role="menuitem"
              className="menu-item danger"
              onClick={() => deleteGroup(groupMenu.groupKey)}
            >
              <MenuIcon d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13" />
              {t("shell.deleteGroup")}
              {bots.filter((b) => b.group === groupMenu.groupKey).length > 0 &&
                t("shell.moveBotsOutFirst")}
            </button>
          </div>
        </>
      )}

      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div
            className="settings"
            role="dialog"
            aria-modal="true"
            aria-label={t("shell.settings")}
            onClick={(e) => e.stopPropagation()}
          >
            <SettingsNav active={settingsSection} onSelect={setSettingsSection} />
            <div className="settings-main">
              <header className="settings-head">
                <h3>
                  {
                    {
                      general: t("shell.general"),
                      voice: t("shell.voice"),
                      permissions: t("d24.permissionsSection"),
                      computer: t("shell.computer"),
                      vault: t("shell.vault"),
                      usage: t("shell.usageAndBilling"),
                      updates: t("shell.updates"),
                    }[settingsSection]
                  }
                </h3>
                <button
                  type="button"
                  className="modal-close"
                  aria-label={t("shell.closeSettings")}
                  onClick={() => setSettingsOpen(false)}
                >
                  ×
                </button>
              </header>
              <div className="settings-body">
                {settingsSection === "general" && (
                  <div className="settings-general">
                    <div className="settings-section-title">{t("shell.account")}</div>
                <div className="account-block">
                <div className="account-card">
                  <button
                    type="button"
                    className="account-avatar"
                    title={t("shell.changeAvatar")}
                    aria-label={t("shell.changeAvatar")}
                    onClick={pickAccountPhoto}
                  >
                    <AvatarView avatar={accountAvatar} variant="inline" size={46} />
                  </button>
                  <div className="account-meta">
                    {editingName ? (
                      <input
                        className="name-input inline"
                        value={nameDraft}
                        maxLength={40}
                        autoFocus
                        aria-label={t("shell.accountName")}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            saveName();
                          }
                        }}
                        onBlur={saveName}
                      />
                    ) : (
                      <span className="account-name">{displayName}</span>
                    )}
                    <span className="account-mail">{t("shell.localSessionNote")}</span>
                  </div>
                  <div className="account-actions">
                    {editingName ? (
                      <button type="button" className="pill-btn" onClick={saveName}>
                        {t("shell.save")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="pill-btn"
                        onClick={() => {
                          setNameDraft(displayName);
                          setEditingName(true);
                        }}
                      >
                        {t("shell.rename")}
                      </button>
                    )}
                    <button type="button" className="pill-btn" onClick={logout}>
                      {t("shell.signOut")}
                    </button>
                  </div>
                </div>
                </div>
                {/* The permissions block and the screen-capture settings that
                    develop attached to it both live in the 权限 section now. */}
                <div className="settings-section-title">{t("shell.apiAccessSection")}</div>
                <div className="settings-card">
                  <div className="settings-row">
                    <span>{t("shell.apiKeyWriteOnly")}</span>
                    <span className="key-input-wrap">
                      <input
                        type="password"
                        className="settings-select key-input"
                        placeholder={desktop.settings.keyConfigured() ? t("shell.configuredOverwrite") : t("shell.notConfigured")}
                        value={keyDraft}
                        onChange={(e) => setKeyDraft(e.target.value)}
                        aria-label="API Key"
                      />
                      <button
                        type="button"
                        className="pill-btn"
                        disabled={keyDraft.length === 0}
                        onClick={() => {
                          void desktop.settings
                            .saveKey(keyDraft)
                            .then(() => {
                              setKeyDraft("");
                              setToast(t("shell.savedNoEcho"));
                            })
                            .catch((error: unknown) => {
                              setToast(
                                t("shell.saveFailed", [error instanceof Error ? error.message : String(error)]),
                              );
                            });
                        }}
                      >
                        {t("shell.save")}
                      </button>
                    </span>
                  </div>
                  <div className="settings-row">
                    <span>{t("shell.testConnection")}</span>
                    <span className="key-input-wrap">
                      {testResult &&
                        (testResult.result === "unverified" ? (
                          <span className="settings-soon">{t("shell.connectionUnverified")}</span>
                        ) : (
                          <span className={testResult.ok ? "settings-ok" : "form-error"}>
                            {testResult.ok ? t("shell.connectionSuccess") : testResult.errorCode}
                          </span>
                        ))}
                      <button
                        type="button"
                        className="pill-btn"
                        disabled={testing}
                        onClick={() => {
                          setTesting(true);
                          void desktop.settings
                            .testConnection({ model: "deepseek-chat", endpoint: "https://api.deepseek.com" })
                            .then(setTestResult)
                            .finally(() => setTesting(false));
                        }}
                      >
                        {testing ? t("shell.testing") : t("shell.testConnection")}
                      </button>
                    </span>
                  </div>
                </div>
                {hostDown ? (
                  <p className="form-error settings-host-down" role="alert">
                    {t("shell.hostDown")}
                  </p>
                ) : null}
                <SearchSettings />
                <AutomationPanel />
                {/* Per-bot eventRule state, pending review, and history. */}
                <EventRuleSettings />
                <div className="settings-section-title">{t("shell.skillsSection")}</div>
                <div className="settings-card">
                  <SkillsPanel
                    storage={window.localStorage}
                    library={skillLibrary}
                    onChange={updateLibrary}
                    onToast={setToast}
                  />
                </div>
                <div className="settings-section-title">{t("shell.appearance")}</div>
                <div className="settings-card appearance-card">
                  <div className="settings-row">
                    <span className="appearance-theme-label">{t("shell.theme")}</span>
                    <CustomSelect
                      className="theme-select"
                      value={theme}
                      options={[
                        { value: "dark", label: t("shell.themeDark") },
                        { value: "light", label: t("shell.themeLight") },
                      ]}
                      onChange={(v) => setTheme(v === "light" ? "light" : "dark")}
                      ariaLabel={t("shell.theme")}
                    />
                  </div>
                  <div className="settings-row">
                    <span>{t("shell.accentColor")}</span>
                    <span className="accent-chips" role="radiogroup" aria-label={t("shell.accentColor")}>
                      {ACCENT_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          className={"accent-chip" + (accent === preset ? " selected" : "")}
                          style={{ background: preset }}
                          aria-label={t("shell.accentColorPreset", [preset])}
                          aria-pressed={accent === preset}
                          onClick={() => setAccent(preset)}
                        />
                      ))}
                    </span>
                  </div>
                  <div className="settings-row">
                    <span>{t("shell.language")}</span>
                    <CustomSelect
                      value={language}
                      options={[
                        { value: "system", label: t("shell.followSystem") },
                        // i18n-ignore: language names are shown in their own language
                        { value: "zh", label: "简体中文" },
                        { value: "en", label: "English" },
                      ]}
                      onChange={(value) =>
                        setLanguage(value === "zh" || value === "en" ? value : "system")
                      }
                      ariaLabel={t("d22.languageLabel")}
                    />
                  </div>
                </div>
                  </div>
                )}
                {/* Authorisation is its own section: it is the part owners read
                    most carefully, and burying it under 通用 made the policy
                    rows compete with the account and appearance controls. */}
                {settingsSection === "voice" && (
                  <>
                    <VoiceLanguageSettings value={voiceLanguage} onChange={setVoiceLanguage} />
                    <div className="settings-card">
                      <VoiceSettingsPanel
                        onConfigSaved={() => setVoiceConfigVersion((version) => version + 1)}
                        onToast={setToast}
                      />
                    </div>
                  </>
                )}
                {settingsSection === "permissions" && (
                  <>
                    <div className="settings-section-title">
                      {t("d24.permissionsHeading")}
                    </div>
                    <PermissionsPanel />
                    {/* ScreenSettings brings its own section heading. */}
                    <ScreenSettings />
                  </>
                )}
                {settingsSection === "updates" && (
                  <div className="settings-card">
                    <div className="settings-row">
                      <span>{t("shell.version")}</span>
                      <span className="settings-soon">{version}</span>
                    </div>
                    <div className="settings-row">
                      <span>{t("shell.checkForUpdates")}</span>
                      <span className="key-input-wrap">
                        <span className="update-state">
                          {updateStatus === null
                            ? t("d24.githubReleasesSource")
                            : updateStatus.available
                              ? t("shell.newVersionFound", [updateStatus.version ?? ""])
                              : updateStatus.error
                                ? t("shell.noUpdatesReleased")
                                : t("shell.upToDate")}
                        </span>
                        <button
                          type="button"
                          className="pill-btn"
                          onClick={() => {
                            const bridge = window.deepseekBot;
                            if (!bridge || !("updates" in bridge)) {
                              setToast(t("shell.updateChannelNeedsMain"));
                              return;
                            }
                            void bridge.updates.check().then(setUpdateStatus).catch(() => {
                              setToast(t("shell.updateCheckFailed"));
                            });
                          }}
                        >
                          {t("shell.check")}
                        </button>
                      </span>
                    </div>
                  </div>
                )}
                {settingsSection === "usage" && (
                  <UsagePanel botId={bots.find((b) => b.key === selectedBot)?.bot.id ?? null} />
                )}
                {settingsSection === "vault" && (
                  <>
                    <div className="settings-section-title">{t("d24.apiKeyStatus")}</div>
                    <div className="settings-card">
                      <div className="settings-row">
                        <span>{t("d24.accessState")}</span>
                        <span className="settings-soon">
                          {desktop.settings.keyConfigured()
                            ? t("d24.keyConfiguredWriteOnly")
                            : t("d24.keyNotConfigured")}
                        </span>
                      </div>
                      <div className="settings-row">
                        <span>{t("d24.saveAndTest")}</span>
                        <span className="session-meta">{t("d24.doneInGeneralAccess")}</span>
                      </div>
                    </div>
                    <div className="settings-section-title">{t("d24.vaultSection")}</div>
                    <div className="settings-card">
                      <div className="settings-row">
                        <span>{t("d24.createBackup")}</span>
                        <span className="key-input-wrap">
                          <button
                            type="button"
                            className="pill-btn"
                            disabled={backupBusy}
                            onClick={() => {
                              setBackupBusy(true);
                              void desktop.vault
                                .createBackup()
                                .then((created) => {
                                  setToast(t("d24.backedUp", [created.backupId.slice(0, 8)]));
                                  return desktop.vault.listBackups();
                                })
                                .then(setBackups)
                                .catch((error: unknown) => {
                                  setToast(
                                    t("d24.backupFailed", [
                                      error instanceof Error ? error.message : String(error),
                                    ]),
                                  );
                                })
                                .finally(() => setBackupBusy(false));
                            }}
                          >
                            {backupBusy ? t("d24.working") : t("d24.backupNow")}
                          </button>
                        </span>
                      </div>
                      <div className="vault-backup-list" aria-label={t("d24.backupList")}>
                        {backups === null && <div className="sys-line">{t("canvas.reading")}</div>}
                        {backups !== null && backups.length === 0 && (
                          <div className="sys-line">{t("d24.noBackupsYet")}</div>
                        )}
                        {(backups ?? []).map((backup) => (
                          <div className="settings-row vault-backup-item" key={backup.backupId}>
                            <span className="vault-backup-meta">
                              <span className="tab-title">
                                {new Date(backup.createdAt).toLocaleString()}
                              </span>
                              <span className="session-meta">
                                schema {backup.schemaVersion} · {formatBackupSize(backup.sizeBytes)}
                              </span>
                            </span>
                            <button
                              type="button"
                              className="pill-btn"
                              disabled={backupBusy}
                              onClick={() => {
                                if (!window.confirm(t("d24.restoreConfirm"))) {
                                  return;
                                }
                                setBackupBusy(true);
                                void desktop.vault
                                  .restore(backup.backupId)
                                  .then(() => {
                                    setToast(t("d24.restoreDoneReloading"));
                                    window.setTimeout(() => window.location.reload(), 600);
                                  })
                                  .catch((error: unknown) => {
                                    setToast(
                                      t("d24.restoreFailed", [
                                        error instanceof Error ? error.message : String(error),
                                      ]),
                                    );
                                    setBackupBusy(false);
                                  });
                              }}
                            >
                              {t("d24.restore")}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                {settingsSection === "computer" && (
                  <>
                  <div className="settings-card">
                    <div className="settings-row">
                      <span>{t("shell.microphone")}</span>
                      <span className="settings-soon">{t("shell.allDeniedByPolicy")}</span>
                    </div>
                    <div className="settings-row">
                      <span>{t("shell.hardwareAcceleration")}</span>
                      <span className="key-input-wrap">
                        <span className="session-meta">
                          {hwAccel === null
                            ? "…"
                            : hwAccel.enabled
                              ? t("d24.hwAccelOnDefault")
                              : t("d24.hwAccelOffRestart")}
                        </span>
                        <button
                          type="button"
                          className="pill-btn"
                          disabled={hwAccel === null}
                          onClick={() => {
                            const target = !(hwAccel?.enabled ?? true);
                            void desktop
                              .hardwareAcceleration(target)
                              .then((status) => {
                                setHwAccel(status);
                                setToast(
                                  status.restartRequired
                                    ? t("d24.savedRestartToApply")
                                    : t("d24.settingUnchanged"),
                                );
                              })
                              .catch((error: unknown) => {
                                setToast(
                                  t("d24.settingFailed", [
                                    error instanceof Error ? error.message : String(error),
                                  ]),
                                );
                              });
                          }}
                        >
                          {t("d24.switchAction")}
                        </button>
                      </span>
                    </div>
                  </div>
                  <div className="settings-section-title">{t("d22.notifySection")}</div>
                  <div className="settings-card">
                    <NotificationSettingsPanel
                      prefs={notifications}
                      bots={bots.map((bot) => ({ id: bot.bot.id, name: bot.bot.name }))}
                      onChange={setNotifications}
                      onTest={testNotification}
                    />
                  </div>
                  <div className="settings-section-title">{t("d22.chromeSection")}</div>
                  <div className="settings-card">
                    <ChromeImportPanel onToast={setToast} />
                  </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      <GlobalSearch
        open={searchOpen}
        items={searchIndex}
        onSelect={onSearchSelect}
        onClose={() => setSearchOpen(false)}
        queryHost={(query) => desktop.search.global(query).then(remoteHitsToItems)}
      />
    </div>
  );
}

function MessageBubble({
  msg,
  accent,
  mentions,
  onMentionClick,
  onChoice,
  lockedChoiceId,
  onReact,
  onQuote,
  onCopy,
  canRegenerate,
  onRegenerate,
  canEditResend,
  onEditResend,
  onOpenAttachment,
  onSpeak,
  speaking,
  voiceStatus,
  slotOrder,
}: {
  msg: Msg;
  accent: string;
  mentions?: MentionTable;
  onMentionClick?: (botKey: number) => void;
  onChoice?: (msgId: number, option: ChoiceOption) => void;
  /** Msg id whose card is waiting for a composer clarification. */
  lockedChoiceId?: number | null;
  onReact: (msgId: number, emoji: Emoji) => void;
  onQuote: (msg: Msg) => void;
  onCopy: (text: string) => void;
  /** G6: only the latest assistant reply offers 重新生成. */
  canRegenerate?: boolean;
  onRegenerate?: () => void;
  /** G6: only the latest user message offers 编辑重发 (prefills the composer). */
  canEditResend?: boolean;
  onEditResend?: (text: string) => void;
  /** Workspace path from the gateway import. Opens the artifact preview. */
  onOpenAttachment?: (relativePath: string) => void;
  /** Voice: read this reply aloud through the Host's local speech engine. */
  onSpeak?: (msgId: number, text: string) => void;
  speaking?: boolean;
  /** Gates the speak button; disabled with a reason when the engine is absent. */
  voiceStatus?: VoiceStatus | null;
  /** Keeps this bubble on the timeline slot of its turn. */
  slotOrder?: number;
}): JSX.Element {
  const isUser = msg.from === "user";
  const speak = speakButton(voiceStatus ?? null, speaking === true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const emojiBtnRef = useRef<HTMLButtonElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [pickerPos, setPickerPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!pickerOpen || !pickerRef.current || !emojiBtnRef.current) {
      return;
    }
    const btn = emojiBtnRef.current.getBoundingClientRect();
    const r = pickerRef.current.getBoundingClientRect();
    const margin = 8;
    let x = btn.right - r.width;
    let y = btn.top - r.height - 6;
    if (y < margin) {
      y = btn.bottom + 6;
    }
    x = Math.min(Math.max(margin, x), Math.max(margin, window.innerWidth - r.width - margin));
    y = Math.min(Math.max(margin, y), Math.max(margin, window.innerHeight - r.height - margin));
    setPickerPos({ x, y });
  }, [pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPickerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);

  const replayCard = msg.history === true && msg.choices !== undefined;
  return (
    <div
      className={"msg-row" + (isUser ? " user" : " bot") + (msg.history === true ? " replay" : "")}
      style={slotOrder === undefined ? undefined : { order: slotOrder }}
      {...(msg.history === true ? { "data-history": "true" } : {})}
    >
      <div className="hover-wrap">
        <div
          className={"msg-bubble" + (isUser ? " user" : "")}
          style={isUser ? { background: accent, color: "#ffffff" } : undefined}
        >
          {msg.meta !== undefined && (
            <span className="msg-meta">
              {msg.meta === "regenerate" ? t("chat.regeneratedMark") : t("chat.editedResendMark")}
            </span>
          )}
          {msg.quote && (
            <div className="msg-quote">
              {t("shell.quotedMessage", [msg.quote.name, msg.quote.text])}
            </div>
          )}
              {msg.attachments && msg.attachments.length > 0 && (
            <div className="msg-attachments">
              {msg.attachments.map((file) => {
                const previewPath = file.relativePath ?? file.path;
                const preview =
                  previewPath !== undefined
                    ? () => onOpenAttachment?.(previewPath)
                    : undefined;
                const stored =
                  file.path !== undefined ? (
                    <span className="msg-attachment-path">
                      {t("shell.attachmentStoredPath", [file.path])}
                    </span>
                  ) : null;
                const fileBody = (
                  <>
                    <span className="msg-attachment-name">{file.name}</span>
                    <span className="msg-attachment-size">
                      {formatAttachmentSize(file.size)}
                    </span>
                    {stored}
                  </>
                );
                if (file.kind === "image" && file.dataUrl) {
                  const image = (
                    <>
                      <img
                        className="msg-attachment-image"
                        src={file.dataUrl}
                        alt={file.name}
                        draggable={false}
                      />
                      {file.path !== undefined && (
                        <span className="msg-attachment-path">
                          {t("shell.attachmentStoredPath", [file.path])}
                        </span>
                      )}
                    </>
                  );
                  return preview ? (
                    <button
                      key={previewPath ?? file.name}
                      type="button"
                      className="msg-attachment-open"
                      aria-label={t("shell.openAttachmentPreview", [file.name])}
                      onClick={preview}
                    >
                      {image}
                    </button>
                  ) : (
                    <span key={file.name}>{image}</span>
                  );
                }
                return preview ? (
                  <button
                    key={previewPath ?? file.name}
                    type="button"
                    className="msg-attachment-file"
                    aria-label={t("shell.openAttachmentPreview", [file.name])}
                    onClick={preview}
                  >
                    {fileBody}
                  </button>
                ) : (
                  <span className="msg-attachment-file" key={file.name}>
                    {fileBody}
                  </span>
                );
              })}
            </div>
          )}
          {replayCard ? null : isUser ? (
            msg.text
          ) : (
            <ChatMarkdown
              text={msg.text}
              mentions={mentions}
              onMentionClick={onMentionClick}
            />
          )}
          {msg.choices && (
            <ChoiceCard
              question={msg.choices.question}
              options={msg.choices.options}
              fallback={msg.choices.other ? { id: "✎", label: t("shell.choiceOther") } : null}
              answered={msg.choices.answered}
              disabled={lockedChoiceId === msg.id || msg.history === true}
              hint={
                lockedChoiceId === msg.id ? t("questions.explainBelowPlaceholder") : null
              }
              {...(canAnswerChoice(msg)
                ? {
                    onChoose: (option: ChoiceOption) => {
                      onChoice?.(msg.id, option);
                    },
                  }
                : {})}
            />
          )}
          {!isUser && EMOJIS.some((e) => (msg.reactions[e] ?? 0) > 0) && (
            <div className="reaction-chips">
              {EMOJIS.filter((e) => (msg.reactions[e] ?? 0) > 0).map((e) => (
                <button
                  key={e}
                  type="button"
                  className={"reaction-chip" + (msg.mine.includes(e) ? " mine" : "")}
                  title={msg.mine.includes(e) ? t("shell.removeMyReaction") : t("shell.react")}
                  onClick={() => onReact(msg.id, e)}
                >
                  {e} {msg.reactions[e]}
                </button>
              ))}
            </div>
          )}
        </div>
        {!isUser &&
          pickerOpen &&
          createPortal(
            <>
              <div className="menu-overlay" onClick={() => setPickerOpen(false)} />
              <div
                ref={pickerRef}
                className="emoji-picker"
                role="menu"
                aria-label={t("shell.selectEmoji")}
                style={{ left: pickerPos.x, top: pickerPos.y }}
              >
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className="react-btn"
                    data-emoji={e}
                    title={t("shell.reactWith", [e])}
                    onClick={() => {
                      onReact(msg.id, e);
                      setPickerOpen(false);
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </>,
            document.body,
          )}
      </div>
      <div className="msg-actions" role="toolbar" aria-label={t("shell.messageActions")}>
        {!isUser && (
          <button
            type="button"
            className={"msg-icon-btn" + (pickerOpen ? " active" : "")}
            data-action="emoji"
            title={t("shell.react")}
            ref={emojiBtnRef}
            onClick={() => setPickerOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="9.2" cy="10" r="1" fill="currentColor" />
              <circle cx="14.8" cy="10" r="1" fill="currentColor" />
              <path d="M8.6 14a4.2 4.2 0 0 0 6.8 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="msg-icon-btn"
          data-action="quote"
          title={t("shell.quote")}
          onClick={() => onQuote(msg)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9.5 14.5 4 9l5.5-5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 9h10a6 6 0 0 1 6 6v5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="msg-icon-btn"
          data-action="copy"
          title={t("shell.copy")}
          onClick={() => onCopy(msg.text)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
        {!isUser && onSpeak !== undefined && (
          <button
            type="button"
            className={"msg-icon-btn" + (speaking === true ? " active" : "")}
            data-action="speak"
            title={t(speak.reasonKey ?? speak.labelKey)}
            disabled={speak.disabled}
            onClick={() => onSpeak(msg.id, msg.text)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M4 9.5h3l4-3.5v12l-4-3.5H4z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path
                d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
        {!isUser && canRegenerate === true && onRegenerate !== undefined && (
          <button
            type="button"
            className="msg-icon-btn"
            data-action="regenerate"
            title={t("shell.regenerateTitle")}
            onClick={onRegenerate}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        {isUser && canEditResend === true && onEditResend !== undefined && (
          <button
            type="button"
            className="msg-icon-btn"
            data-action="edit-resend"
            title={t("shell.editResendTitle")}
            onClick={() => onEditResend(msg.text)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="m4 20 1.2-4.2L16.4 4.6a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8.2 18.8 4 20Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function BotsPlaceholder({
  bots,
  groups,
  selectedBot,
  stream,
  streamHandles,
  onStreamUpdate,
  msgs,
  pairTranscripts,
  quoteDraft,
  onQuote,
  onPairQuote,
  onCancelQuote,
  onSend,
  onReact,
  onTalkTo,
  onCopy,
  onAssistant,
  onOpenBot,
  voiceLanguage,
  voiceConfigVersion,
  onNotify,
  onBotStatus,
  onReplyCompleted,
  onApprovalPending,
  skillContext,
  onAnswerSeedCard,
  onOpenAttachment,
  primitiveMode,
  onTogglePrimitive,
  deepThinking,
  onToggleDeepThinking,
  onOpenAutomation,
}: {
  bots: UiBot[];
  groups: Group[];
  selectedBot: number;
  /** 跨 bot 并行思考：本 bot 的 live stream 状态存放在 App（切换不丢）。 */
  stream: StreamStateForBot | null;
  /** 本 bot 的 Host 回合句柄；与 stream 一样跨面板重挂载存活。 */
  streamHandles: Map<number, StreamHandle>;
  onStreamUpdate: (
    update: (prev: StreamStateForBot | null) => StreamStateForBot | null,
  ) => void;
  msgs: Msg[];
  pairTranscripts: Record<
    string,
    { id: number; speakerKey: number; text: string; time: number }[]
  >;
  quoteDraft: { name: string; text: string } | null;
  onQuote: (msg: Msg) => void;
  onPairQuote: (name: string, text: string) => void;
  onCancelQuote: () => void;
  onSend: (text: string, attachments?: Msg["attachments"], meta?: Msg["meta"]) => void;
  onReact: (msgId: number, emoji: Emoji) => void;
  onTalkTo: (otherKey: number) => void;
  onCopy: (text: string) => void;
  onAssistant: (text: string) => void;
  onOpenBot: (botKey: number) => void;
  /** Settings → Voice. Passed through to whisper-cli as `-l`. */
  voiceLanguage: VoiceTranscriptionLanguage;
  /** Bumps when Settings saves whisper paths so this pane re-reads voice.status. */
  voiceConfigVersion: number;
  onNotify: (message: string) => void;
  /** D22: live bot state for the tray (running / waiting-approval / idle). */
  onBotStatus: (botId: string, status: TrayBotStatus) => void;
  /** D22: a reply landed — raise a system notification when the window is away. */
  onReplyCompleted: (botId: string, botName: string) => void;
  /** D22: pending approvals change the tray status and may notify. */
  onApprovalPending: (botId: string, botName: string, count: number) => void;
  /** Bound skills for this bot, sent to the Host with the turn (D17). */
  skillContext: (botId: string) => ReturnType<typeof skillsForInjection>;
  /**
   * Persist a seed card's answer on the message itself. The answer cannot live
   * in this component's state: the pane is keyed by the selected bot, so
   * switching bots and coming back used to re-expand an answered card.
   */
  onAnswerSeedCard: (botKey: number, msgId: number, text: string) => void;
  onOpenAttachment: (relativePath: string) => void;
  /** 原始人模式: per-bot terse-prompt switch, live at the composer. */
  primitiveMode: boolean;
  onTogglePrimitive: () => void;
  /** Deep thinking (G5): the bot's model profile, toggled from the composer. */
  deepThinking: boolean;
  onToggleDeepThinking: () => void;
  /** D20': jump from the chat automation notice to the settings panel. */
  onOpenAutomation: () => void;
}): JSX.Element {
  const service = useService();
  const [draft, setDraft] = useState("");
  const [plusOpen, setPlusOpen] = useState(false);
  const [detailOther, setDetailOther] = useState<number | null>(null);
  const [failedText, setFailedText] = useState("");
  const [answeredQuestions, setAnsweredQuestions] = useState<AnsweredQuestionMap>({});
  const [clarify, setClarify] = useState<ClarifyTarget | null>(null);
  /**
   * Voice (D27 desktop slice): both halves are local and optional — the mic and
   * the speak button stay disabled with a reason until `voice.status` says the
   * configured whisper paths or the system speech engine are usable. The mic is
   * hold-to-talk: release transcribes into the draft and does not send.
   */
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null);
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<AttachmentDraft[]>([]);
  const [skills, setSkills] = useState<Skill[]>(() => listSkills(window.localStorage));
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  /** G6: a pending 编辑重发 labels the next sent user bubble. */
  const [pendingMeta, setPendingMeta] = useState<Msg["meta"] | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const me = bots.find((b) => b.key === selectedBot);

  /**
   * 配对视图的真实往来记录（点击消息往来上的对方 bot 进入）：只用这次交接的
   * dispatch 与 dispatch_reply。同一会话里跟用户的对话不放进来。
   */
  const [pairRecords, setPairRecords] = useState<PairRecord[] | null>(null);
  useEffect(() => {
    if (detailOther === null || me === undefined) {
      if (detailOther === null) setPairRecords(null);
      return;
    }
    const peer = bots.find((bot) => bot.key === detailOther);
    if (peer === undefined) {
      setPairRecords([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [tasks, myRows, peerRows] = await Promise.all([
          service.tasks.list({}),
          service.chat.history(me.bot.id, 200),
          service.chat.history(peer.bot.id, 200),
        ]);
        if (cancelled) return;
        const rows = assemblePairRecords(
          { id: me.bot.id, key: me.key },
          { id: peer.bot.id, key: peer.key },
          tasks.tasks,
          myRows,
          peerRows,
        );
        if (!cancelled) setPairRecords(rows);
      } catch {
        if (!cancelled) setPairRecords([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailOther, bots, me, service]);

  /** Context circle (TASK_CONTEXT_METER.md): reload the gauge when the bot
   * changes, after every settled turn, and once more while a background
   * compression is running so the percentage drops as soon as it lands. */
  const [contextUsage, setContextUsage] = useState<ContextUsageView | null>(null);
  const contextUsageRequest = useRef(0);
  const meBotId = me?.bot.id;
  const refreshContextUsage = useCallback((): void => {
    if (meBotId === undefined) {
      return;
    }
    // The gauge follows this bot's one conversation. sessionId stays
    // omitted so a stored extra session is not metered, and the host's
    // ≥80% compression still runs on the default thread.
    const scoped = scopeToBotConversation({ botId: meBotId });
    const requestId = contextUsageRequest.current + 1;
    contextUsageRequest.current = requestId;
    service.chat
      .contextUsage(scoped.botId)
      .then((view) => {
        if (contextUsageRequest.current !== requestId) {
          return;
        }
        setContextUsage(view);
        if (view.compressing) {
          setTimeout(() => {
            if (contextUsageRequest.current !== requestId) {
              return;
            }
            service.chat
              .contextUsage(scoped.botId)
              .then((later) => {
                if (contextUsageRequest.current === requestId) {
                  setContextUsage(later);
                }
              })
              .catch(() => undefined);
          }, 2_000);
        }
      })
      .catch(() => undefined);
  }, [service, meBotId]);
  useEffect(() => {
    refreshContextUsage();
  }, [refreshContextUsage]);

  /** @Name chips link to any known bot; color follows its avatar. */
  const mentionTable = useMemo<MentionTable>(() => {
    const table: MentionTable = new Map();
    for (const bot of bots) {
      table.set(bot.bot.name, { botKey: bot.key, color: avatarColor(bot.avatar), shape: bot.avatar.kind === "grok" ? bot.avatar.shape : "circle" });
    }
    return table;
  }, [bots]);
  const applySkillToDraft = (skill: Skill): void => {
    setDraft((prev) => applySkill(skill, prev));
    setSkillMenuOpen(false);
  };

  const saveDraftAsSkill = (): void => {
    const prompt = draft.trim();
    if (prompt.length === 0) {
      onNotify(t("skills.saveNeedsContent"));
      return;
    }
    const name = t("skills.appliedLabel", [skills.length + 1]);
    const result = upsertSkill(window.localStorage, { name, prompt });
    if (result.ok) {
      setSkills(listSkills(window.localStorage));
      onNotify(t("skills.savedVersioned", [result.skill.name, result.skill.version]));
    } else {
      onNotify(result.reason === "limit" ? t("skills.limitReachedShort") : t("skills.emptyContent"));
    }
    setSkillMenuOpen(false);
  };

  const removeSkill = (id: string): void => {
    setSkills(deleteSkill(window.localStorage, id));
  };

  /* The old local-only handleChoice from the skills branch is deliberately not
     taken: this branch answers choice cards through the shared chat stream
     (see the handleChoice below), so keeping both would shadow it. */
  const stickToBottom = useRef(true);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [msgs.length]);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !stickToBottom.current) return;
    const max = list.scrollHeight - list.clientHeight;
    if (Math.abs(list.scrollTop - max) > 1) list.scrollTop = max;
  });

  /** Ask the Host whether the configured whisper paths and Windows SAPI are usable.
   * Kept with the other hooks: the pair view returns early, and a hook below
   * that return drops out and blanks the window. */
  useEffect(() => {
    void window.deepseekBot.host
      .call("voice.status", {})
      .then((response) =>
        setVoiceStatus(METHOD_CONTRACTS["voice.status"].response.parse(response)),
      )
      .catch(() => setVoiceStatus(null));
  }, [voiceConfigVersion]);

  if (!me) {
    return (
      <div className="bubble">
        <h2>{t("shell.bot")}</h2>
        <p>{t("shell.botNotFound")}</p>
      </div>
    );
  }

  if (detailOther !== null) {
    const peer = bots.find((bot) => bot.key === detailOther);
    const records = pairRecords ?? [];
    return (
      <div className="pair-view">
        <header className="pair-head">
          <span className="pair-title">
            <AvatarView avatar={me.avatar} variant="inline" size={26} />
            <span className="pair-name" style={{ color: avatarColor(me.avatar) }}>
              {me.bot.name}
            </span>
            <span className="pair-arrow">⇄</span>
            <AvatarView avatar={peer?.avatar ?? me.avatar} variant="inline" size={26} />
            <span
              className="pair-name"
              style={{ color: avatarColor(peer?.avatar ?? me.avatar) }}
            >
              {peer?.bot.name ?? "?"}
            </span>
          </span>
        </header>
        <div className="pair-body">
          {records.map((row, index) =>
            row.kind === "notice" ? (
              <div className="sys-line" key={`notice-${index}`}>
                {row.text}
              </div>
            ) : (() => {
              const speaker = bots.find((bot) => bot.key === row.speakerKey);
              return (
                <div className="pair-turn" key={`turn-${index}`}>
                  <AvatarView avatar={speaker?.avatar ?? me.avatar} variant="inline" size={30} />
                  <div className="pair-turn-main">
                    <span
                      className="pair-speaker"
                      style={{ color: avatarColor(speaker?.avatar ?? me.avatar) }}
                    >
                      {speaker?.bot.name ?? "?"}
                    </span>
                    <div className="pair-bubble-row">
                      <div className="msg-bubble">
                        <ChatMarkdown
                          text={row.text}
                          mentions={mentionTable}
                          onMentionClick={(botKey) => {
                            setDetailOther(null);
                            onOpenBot(botKey);
                          }}
                        />
                      </div>
                      <div className="pair-actions">
                        <button
                          type="button"
                          className="msg-icon-btn"
                          title={t("shell.quote")}
                          aria-label={t("shell.quote")}
                          onClick={() => {
                            onPairQuote(speaker?.bot.name ?? "?", row.text);
                            setDetailOther(null);
                          }}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M9.5 14.5 4 9l5.5-5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M4 9h10a6 6 0 0 1 6 6v5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="msg-icon-btn"
                          title={t("shell.copy")}
                          aria-label={t("shell.copy")}
                          onClick={() => onCopy(row.text)}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="9" y="9" width="11" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                            <path
                              d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })(),
          )}
          {records.length === 0 && (
            <div className="sys-line">
              {pairRecords === null ? t("shell.loadingRecords") : t("shell.noExchangesYet")}
            </div>
          )}
        </div>
        <div className="pair-foot">
          <button type="button" className="pill-btn" onClick={() => setDetailOther(null)}>
            {t("shell.closeChat")}
          </button>
        </div>
      </div>
    );
  }

  const others = bots.filter((b) => b.key !== me.key);
  const clarifyActive = clarify !== null && clarify.forKey === me.key;
  const pairPeers = Array.from(
    new Set(
      msgs.flatMap((message) => (message.notice ? [message.notice.otherKey] : [])),
    ),
  ).filter((peerKey) => peerKey !== me.key);
  const pairTotal = pairPeers.reduce(
    (sum, peerKey) => sum + (pairTranscripts[pairKeyOf(me.key, peerKey)]?.length ?? 0),
    0,
  );
  const firstNoticeId = msgs.find((message) => message.notice)?.id ?? null;

  const readPickedFiles = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) {
      return;
    }
    const drafts: AttachmentDraft[] = [];
    for (const file of [...files]) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        onNotify(t("shell.attachmentTooLarge", [file.name]));
        continue;
      }
      if (file.size === 0) {
        onNotify(t("shell.attachmentEmpty", [file.name]));
        continue;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const kind = classifyAttachment(file.type, file.name);
      const draft: AttachmentDraft = {
        name: file.name,
        size: file.size,
        mime: file.type,
        bytes,
        file,
      };
      if (kind === "text") {
        draft.text = new TextDecoder().decode(bytes);
      } else if (kind === "image") {
        draft.dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
      }
      drafts.push(draft);
    }
    if (drafts.length > 0) {
      setPendingFiles((prev) => [...prev, ...drafts]);
    }
  };

  /**
   * The one stream starter for the composer, the failure retry and the choice
   * cards (FR-3): cancels any in-flight turn, resets the stream state and
   * wires cancel/failure/assistant-bubble transitions identically everywhere.
   */
  const startChatStream = (text: string, images?: StreamOptions["images"]): void => {
    const injected = skillContext(me.bot.id);
    if (!injected.ok) {
      onNotify(
        injected.reason === "unknown-capability"
          ? t("skills.unknownCapability", [injected.skill, injected.capability])
          : injected.reason === "too-many-capabilities"
            ? t("skills.tooManyCapabilities", [injected.skill])
            : injected.reason === "too-many-skills"
              ? t("skills.tooManySkills", [injected.skill])
              : t("skills.injectionRejected", [injected.skill]),
      );
      return;
    }
    // 同一 bot 的新回合取代自己的旧回合；其他 bot 的流互不影响（跨 bot 并行思考）。
    streamHandles.get(me.key)?.cancel();
    const forKey = me.key;
    // One conversation: do not send a session id. The host files the turn on
    // this bot's default thread and still compresses that thread at ~80%.
    const turn = scopeToBotConversation({
      text,
      skills: injected.skills,
      primitive: primitiveMode,
      images,
    });
    onStreamUpdate(() => ({ ...emptyStream(), forKey }));
    onBotStatus(me.bot.id, "running");
    const started = runChatStream({
      stream: service.chat.stream,
      botId: me.bot.id,
      text: turn.text,
      skills: turn.skills,
      primitive: turn.primitive,
      images: turn.images,
      forKey,
      update: (update) => onStreamUpdate(update),
      onAssistant,
      /* Only this handle may commit its answer. Once a newer turn of the same
         bot owns the handle map entry, this one is stale — and that has to be
         asked here rather than inferred inside the state updater, which React
         runs during render. The map lives in App, so it survives pane
         remounts (switching chats never drops a running turn). */
      isCurrent: () => streamHandles.get(forKey) === started,
      onSettled: (result) => {
        const settled = result.cancelled || result.failure !== null;
        onBotStatus(me.bot.id, "idle");
        if (!settled) {
          onReplyCompleted(me.bot.id, me.bot.name);
        }
        refreshContextUsage();
      },
    });
    streamHandles.set(forKey, started);
  };

  /**
   * The composer owes a choice card its free-text answer. Seed cards send the
   * text like any user message (owner decision Q3); ask_user cards submit it
   * through question.answer — the waiting model turn continues with it, so no
   * new stream may start. Failures restore the draft for another try.
   */
  const answerClarify = (target: ClarifyTarget, text: string): void => {
    setClarify(null);
    setDraft("");
    if (target.kind === "seed") {
      onAnswerSeedCard(me.key, target.msgId, text);
      onSend(text);
      setFailedText(text);
      startChatStream(text);
      return;
    }
    void window.deepseekBot.host
      .call("question.answer", { botId: me.bot.id, requestId: target.requestId, text })
      .then((response) => {
        const parsed = METHOD_CONTRACTS["question.answer"].response.parse(response);
        setAnsweredQuestions((prev) => ({
          ...prev,
          [target.requestId]: {
            botId: me.bot.id,
            question: target.question,
            text: parsed.text,
          },
        }));
        onSend(parsed.text);
      })
      .catch(() => {
        setClarify(target);
        setDraft(text);
        onNotify(t("questions.answerRetryFailed"));
      });
  };

  const send = (): void => {
    const text = draft.trim();
    if (!text && pendingFiles.length === 0) {
      return;
    }
    if (clarify !== null && clarify.forKey === me.key && text) {
      answerClarify(clarify, text);
      return;
    }
    // Onboarding (对标学习): a free-text reply retires an open seed card —
    // the card dims into its answered row instead of nagging, and the reply
    // itself flows on as a normal turn.
    const pendingCard = findPendingChoiceCard(msgs);
    if (pendingCard !== undefined) {
      onAnswerSeedCard(me.key, pendingCard.id, text);
    }
    void sendWithAttachments(text);
  };

  /**
   * Closure upload (attachment.begin/append/commit) runs before the turn.
   * Small text stays inline; larger files point at read_workspace_file.
   * The same path is named for the gateway `read` tool and opens the
   * artifact preview. chat.attach remains on the service. A failed upload
   * aborts the send and keeps the draft.
   */
  const sendWithAttachments = async (text: string): Promise<void> => {
    const files = pendingFiles;
    const meta = pendingMeta ?? undefined;
    const outgoing: NonNullable<Msg["attachments"]> = [];
    const pointers: string[] = [];
    // B3'' 视觉输入 + open-defects §2.1 (plan 乙): only a cataloged vision
    // model rides the request as real image content blocks (downscaled to the
    // provider budget). The capability flags decide the model-facing note —
    // cataloged text-only says "cannot see", an unregistered id says "not
    // registered, blocks not attached". The workspace copy and pointer text
    // stay regardless — an image is never silently dropped.
    let vision: VisionNoteMode = "unregistered";
    try {
      const status = await service.vision.status(me.bot.id);
      vision = status.visionAvailable
        ? "ride-along"
        : status.visionKnown
          ? "text-only"
          : "unregistered";
    } catch {
      vision = "unregistered";
    }
    const imageBlocks: { data: string; mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" }[] = [];
    for (const file of files) {
      if (file.bytes === undefined) {
        continue;
      }
      const kind = classifyAttachment(file.mime, file.name);
      try {
        const uploaded = await service.attachments.upload(me.bot.id, {
          name: file.name,
          bytes: file.bytes,
        });
        outgoing.push({
          name: file.name,
          size: file.size,
          kind,
          ...(file.dataUrl !== undefined ? { dataUrl: file.dataUrl } : {}),
          path: uploaded.path,
          relativePath: uploaded.path,
        });
        if (vision === "ride-along" && kind === "image") {
          const prepared = await prepareVisionImage(
            { bytes: file.bytes, mime: file.mime },
            async (bytes, longEdge, quality) => {
              const bitmap = await createImageBitmap(
                new Blob([bytes as BlobPart], { type: file.mime || "image/png" }),
              );
              const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height));
              const width = Math.max(1, Math.round(bitmap.width * scale));
              const height = Math.max(1, Math.round(bitmap.height * scale));
              const canvas = document.createElement("canvas");
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext("2d");
              if (ctx === null) {
                throw new Error("canvas 2d context unavailable");
              }
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(0, 0, width, height);
              ctx.drawImage(bitmap, 0, 0, width, height);
              bitmap.close();
              const data = canvas.toDataURL("image/jpeg", quality);
              return { data: data.split(",")[1] ?? "", width, height };
            },
          );
          imageBlocks.push({ data: prepared.data, mimeType: prepared.mimeType });
        }
        pointers.push(
          ...composeAttachmentBlocks(
            [
              {
                name: file.name,
                size: file.size,
                mime: file.mime,
                kind,
                ...(file.text !== undefined ? { text: file.text } : {}),
                path: uploaded.path,
              },
            ],
            vision,
          ),
          buildAttachmentContext({
            name: file.name,
            size: file.size,
            relativePath: uploaded.path,
          }),
        );
      } catch (error) {
        const code = (error as { code?: string }).code;
        const detail = code ?? (error instanceof Error ? error.message : String(error));
        onNotify(t("shell.attachmentUploadFailed", [file.name, detail]));
        return;
      }
    }
    onSend(text, outgoing.length > 0 ? outgoing : undefined, meta);
    setPendingMeta(null);
    setPendingFiles([]);
    setFailedText(text);
    setDraft("");
    startChatStream(composeAttachmentPrompt(text, pointers), imageBlocks);
  };

  /** G6: 重新生成 — re-ask the latest user question as a new labelled turn. */
  const regenerate = (): void => {
    const lastUser = [...msgs].reverse().find((m) => m.from === "user" && !m.system);
    if (lastUser === undefined) {
      return;
    }
    onSend(lastUser.text, undefined, "regenerate");
    setFailedText(lastUser.text);
    startChatStream(lastUser.text);
  };

  /** G6: 编辑重发 — prefill the composer; the next send carries the label. */
  const editResend = (text: string): void => {
    setPendingMeta("edited_resend");
    setDraft(text);
    inputRef.current?.focus();
  };

  const retryStream = (): void => {
    if (failedText.trim()) {
      const text = failedText;
      setFailedText("");
      onSend(text);
      startChatStream(text);
    }
  };

  /** Card rows answer with their own label — no prefix, plain text (FR-1). */
  const handleChoice = (msgId: number, option: ChoiceOption): void => {
    const target = msgs.find((message) => message.id === msgId);
    if (target === undefined || !canAnswerChoice(target)) {
      return;
    }
    if (option.id === "✎") {
      setClarify({ forKey: me.key, kind: "seed", msgId });
      inputRef.current?.focus();
      return;
    }
    onAnswerSeedCard(me.key, msgId, option.label);
    onSend(option.label);
    setFailedText(option.label);
    startChatStream(option.label);
  };

  const speakMessage = (msgId: number, text: string): void => {
    if (speakingId !== null) {
      return;
    }
    setSpeakingId(msgId);
    void window.deepseekBot.host
      .call("voice.speak", { text })
      .catch(() => onNotify(t("voice.speakFailed")))
      .finally(() => setSpeakingId(null));
  };

  // G6: only the newest user question may regenerate and only the newest user
  // message may be edited-resent — older ones stay historical record.
  const lastBotMsgId = [...msgs].reverse().find((m) => m.from === "bot" && !m.system)?.id;
  const lastUserMsgId = [...msgs].reverse().find((m) => m.from === "user" && !m.system)?.id;

  return (
    <div
      className="chat-page"
      /* SPRINTS §6 #8: the user bubble follows the current bot's colour, and so
         does the composer's send button. The pair is scoped to the page rather
         than to the message list, because the composer is its sibling — a
         variable set on `.chat` cannot reach it. Switching bots re-tints only
         this pane. */
      style={
        {
          "--bot-color": avatarColor(me.avatar),
          "--bot-ink": bubbleInk(avatarColor(me.avatar)),
        } as CSSProperties
      }
    >
      <ChatAutomationNotice botId={me.bot.id} onOpenAutomation={onOpenAutomation} />
      <div
        className="chat"
        ref={listRef}
        onScroll={() => {
          const list = listRef.current;
          if (!list) return;
          stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
        }}
      >
        <TimelineOrderProvider times={msgs.map((message) => message.time)}>
        {msgs.map((m, index) => {
          const prev = msgs[index - 1];
          const slot = messageSlotOrder(index);
          const showTime =
            !m.system &&
            !m.notice &&
            (!prev || prev.system || m.time - prev.time > 5 * 60 * 1000);
          return (
            <Fragment key={m.id}>
              {showTime && (
                <div className={"chat-time" + (m.history === true ? " replay" : "")} style={{ order: slot }}>
                  {formatChatTime(m.time)}
                </div>
              )}
              {m.notice ? (
                m.deliverTo ? (
                  <div className="deliver-notice" role="status" style={{ order: slot }}>
                    <span className="deliver-label">{m.notice.label}</span>
                    <span className="avatar-stack">
                      {m.deliverTo.map((key) => {
                        const target = bots.find((bot) => bot.key === key);
                        return (
                          <button
                            key={key}
                            type="button"
                            className="stack-avatar"
                            title={t("shell.viewExchangesWith", [target?.bot.name ?? "?"])}
                            aria-label={t("shell.viewExchangesWith", [target?.bot.name ?? "?"])}
                            onClick={() => setDetailOther(key)}
                          >
                            <AvatarView
                              avatar={target?.avatar ?? me.avatar}
                              variant="inline"
                              size={20}
                            />
                          </button>
                        );
                      })}
                    </span>
                    {m.deliverTo.length > 1 && (
                      <span className="deliver-count">{t("shell.botCount", [m.deliverTo.length])}</span>
                    )}
                  </div>
                ) : m.id === firstNoticeId ? (
                  <div className="chat-summary" style={{ order: slot }}>
                    <span className="chat-summary-label">{t("shell.exchangeCount", [pairTotal])}</span>
                    {pairPeers.map((peerKey, peerIndex) => {
                      const peer = bots.find((bot) => bot.key === peerKey);
                      return (
                        <Fragment key={peerKey}>
                          {peerIndex > 0 && <span className="summary-and">{t("shell.and")}</span>}
                          <button
                            type="button"
                            className="summary-bot"
                            title={t("shell.viewExchangesWith", [peer?.bot.name ?? "?"])}
                            onClick={() => setDetailOther(peerKey)}
                          >
                            <AvatarView avatar={peer?.avatar ?? me.avatar} variant="inline" size={16} />
                            <span>{peer?.bot.name ?? "?"}</span>
                          </button>
                        </Fragment>
                      );
                    })}
                  </div>
                ) : null
              ) : m.system ? (
                <div className="sys-line" style={{ order: slot }}>{m.text}</div>
              ) : (
                <MessageBubble
                  slotOrder={slot}
                  msg={{
                    ...m,
                    choices: m.choices,
                  }}
                  accent={avatarColor(me.avatar)}
                  mentions={mentionTable}
                  onMentionClick={onOpenBot}
                  onChoice={handleChoice}
                  lockedChoiceId={
                    clarify?.kind === "seed" && clarify.forKey === me.key ? clarify.msgId : null
                  }
                  onReact={onReact}
                  onQuote={onQuote}
                  onCopy={onCopy}
                  canRegenerate={m.id === lastBotMsgId}
                  onRegenerate={regenerate}
                  canEditResend={m.id === lastUserMsgId}
                  onEditResend={editResend}
                  onOpenAttachment={onOpenAttachment}
                  onSpeak={speakMessage}
                  speaking={speakingId === m.id}
                  voiceStatus={voiceStatus}
                />
              )}
            </Fragment>
          );
        })}
        {msgs.length === 0 && <div className="sys-line">{t("shell.sessionEmpty")}</div>}
        {stream && stream.forKey === me.key && (
          <>
            {stream.tools.map((tool) => (
              <div className="tool-card" key={tool.toolName} style={{ order: streamSlotOrder(msgs.length) }}>
                <span className={"tool-state tool-" + tool.state}>
                  {tool.state === "requested"
                    ? t("shell.toolRequested")
                    : tool.state === "running"
                      ? t("shell.toolRunning")
                      : tool.state === "succeeded"
                        ? t("shell.toolCompleted")
                        : t("shell.toolFailed")}
                </span>
                <span className="tool-name">{tool.toolName}</span>
                {tool.summary && <span className="tool-summary">{tool.summary}</span>}
              </div>
            ))}
            {(stream.text || (!stream.failure && !stream.cancelled)) && (
              <div className="msg-row bot streaming" style={{ order: streamSlotOrder(msgs.length) }}>
                {stream.text ? (
                  <div className="hover-wrap">
                    <div className="msg-bubble">
                      {stream.text}
                      {!stream.failure && !stream.cancelled && (
                        <button
                          type="button"
                          className="stream-cancel"
                          title={t("shell.cancel")}
                          onClick={() => streamHandles.get(me.key)?.cancel()}
                        >
                          {t("shell.cancel")}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="stream-pending">
                    <ThinkingLine botId={me.bot.id} avatar={me.avatar} />
                    <button
                      type="button"
                      className="stream-cancel"
                      title={t("shell.cancel")}
                      onClick={() => streamHandles.get(me.key)?.cancel()}
                    >
                      {t("shell.cancel")}
                    </button>
                  </div>
                )}
              </div>
            )}
            {stream.failure && (
              <div className="chat-failure" role="alert" style={{ order: streamSlotOrder(msgs.length) }}>
                <div className="failure-head">
                  <span className="failure-chip">{stream.failure.code}</span>
                  {stream.failure.retryable && (
                    <button type="button" className="pill-btn" onClick={retryStream}>
                      {t("shell.retry")}
                    </button>
                  )}
                </div>
                {/* The Host authors the human sentence (humanized errors); the
                    catalogue line only backs codes that carry no message. */}
                <div className="failure-text">
                  {stream.failure.message ? stream.failure.message : failureMessage(stream.failure.code)}
                </div>
              </div>
            )}
          </>
        )}
        <QuestionChatCards
          botId={me.bot.id}
          answered={answeredQuestions}
          onAnswered={(requestId, entry) =>
            setAnsweredQuestions((prev) => ({ ...prev, [requestId]: entry }))
          }
          onUserBubble={onSend}
          onFallback={(requestId, question) => {
            setClarify({ forKey: me.key, kind: "ask", requestId, question });
            inputRef.current?.focus();
          }}
          clarifyRequestId={
            clarify?.kind === "ask" && clarify.forKey === me.key ? clarify.requestId : null
          }
        />
        <SearchResultCards botId={me.bot.id} />
        <PermissionChatCards
          botId={me.bot.id}
          botName={me.bot.name}
          onPendingCount={(count) => onApprovalPending(me.bot.id, me.bot.name, count)}
        />
        <TaskFeedCards
          botId={me.bot.id}
          bots={bots}
          onOpenExchange={(botKey) => setDetailOther(botKey)}
        />
        </TimelineOrderProvider>
      </div>
      {pendingFiles.length > 0 && (
        <div className="attach-chips" aria-label={t("shell.pendingAttachments")}>
          {pendingFiles.map((file, index) => (
            <span className="attach-chip" key={`${file.name}-${index}`}>
              <span className="attach-chip-name">{file.name}</span>
              <span className="attach-chip-size">{formatAttachmentSize(file.size)}</span>
              {classifyAttachment(file.mime, file.name) === "image" && (
                <span className="attach-chip-flag">{t("shell.attachmentNotModelReadable")}</span>
              )}
              <button
                type="button"
                className="attach-chip-remove"
                aria-label={t("shell.removeAttachment", [file.name])}
                onClick={() =>
                  setPendingFiles((prev) => prev.filter((_, i) => i !== index))
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {quoteDraft && (
        <div className="quote-chip">
          <span>
            {t("shell.quotedMessage", [quoteDraft.name, quoteDraft.text])}
          </span>
          <button type="button" className="quote-cancel" aria-label={t("shell.cancelQuote")} onClick={onCancelQuote}>
            ×
          </button>
        </div>
      )}
      {clarifyActive && (
        <div className="quote-chip" role="status">
          <span>{t("questions.explainPlaceholder")}</span>
          <button
            type="button"
            className="quote-cancel"
            aria-label={t("questions.cancelExplain")}
            onClick={() => setClarify(null)}
          >
            ×
          </button>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={attachmentAccept()}
        style={{ display: "none" }}
        aria-label={t("shell.selectAttachments")}
        onChange={(event) => {
          void readPickedFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <div className="composer">
        <div className="composer-menu-wrap">
          {skillMenuOpen && (
            <>
              <div className="menu-overlay" onClick={() => setSkillMenuOpen(false)} />
              <div className="composer-menu skills-menu" role="menu" aria-label={t("skills.menuLabel")}>
                {skills.length === 0 && (
                  <div className="menu-item skills-empty">{t("skills.emptyHint")}</div>
                )}
                {skills.map((skill) => (
                  <div className="skill-row" key={skill.id}>
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item skill-apply"
                      title={t("skills.applyAria", [skill.name, skill.version])}
                      onClick={() => applySkillToDraft(skill)}
                    >
                      <span className="skill-name">{skill.name}</span>
                      <span className="skill-version">v{skill.version}</span>
                    </button>
                    <button
                      type="button"
                      className="skill-remove"
                      aria-label={t("skills.removeAria", [skill.name])}
                      onClick={() => removeSkill(skill.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div className="menu-sep" />
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  disabled={draft.trim().length === 0}
                  onClick={saveDraftAsSkill}
                >
                  <MenuIcon d="M5 4h9l5 5v11H5zM14 4v5h5" />
                  {t("skills.saveCurrentAria")}
                </button>
              </div>
            </>
          )}
          <button
            type="button"
            className="composer-plus"
            aria-label={t("shell.moreActions")}
            title={t("shell.startConversation")}
            onClick={() => setPlusOpen((v) => !v)}
          >
            ＋
          </button>
          {plusOpen && (
            <>
              <div className="menu-overlay" onClick={() => setPlusOpen(false)} />
              <div className="composer-menu" role="menu" aria-label={t("shell.more")}>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    setPlusOpen(false);
                    fileInputRef.current?.click();
                  }}
                >
                  <MenuIcon d="M21 12.5 12.5 21a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a1.8 1.8 0 0 1-2.5-2.5L15 4.5" />
                  {t("shell.addAttachment")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    setPlusOpen(false);
                    setSkillMenuOpen(true);
                  }}
                >
                  <MenuIcon d="M13 2 4.5 12.5 H11 L9.5 21 L19 9.5 H12 Z" />
                  {t("skills.menuLabel")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    setPlusOpen(false);
                    setMemoryOpen(true);
                  }}
                >
                  <MenuIcon d="M7 3.5h10a1 1 0 0 1 1 1V20l-6-3.8-6 3.8V4.5a1 1 0 0 1 1-1Z" />
                  {t("memory.dialogTitle")}
                </button>
                <div className="menu-sep" />
                {/* 回答方式：两个开关从输入行收进＋菜单。
                    menuitemcheckbox + 行尾勾选；点击后菜单保持打开，
                    让勾选状态当场可见。状态来源不变（localStorage / 模型配置）。 */}
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={deepThinking}
                  className="menu-item"
                  title={deepThinking ? t("reasoner.tooltipOn") : t("reasoner.tooltipOff")}
                  onClick={onToggleDeepThinking}
                >
                  <MenuIcon d="M12 3.5a5.5 5.5 0 0 1 3.7 9.6c-.7.6-1.2 1.5-1.2 2.4v.5h-5v-.5c0-.9-.5-1.8-1.2-2.4A5.5 5.5 0 0 1 12 3.5ZM9.5 19.5h5M10.5 21.5h3" />
                  {t("reasoner.toggleLabel")}
                  {deepThinking && (
                    <span className="menu-check menu-check-end" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={primitiveMode}
                  className="menu-item"
                  title={t("shell.primitiveModeTitle")}
                  onClick={onTogglePrimitive}
                >
                  <MenuIcon d="M5 19 15 9M13 4l7 7-4 1-4-4 1-4Z" />
                  {t("shell.primitiveMode")}
                  {primitiveMode && (
                    <span className="menu-check menu-check-end" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </button>
                <div className="menu-sep" />
                <div className="menu-sub-wrap">
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={(e) => e.currentTarget.focus()}
                  >
                    <MenuIcon d="M8 12h8m-8 0a3 3 0 1 1 3-3m-3 3a3 3 0 0 0 3 3m5-6h3a3 3 0 0 1 0 6h-3m-2 0a3 3 0 1 0 3 3" />
                    {t("shell.startConversation")}
                    <span className="menu-arrow">›</span>
                  </button>
                  <div className="submenu" role="menu" aria-label={t("shell.selectBot")}>
                    {others.length === 0 && (
                      <div className="composer-menu-empty">{t("shell.noOtherBots")}</div>
                    )}
                    {others.map((b) => (
                      <button
                        key={b.key}
                        type="button"
                        role="menuitem"
                        className="menu-item"
                        onClick={() => {
                          onTalkTo(b.key);
                          setPlusOpen(false);
                        }}
                      >
                        <AvatarView avatar={b.avatar} variant="inline" size={22} />
                        <span className="tab-title">{b.bot.name}</span>
                        <span className="composer-menu-hint">
                          {groupLabel(groups.find((g) => g.key === b.group))}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
        <input
          ref={inputRef}
          className="composer-input"
          placeholder={clarifyActive ? t("questions.realIntentPlaceholder") : t("shell.messageBot", [me.bot.name])}
          value={draft}
          maxLength={200}
          aria-label={t("shell.messageBot", [me.bot.name])}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              send();
            }
          }}
        />
        <ContextRing usage={contextUsage} />
        <ComposerMic
          status={voiceStatus}
          language={voiceLanguage}
          onNotify={onNotify}
          onTranscript={(text) => setDraft((prev) => appendTranscript(prev, text))}
        />
        <button type="button" className="send-btn" aria-label={t("shell.send")} disabled={!draft.trim() && pendingFiles.length === 0} onClick={send}>
          ↑
        </button>
      </div>
      {memoryOpen && (
        <MemoryPanel botId={me.bot.id} onClose={() => setMemoryOpen(false)} />
      )}
    </div>
  );
}




