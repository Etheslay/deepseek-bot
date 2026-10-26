/**
 * Session history + artifacts (D05 brief §2.1 会话历史 / 产物面板; D28 共编).
 *
 * Lists sessions for a bot; opening one replays persisted events (via
 * chat-reducer replayTimeline) and lists the bot's workspace artifacts with
 * safe read (text only; HTML/binary blocked, QA-14).
 */
import { useState, type JSX } from "react";
import type { BotArtifact } from "@deepseek-bot/contracts";
import type { ChatSessionView } from "../../services/desktop-service.js";
import type { DesktopService } from "../../services/desktop-service.js";
import { replayTimeline } from "./chat-reducer.js";

export function SessionHistory(props: {
  service: DesktopService;
  botId: string;
}): JSX.Element {
  const [sessions, setSessions] = useState<ChatSessionView[] | null>(null);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [replay, setReplay] = useState<{ items: ReturnType<typeof replayTimeline> } | null>(
    null,
  );
  const [artifacts, setArtifacts] = useState<BotArtifact[] | null>(null);
  const [preview, setPreview] = useState<
    { artifactPath: string; kind: "text"; content: string } | { artifactPath: string; kind: "blocked"; reason: string } | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    setError(null);
    try {
      setSessions(await props.service.chat.listSessions(props.botId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const open = async (sessionId: string): Promise<void> => {
    setError(null);
    try {
      const { events } = await props.service.chat.openSession(sessionId);
      setReplay({ items: replayTimeline(events) });
      setOpenSessionId(sessionId);
      setArtifacts(await props.service.artifacts.list(props.botId));
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const previewArtifact = async (artifact: BotArtifact): Promise<void> => {
    setError(null);
    try {
      const result = await props.service.artifacts.read(props.botId, artifact.relativePath);
      if (result.kind === "text") {
        setPreview({ artifactPath: artifact.relativePath, kind: "text", content: result.content });
      } else {
        setPreview({ artifactPath: artifact.relativePath, kind: "blocked", reason: result.reason });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (sessions === null) {
    return (
      <button type="button" className="ghost-btn history-toggle" onClick={() => void load()}>
        历史会话
      </button>
    );
  }

  return (
    <div className="session-history">
      <button type="button" className="ghost-btn history-toggle" onClick={() => setOpenSessionId(null)}>
        收起历史
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="session-list" aria-label="历史会话列表">
        {sessions.map((s) => (
          <button
            key={s.sessionId}
            type="button"
            className={"session-item" + (openSessionId === s.sessionId ? " active" : "")}
            onClick={() => void open(s.sessionId)}
          >
            <span className="tab-title">{s.title}</span>
            <span className="session-meta">
              {s.status === "ended" ? "已结束" : "进行中"} · {s.replayEventCount} 个事件
            </span>
          </button>
        ))}
        {sessions.length === 0 && <div className="sys-line">暂无历史会话。</div>}
      </div>
      {openSessionId !== null && replay !== null && (
        <div className="replay-panel" aria-label="会话回放">
          <div className="replay-title">会话回放（持久事件）</div>
          {replay.items.map((item, i) =>
            item.kind === "time" ? (
              <div className="msg-time" key={`t-${i}`}>
                {item.text}
              </div>
            ) : (
              <div className="msg-notice" key={`e-${i}`}>
                {item.label} <span className="session-meta">{item.detail}</span>
              </div>
            ),
          )}
          {replay.items.length === 0 && <div className="sys-line">无持久事件。</div>}
          <div className="replay-title">产物</div>
          <div className="artifact-list" aria-label="产物列表">
            {(artifacts ?? []).map((a) => (
              <div className="artifact-item" key={a.relativePath}>
                <div className="artifact-meta">
                  <div className="tab-title">{a.relativePath}</div>
                  <div className="session-meta">
                    {a.mediaType} · {a.size} bytes · sha256 {a.checksum.value.slice(0, 12)}…
                  </div>
                </div>
                <button
                  type="button"
                  className="pill-btn"
                  onClick={() => void previewArtifact(a)}
                >
                  预览
                </button>
              </div>
            ))}
            {(artifacts ?? []).length === 0 && <div className="sys-line">无产物。</div>}
          </div>
          {preview !== null && (
            preview.kind === "text" ? (
              <pre className="artifact-preview" aria-label="产物预览">
                {preview.content}
              </pre>
            ) : (
              <p className="form-error" role="alert">
                {preview.reason}
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}
