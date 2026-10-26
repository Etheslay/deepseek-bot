/**
 * Canvas co-edit sidecar (D28).
 *
 * One workspace file, opened beside the chat: the user edits and saves
 * (Ctrl+S or button) through artifacts.save with optimistic concurrency
 * against concurrent bot writes; a slow poll surfaces bot writes — silent
 * reload while clean, a stale banner while the user has unsaved edits. The
 * version panel lists the append-only trail (user/bot), previews any text
 * version and reverts; a revert appends a new version, it never rewrites
 * history. HTML and binary media open as a blocked notice (QA-14).
 */
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { isTextEditableMediaType, type ArtifactVersion } from "@deepseek-bot/contracts";
import { ChatMarkdown } from "../chat/chat-markdown.js";
import type { DesktopService, ServiceError } from "../../services/desktop-service.js";

type ReadState =
  | { phase: "loading" }
  | { phase: "text"; mediaType: string; content: string; checksum: string }
  | { phase: "blocked"; mediaType: string; reason: string };

const POLL_MS = 5000;

export function CanvasSidecar(props: {
  service: DesktopService;
  botId: string;
  botName: string;
  relativePath: string;
  onClose: () => void;
}): JSX.Element {
  const { service, botId, relativePath, onClose } = props;
  const [readState, setReadState] = useState<ReadState>({ phase: "loading" });
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [versions, setVersions] = useState<ArtifactVersion[] | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionPreview, setVersionPreview] = useState<
    { version: ArtifactVersion; content: string } | null
  >(null);
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
  const [toast, setToast] = useState<string | null>(null);

  // Base checksum of the content the editor was loaded from; sent back on
  // save so a concurrent bot write fails loudly instead of being clobbered.
  const baseChecksumRef = useRef<string | null>(null);
  const draftRef = useRef("");
  draftRef.current = draft;
  const dirty = readState.phase === "text" ? draft !== readState.content : false;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  const refreshVersions = useCallback(async (): Promise<void> => {
    try {
      setVersions(await service.artifacts.versions(botId, relativePath));
    } catch {
      setVersions(null);
    }
  }, [service, botId, relativePath]);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    setStale(false);
    setVersionPreview(null);
    try {
      const result = await service.artifacts.read(botId, relativePath);
      if (result.kind === "text") {
        setReadState({
          phase: "text",
          mediaType: result.mediaType,
          content: result.content,
          checksum: result.checksum.value,
        });
        baseChecksumRef.current = result.checksum.value;
        setDraft(result.content);
        setViewMode("edit");
      } else {
        setReadState({ phase: "blocked", mediaType: result.mediaType, reason: result.reason });
        setDraft("");
      }
    } catch (e) {
      setReadState({
        phase: "blocked",
        mediaType: "application/octet-stream",
        reason: e instanceof Error ? e.message : String(e),
      });
      setDraft("");
    }
    void refreshVersions();
  }, [service, botId, relativePath, refreshVersions]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (): Promise<void> => {
    const state = readState;
    if (state.phase !== "text" || !isTextEditableMediaType(state.mediaType) || saving) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await service.artifacts.save(
        botId,
        relativePath,
        draftRef.current,
        baseChecksumRef.current ?? undefined,
      );
      baseChecksumRef.current = response.artifact.checksum.value;
      setReadState({
        phase: "text",
        mediaType: response.artifact.mediaType,
        content: draftRef.current,
        checksum: response.artifact.checksum.value,
      });
      setStale(false);
      setToast(`已保存 v${response.version.revision}`);
      void refreshVersions();
    } catch (e) {
      const serviceError = e as ServiceError;
      if (serviceError?.code === "REVISION_CONFLICT") {
        setError("文件在编辑期间被修改（可能来自 bot）。点击「重新加载」获取最新内容后再保存。");
        setStale(true);
      } else {
        setError(serviceError instanceof Error ? serviceError.message : String(serviceError));
      }
    } finally {
      setSaving(false);
    }
  }, [service, botId, relativePath, readState, saving, refreshVersions]);

  // Poll for bot writes: silent reload when clean, stale banner when dirty.
  useEffect(() => {
    const timer = setInterval(() => {
      void (async () => {
        try {
          const result = await service.artifacts.read(botId, relativePath);
          if (result.kind !== "text") {
            return;
          }
          if (result.checksum.value === baseChecksumRef.current) {
            setStale(false);
            return;
          }
          if (!dirtyRef.current) {
            baseChecksumRef.current = result.checksum.value;
            setReadState({
              phase: "text",
              mediaType: result.mediaType,
              content: result.content,
              checksum: result.checksum.value,
            });
            setDraft(result.content);
            void refreshVersions();
          } else {
            setStale(true);
          }
        } catch {
          // Transient read failures (file replaced mid-read) retry next tick.
        }
      })();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [service, botId, relativePath, refreshVersions]);

  useEffect(() => {
    if (toast === null) {
      return;
    }
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const maybeClose = useCallback((): void => {
    if (dirtyRef.current && !window.confirm("有未保存的修改，确定关闭画布？")) {
      return;
    }
    onClose();
  }, [onClose]);

  // Ctrl+S saves (save() self-guards); Esc leaves, confirming while dirty.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        maybeClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, maybeClose]);

  const discardDraft = (): void => {
    if (readState.phase === "text" && !window.confirm("放弃未保存的修改？")) {
      return;
    }
    if (readState.phase === "text") {
      setDraft(readState.content);
    }
  };

  const previewVersion = async (version: ArtifactVersion): Promise<void> => {
    setError(null);
    try {
      const result = await service.artifacts.versionContent(botId, relativePath, version.id);
      if (result.kind === "text") {
        setVersionPreview({ version, content: result.content });
      } else {
        setVersionPreview(null);
        setToast(result.reason);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const revert = async (version: ArtifactVersion): Promise<void> => {
    if (!window.confirm(`回退到 v${version.revision}？回退会以新版本形式保存，不会丢失历史。`)) {
      return;
    }
    setError(null);
    try {
      const response = await service.artifacts.revert(botId, relativePath, version.id);
      setToast(`已回退到 v${version.revision}（生成 v${response.version.revision}）`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const editable = readState.phase === "text" && isTextEditableMediaType(readState.mediaType);

  return (
    <aside className="canvas-sidecar" aria-label="产物画布">
      <header className="canvas-head">
        <div className="canvas-title-wrap">
          <span className="canvas-bot-chip">{props.botName}</span>
          <span className="canvas-path" title={relativePath}>
            {relativePath}
          </span>
        </div>
        <div className="canvas-head-actions">
          {readState.phase === "text" && readState.mediaType === "text/markdown" && (
            <button
              type="button"
              className="pill-btn"
              onClick={() => setViewMode((mode) => (mode === "edit" ? "preview" : "edit"))}
            >
              {viewMode === "edit" ? "预览" : "编辑"}
            </button>
          )}
          <button type="button" className="pill-btn" onClick={maybeClose}>
            关闭
          </button>
        </div>
      </header>

      {toast !== null && <div className="canvas-toast">{toast}</div>}
      {error !== null && (
        <p className="form-error canvas-error" role="alert">
          {error}
        </p>
      )}
      {stale && (
        <div className="canvas-stale" role="status">
          <span>工作区文件已被修改（可能来自 bot）。</span>
          <button
            type="button"
            className="pill-btn"
            onClick={() => {
              if (dirtyRef.current && !window.confirm("重新加载会丢弃未保存的修改，继续？")) {
                return;
              }
              void load();
            }}
          >
            重新加载
          </button>
        </div>
      )}

      {readState.phase === "loading" && <div className="sys-line">正在读取…</div>}
      {readState.phase === "blocked" && (
        <div className="canvas-blocked" role="alert">
          <p className="form-error">{readState.reason}</p>
          <div className="session-meta">mediaType {readState.mediaType} · 仍可查看版本历史。</div>
        </div>
      )}

      {readState.phase === "text" && (
        <>
          <div className="canvas-meta session-meta">
            {readState.mediaType}
            {dirty ? " · 未保存" : " · 已同步"}
          </div>
          {editable && viewMode === "edit" ? (
            <textarea
              className="canvas-editor"
              aria-label="产物内容编辑器"
              spellCheck={false}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          ) : editable && viewMode === "preview" ? (
            <div className="canvas-preview" aria-label="Markdown 预览">
              <ChatMarkdown text={draft} />
            </div>
          ) : (
            <pre className="artifact-preview">{readState.content}</pre>
          )}
          <div className="canvas-actions">
            <button
              type="button"
              className="primary-btn"
              disabled={!editable || !dirty || saving}
              onClick={() => void save()}
            >
              {saving ? "保存中…" : "保存（Ctrl+S）"}
            </button>
            {dirty && (
              <button type="button" className="pill-btn" onClick={discardDraft}>
                放弃修改
              </button>
            )}
          </div>
        </>
      )}

      <section className="canvas-versions">
        <button
          type="button"
          className="ghost-btn canvas-versions-toggle"
          aria-expanded={versionsOpen}
          onClick={() => setVersionsOpen((open) => !open)}
        >
          版本历史{versions !== null ? `（${versions.length}）` : ""}
        </button>
        {versionsOpen && (
          <div className="canvas-version-list" aria-label="版本历史列表">
            {(versions ?? []).map((version) => (
              <div className="canvas-version-item" key={version.id}>
                <div className="artifact-meta">
                  <div className="tab-title">
                    v{version.revision} · {version.author === "user" ? "用户" : "bot"}
                  </div>
                  <div className="session-meta">
                    {new Date(version.createdAt).toLocaleString()} · {version.size} bytes ·{" "}
                    {version.checksum.value.slice(0, 12)}…
                  </div>
                </div>
                <div className="canvas-version-actions">
                  <button
                    type="button"
                    className="pill-btn"
                    onClick={() => void previewVersion(version)}
                  >
                    预览
                  </button>
                  <button type="button" className="pill-btn" onClick={() => void revert(version)}>
                    回退
                  </button>
                </div>
              </div>
            ))}
            {(versions ?? []).length === 0 && <div className="sys-line">暂无版本。</div>}
            {versionPreview !== null && (
              <div className="canvas-version-preview">
                <div className="replay-title">
                  v{versionPreview.version.revision} 内容
                  <button
                    type="button"
                    className="pill-btn"
                    onClick={() => setVersionPreview(null)}
                  >
                    收起
                  </button>
                </div>
                <pre className="artifact-preview">{versionPreview.content}</pre>
              </div>
            )}
          </div>
        )}
      </section>
    </aside>
  );
}
