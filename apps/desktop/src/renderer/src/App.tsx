import { useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { useBots, type UiBot } from "./features/bots/use-bots.js";
import { BotForm } from "./features/bots/bot-form.js";
import type { BotDraft } from "./services/desktop-service.js";

const SHAPES: { radius: string }[] = [
  { radius: "50%" },
  { radius: "46% 54% 52% 48% / 56% 44% 56% 44%" },
  { radius: "30%" },
  { radius: "58% 42% 38% 62% / 44% 58% 42% 56%" },
  { radius: "40% 60% 60% 40% / 50% 40% 60% 50%" },
  { radius: "62% 38% 56% 44% / 48% 62% 38% 52%" },
  { radius: "50% 50% 42% 58% / 60% 44% 56% 40%" },
  { radius: "44% 56% 48% 52% / 52% 48% 60% 40%" },
];

const PALETTE = [
  "#f4f4f5",
  "#a16207",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#6b7280",
];

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
  /** System notices (e.g. blocked cross-group requests) render as a centered muted line. */
  system?: boolean;
};

type ChatState = Record<number, Msg[]>;

function formatTime(t: number): string {
  const d = new Date(t);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

type MenuState = { x: number; y: number; botKey: number };
type DialogState = { type: "newGroup"; moveBot: number | null };

function BlobMark(): JSX.Element {
  return (
    <svg className="blob-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2.5c5.1 0 9.5 3.4 9.5 8.2 0 4.9-4.4 8.3-9.5 8.3-1 0-2-.1-2.9-.4l-3.6 1.6c-.5.2-1-.3-.8-.8l1-3C4.2 15 2.5 13 2.5 10.7c0-4.8 4.4-8.2 9.5-8.2Z"
        fill="currentColor"
      />
      <circle cx="9.2" cy="10.2" r="1.5" fill="#0f0f10" />
      <circle cx="14.8" cy="10.2" r="1.5" fill="#0f0f10" />
    </svg>
  );
}

function BlobFace({
  shape,
  color,
  size,
}: {
  shape: number;
  color: string;
  size: number;
}): JSX.Element {
  const s = SHAPES[shape] ?? SHAPES[0]!;
  return (
    <span
      className="blob-face"
      style={{ background: color, borderRadius: s.radius, width: size, height: size }}
      aria-hidden="true"
    >
      <span className="eye" />
      <span className="eye" />
    </span>
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
  const [modalGroup, setModalGroup] = useState<number>(UNGROUPED);

  const [groups, setGroups] = useState<Group[]>([{ key: UNGROUPED, name: "未分组" }]);
  const {
    bots,
    create: createBotEntity,
    update: updateBotEntity,
    archive: archiveBotEntity,
    duplicate: duplicateBotEntity,
    setUi,
    moveToTop,
    hide,
  } = useBots(UNGROUPED);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [menuDialog, setMenuDialog] = useState<DialogState | null>(null);
  const [dialogText, setDialogText] = useState("");

  const [selectedBot, setSelectedBot] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [chats, setChats] = useState<ChatState>({});
  const [quoteDraft, setQuoteDraft] = useState<{ name: string; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragOverGroup, setDragOverGroup] = useState<number | null>(null);
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
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [accountName, setAccountName] = useState("本地用户");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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

  const selectedBotName =
    bots.find((b) => b.key === selectedBot)?.bot.name ?? "DeepSeek Bot";

  const openCreateBotModal = () => {
    setShape(0);
    setColor(2);
    setModalGroup(
      groups.find((g) => g.name === "未分组")?.key ?? groups[0]?.key ?? UNGROUPED,
    );
    setEditingBot(null);
    setModalOpen(true);
  };

  const openEditBotModal = (bot: UiBot) => {
    setEditingBot(bot);
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
      setUi(result.key, { shape, color, group: modalGroup });
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
          text: `hello，我是 ${bot.bot.name}，有什么可以为你服务的吗`,
          quote: null,
          reactions: {},
          mine: [],
          time: Date.now(),
          speakerKey: bot.key,
        },
      ],
      };
    });
  };

  const sendUserMessage = (botKey: number, text: string): void => {
    const t = text.trim();
    if (!t) {
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
          },
        ],
      };
    });
    setQuoteDraft(null);
    const reply = `(占位) 已收到：「${t.slice(0, 24)}」。真实模型会话将在后续里程碑接入。`;
    setTimeout(() => {
      setChats((prev) => {
        const list = prev[botKey] ?? [];
        return {
          ...prev,
          [botKey]: [
            ...list,
            {
              id: Date.now() + 1,
              from: "bot",
              text: reply,
              quote: null,
              reactions: {},
              mine: [],
              time: Date.now(),
              speakerKey: botKey,
            },
          ],
        };
      });
    }, 450);
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
    // Bot-to-bot dialogue: both sides keep the same transcript, rendered as a real conversation.
    const turns: { speaker: number; text: string }[] = [
      { speaker: fromKey, text: `${to.bot.name}，在吗？我是 ${from.bot.name}。` },
      { speaker: toKey, text: `在的 ${from.bot.name}，什么事？` },
      {
        speaker: fromKey,
        text: "先占个位——等真实模型接入后，我们就能这样面对面聊天了。",
      },
      { speaker: toKey, text: "好啊，到时候聊个痛快。" },
    ];
    const transcript = turns.map((t, i) => ({
      id: now + 1 + i,
      from: "bot" as const,
      text: t.text,
      quote: null,
      reactions: {},
      mine: [] as Emoji[],
      time: now + i,
      speakerKey: t.speaker,
    }));
    setChats((prev) => ({
      ...prev,
      [fromKey]: [...(prev[fromKey] ?? []), ...transcript],
      [toKey]: [...(prev[toKey] ?? []), ...transcript.map((m) => ({ ...m }))],
    }));
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

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="side-top">
          <span className="circle-btn" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
              <line x1="15.5" y1="15.5" x2="20" y2="20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
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
            <BlobMark />
            <span className="presence-dot" />
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
                      const face = document.createElement("span");
                      face.className = "blob-face";
                      face.style.background = PALETTE[b.color]!;
                      face.style.borderRadius = (SHAPES[b.shape] ?? SHAPES[0]!).radius;
                      face.style.width = "52px";
                      face.style.height = "52px";
                      const e1 = document.createElement("span");
                      e1.className = "eye";
                      const e2 = document.createElement("span");
                      e2.className = "eye";
                      face.append(e1, e2);
                      ghost.append(face);
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
                    <BlobFace shape={b.shape} color={PALETTE[b.color]!} size={36} />
                    <span className="tab-label">
                      <span className="tab-title">
                        {b.bot.name}
                        {b.bot.archivedAt !== null && (
                          <span className="archived-tag">已归档</span>
                        )}
                        {b.unread && <span className="unread-dot" aria-label="未读" />}
                      </span>
                      <span className="tab-hint">会话内占位 · 未持久化</span>
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
        <div className="sidebar-foot clickable" title={version}>
          <button
            type="button"
            className="foot-btn"
            aria-label="打开设置"
            title="打开设置"
            onClick={() => setSettingsOpen(true)}
          >
            <span className="avatar" aria-hidden="true">
              {accountName.slice(0, 1).toUpperCase()}
            </span>
            <span className="foot-text">{version}</span>
          </button>
        </div>
      </aside>
      <section className="content">
        <header className="top">
          <span className="page-chip">
            <BlobMark />
            {selectedBotName}
          </span>
        </header>
        <main className="panel">
          {selectedBot !== null ? (
            <BotsPlaceholder
              key={selectedBot}
              bots={bots}
              groups={groups}
              selectedBot={selectedBot}
              msgs={chats[selectedBot] ?? []}
              quoteDraft={quoteDraft}
              onQuote={(m) => {
                const sender =
                  m.from === "bot"
                    ? bots.find((b) => b.key === (m.speakerKey ?? selectedBot))?.bot.name ?? "Bot"
                    : "我";
                setQuoteDraft({ name: sender, text: m.text.slice(0, 60) });
              }}
              onCancelQuote={() => setQuoteDraft(null)}
              onSend={(t) => sendUserMessage(selectedBot, t)}
              onReact={(msgId, emoji) => toggleReaction(selectedBot, msgId, emoji)}
              onTalkTo={(otherKey) => talkTo(selectedBot, otherKey)}
              onCopy={(t) => void copyText(t)}
              onAttach={() => setToast("添加附件（后续提供）")}
            />
          ) : (
            <div className="empty-state">
              <BlobMark />
              <p>创建一个 Bot 开始使用</p>
              <button type="button" className="primary-btn" onClick={openCreateBotModal}>
                创建 Bot
              </button>
            </div>
          )}
        </main>
      </section>

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
              className={"menu-item" + (menuBot.bot.archivedAt === null ? "" : " disabled-hint")}
              disabled={menuBot.bot.archivedAt !== null}
              onClick={() => {
                void (async () => {
                  const result = await archiveBotEntity(menuBot.bot.id);
                  setToast(result.ok ? "已归档：不能发起新聊天，历史会话保留" : "归档失败");
                })();
                setMenu(null);
              }}
            >
              <MenuIcon d="M3 8h18M6 8V5h12v3M7 8l1 13h8l1-13" />
              {menuBot.bot.archivedAt === null ? "归档 Bot" : "已归档"}
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
            <button type="button" role="menuitem" className="menu-item danger" onClick={() => removeBot(menuBot.key, "已删除")}>
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
              {!editingBot && (
                <>
                  <div className="preview">
                    <BlobFace shape={shape} color={PALETTE[color]!} size={100} />
                  </div>
                  <div className="shape-grid" role="radiogroup" aria-label="形状">
                    {SHAPES.map((sh, i) => (
                      <button
                        key={i}
                        type="button"
                        role="radio"
                        aria-checked={shape === i}
                        className={shape === i ? "shape-btn selected" : "shape-btn"}
                        onClick={() => setShape(i)}
                      >
                        <BlobFace shape={i} color={PALETTE[color]!} size={44} />
                      </button>
                    ))}
                  </div>
                  <div className="color-grid" role="radiogroup" aria-label="颜色">
                    {PALETTE.map((c, i) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={color === i}
                        className={color === i ? "color-btn selected" : "color-btn"}
                        style={{ background: c }}
                        onClick={() => setColor(i)}
                      />
                    ))}
                  </div>
                  <label className="group-pick">
                    分组
                    <select
                      value={modalGroup}
                      disabled={groups.length === 0}
                      onChange={(e) => setModalGroup(Number(e.target.value))}
                    >
                      {groups.map((g) => (
                        <option key={g.key} value={g.key}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <BotForm
                key={editingBot?.bot.id ?? "new"}
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
                onSubmit={submitBotDraft}
                onCancel={() => setModalOpen(false)}
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
                <div className="settings-section-title">外观</div>
                <div className="settings-card">
                  <div className="settings-row">
                    <span>主题</span>
                    <select
                      className="settings-select"
                      value={theme}
                      onChange={(e) => setTheme(e.target.value === "light" ? "light" : "dark")}
                      aria-label="主题"
                    >
                      <option value="dark">深色</option>
                      <option value="light">浅色</option>
                    </select>
                  </div>
                  <div className="settings-row">
                    <span>强调色</span>
                    <span className="settings-soon">后续提供</span>
                  </div>
                  <div className="settings-row">
                    <span>语言</span>
                    <span className="settings-soon">跟随系统</span>
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
    </div>
  );
}

function MessageBubble({
  msg,
  speaker,
  onReact,
  onQuote,
  onCopy,
}: {
  msg: Msg;
  speaker: UiBot | null;
  onReact: (msgId: number, emoji: Emoji) => void;
  onQuote: (msg: Msg) => void;
  onCopy: (text: string) => void;
}): JSX.Element {
  const isUser = msg.from === "user";
  const timeLabel = formatTime(msg.time);
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
        <BlobFace shape={speaker.shape} color={PALETTE[speaker.color]!} size={34} />
      )}
      <div className="hover-wrap">
        {!isUser && speaker ? (
          <div className="sender-line">
            <span className="sender-name" style={{ color: PALETTE[speaker.color]! }}>
              {speaker.bot.name}
            </span>
            <span className="msg-stamp">{timeLabel}</span>
          </div>
        ) : (
          <div className="msg-stamp user-stamp">{timeLabel}</div>
        )}
        <div className={"msg-bubble" + (isUser ? " user" : "")}>
          {msg.quote && (
            <div className="msg-quote">
              引用 {msg.quote.name}：{msg.quote.text}
            </div>
          )}
          {msg.text}
          {(EMOJIS.some((e) => (msg.reactions[e] ?? 0) > 0)) && (
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
        {pickerOpen &&
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
  quoteDraft,
  onQuote,
  onCancelQuote,
  onSend,
  onReact,
  onTalkTo,
  onCopy,
  onAttach,
}: {
  bots: UiBot[];
  groups: Group[];
  selectedBot: number;
  msgs: Msg[];
  quoteDraft: { name: string; text: string } | null;
  onQuote: (msg: Msg) => void;
  onCancelQuote: () => void;
  onSend: (text: string) => void;
  onReact: (msgId: number, emoji: Emoji) => void;
  onTalkTo: (otherKey: number) => void;
  onCopy: (text: string) => void;
  onAttach: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState("");
  const [plusOpen, setPlusOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const me = bots.find((b) => b.key === selectedBot);

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
  const others = bots.filter((b) => b.key !== me.key);
  const archived = me.bot.archivedAt !== null;

  const send = (): void => {
    if (!draft.trim()) {
      return;
    }
    onSend(draft);
    setDraft("");
  };

  return (
    <div className="chat-page">
      <p className="sys-line" aria-live="polite">
        静态占位 · 无网络请求 · 不同分组的 Bot 无法主动交流
      </p>
      <div className="chat" ref={listRef}>
        {msgs.map((m) => {
          const speaker =
            m.from === "bot"
              ? bots.find((b) => b.key === (m.speakerKey ?? me.key)) ?? me
              : null;
          return m.system ? (
            <div className="sys-line" key={m.id}>
              {m.text}
            </div>
          ) : (
            <MessageBubble
              key={m.id}
              msg={m}
              speaker={speaker}
              onReact={onReact}
              onQuote={onQuote}
              onCopy={onCopy}
            />
          );
        })}
        {msgs.length === 0 && <div className="sys-line">会话为空。</div>}
      </div>
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
      {archived && (
        <div className="archived-banner" role="status">
          该机器人已归档：不能发起新聊天；历史会话仍可查看。
        </div>
      )}
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
                    onAttach();
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
                        <BlobFace shape={b.shape} color={PALETTE[b.color]!} size={22} />
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
          className="composer-input"
          placeholder={archived ? "已归档：不能发起新聊天" : `给 ${me.bot.name} 发消息`}
          value={draft}
          maxLength={200}
          aria-label={archived ? "已归档，不能发起新聊天" : `给 ${me.bot.name} 发消息`}
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
        <button type="button" className="send-btn" aria-label="发送" disabled={archived || !draft.trim()} onClick={send}>
          ↑
        </button>
      </div>
    </div>
  );
}
