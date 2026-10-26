/**
 * Notes for the open bot. The panel lists, writes and deletes through
 * trusted memory methods. Text is rendered as text, not HTML.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { METHOD_CONTRACTS } from "@deepseek-bot/contracts";

type MemoryNote = {
  id: string;
  botId: string;
  text: string;
  at: string;
};

export function MemoryPanel({ botId }: { botId: string }): JSX.Element {
  return <BotMemory key={botId} botId={botId} />;
}

function BotMemory({ botId }: { botId: string }): JSX.Element {
  const [memories, setMemories] = useState<MemoryNote[] | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
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
    setNotice((current) => (current === "记忆读取失败" ? null : current));
  }, [botId, query]);

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    const run = (): void => {
      void load().catch(() => {
        if (!cancelled) setNotice("记忆读取失败");
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
      setNotice("已保存记忆");
      await load();
    } catch {
      if (active.current) setNotice("记忆保存失败");
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
      setNotice("已删除记忆");
      await load();
    } catch {
      if (active.current) setNotice("记忆删除失败");
    } finally {
      if (active.current) setBusy(false);
    }
  }

  return (
    <section className="memory-panel" aria-label="记忆">
      <div>
        <input
          aria-label="记忆内容"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="button" onClick={() => void save()}>
          保存记忆
        </button>
      </div>
      <input
        aria-label="检索记忆"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {notice !== null ? <div role="status">{notice}</div> : null}
      {(memories ?? []).map((memory) => (
        <div key={memory.id}>
          <div>{memory.text}</div>
          <button type="button" onClick={() => void remove(memory.id)}>
            删除
          </button>
        </div>
      ))}
    </section>
  );
}
