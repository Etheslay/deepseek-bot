import { useEffect, useState, type JSX } from "react";

type PageId = "bots" | "workflows" | "runs" | "settings";

const PAGES: {
  id: PageId;
  label: string;
  hint: string;
  body: string;
}[] = [
  {
    id: "bots",
    label: "机器人",
    hint: "Bots · 列表与编辑占位",
    body: "机器人列表占位。真实机器人管理、会话与持久化将在后续里程碑接入。",
  },
  {
    id: "workflows",
    label: "工作流",
    hint: "Workflows · 编辑器占位",
    body: "工作流编辑占位。节点编辑器将在后续里程碑接入。",
  },
  {
    id: "runs",
    label: "运行",
    hint: "Runs · 历史与监控占位",
    body: "运行记录占位。实时监控与取消将在后续里程碑接入。",
  },
  {
    id: "settings",
    label: "设置",
    hint: "Settings · 偏好占位",
    body: "设置占位。本阶段不写入任何凭据，也不发起网络请求。",
  },
];

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
  const [page, setPage] = useState<PageId>("bots");
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
  const [chatTarget, setChatTarget] = useState<string>("");
  const [chatResult, setChatResult] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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

  const current = PAGES.find((p) => p.id === page) ?? PAGES[0]!;

  const openModal = () => {
    setBotName("");
    setShape(0);
    setColor(2);
    setModalGroup(UNGROUPED);
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
      setChatResult(null);
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

  const startTalk = (): void => {
    const from = bots.find((b) => b.key === selectedBot);
    const to = bots.find((b) => b.key === Number(chatTarget));
    if (!from || !to) {
      return;
    }
    if (from.group !== to.group) {
      const g1 = groups.find((g) => g.key === from.group)?.name ?? "?";
      const g2 = groups.find((g) => g.key === to.group)?.name ?? "?";
      setChatResult(`无法发起：不同分组的 Bot 无法主动交流（${g1} ↔ ${g2}）。`);
    } else {
      setChatResult(`同分组，允许交流（占位会话，无后端）。`);
    }
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
        <div className="group-label">导航</div>
        <nav className="tabs" aria-label="主导航">
          {PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={page === p.id}
              className={page === p.id ? "tab active" : "tab"}
              onClick={() => setPage(p.id)}
            >
              <span className={`blob blob-${p.id}`} aria-hidden="true">
                <span className="eye" />
                <span className="eye" />
              </span>
              <span className="tab-label">
                <span className="tab-title">{p.label}</span>
                <span className="tab-hint">{p.hint}</span>
              </span>
            </button>
          ))}
        </nav>
        {groups.map((g) => {
          const members = bots.filter((b) => b.group === g.key);
          return (
            <div key={g.key} className="group-section">
              <div className="group-label">
                {g.name}
                {members.length > 0 && <span className="group-count">{members.length}</span>}
              </div>
              <div className="tabs" aria-label={`机器人列表-${g.name}`}>
                {members.map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    className={selectedBot === b.key && page === "bots" ? "tab active" : "tab"}
                    onClick={() => {
                      setSelectedBot(b.key);
                      setChatResult(null);
                      setChatTarget("");
                      setPage("bots");
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
              </div>
            </div>
          );
        })}
        <div className="sidebar-foot" title={version}>
          <span className="avatar" aria-hidden="true">
            D
          </span>
          <span className="foot-text">{version}</span>
        </div>
      </aside>
      <section className="content">
        <header className="top">
          <span className="page-chip">
            <BlobMark />
            {current.label}
          </span>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => void window.deepseekBot.window.hide()}
          >
            隐藏到托盘
          </button>
        </header>
        <main className="panel" role="tabpanel" aria-label={current.label}>
          {page === "bots" && selectedBot !== null ? (
            <BotsPlaceholder
              bots={bots}
              groups={groups}
              selectedBot={selectedBot}
              chatTarget={chatTarget}
              chatResult={chatResult}
              onSelect={setChatTarget}
              onTalk={startTalk}
            />
          ) : (
            <>
              <p className="sys-line" aria-live="polite">
                静态占位 · 无网络请求 · 不读取本地数据
              </p>
              <div className="bubble">
                <h2>{current.label}</h2>
                <p>{current.body}</p>
              </div>
            </>
          )}
        </main>
      </section>

      {menu && menuBot && (
        <>
          <div className="menu-overlay" onClick={() => setMenu(null)} />
          <div className="menu" role="menu" aria-label={`Bot 操作：${menuBot.name}`} style={{ left: menu.x, top: menu.y }}>
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
                <select value={modalGroup} onChange={(e) => setModalGroup(Number(e.target.value))}>
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
              <button type="button" className="primary-btn" disabled={!botName.trim()} onClick={createBot}>
                创建
              </button>
            </footer>
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

function BotsPlaceholder({
  bots,
  groups,
  selectedBot,
  chatTarget,
  chatResult,
  onSelect,
  onTalk,
}: {
  bots: Bot[];
  groups: Group[];
  selectedBot: number;
  chatTarget: string;
  chatResult: string | null;
  onSelect: (v: string) => void;
  onTalk: () => void;
}): JSX.Element {
  const me = bots.find((b) => b.key === selectedBot);
  if (!me) {
    return (
      <div className="bubble">
        <h2>机器人</h2>
        <p>该 Bot 已不存在。</p>
      </div>
    );
  }
  const others = bots.filter((b) => b.key !== me.key);
  const myGroup = groups.find((g) => g.key === me.group)?.name ?? "?";
  return (
    <>
      <p className="sys-line" aria-live="polite">
        静态占位 · 无网络请求 · 不读取本地数据
      </p>
      <div className="msg-row">
        <BlobFace shape={me.shape} color={PALETTE[me.color]!} size={34} />
        <div className="msg-bubble">
          hello，我是 {me.name}，有什么可以为你服务的吗
        </div>
      </div>
      <div className="bubble">
        <h2>{me.name}</h2>
        <p>
          分组：{myGroup} · 会话内占位，未持久化。
          <br />
          规则：不同分组的 Bot 无法主动交流。
        </p>
      </div>
      {others.length > 0 ? (
        <div className="bubble">
          <h2>发起交流</h2>
          <p className="talk-row">
            <select
              className="talk-select"
              value={chatTarget}
              onChange={(e) => onSelect(e.target.value)}
              aria-label="选择目标 Bot"
            >
              <option value="">选择另一个 Bot…</option>
              {others.map((b) => (
                <option key={b.key} value={String(b.key)}>
                  {b.name}（{groups.find((g) => g.key === b.group)?.name ?? "?"}）
                </option>
              ))}
            </select>
            <button type="button" className="primary-btn" disabled={!chatTarget} onClick={onTalk}>
              发起交流
            </button>
          </p>
          {chatResult && <p className="talk-result">{chatResult}</p>}
        </div>
      ) : null}
    </>
  );
}
