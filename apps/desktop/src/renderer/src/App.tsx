import { Fragment, useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";

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
type Bot = {
  key: number;
  name: string;
  shape: number;
  color: number;
  group: number;
  unread: boolean;
};

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
  notice: boolean;
};

type ChatState = Record<number, Msg[]>;

const FIVE_MINUTES = 5 * 60 * 1000;

function formatTime(t: number): string {
  const d = new Date(t);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type MenuState = { x: number; y: number; botKey: number };
type DialogState =
  | { type: "newGroup"; moveBot: number | null }
  | { type: "rename"; botKey: number };

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
  const [botName, setBotName] = useState("");
  const [shape, setShape] = useState(0);
  const [color, setColor] = useState(2);
  const [modalGroup, setModalGroup] = useState<number>(UNGROUPED);

  const [groups, setGroups] = useState<Group[]>([{ key: UNGROUPED, name: "未分组" }]);
  const [bots, setBots] = useState<Bot[]>([]);

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
    bots.find((b) => b.key === selectedBot)?.name ?? "DeepSeek Bot";

  const openModal = () => {
    setBotName("");
    setShape(0);
    setColor(2);
    setModalGroup(
      groups.find((g) => g.name === "未分组")?.key ?? groups[0]?.key ?? UNGROUPED,
    );
    setModalOpen(true);
  };

  const createBot = () => {
    const name = botName.trim();
    if (!name) {
      return;
    }
    setBots((prev) => [
      ...prev,
      { key: Date.now(), name, shape, color, group: modalGroup, unread: false },
    ]);
    setModalOpen(false);
  };

  const withBot = (botKey: number, fn: (b: Bot) => Bot): void => {
    setBots((prev) => prev.map((b) => (b.key === botKey ? fn(b) : b)));
  };

  const pinBot = (botKey: number): void => {
    setBots((prev) => {
      const target = prev.find((b) => b.key === botKey);
      if (!target) {
        return prev;
      }
      return [target, ...prev.filter((b) => b.key !== botKey)];
    });
    setToast("已置顶");
    setMenu(null);
  };

  const moveToGroup = (botKey: number, groupKey: number): void => {
    const g = groups.find((x) => x.key === groupKey);
    withBot(botKey, (b) => ({ ...b, group: groupKey }));
    setToast(g ? `已移至「${g.name}」` : "已移动");
    setMenu(null);
  };

  const toggleUnread = (botKey: number): void => {
    withBot(botKey, (b) => ({ ...b, unread: !b.unread }));
    setMenu(null);
  };

  const renameBot = (botKey: number, name: string): void => {
    const n = name.trim();
    if (n) {
      withBot(botKey, (b) => ({ ...b, name: n }));
    }
    setMenuDialog(null);
  };

  const copyBotId = async (botKey: number): Promise<void> => {
    const id = `bot-${botKey}`;
    try {
      await navigator.clipboard.writeText(id);
      setToast(`已复制 ${id}`);
    } catch {
      setToast("复制失败（占位环境限制）");
    }
    setMenu(null);
  };

  const removeBot = (botKey: number, why: string): void => {
    setBots((prev) => prev.filter((b) => b.key !== botKey));
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
    if (menuDialog.type === "newGroup") {
      if (!name) {
        return;
      }
      const key = Date.now();
      setGroups((prev) => [...prev, { key, name }]);
      if (menuDialog.moveBot !== null) {
        withBot(menuDialog.moveBot, (b) => ({ ...b, group: key }));
        setToast(`已创建分组「${name}」并移入`);
      } else {
        setToast(`已创建分组「${name}」`);
      }
    } else if (name) {
      renameBot(menuDialog.botKey, name);
      setToast("已重命名");
      return;
    }
    setMenuDialog(null);
  };

  const ensureChat = (bot: Bot): void => {
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
            text: `hello，我是 ${bot.name}，有什么可以为你服务的吗`,
            quote: null,
            reactions: {},
            mine: [],
            time: Date.now(),
            notice: false,
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
            notice: false,
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
              notice: true,
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
    withBot(botKey, (x) => ({ ...x, group: groupKey }));
    setToast(`已将「${b.name}」拖至「${g.name}」`);
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
    let text: string;
    if (from.group !== to.group) {
      const g1 = groups.find((g) => g.key === from.group)?.name ?? "?";
      const g2 = groups.find((g) => g.key === to.group)?.name ?? "?";
      text = `无法发起：不同分组的 Bot 无法主动交流（${g1} ↔ ${g2}）。`;
    } else {
      text = `已与「${to.name}」建立会话（占位，无后端）。`;
    }
    setChats((prev) => {
      const list = prev[fromKey] ?? [];
      return {
        ...prev,
        [fromKey]: [
          ...list,
          {
            id: Date.now() + 2,
            from: "bot",
            text,
            quote: null,
            reactions: {},
            mine: [],
            time: Date.now(),
            notice: true,
          },
        ],
      };
    });
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
            onClick={openModal}
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
                        {b.name}
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
                    ? bots.find((b) => b.key === selectedBot)?.name ?? "Bot"
                    : "我";
                setQuoteDraft({ name: sender, text: m.text.slice(0, 60) });
              }}
              onCancelQuote={() => setQuoteDraft(null)}
              onSend={(t) => sendUserMessage(selectedBot, t)}
              onReact={(msgId, emoji) => toggleReaction(selectedBot, msgId, emoji)}
              onTalkTo={(otherKey) => talkTo(selectedBot, otherKey)}
            />
          ) : (
            <div className="empty-state">
              <BlobMark />
              <p>创建一个 Bot 开始使用</p>
              <button type="button" className="primary-btn" onClick={openModal}>
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
            aria-label={`Bot 操作：${menuBot.name}`}
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
                setDialogText(menuBot.name);
                setMenuDialog({ type: "rename", botKey: menuBot.key });
                setMenu(null);
              }}
            >
              <MenuIcon d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
              重命名 Bot
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
            aria-label={menuDialog.type === "newGroup" ? "创建分组" : "重命名 Bot"}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-head">
              <h3>{menuDialog.type === "newGroup" ? "创建分组" : "重命名 Bot"}</h3>
              <button type="button" className="modal-close" aria-label="关闭" onClick={() => setMenuDialog(null)}>
                ×
              </button>
            </header>
            <div className="modal-body">
              <input
                className="name-input"
                placeholder={menuDialog.type === "newGroup" ? "分组名称" : "Bot 名称"}
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
            aria-label="创建新 Bot"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-head">
              <h3>创建新 Bot</h3>
              <button type="button" className="modal-close" aria-label="关闭" onClick={() => setModalOpen(false)}>
                ×
              </button>
            </header>
            <div className="modal-body">
              <div className="preview">
                <BlobFace shape={shape} color={PALETTE[color]!} size={140} />
              </div>
              <input
                className="name-input"
                placeholder="给你的 Bot 起个名字"
                value={botName}
                maxLength={40}
                autoFocus
                onChange={(e) => setBotName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    createBot();
                  }
                }}
              />
              <div className="shape-grid" role="radiogroup" aria-label="形状">
                {SHAPES.map((s, i) => (
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
            </div>
            <footer className="modal-foot">
              <button type="button" className="ghost-btn" onClick={() => setModalOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={!botName.trim() || groups.length === 0}
                onClick={createBot}
              >
                创建
              </button>
            </footer>
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
  shape,
  color,
  onReact,
  onQuote,
}: {
  msg: Msg;
  shape: number;
  color: string;
  onReact: (msgId: number, emoji: Emoji) => void;
  onQuote: (msg: Msg) => void;
}): JSX.Element {
  const isUser = msg.from === "user";
  return (
    <div className={"msg-row" + (isUser ? " user" : "")}>
      {!isUser && <BlobFace shape={shape} color={color} size={34} />}
      <div className="hover-wrap">
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
        <div className="hover-actions" role="toolbar" aria-label="消息操作">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              className="react-btn"
              data-emoji={e}
              title={`回应 ${e}`}
              onClick={() => onReact(msg.id, e)}
            >
              {e}
            </button>
          ))}
          <button
            type="button"
            className="react-btn"
            data-action="quote"
            title="引用"
            onClick={() => onQuote(msg)}
          >
            ↩
          </button>
        </div>
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
}: {
  bots: Bot[];
  groups: Group[];
  selectedBot: number;
  msgs: Msg[];
  quoteDraft: { name: string; text: string } | null;
  onQuote: (msg: Msg) => void;
  onCancelQuote: () => void;
  onSend: (text: string) => void;
  onReact: (msgId: number, emoji: Emoji) => void;
  onTalkTo: (otherKey: number) => void;
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

  let lastShownTime = 0;

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
          const showTime = lastShownTime === 0 || m.time - lastShownTime >= FIVE_MINUTES;
          if (showTime) {
            lastShownTime = m.time;
          }
          return (
            <Fragment key={m.id}>
              {showTime && <div className="msg-time">{formatTime(m.time)}</div>}
              {m.from === "bot" && m.notice && (
                <div className="msg-notice">
                  消息来自
                  <BlobFace shape={me.shape} color={PALETTE[me.color]!} size={14} />
                  {me.name}
                </div>
              )}
              <MessageBubble
                msg={m}
                shape={me.shape}
                color={PALETTE[me.color]!}
                onReact={onReact}
                onQuote={onQuote}
              />
              {m.from === "user" && (
                <div className="msg-notice">
                  已发消息给
                  <BlobFace shape={me.shape} color={PALETTE[me.color]!} size={14} />
                  {me.name}
                </div>
              )}
            </Fragment>
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
              <div className="composer-menu" role="menu" aria-label="发起交流">
                <div className="composer-menu-title">发起交流</div>
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
                    <BlobFace shape={b.shape} color={PALETTE[b.color]!} size={26} />
                    <span className="tab-title">{b.name}</span>
                    <span className="composer-menu-hint">
                      {groups.find((g) => g.key === b.group)?.name ?? "?"}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <input
          className="composer-input"
          placeholder={`给 ${me.name} 发消息`}
          value={draft}
          maxLength={200}
          aria-label={`给 ${me.name} 发消息`}
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
        <button type="button" className="send-btn" aria-label="发送" disabled={!draft.trim()} onClick={send}>
          ↑
        </button>
      </div>
    </div>
  );
}
