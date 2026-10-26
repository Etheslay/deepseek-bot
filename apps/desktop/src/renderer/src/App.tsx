import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { useBots, type UiBot } from "./features/bots/use-bots.js";
import { PermissionsPanel } from "./features/permissions/permissions-panel.js";
import { BotForm } from "./features/bots/bot-form.js";
import { CustomSelect } from "./components/custom-select.js";
import type { BotDraft } from "./services/desktop-service.js";
import { useService } from "./services/service-context.jsx";
import {
  applyCancelled,
  applyDelta,
  applyFailure,
  applyTool,
  emptyStream,
  failureMessage,
  type StreamState,
} from "./features/chat/chat-reducer.js";
import type { StreamHandle } from "./services/desktop-service.js";
import { Avatar as AvatarView } from "./features/avatars/avatar.js";
import { AvatarPicker } from "./features/avatars/avatar-picker.js";
import {
  avatarColor,
  type Avatar as AvatarKind,
} from "./features/avatars/avatar-meta.js";
import { WorkflowEditor } from "./features/workflow-editor/workflow-editor.js";
import { RunMonitor } from "./features/run-monitor/run-monitor.js";
import { ChatMarkdown } from "./features/chat/chat-markdown.js";
import type { MentionTable } from "./features/chat/mentions.js";
import {
  attachmentAccept,
  classifyAttachment,
  formatAttachmentSize,
  MAX_ATTACHMENT_BYTES,
  type AttachmentDraft,
} from "./features/chat/attachments.js";
import { GlobalSearch } from "./features/search/global-search.js";
import { buildSearchIndex, type SearchItem } from "./features/search/search-core.js";
import {
  ACCENT_PRESETS,
  loadSettings,
  saveSettings,
} from "./features/settings/settings-store.js";
import {
  deleteTemplate,
  listTemplates,
  saveTemplate,
  type BotTemplate,
} from "./features/templates/bot-templates.js";


type Group = { key: number; name: string };
const UNGROUPED = 1;

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
  /** Files sent with the message (D26 renderer slice). */
  attachments?:
    | { name: string; size: number; kind: "text" | "image" | "binary"; dataUrl?: string }[]
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
};

type ChatState = Record<number, Msg[]>;


type MenuState = { x: number; y: number; botKey: number };
type DialogState = { type: "newGroup"; moveBot: number | null };

function pairKeyOf(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function formatChatTime(t: number): string {
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const time = `${hh}:${mm}`;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `今天 ${time}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return `昨天 ${time}`;
  }
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${d.getMonth() + 1}月${d.getDate()}日${weekdays[d.getDay()]} ${time}`;
}

function readableTextColor(hex: string): string {
  if (hex.startsWith("var(")) {
    return "var(--avatar-mono-fg)";
  }
  const value = hex.replace("#", "");
  if (value.length !== 6) {
    return "#ffffff";
  }
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#1b1b1f" : "#ffffff";
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
  const [modalGroup, setModalGroup] = useState<number>(UNGROUPED);
  const [tplSeed, setTplSeed] = useState("new");
  const [tplDraft, setTplDraft] = useState<BotDraft | null>(null);

  const [groups, setGroups] = useState<Group[]>([{ key: UNGROUPED, name: "未分组" }]);
  const {
    bots,
    create: createBotEntity,
    update: updateBotEntity,
    duplicate: duplicateBotEntity,
    setUi,
    moveToTop,
    hide,
  } = useBots(UNGROUPED);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [menuDialog, setMenuDialog] = useState<DialogState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UiBot | null>(null);
  const [dialogText, setDialogText] = useState("");

  const [selectedBot, setSelectedBot] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [historySessions, setHistorySessions] = useState<
    { sessionId: string; botId: string; title: string; startedAt: string; status: string }[] | null
  >(null);
  const [artifactList, setArtifactList] = useState<
    import("@deepseek-bot/contracts").Artifact[] | null
  >(null);
  const [artifactPreview, setArtifactPreview] = useState<
    { id: string; kind: "text"; content: string } | { id: string; kind: "blocked"; reason: string } | null
  >(null);
  const [restoredSession, setRestoredSession] = useState<{
    sessionId: string;
    title: string;
    startedAt: string;
    status: string;
  } | null>(null);

  const [chats, setChats] = useState<ChatState>({});
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
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const initialSettings = useMemo(() => loadSettings(window.localStorage), []);
  const [theme, setTheme] = useState<"dark" | "light">(initialSettings.theme);
  const [accountName, setAccountName] = useState(initialSettings.accountName);
  const [accent, setAccent] = useState(initialSettings.accent);
  const [botTemplates, setBotTemplates] = useState<BotTemplate[]>(() =>
    listTemplates(window.localStorage),
  );

  const saveBotTemplate = (target: UiBot): void => {
    const result = saveTemplate(window.localStorage, {
      name: `${target.bot.name} 模板`,
      bot: {
        name: target.bot.name,
        instructions: target.bot.instructions,
        avatarUi: { avatar: target.avatar, shape: target.shape, color: target.color },
      },
    });
    if (result.ok) {
      setBotTemplates(listTemplates(window.localStorage));
      setToast(`已保存模板「${result.template.name}」`);
    } else {
      setToast(
        result.reason === "limit" ? `模板已达上限` : `同名模板已存在`,
      );
    }
  };

  const [updateStatus, setUpdateStatus] = useState<
    { available: boolean; version: string | null; downloading: boolean; readyToInstall: boolean; error: string | null } | null
  >(null);

  useEffect(() => {
    saveSettings(window.localStorage, { theme, accountName, accent });
  }, [theme, accountName, accent]);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accent);
  }, [accent]);

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
    // 窗口控制条由主进程 titleBarOverlay 绘制，随主题经白名单 IPC 同步颜色
    const overlay =
      theme === "light"
        ? { color: "#ffffff", symbolColor: "#1a1a1e" }
        : { color: "#0f0f10", symbolColor: "#ececf1" };
    void window.deepseekBot.window.setTitleBarOverlay(overlay).catch(() => undefined);
  }, [theme]);

  useEffect(() => {
    if (modalOpen && !editingBot) {
      setAvatar({ kind: "grok", shape: "blob", color: "#3b93f0" });
    }
  }, [modalOpen, editingBot]);
  useEffect(() => {
    if (!historyOpen || selectedBot === null) {
      return;
    }
    const bot = bots.find((b) => b.key === selectedBot);
    if (!bot) {
      return;
    }
    let cancelled = false;
    void desktop.chat.listSessions(bot.bot.id).then((sessions) => {
      if (!cancelled) {
        setHistorySessions(sessions);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [historyOpen, selectedBot, bots, desktop]);

  useEffect(() => {
    if (!artifactsOpen || selectedBot === null) {
      return;
    }
    const bot = bots.find((b) => b.key === selectedBot);
    if (!bot) {
      return;
    }
    let cancelled = false;
    void desktop.chat
      .listSessions(bot.bot.id)
      .then((sessions) => (sessions.length > 0 ? sessions[0]!.sessionId : null))
      .then((sessionId) => (sessionId ? desktop.artifacts.listBySession(sessionId) : []))
      .then((list) => {
        if (!cancelled) {
          setArtifactList(list);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [artifactsOpen, selectedBot, bots, desktop]);

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
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const selectedBotEntry = bots.find((b) => b.key === selectedBot);
  const selectedBotName = selectedBotEntry?.bot.name ?? "DeepSeek Bot";

  const openCreateBotModal = () => {
    setTplDraft(null);
    setTplSeed("new");
    setShape(0);
    setColor(2);
    setAvatar({ kind: "grok", shape: "blob", color: "#3b93f0" });
    setModalGroup(
      groups.find((g) => g.name === "未分组")?.key ?? groups[0]?.key ?? UNGROUPED,
    );
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
    if (editingBot) {
      const result = await updateBotEntity(editingBot.bot.id, draft);
      if (result.ok) {
        setModalOpen(false);
        setToast("已保存");
      }
      return result;
    }
    const result = await createBotEntity(draft);
    if (result.ok && result.key !== undefined) {
      setUi(result.key, { avatar, shape, color, group: modalGroup });
      setModalOpen(false);
      setToast("已创建");
    }
    return result;
  };

  const pinBot = (botKey: number): void => {
    moveToTop(botKey);
    setToast("已置顶");
    setMenu(null);
  };

  const moveToGroup = (botKey: number, groupKey: number): void => {
    const g = groups.find((x) => x.key === groupKey);
    setUi(botKey, { group: groupKey });
    setToast(g ? `已移至「${g.name}」` : "已移动");
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
      setToast("已复制");
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
        setToast(ok ? "已复制" : "复制失败（占位环境限制）");
      } catch {
        setToast("复制失败（占位环境限制）");
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
    hide(botKey);
    if (selectedBot === botKey) {
      setSelectedBot(null);
    }
    setToast(why);
    setMenu(null);
  };

    const sendUserMessage = (
    botKey: number,
    text: string,
    attachments?: Msg["attachments"],
  ): void => {
    const t = text.trim();
    if (!t && !(attachments && attachments.length > 0)) {
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
            text: t,
            quote: quoteDraft ? { ...quoteDraft } : null,
            reactions: {},
            mine: [],
            time: Date.now(),
            system: false,
            attachments: attachments && attachments.length > 0 ? attachments : undefined,
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
      const g1 = groups.find((g) => g.key === from.group)?.name ?? "?";
      const g2 = groups.find((g) => g.key === to.group)?.name ?? "?";
      setChats((prev) => ({
        ...prev,
        [fromKey]: [
          ...(prev[fromKey] ?? []),
          {
            id: now + 2,
            from: "bot",
            text: `无法发起：不同分组的 Bot 无法主动交流（${g1} ↔ ${g2}）。`,
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
      { speaker: fromKey, text: `${to.bot.name}，在吗？我是 ${from.bot.name}。` },
      { speaker: toKey, text: `在的 ${from.bot.name}，什么事？` },
      {
        speaker: fromKey,
        text: "先占个位——等真实模型接入后，我们就能这样面对面聊天了。",
      },
      { speaker: toKey, text: "好啊，到时候聊个痛快。" },
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
          notice: { label: "已发消息给", otherKey: toKey },
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
          notice: { label: "已只回", otherKey: fromKey },
          peerKey: fromKey,
        },
      ],
    }));
  };

  const submitDialog = (): void => {
    if (!menuDialog) {
      return;
    }
    const name = dialogText.trim();
    if (!name) {
      return;
    }
    const key = Date.now();
    setGroups((prev) => [...prev, { key, name }]);
    if (menuDialog.moveBot !== null) {
      setUi(menuDialog.moveBot, { group: key });
      setToast(`已创建分组「${name}」并移入`);
    } else {
      setToast(`已创建分组「${name}」`);
    }
    setMenuDialog(null);
  };

  const ensureChat = (bot: UiBot): void => {
    setChats((prev) => {
      if (prev[bot.key]) {
        return prev;
      }
      return {
        ...prev,
            [bot.key]: [
          {
            id: bot.key,
            from: "bot",
            text: `hello，我是 ${bot.bot.name}。聊天支持 **Markdown**：

- 列表、\`行内代码\` 与 [链接](https://api.deepseek.com)
- 代码块带高亮：
\`\`\`typescript
const answer = await bot.ask("你好");
\`\`\`
- 数学公式：质能方程 $E = mc^2$，以及求和
$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$`,
            quote: null,
            reactions: {},
            mine: [],
            time: Date.now(),
            system: false,
            speakerKey: bot.key,
          },
          {
            id: bot.key + 0.5,
            from: "bot",
            text: `想先试哪种能力？也可以在输入框里直接提需求，或 @${bot.bot.name} 让我接手。`,
            quote: null,
            reactions: {},
            mine: [],
            time: Date.now(),
            system: false,
            speakerKey: bot.key,
            choices: {
              question: "想先试哪种能力？",
              options: [
                { id: "A", label: "深度思考一个复杂问题" },
                { id: "B", label: "帮我起草一个工作流" },
                { id: "C", label: "查看运行监控" },
              ],
              other: true,
            },
          },
        ],
      };
    });
  };

  const dropBotToGroup = (botKey: number, groupKey: number): void => {
    const b = bots.find((x) => x.key === botKey);
    const g = groups.find((x) => x.key === groupKey);
    if (!b || !g) {
      return;
    }
    if (b.group === groupKey) {
      setToast("已在该分组");
      return;
    }
    setUi(botKey, { group: groupKey });
    setToast(`已将「${b.bot.name}」拖至「${g.name}」`);
  };

  const deleteGroup = (groupKey: number): void => {
    const g = groups.find((x) => x.key === groupKey);
    if (!g) {
      return;
    }
    const members = bots.filter((b) => b.group === groupKey);
    if (members.length > 0) {
      setToast("请先移出或删除组内 Bot");
      setGroupMenu(null);
      return;
    }
    setGroups((prev) => prev.filter((x) => x.key !== groupKey));
    setCollapsedGroups((prev) => prev.filter((k) => k !== groupKey));
    setToast(`已删除分组「${g.name}」`);
    setGroupMenu(null);
  };

const logout = (): void => {
    setAccountName("本地用户");
    setTheme("dark");
    setEditingName(false);
    setSettingsOpen(false);
    setToast("已退出登录（占位，未接入账号系统）");
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
      botName: string;
      text: string;
      time: number;
    }[] = [];
    for (const [botKey, list] of Object.entries(chats)) {
      const botName =
        bots.find((b) => b.key === Number(botKey))?.bot.name ?? "Bot";
      for (const msg of list) {
        if (msg.system || msg.notice) {
          continue;
        }
        messages.push({
          botKey: Number(botKey),
          botName,
          text: msg.text,
          time: msg.time,
        });
      }
    }
    return buildSearchIndex({
      bots: bots.map((b) => ({
        key: b.key,
        name: b.bot.name,
        group: groups.find((g) => g.key === b.group)?.name ?? "未分组",
      })),
      messages,
      actions: [
        {
          id: "action-settings",
          kind: "action",
          title: "打开设置",
          subtitle: "Key、主题、账户",
          action: "settings",
        },
        {
          id: "action-monitor",
          kind: "action",
          title: "打开运行监控与审批",
          subtitle: "FR-06/07",
          action: "monitor",
        },
        {
          id: "action-workflow",
          kind: "action",
          title: "打开工作流编辑器",
          subtitle: "FR-04",
          action: "workflow",
        },
      ],
    });
  }, [bots, groups, chats]);

  const onSearchSelect = (item: SearchItem): void => {
    if (item.kind === "bot" || item.kind === "message") {
      const botKey = item.botKey;
      const target = bots.find((b) => b.key === botKey);
      if (botKey !== undefined && target) {
        setSelectedBot(botKey);
        setQuoteDraft(null);
        ensureChat(target);
      }
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
        <span className="page-chip">
          {selectedBotEntry ? (
            <AvatarView avatar={selectedBotEntry.avatar} variant="message-header" />
          ) : (
            <BlobMark />
          )}
          {selectedBotName}
        </span>
        <button
          type="button"
          className={"top-icon-btn" + (monitorOpen ? " active" : "")}
          aria-label="运行监控与审批"
          title="运行监控与审批"
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
          aria-label="工作流编辑器"
          title="工作流编辑器"
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
          aria-label="最近会话"
          title="最近会话"
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
          aria-label="产物"
          title="产物"
          onClick={() => {
            setHistoryOpen(false);
            setArtifactsOpen((v) => !v);
            setArtifactPreview(null);
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
        {historyOpen && (
          <>
            <div className="menu-overlay" onClick={() => setHistoryOpen(false)} />
            <div className="top-popover" role="dialog" aria-label="最近会话">
              <div className="popover-title">最近会话</div>
              {(historySessions ?? []).slice(0, 8).map((session) => (
                <button
                  key={session.sessionId}
                  type="button"
                  className="session-item"
                  onClick={() => {
                    setRestoredSession(session);
                    setHistoryOpen(false);
                  }}
                >
                  <span className="tab-title">{session.title}</span>
                  <span className="session-meta">
                    {new Date(session.startedAt).toLocaleString()} ·{" "}
                    {session.status === "ended" ? "已结束" : "进行中"}
                  </span>
                </button>
              ))}
              {(historySessions ?? []).length === 0 && (
                <div className="sys-line">还没有历史会话</div>
              )}
            </div>
          </>
        )}
        {artifactsOpen && (
          <>
            <div className="menu-overlay" onClick={() => setArtifactsOpen(false)} />
            <div className="top-popover artifacts-popover" role="dialog" aria-label="产物">
              <div className="popover-title">产物</div>
              {(artifactList ?? []).map((artifact) => (
                <div className="artifact-item" key={artifact.id}>
                  <div className="artifact-meta">
                    <div className="tab-title">{artifact.relativePath}</div>
                    <div className="session-meta">
                      {artifact.mediaType} · {artifact.size} bytes
                    </div>
                  </div>
                  <button
                    type="button"
                    className="pill-btn"
                    onClick={() => {
                      void desktop.artifacts.preview(artifact).then((result: { kind: "text"; content: string } | { kind: "blocked"; reason: string }) => {
                        setArtifactPreview(
                          result.kind === "text"
                            ? { id: artifact.id, kind: "text", content: result.content }
                            : { id: artifact.id, kind: "blocked", reason: result.reason },
                        );
                      });
                    }}
                  >
                    预览
                  </button>
                </div>
              ))}
              {(artifactList ?? []).length === 0 && <div className="sys-line">暂无产物</div>}
              {artifactPreview !== null &&
                (artifactPreview.kind === "text" ? (
                  <pre className="artifact-preview">{artifactPreview.content}</pre>
                ) : (
                  <p className="form-error">{artifactPreview.reason}</p>
                ))}
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
            aria-label="全局搜索（Ctrl+K）"
            title="全局搜索（Ctrl+K）"
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
            aria-label="创建新 Bot"
            title="创建新 Bot"
            onClick={openCreateBotModal}
          >
            <svg viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="side-identity">
          <span className="big-avatar">
            <AvatarView avatar={{ kind: "grok", shape: "circle", color: "#3b93f0" }} variant="preview" size={84} />
          </span>
          <span className="identity-name">DeepSeek Bot</span>
        </div>
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
                {g.name}
                {!collapsedGroups.includes(g.key) && members.length > 0 && (
                  <span className="group-count">{members.length}</span>
                )}
              </button>
              {!collapsedGroups.includes(g.key) && (
                <div className="tabs" aria-label={`机器人列表-${g.name}`}>
                  {members.map((b) => (
                  <button
                    key={b.key}
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
                      ensureChat(b);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, botKey: b.key });
                    }}
                  >
                    <AvatarView avatar={b.avatar} variant="sidebar" size={36} />
                    <span className="tab-label">
                      <span className="tab-title">
                        {b.bot.name}
                        {b.unread && <span className="unread-dot" aria-label="未读" />}
                      </span>

                    </span>
                  </button>
                ))}
                {dragging && members.length === 0 && (
                  <div className="drop-hint">拖到这里移入「{g.name}」</div>
                )}
                </div>
              )}
            </div>
          );
        })}
        {updateStatus?.available && (
          <button
            type="button"
            className="update-badge"
            title={`下载并安装 ${updateStatus.version ?? "新版本"}`}
            onClick={() => {
              const bridge = window.deepseekBot;
              if (!bridge || !("updates" in bridge)) {
                return;
              }
              setUpdateStatus({ ...updateStatus, downloading: true });
              void bridge.updates
                .downloadInstall()
                .then(setUpdateStatus)
                .catch(() => setUpdateStatus({ ...updateStatus, downloading: false, error: "下载失败" }));
            }}
          >
            <span className="update-badge-dot" />
            {updateStatus.downloading ? "更新下载中…" : "有新版本，点击更新"}
          </button>
        )}
        <div className="sidebar-foot">
          <button
            type="button"
            className="foot-account"
            title="打开设置"
            aria-label="打开设置"
            onClick={() => setSettingsOpen(true)}
          >
            <span className="avatar" aria-hidden="true">
              {accountName.slice(0, 1).toUpperCase()}
            </span>
            <span className="foot-id">
              <span className="foot-name">{accountName}</span>
              <span className="foot-sub">本地工作台</span>
            </span>
          </button>
          <button
            type="button"
            className="foot-gear"
            aria-label="打开设置"
            title="打开设置"
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
      </aside>
      <section className="content">
        <main className="panel">
          {monitorOpen ? (
            <RunMonitor onClose={() => setMonitorOpen(false)} />
          ) : workflowOpen ? (
            <WorkflowEditor onClose={() => setWorkflowOpen(false)} />
          ) : restoredSession !== null && selectedBot !== null ? (
            <div className="restored-view">
              <header className="pair-head">
                <span className="page-chip">{restoredSession.title}</span>
              </header>
              <div className="pair-body">
                <div className="msg-notice">
                  {new Date(restoredSession.startedAt).toLocaleString()} ·{" "}
                  {restoredSession.status === "ended" ? "已结束" : "进行中"}
                </div>
                <div className="sys-line">
                  该会话暂无可回放的聊天消息：当前夹具只含运行事件，真实消息回放需 D06/D12 接入。
                </div>
              </div>
              <div className="pair-foot">
                <button
                  type="button"
                  className="pill-btn"
                  onClick={() => setRestoredSession(null)}
                >
                  返回当前会话
                </button>
              </div>
            </div>
          ) : selectedBot !== null ? (
            <BotsPlaceholder
              key={selectedBot}
              bots={bots}
              groups={groups}
              selectedBot={selectedBot}
              msgs={chats[selectedBot] ?? []}
              pairTranscripts={pairTranscripts}
              quoteDraft={quoteDraft}
              onQuote={(m) => {
                const sender =
                  m.from === "bot"
                    ? bots.find((b) => b.key === (m.speakerKey ?? selectedBot))?.bot.name ?? "Bot"
                    : "我";
                setQuoteDraft({ name: sender, text: m.text.slice(0, 60) });
              }}
              onPairQuote={(name, text) => setQuoteDraft({ name, text: text.slice(0, 60) })}
              onCancelQuote={() => setQuoteDraft(null)}
              onSend={(text, attachments) => sendUserMessage(selectedBot, text, attachments)}
              onAssistant={(t) =>
                setChats((prev) => ({
                  ...prev,
                  [selectedBot]: [
                    ...(prev[selectedBot] ?? []),
                    {
                      id: Date.now() + 1,
                      from: "bot",
                      text: t,
                      quote: null,
                      reactions: {},
                      mine: [],
                      time: Date.now(),
                      system: false,
                      speakerKey: selectedBot,
                    },
                  ],
                }))
              }
              onReact={(msgId, emoji) => toggleReaction(selectedBot, msgId, emoji)}
              onTalkTo={(otherKey) => talkTo(selectedBot, otherKey)}
              onCopy={(t) => void copyText(t)}
              onNotify={(message) => setToast(message)}
              onOpenBot={(botKey) => {
                const target = bots.find((b) => b.key === botKey);
                if (target) {
                  setSelectedBot(botKey);
                  setQuoteDraft(null);
                  ensureChat(target);
                }
              }}
            />
          ) : (
            <div className="empty-state">
              <div className="empty-hero">
                <BlobMark />
                <CloudDecor />
              </div>
              <p>创建一个 Bot 开始使用</p>
              <button type="button" className="primary-btn" onClick={openCreateBotModal}>
                创建 Bot
              </button>
            </div>
          )}
        </main>
      </section>
      </div>

      {menu && menuBot && (
        <>
          <div className="menu-overlay" onClick={() => setMenu(null)} />
          <div
            ref={menuRef}
            className="menu"
            role="menu"
            aria-label={`Bot 操作：${menuBot.bot.name}`}
            style={{ left: menu.x, top: menu.y }}
          >
            <button type="button" role="menuitem" className="menu-item" onClick={() => pinBot(menuBot.key)}>
              <MenuIcon d="M12 17v5M9 3h6l1 7 3 3H5l3-3 1-7Z" />
              置顶
            </button>
            <div className="menu-sub-wrap">
              <button type="button" role="menuitem" className="menu-item" onClick={(e) => e.currentTarget.focus()}>
                <MenuIcon d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
                移至
                <span className="menu-arrow">›</span>
              </button>
              <div className="submenu" role="menu" aria-label="移至分组">
                {groups.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => moveToGroup(menuBot.key, g.key)}
                  >
                    {menuBot.group === g.key && <span className="menu-check">✓</span>}
                    {g.name}
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
                  创建分组…
                </button>
              </div>
            </div>
            <button type="button" role="menuitem" className="menu-item" onClick={() => toggleUnread(menuBot.key)}>
              <MenuIcon d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M10.3 21a2 2 0 0 0 3.4 0" />
              {menuBot.unread ? "标为已读" : "标为未读"}
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
              编辑 Bot
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                void (async () => {
                  const result = await duplicateBotEntity(menuBot.bot.id);
                  setToast(result.ok ? "已复制（副本）" : "复制失败");
                })();
                setMenu(null);
              }}
            >
              <MenuIcon d="M9 9h10v12H9zM5 15H3V3h12v2" />
              复制 Bot
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
              存为模板
            </button>
            <button type="button" role="menuitem" className="menu-item" onClick={() => void copyBotId(menuBot.key)}>
              <MenuIcon d="M9 9h10v12H9zM5 15H3V3h12v2" />
              复制对话 ID
            </button>
            <div className="menu-sep" />
            <button type="button" role="menuitem" className="menu-item" onClick={() => removeBot(menuBot.key, "已从侧边栏隐藏")}>
              <MenuIcon d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M7 11v-3a5 5 0 0 1 9.9-1M21 16v2a2 2 0 0 1-2 2H7" />
              从侧边栏隐藏
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
              删除
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
            aria-label="创建分组"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-head">
              <h3>创建分组</h3>
              <button type="button" className="modal-close" aria-label="关闭" onClick={() => setMenuDialog(null)}>
                ×
              </button>
            </header>
            <div className="modal-body">
              <input
                className="name-input"
                placeholder="分组名称"
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
                取消
              </button>
              <button type="button" className="primary-btn" disabled={!dialogText.trim()} onClick={submitDialog}>
                确定
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
              <h3 id="delete-bot-title">删除“{deleteTarget.bot.name}”</h3>
            </header>
            <div className="modal-body">
              <p className="delete-copy">这将永久删除 Bot 及其聊天记录。此操作无法撤销。</p>
            </div>
            <footer className="modal-foot delete-foot">
              <button type="button" className="ghost-btn" onClick={() => setDeleteTarget(null)}>
                取消
              </button>
              <button
                type="button"
                className="danger-btn"
                onClick={() => {
                  removeBot(deleteTarget.key, "已删除");
                  setDeleteTarget(null);
                }}
              >
                删除
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
            aria-label={editingBot ? "编辑机器人" : "创建新 Bot"}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-head">
              <h3>{editingBot ? "编辑机器人" : "创建新 Bot"}</h3>
              <button type="button" className="modal-close" aria-label="关闭" onClick={() => setModalOpen(false)}>
                ×
              </button>
            </header>
            <div className="modal-body">
              {!editingBot && botTemplates.length > 0 && (
                <div className="tpl-row" role="group" aria-label="从模板开始">
                  <span className="tpl-label">模板</span>
                  {botTemplates.map((tpl) => (
                    <span className="tpl-chip-wrap" key={tpl.id}>
                      <button
                        type="button"
                        className="tpl-chip"
                        title={`用模板「${tpl.name}」填充`}
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
                        aria-label={`删除模板 ${tpl.name}`}
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
                {...(editingBot
                  ? {
                      initial: {
                        name: editingBot.bot.name,
                        instructions: editingBot.bot.instructions,
                        modelProfileId: editingBot.bot.modelProfileId,
                        workspaceId: editingBot.bot.workspaceId,
                        toolPolicyId: editingBot.bot.toolPolicyId,
                      },
                    }
                  : {})}
                submitLabel={editingBot ? "保存" : "创建"}
                minimal={!editingBot}
                onSubmit={submitBotDraft}
                onCancel={() => setModalOpen(false)}
                previewSlot={
                  <div className="preview">
                    <AvatarView avatar={avatar} variant="preview" size={editingBot ? 100 : 80} />
                  </div>
                }
                avatarSlot={<AvatarPicker value={avatar} onChange={setAvatar} theme={theme} />}
                groupSlot={
                  !editingBot && (
                    <div className="group-pick compact">
                      <span>分组</span>
                      <CustomSelect
                        value={modalGroup}
                        options={groups.map((g) => ({ value: g.key, label: g.name }))}
                        onChange={(v) => setModalGroup(Number(v))}
                        ariaLabel="分组"
                        disabled={groups.length === 0}
                      />
                    </div>
                  )
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
            aria-label="分组操作"
            style={{ left: groupMenu.x, top: groupMenu.y }}
          >
            <button
              type="button"
              role="menuitem"
              className="menu-item danger"
              onClick={() => deleteGroup(groupMenu.groupKey)}
            >
              <MenuIcon d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13" />
              删除分组
              {bots.filter((b) => b.group === groupMenu.groupKey).length > 0 &&
                "（请先移出组内 Bot）"}
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
            aria-label="设置"
            onClick={(e) => e.stopPropagation()}
          >
            <aside className="settings-nav" aria-label="设置分类">
              <button type="button" className="settings-nav-item active">
                <MenuIcon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z" />
                通用
              </button>
              {["电脑", "保险库", "用量与账单", "更新"].map((label) => (
                <button
                  key={label}
                  type="button"
                  className="settings-nav-item disabled"
                  disabled
                  title="后续提供"
                >
                  {label}
                </button>
              ))}
            </aside>
            <div className="settings-main">
              <header className="settings-head">
                <h3>通用</h3>
                <button
                  type="button"
                  className="modal-close"
                  aria-label="关闭设置"
                  onClick={() => setSettingsOpen(false)}
                >
                  ×
                </button>
              </header>
              <div className="settings-body">
                <div className="settings-section-title">账户</div>
                <div className="account-card">
                  <span className="account-avatar" aria-hidden="true">
                    {accountName.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="account-meta">
                    {editingName ? (
                      <input
                        className="name-input inline"
                        value={nameDraft}
                        maxLength={40}
                        autoFocus
                        aria-label="账户名称"
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            saveName();
                          }
                        }}
                        onBlur={saveName}
                      />
                    ) : (
                      <span className="account-name">{accountName}</span>
                    )}
                    <span className="account-mail">本地会话 · 未接入账号系统</span>
                  </div>
                  <div className="account-actions">
                    {editingName ? (
                      <button type="button" className="pill-btn" onClick={saveName}>
                        保存
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="pill-btn"
                        onClick={() => {
                          setNameDraft(accountName);
                          setEditingName(true);
                        }}
                      >
                        改名字
                      </button>
                    )}
                    <button type="button" className="pill-btn" onClick={logout}>
                      退出登录
                    </button>
                  </div>
                </div>
                <div className="settings-section-title">电脑与权限（策略 / 授权 / 撤销）</div>
                <PermissionsPanel />
                <div className="settings-section-title">接入（Key 加密保存在系统凭据库，只写不读）</div>
                <div className="settings-card">
                  <div className="settings-row">
                    <span>API Key（只写不读）</span>
                    <span className="key-input-wrap">
                      <input
                        type="password"
                        className="settings-select key-input"
                        placeholder={desktop.settings.keyConfigured() ? "已配置（输入新值覆盖）" : "未配置"}
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
                              setToast("已保存（不回显）");
                            })
                            .catch((error: unknown) => {
                              setToast(
                                `保存失败：${error instanceof Error ? error.message : String(error)}`,
                              );
                            });
                        }}
                      >
                        保存
                      </button>
                    </span>
                  </div>
                  <div className="settings-row">
                    <span>测试连接</span>
                    <span className="key-input-wrap">
                      {testResult &&
                        (testResult.result === "unverified" ? (
                          <span className="settings-soon">UNVERIFIED（无真实网络，占位）</span>
                        ) : (
                          <span className={testResult.ok ? "settings-ok" : "form-error"}>
                            {testResult.ok ? "连接成功" : testResult.errorCode}
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
                        {testing ? "测试中…" : "测试连接"}
                      </button>
                    </span>
                  </div>
                </div>
                <div className="settings-section-title">外观</div>
                <div className="settings-card">
                  <div className="settings-row">
                    <span>主题</span>
                    <CustomSelect
                      value={theme}
                      options={[
                        { value: "dark", label: "深色" },
                        { value: "light", label: "浅色" },
                      ]}
                      onChange={(v) => setTheme(v === "light" ? "light" : "dark")}
                      ariaLabel="主题"
                    />
                  </div>
                  <div className="settings-row">
                    <span>强调色</span>
                    <span className="accent-chips" role="radiogroup" aria-label="强调色">
                      {ACCENT_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          className={"accent-chip" + (accent === preset ? " selected" : "")}
                          style={{ background: preset }}
                          aria-label={`强调色 ${preset}`}
                          aria-pressed={accent === preset}
                          onClick={() => setAccent(preset)}
                        />
                      ))}
                    </span>
                  </div>
                  <div className="settings-row">
                    <span>语言</span>
                    <span className="settings-soon">跟随系统</span>
                  </div>
                </div>
                <div className="settings-section-title">关于与更新</div>
                <div className="settings-card">
                  <div className="settings-row">
                    <span>版本</span>
                    <span className="settings-soon">{version}</span>
                  </div>
                  <div className="settings-row">
                    <span>检查更新</span>
                    <span className="key-input-wrap">
                      <span className="update-state">
                        {updateStatus === null
                          ? "（GitHub Releases）"
                          : updateStatus.available
                            ? `发现新版本 ${updateStatus.version ?? ""}`
                            : updateStatus.error
                              ? "暂无可用更新（尚未发布 Release）"
                              : "已是最新"}
                      </span>
                      <button
                        type="button"
                        className="pill-btn"
                        onClick={() => {
                          const bridge = window.deepseekBot;
                          if (!bridge || !("updates" in bridge)) {
                            setToast("更新通道需要主进程（打包版可用）");
                            return;
                          }
                          void bridge.updates.check().then(setUpdateStatus).catch(() => {
                            setToast("检查更新失败（网络或无 Release）");
                          });
                        }}
                      >
                        检查
                      </button>
                    </span>
                  </div>
                  <div className="settings-row">
                    <span>本地用量</span>
                    <span className="settings-soon">
                      {bots.length} 个 Bot · {Object.keys(chats).length} 个会话 ·{" "}
                      {Object.values(chats).reduce((sum, list) => sum + list.length, 0)} 条消息
                    </span>
                  </div>
                </div>
                <div className="settings-section-title">系统</div>
                <div className="settings-card">
                  <div className="settings-row">
                    <span>麦克风</span>
                    <span className="settings-soon">已全部拒绝（安全策略）</span>
                  </div>
                  <div className="settings-row">
                    <span>硬件加速</span>
                    <span className="settings-soon">后续提供</span>
                  </div>
                </div>
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
      />
    </div>
  );
}

function MessageBubble({
  msg,
  speaker,
  accent,
  mentions,
  onMentionClick,
  onChoice,
  onReact,
  onQuote,
  onCopy,
}: {
  msg: Msg;
  speaker: UiBot | null;
  accent: string;
  mentions?: MentionTable;
  onMentionClick?: (botKey: number) => void;
  onChoice?: (msgId: number, optionLabel: string, other: boolean) => void;
  onReact: (msgId: number, emoji: Emoji) => void;
  onQuote: (msg: Msg) => void;
  onCopy: (text: string) => void;
}): JSX.Element {
  const isUser = msg.from === "user";
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

  return (
    <div className={"msg-row" + (isUser ? " user" : " bot")}>
      {!isUser && speaker && (
        <AvatarView avatar={speaker.avatar} variant="inline" size={34} />
      )}
      <div className="hover-wrap">
        {!isUser && speaker ? (
          <div className="sender-line">
            <span className="sender-name" style={{ color: avatarColor(speaker.avatar) }}>
              {speaker.bot.name}
            </span>
          </div>
        ) : null}
        <div
          className={"msg-bubble" + (isUser ? " user" : "")}
          style={isUser ? { background: accent, color: readableTextColor(accent) } : undefined}
        >
          {msg.quote && (
            <div className="msg-quote">
              引用 {msg.quote.name}：{msg.quote.text}
            </div>
          )}
          {msg.attachments && msg.attachments.length > 0 && (
            <div className="msg-attachments">
              {msg.attachments.map((file) =>
                file.kind === "image" && file.dataUrl ? (
                  <img
                    key={file.name}
                    className="msg-attachment-image"
                    src={file.dataUrl}
                    alt={file.name}
                    draggable={false}
                  />
                ) : (
                  <span className="msg-attachment-file" key={file.name}>
                    <span className="msg-attachment-name">{file.name}</span>
                    <span className="msg-attachment-size">
                      {formatAttachmentSize(file.size)}
                    </span>
                  </span>
                ),
              )}
            </div>
          )}
          {isUser ? (
            msg.text
          ) : (
            <ChatMarkdown
              text={msg.text}
              mentions={mentions}
              onMentionClick={onMentionClick}
            />
          )}
          {msg.choices && (
            <div className="choice-card" role="group" aria-label={msg.choices.question}>
              <div className="choice-question">{msg.choices.question}</div>
              {msg.choices.answered ? (
                <div className="choice-answered">已选择：{msg.choices.answered}</div>
              ) : (
                <div className="choice-options">
                  {msg.choices.options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="choice-option"
                      onClick={() => onChoice?.(msg.id, option.label, false)}
                    >
                      <span className="choice-key">{option.id}</span>
                      <span>{option.label}</span>
                    </button>
                  ))}
                  {msg.choices.other && (
                    <button
                      type="button"
                      className="choice-option choice-other"
                      onClick={() => onChoice?.(msg.id, "", true)}
                    >
                      <span className="choice-key">✎</span>
                      <span>其他，我说明</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {!isUser && EMOJIS.some((e) => (msg.reactions[e] ?? 0) > 0) && (
            <div className="reaction-chips">
              {EMOJIS.filter((e) => (msg.reactions[e] ?? 0) > 0).map((e) => (
                <button
                  key={e}
                  type="button"
                  className={"reaction-chip" + (msg.mine.includes(e) ? " mine" : "")}
                  title={msg.mine.includes(e) ? "取消我的回应" : "回应"}
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
                aria-label="选择表情"
                style={{ left: pickerPos.x, top: pickerPos.y }}
              >
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    className="react-btn"
                    data-emoji={e}
                    title={`回应 ${e}`}
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
      <div className="msg-actions" role="toolbar" aria-label="消息操作">
        {!isUser && (
          <button
            type="button"
            className={"msg-icon-btn" + (pickerOpen ? " active" : "")}
            data-action="emoji"
            title="回应"
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
          title="引用"
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
          title="复制"
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
      </div>
    </div>
  );
}

function BotsPlaceholder({
  bots,
  groups,
  selectedBot,
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
  onNotify,
}: {
  bots: UiBot[];
  groups: Group[];
  selectedBot: number;
  msgs: Msg[];
  pairTranscripts: Record<
    string,
    { id: number; speakerKey: number; text: string; time: number }[]
  >;
  quoteDraft: { name: string; text: string } | null;
  onQuote: (msg: Msg) => void;
  onPairQuote: (name: string, text: string) => void;
  onCancelQuote: () => void;
  onSend: (text: string, attachments?: Msg["attachments"]) => void;
  onReact: (msgId: number, emoji: Emoji) => void;
  onTalkTo: (otherKey: number) => void;
  onCopy: (text: string) => void;
  onAssistant: (text: string) => void;
  onOpenBot: (botKey: number) => void;
  onNotify: (message: string) => void;
}): JSX.Element {
  const service = useService();
  const [draft, setDraft] = useState("");
  const [plusOpen, setPlusOpen] = useState(false);
  const [detailOther, setDetailOther] = useState<number | null>(null);
  const [stream, setStream] = useState<(StreamState & { forKey: number }) | null>(null);
  const [failedText, setFailedText] = useState("");
  const [answeredChoices, setAnsweredChoices] = useState<Record<number, string>>({});
  const [pendingFiles, setPendingFiles] = useState<AttachmentDraft[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<StreamHandle | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const me = bots.find((b) => b.key === selectedBot);

  /** @Name chips link to any known bot; color follows its avatar. */
  const mentionTable = useMemo<MentionTable>(() => {
    const table: MentionTable = new Map();
    for (const bot of bots) {
      table.set(bot.bot.name, { botKey: bot.key, color: avatarColor(bot.avatar) });
    }
    return table;
  }, [bots]);

  const handleChoice = (msgId: number, optionLabel: string, other: boolean): void => {
    if (other) {
      inputRef.current?.focus();
      return;
    }
    setAnsweredChoices((prev) => ({ ...prev, [msgId]: optionLabel }));
    onSend(`我选择：${optionLabel}`);
  };

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [msgs.length]);

  if (!me) {
    return (
      <div className="bubble">
        <h2>机器人</h2>
        <p>该 Bot 已不存在。</p>
      </div>
    );
  }

  if (detailOther !== null) {
    const peer = bots.find((bot) => bot.key === detailOther);
    const turns = pairTranscripts[pairKeyOf(me.key, detailOther)] ?? [];
    return (
      <div className="pair-view">
        <header className="pair-head">
          <span className="pair-title">
            <AvatarView avatar={me.avatar} variant="inline" size={26} />
            <span className="pair-arrow">⇄</span>
            <AvatarView avatar={peer?.avatar ?? me.avatar} variant="inline" size={26} />
            <span>{peer?.bot.name ?? "?"}</span>
          </span>
        </header>
        <div className="pair-body">
          {turns.map((turn) => {
            const speaker = bots.find((bot) => bot.key === turn.speakerKey);
            return (
              <div className="pair-turn" key={turn.id}>
                <AvatarView avatar={speaker?.avatar ?? me.avatar} variant="inline" size={30} />
                <div className="pair-turn-main">
                  <span
                    className="pair-speaker"
                    style={{ color: avatarColor(speaker?.avatar ?? me.avatar) }}
                  >
                    {speaker?.bot.name ?? "?"}
                  </span>
                  <div className="pair-bubble-row">
                    <div className="msg-bubble">{turn.text}</div>
                    <div className="pair-actions">
                      <button
                        type="button"
                        className="msg-icon-btn"
                        title="引用"
                        aria-label="引用"
                        onClick={() => {
                          onPairQuote(speaker?.bot.name ?? "?", turn.text);
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
                        title="复制"
                        aria-label="复制"
                        onClick={() => onCopy(turn.text)}
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
          })}
          {turns.length === 0 && <div className="sys-line">暂无消息往来。</div>}
        </div>
        <div className="pair-foot">
          <button type="button" className="pill-btn" onClick={() => setDetailOther(null)}>
            关闭聊天
          </button>
        </div>
      </div>
    );
  }

  const others = bots.filter((b) => b.key !== me.key);
  const pairPeers = Array.from(
    new Set(
      msgs.flatMap((message) => (message.notice ? [message.notice.otherKey] : [])),
    ),
  );
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
        onNotify(`${file.name} 超过 2 MB 上限`);
        continue;
      }
      const kind = classifyAttachment(file.type, file.name);
      if (kind === "text") {
        drafts.push({ name: file.name, size: file.size, mime: file.type, text: await file.text() });
      } else if (kind === "image") {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        drafts.push({ name: file.name, size: file.size, mime: file.type, dataUrl });
      } else {
        onNotify(`${file.name} 暂不支持预览（仅文本与图片）`);
      }
    }
    if (drafts.length > 0) {
      setPendingFiles((prev) => [...prev, ...drafts]);
    }
  };

  const send = (): void => {
    const text = draft.trim();
    if (!text && pendingFiles.length === 0) {
      return;
    }
    const outgoing: NonNullable<Msg["attachments"]> = pendingFiles.map((f) => ({
      name: f.name,
      size: f.size,
      kind: classifyAttachment(f.mime, f.name),
      ...(f.dataUrl !== undefined ? { dataUrl: f.dataUrl } : {}),
    }));
    onSend(text, outgoing.length > 0 ? outgoing : undefined);
    setPendingFiles([]);
    setFailedText(text);
    setDraft("");
    if (streamRef.current) {
      streamRef.current.cancel();
    }
    const forKey = me.key;
    setStream({ ...emptyStream(), forKey });
    let acc = "";
    const handle = service.chat.stream(me.bot.id, text, {
      onDelta: (chunk) => {
        acc += chunk;
        setStream((prev) =>
          prev && prev.forKey === forKey ? { ...applyDelta(prev, chunk), forKey } : prev,
        );
      },
      onTool: (tool) => {
        setStream((prev) =>
          prev && prev.forKey === forKey ? { ...applyTool(prev, tool), forKey } : prev,
        );
      },
    });
    streamRef.current = handle;
    void handle.finish().then((result) => {
      streamRef.current = null;
      setStream((prev) => {
        if (!prev || prev.forKey !== forKey) {
          return prev;
        }
        if (result.cancelled) {
          return { ...applyCancelled(prev), forKey };
        }
        if (result.failure) {
          return { ...applyFailure(prev, result.failure), forKey };
        }
        onAssistant(acc);
        return null;
      });
    });
  };

  const retryStream = (): void => {
    if (failedText.trim()) {
      const text = failedText;
      setFailedText("");
      onSend(text);
      const forKey = me.key;
      setStream({ ...emptyStream(), forKey });
      let acc = "";
      const handle = service.chat.stream(me.bot.id, text, {
        onDelta: (chunk) => {
          acc += chunk;
          setStream((prev) =>
            prev && prev.forKey === forKey ? { ...applyDelta(prev, chunk), forKey } : prev,
          );
        },
        onTool: (tool) => {
          setStream((prev) =>
            prev && prev.forKey === forKey ? { ...applyTool(prev, tool), forKey } : prev,
          );
        },
      });
      streamRef.current = handle;
      void handle.finish().then((result) => {
        streamRef.current = null;
        setStream((prev) => {
          if (!prev || prev.forKey !== forKey) {
            return prev;
          }
          if (result.cancelled) {
            return { ...applyCancelled(prev), forKey };
          }
          if (result.failure) {
            return { ...applyFailure(prev, result.failure), forKey };
          }
          onAssistant(acc);
          return null;
        });
      });
    }
  };

  return (
    <div className="chat-page">
      <p className="sys-line" aria-live="polite">
        静态占位 · 无网络请求 · 不同分组的 Bot 无法主动交流
      </p>
      <div className="chat" ref={listRef}>
        {msgs.map((m, index) => {
          const prev = msgs[index - 1];
          const showTime =
            !m.system &&
            !m.notice &&
            (!prev || prev.system || m.time - prev.time > 5 * 60 * 1000);
          const speaker =
            m.from === "bot" ? bots.find((b) => b.key === (m.speakerKey ?? me.key)) ?? me : null;
          return (
            <Fragment key={m.id}>
              {showTime && <div className="chat-time">{formatChatTime(m.time)}</div>}
              {m.notice ? (
                m.deliverTo ? (
                  <div className="deliver-notice" role="status">
                    <span className="deliver-label">{m.notice.label}</span>
                    <span className="avatar-stack">
                      {m.deliverTo.map((key) => {
                        const target = bots.find((bot) => bot.key === key);
                        return (
                          <button
                            key={key}
                            type="button"
                            className="stack-avatar"
                            title={`打开 ${target?.bot.name ?? "?"} 的会话`}
                            aria-label={`打开 ${target?.bot.name ?? "?"} 的会话`}
                            onClick={() => onOpenBot(key)}
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
                      <span className="deliver-count">{m.deliverTo.length} 个 Bot</span>
                    )}
                  </div>
                ) : m.id === firstNoticeId ? (
                  <div className="chat-summary">
                    <span className="chat-summary-label">{pairTotal} 条消息往来：</span>
                    {pairPeers.map((peerKey, peerIndex) => {
                      const peer = bots.find((bot) => bot.key === peerKey);
                      return (
                        <Fragment key={peerKey}>
                          {peerIndex > 0 && <span className="summary-and">和</span>}
                          <button
                            type="button"
                            className="summary-bot"
                            title={`查看与 ${peer?.bot.name ?? "?"} 的消息往来`}
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
                <div className="sys-line">{m.text}</div>
              ) : (
                <MessageBubble
                  msg={{
                    ...m,
                    choices: m.choices
                      ? { ...m.choices, answered: m.choices.answered ?? answeredChoices[m.id] }
                      : undefined,
                  }}
                  speaker={speaker}
                  accent={avatarColor(me.avatar)}
                  mentions={mentionTable}
                  onMentionClick={onOpenBot}
                  onChoice={handleChoice}
                  onReact={onReact}
                  onQuote={onQuote}
                  onCopy={onCopy}
                />
              )}
            </Fragment>
          );
        })}
        {msgs.length === 0 && <div className="sys-line">会话为空。</div>}
        {stream && stream.forKey === me.key && (
          <>
            {stream.tools.map((tool) => (
              <div className="tool-card" key={tool.toolName}>
                <span className={"tool-state tool-" + tool.state}>
                  {tool.state === "requested"
                    ? "请求中"
                    : tool.state === "running"
                      ? "执行中"
                      : tool.state === "succeeded"
                        ? "已完成"
                        : "失败"}
                </span>
                <span className="tool-name">{tool.toolName}</span>
                {tool.summary && <span className="tool-summary">{tool.summary}</span>}
              </div>
            ))}
            {(stream.text || (!stream.failure && !stream.cancelled)) && (
              <div className="msg-row bot streaming">
                <div className="hover-wrap">
                  <div className="msg-bubble">
                    {stream.text || "…"}
                    {!stream.failure && !stream.cancelled && (
                      <button
                        type="button"
                        className="stream-cancel"
                        title="取消"
                        onClick={() => streamRef.current?.cancel()}
                      >
                        取消
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
            {stream.failure && (
              <div className="chat-failure" role="alert">
                <span className="failure-code">{stream.failure.code}</span>
                {failureMessage(stream.failure.code)}
                {stream.failure.message ? (
                  <span className="failure-detail">{stream.failure.message}</span>
                ) : null}
                {stream.failure.code === "UNAUTHORIZED_PATH" &&
                /grant required: ([a-z.]+)/.test(stream.failure.message ?? "") ? (
                  <span className="grant-card">
                    {(["once", "session", "persistent"] as const).map((scope) => (
                      <button
                        key={scope}
                        type="button"
                        className="pill-btn"
                        onClick={() => {
                          const capability = /grant required: ([a-z.]+)/.exec(
                            stream.failure?.message ?? "",
                          )?.[1];
                          if (!capability) {
                            return;
                          }
                          void window.deepseekBot.host
                            .call("grant.create", {
                              capability,
                              scope,
                              botId: me.bot.id,
                              ...(scope === "persistent" ? { maxUses: 0 } : {}),
                            })
                            .then(() => {
                              retryStream();
                            });
                        }}
                      >
                        {scope === "once" ? "仅本次" : scope === "session" ? "本会话" : "永久允许"}
                      </button>
                    ))}
                  </span>
                ) : null}
                {stream.failure.retryable && (
                  <button type="button" className="pill-btn" onClick={retryStream}>
                    重试
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {pendingFiles.length > 0 && (
        <div className="attach-chips" aria-label="待发送附件">
          {pendingFiles.map((file, index) => (
            <span className="attach-chip" key={`${file.name}-${index}`}>
              <span className="attach-chip-name">{file.name}</span>
              <span className="attach-chip-size">{formatAttachmentSize(file.size)}</span>
              <button
                type="button"
                className="attach-chip-remove"
                aria-label={`移除附件 ${file.name}`}
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
            引用 {quoteDraft.name}：{quoteDraft.text}
          </span>
          <button type="button" className="quote-cancel" aria-label="取消引用" onClick={onCancelQuote}>
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
        aria-label="选择附件"
        onChange={(event) => {
          void readPickedFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <div className="composer">
        <div className="composer-menu-wrap">
          <button
            type="button"
            className="composer-plus"
            aria-label="更多操作"
            title="发起交流"
            onClick={() => setPlusOpen((v) => !v)}
          >
            ＋
          </button>
          {plusOpen && (
            <>
              <div className="menu-overlay" onClick={() => setPlusOpen(false)} />
              <div className="composer-menu" role="menu" aria-label="更多">
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
                  添加附件
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
                    发起交流
                    <span className="menu-arrow">›</span>
                  </button>
                  <div className="submenu" role="menu" aria-label="选择 Bot">
                    {others.length === 0 && (
                      <div className="composer-menu-empty">还没有其他 Bot。</div>
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
                          {groups.find((g) => g.key === b.group)?.name ?? "?"}
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
          placeholder={`给 ${me.bot.name} 发消息`}
          value={draft}
          maxLength={200}
          aria-label={`给 ${me.bot.name} 发消息`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              send();
            }
          }}
        />
        <span className="composer-mic" title="后续提供" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M5 11a7 7 0 0 0 14 0M12 18v3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <button type="button" className="send-btn" aria-label="发送" disabled={!draft.trim() && pendingFiles.length === 0} onClick={send}>
          ↑
        </button>
      </div>

    </div>
  );
}




