/**
 * Notes and knowledge for the open bot. Memory notes list/write/delete
 * through trusted memory methods; knowledge documents (D18 独立知识表)
 * list/import/search/delete through trusted knowledge methods; the
 * retention policy (保留策略) edits the shared memory.retention settings
 * key. All text is rendered as text, never HTML.
 *
 * Management lives behind the composer "+" menu as a modal — the chat flow
 * itself stays clean; the bot reads and writes memory through its tools.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { METHOD_CONTRACTS } from "@deepseek-bot/contracts";
import { type Notice, noticeText, t, useLanguage } from "../../i18n.js";

type MemoryNote = {
  id: string;
  botId: string;
  text: string;
  at: string;
};

type KnowledgeDoc = {
  id: string;
  botId: string;
  title: string;
  size: number;
  at: string;
};

type KnowledgeHit = {
  docId: string;
  title: string;
  score: number;
  snippet: string;
  at: string;
};

type RetentionPolicy = {
  retentionDays: number;
  memoryMaxPerBot: number;
  knowledgeMaxPerBot: number;
};

function importNotice(code: "format" | "size" | "empty" | "encoding" | "read"): Notice {
  if (code === "format") return { key: "memory.knowledgeFileFormat" };
  if (code === "size") return { key: "memory.fileTooLarge" };
  if (code === "empty") return { key: "memory.fileNoBody" };
  if (code === "encoding") return { key: "memory.fileNotUtf8" };
  return { key: "memory.fileUnreadable" };
}

export function MemoryPanel({ botId, onClose }: { botId: string; onClose: () => void }): JSX.Element {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal memory-modal"
        aria-label={t("memory.dialogTitle")}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h3>{t("memory.dialogTitle")}</h3>
          <button type="button" className="modal-close" aria-label={t("shell.close")} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="memory-body">
          <BotMemory key={botId} botId={botId} />
          <KnowledgeSection key={`k-${botId}`} botId={botId} />
          <RetentionControls />
        </div>
      </section>
    </div>
  );
}

function BotMemory({ botId }: { botId: string }): JSX.Element {
  const [memories, setMemories] = useState<MemoryNote[] | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  useLanguage();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const loadSequence = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const sequence = ++loadSequence.current;
    const trimmed = query.trim();
    const response = await window.deepseekBot.host.call(
      "memory.list",
      trimmed.length === 0 ? { botId } : { botId, query: trimmed },
    );
    const parsed = METHOD_CONTRACTS["memory.list"].response.parse(response);
    if (!active.current || sequence !== loadSequence.current) return;
    setMemories(parsed.memories);
    setNotice((current) => (current?.key === "memory.memoryLoadFailed" ? null : current));
  }, [botId, query]);

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    const run = (): void => {
      void load().catch(() => {
        if (!cancelled) setNotice({ key: "memory.memoryLoadFailed" });
      });
    };
    run();
    const timer = setInterval(run, 1_000);
    return () => {
      active.current = false;
      cancelled = true;
      clearInterval(timer);
    };
  }, [load]);

  async function save(): Promise<void> {
    const text = draft.trim();
    if (text.length === 0 || busy) return;
    setBusy(true);
    try {
      await window.deepseekBot.host.call("memory.write", { botId, text });
      if (!active.current) return;
      setDraft("");
      setNotice({ key: "memory.memorySaved" });
      await load();
    } catch {
      if (active.current) setNotice({ key: "memory.memorySaveFailed" });
    } finally {
      if (active.current) setBusy(false);
    }
  }

  async function remove(memoryId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await window.deepseekBot.host.call("memory.delete", { botId, memoryId });
      if (!active.current) return;
      setNotice({ key: "memory.memoryDeleted" });
      await load();
    } catch {
      if (active.current) setNotice({ key: "memory.memoryDeleteFailed" });
    } finally {
      if (active.current) setBusy(false);
    }
  }

  return (
    <div className="memory-section">
      <div className="memory-section-title">{t("memory.memorySectionAria")}</div>
      <div className="memory-row">
        <input
          className="memory-input"
          aria-label={t("memory.memoryContent")}
          placeholder={t("memory.notePlaceholder")}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="button" className="memory-btn" onClick={() => void save()}>
          {t("memory.saveMemory")}
        </button>
      </div>
      <div className="memory-row">
        <input
          className="memory-input"
          aria-label={t("permissions.memoryRead")}
          placeholder={t("permissions.memoryRead")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {notice !== null ? (
        <div className="memory-notice" role="status">
          {noticeText(notice)}
        </div>
      ) : null}
      {(memories ?? []).map((memory) => (
        <div className="memory-item" key={memory.id}>
          <span className="memory-item-text">{memory.text}</span>
          <button type="button" className="memory-btn" onClick={() => void remove(memory.id)}>
            {t("shell.delete")}
          </button>
        </div>
      ))}
    </div>
  );
}

function KnowledgeSection({ botId }: { botId: string }): JSX.Element {
  const [docs, setDocs] = useState<KnowledgeDoc[] | null>(null);
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null);
  const [query, setQuery] = useState("");
  useLanguage();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef(true);

  const load = useCallback(async (): Promise<void> => {
    const response = await window.deepseekBot.host.call("knowledge.list", { botId });
    const parsed = METHOD_CONTRACTS["knowledge.list"].response.parse(response);
    if (!active.current) return;
    setDocs(parsed.docs);
    setNotice((current) => (current?.key === "memory.knowledgeBaseLoadFailed" ? null : current));
  }, [botId]);

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    void load().catch(() => {
      if (!cancelled) setNotice({ key: "memory.knowledgeBaseLoadFailed" });
    });
    return () => {
      active.current = false;
      cancelled = true;
    };
  }, [load]);

  async function importFile(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const picked = await window.deepseekBot.knowledge.importFile();
      if (!active.current) return;
      if (!picked.ok) {
        if (picked.code !== "cancelled") setNotice(importNotice(picked.code));
        return;
      }
      await window.deepseekBot.host.call("knowledge.write", {
        botId,
        title: picked.title,
        text: picked.text,
      });
      if (!active.current) return;
      setNotice({ key: "memory.knowledgeImported" });
      await load();
    } catch {
      if (active.current) setNotice({ key: "memory.knowledgeImportFailed" });
    } finally {
      if (active.current) setBusy(false);
    }
  }

  async function search(): Promise<void> {
    const trimmed = query.trim();
    if (trimmed.length === 0 || busy) return;
    setBusy(true);
    try {
      const response = await window.deepseekBot.host.call("knowledge.search", {
        botId,
        query: trimmed,
      });
      const parsed = METHOD_CONTRACTS["knowledge.search"].response.parse(response);
      if (!active.current) return;
      setHits(parsed.hits);
    } catch {
      if (active.current) setNotice({ key: "memory.knowledgeSearchFailed" });
    } finally {
      if (active.current) setBusy(false);
    }
  }

  async function remove(docId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await window.deepseekBot.host.call("knowledge.delete", { botId, docId });
      if (!active.current) return;
      setNotice({ key: "memory.knowledgeDeleted" });
      setHits(null);
      await load();
    } catch {
      if (active.current) setNotice({ key: "memory.knowledgeDeleteFailed" });
    } finally {
      if (active.current) setBusy(false);
    }
  }

  return (
    <div className="memory-section">
      <div className="memory-section-title">{t("memory.knowledgeTitle")}</div>
      <div className="memory-row">
        <button type="button" className="memory-btn" onClick={() => void importFile()}>
          {t("main.importKnowledge")}
        </button>
        <input
          className="memory-input"
          aria-label={t("memory.searchKnowledgeField")}
          placeholder={t("memory.searchKnowledgeField")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" className="memory-btn" onClick={() => void search()}>
          {t("memory.searchKnowledgeButton")}
        </button>
      </div>
      {notice !== null ? (
        <div className="memory-notice" role="status">
          {noticeText(notice)}
        </div>
      ) : null}
      {(hits ?? []).map((hit) => (
        <div className="memory-item" key={`${hit.docId}:${hit.at}:${hit.snippet}`}>
          <span className="memory-item-text">
            {hit.title}
            <span className="memory-item-sub">{hit.snippet}</span>
          </span>
        </div>
      ))}
      {hits !== null && hits.length === 0 ? (
        <div className="memory-notice" role="status">
          {t("memory.noKnowledgeMatches")}
        </div>
      ) : null}
      {(docs ?? []).map((doc) => (
        <div className="memory-item" key={doc.id}>
          <span className="memory-item-text">
            {doc.title}
            <span className="memory-item-sub">{t("memory.charCount", [doc.size])}</span>
          </span>
          <button type="button" className="memory-btn" onClick={() => void remove(doc.id)}>
            {t("shell.delete")}
          </button>
        </div>
      ))}
    </div>
  );
}

const ZERO_POLICY: RetentionPolicy = {
  retentionDays: 0,
  memoryMaxPerBot: 0,
  knowledgeMaxPerBot: 0,
};

function RetentionControls(): JSX.Element {
  const [policy, setPolicy] = useState<RetentionPolicy>(ZERO_POLICY);
  useLanguage();
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let active = true;
    void window.deepseekBot.host
      .call("memory.retention.get", {})
      .then((response) => {
        const parsed = METHOD_CONTRACTS["memory.retention.get"].response.parse(response);
        if (active) setPolicy(parsed.policy);
      })
      .catch(() => {
        if (active) setNotice({ key: "memory.policyLoadFailed" });
      });
    return () => {
      active = false;
    };
  }, []);

  function update(field: keyof RetentionPolicy, raw: string): void {
    const value = Number.parseInt(raw, 10);
    setPolicy((current) => ({
      ...current,
      [field]: Number.isInteger(value) && value >= 0 ? value : 0,
    }));
  }

  async function save(): Promise<void> {
    try {
      const response = await window.deepseekBot.host.call("memory.retention.set", { policy });
      const parsed = METHOD_CONTRACTS["memory.retention.set"].response.parse(response);
      setPolicy(parsed.policy);
      setNotice({ key: "memory.policySaved" });
    } catch {
      setNotice({ key: "memory.policySaveFailed" });
    }
  }

  return (
    <div className="memory-section">
      <div className="memory-section-title">{t("memory.retentionPolicy")}</div>
      <div className="memory-row">
        <input
          className="memory-input"
          aria-label={t("memory.memoryRetentionDays")}
          value={policy.retentionDays}
          onChange={(event) => update("retentionDays", event.target.value)}
        />
        <input
          className="memory-input"
          aria-label={t("memory.perBotMemoryLimit")}
          value={policy.memoryMaxPerBot}
          onChange={(event) => update("memoryMaxPerBot", event.target.value)}
        />
        <input
          className="memory-input"
          aria-label={t("memory.perBotKnowledgeLimit")}
          value={policy.knowledgeMaxPerBot}
          onChange={(event) => update("knowledgeMaxPerBot", event.target.value)}
        />
        <button type="button" className="memory-btn" onClick={() => void save()}>
          {t("memory.savePolicy")}
        </button>
      </div>
      {notice !== null ? (
        <div className="memory-notice" role="status">
          {noticeText(notice)}
        </div>
      ) : null}
    </div>
  );
}
