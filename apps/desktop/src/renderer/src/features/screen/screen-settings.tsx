/**
 * Settings for one selected window (D21 desktop).
 *
 * The user picks a bot, turns `screen.capture` from deny to ask, refreshes
 * the window list, and runs one screenshot or OCR capture. Approval is only
 * for this time. The JPEG and OCR text stay in this panel; a response that
 * belongs to an earlier bot or target is dropped.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import {
  METHOD_CONTRACTS,
  PERMISSION_METHODS,
  type AppApproval,
  type ScreenResult,
  type ScreenStatus,
  type ScreenWindow,
} from "@deepseek-bot/contracts";
import { CustomSelect } from "../../components/custom-select.js";
import { noticeText, t, useLanguage, type Notice } from "../../i18n.js";
import { SettingsSwitch } from "../system/notifications-panel.js";
import { approvalChoices, approvalDecision } from "../permissions/permission-chat.js";
import { capabilityLabel } from "../permissions/capability-labels.js";
import { screenHostNotice, screenPreviewDataUrl } from "./screen-preview.js";

type Banner = { notice: Notice; error: boolean };
type ScreenPreview = {
  result: ScreenResult;
  imageBase64: string;
  text: string | null;
};

function windowOptions(
  windows: readonly ScreenWindow[],
  target: ScreenWindow | null,
): ScreenWindow[] {
  if (target === null || windows.some((item) => item.id === target.id)) return [...windows];
  return [target, ...windows];
}

function approvalWindowTitle(params: Record<string, unknown>): string | null {
  const title = params.windowTitle;
  if (typeof title !== "string" || title.length < 1 || title.length > 512) return null;
  return title;
}

export function ScreenSettings(): JSX.Element {
  useLanguage();
  const [bots, setBots] = useState<Array<{ id: string; name: string }> | null>(null);
  const [botId, setBotId] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void window.deepseekBot.host
      .call("bot.list", {})
      .then((response) => {
        if (!active) return;
        const available = METHOD_CONTRACTS["bot.list"].response
          .parse(response)
          .bots.filter((bot) => bot.archivedAt === null);
        setBots(available.map((bot) => ({ id: bot.id, name: bot.name })));
        setBotId((current) => current || available[0]?.id || "");
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <div className="settings-section-title">{t("permissions.screenAndWindowAwareness")}</div>
      <div className="settings-card" data-testid="screen-settings">
        {bots === null ? (
          <p className={failed ? "form-error" : "settings-soon"} role={failed ? "alert" : "status"}>
            {failed ? t("screen.loadFailed") : t("permissions.loading")}
          </p>
        ) : (
          <>
            <div className="settings-row">
              <span>{t("screen.botLabel")}</span>
              <CustomSelect
                value={botId}
                options={bots.map((bot) => ({ value: bot.id, label: bot.name }))}
                ariaLabel={t("screen.botLabel")}
                disabled={bots.length === 0}
                onChange={setBotId}
              />
            </div>
            {bots.length === 0 ? <p role="status">{t("screen.noBots")}</p> : null}
            {botId !== "" ? <ScreenBotPanel key={botId} botId={botId} /> : null}
          </>
        )}
      </div>
    </>
  );
}

function ScreenBotPanel(props: { botId: string }): JSX.Element {
  const { botId } = props;
  useLanguage();
  const alive = useRef(true);
  const ticket = useRef(0);
  const refreshSeq = useRef(0);
  const [status, setStatus] = useState<ScreenStatus | null>(null);
  const [windows, setWindows] = useState<ScreenWindow[]>([]);
  const [results, setResults] = useState<ScreenResult[]>([]);
  const [preview, setPreview] = useState<ScreenPreview | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<AppApproval[]>([]);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState(false);

  const loadCore = useCallback(
    async (token: number): Promise<void> => {
      try {
        const [statusResponse, resultsResponse] = await Promise.all([
          window.deepseekBot.host.call("screen.status", { botId }),
          window.deepseekBot.host.call("screen.results.list", { botId }),
        ]);
        if (!alive.current || ticket.current !== token) return;
        setStatus(METHOD_CONTRACTS["screen.status"].response.parse(statusResponse));
        setResults(METHOD_CONTRACTS["screen.results.list"].response.parse(resultsResponse).results);
        setBanner((current) => (current?.notice.key === "screen.loadFailed" ? null : current));
      } catch {
        if (!alive.current || ticket.current !== token) return;
        setBanner((current) => {
          if (current !== null && current.notice.key !== "screen.loadFailed") return current;
          return { notice: { key: "screen.loadFailed" }, error: true };
        });
      }
    },
    [botId],
  );

  useEffect(() => {
    alive.current = true;
    void loadCore(ticket.current);
    const timer = setInterval(() => {
      void loadCore(ticket.current);
    }, 4_000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [loadCore]);

  const waiting = capturing || status?.busy === true;

  useEffect(() => {
    if (!waiting) {
      setApprovals([]);
      return;
    }
    let cancelled = false;
    const load = (): void => {
      const token = ticket.current;
      void window.deepseekBot.host
        .call("permission.approval.list", { botId })
        .then((response) => {
          if (cancelled || !alive.current || ticket.current !== token) return;
          const parsed = PERMISSION_METHODS["permission.approval.list"].response.parse(response);
          setApprovals(
            parsed.approvals.filter(
              (approval) =>
                approval.status === "pending" &&
                approval.botId === botId &&
                approval.capabilities.includes("screen.capture"),
            ),
          );
          setBanner((current) =>
            current?.notice.key === "screen.approvalLoadFailed" ? null : current,
          );
        })
        .catch(() => {
          if (cancelled || !alive.current || ticket.current !== token) return;
          setBanner((current) =>
            current === null
              ? { notice: { key: "screen.approvalLoadFailed" }, error: true }
              : current,
          );
        });
    };
    load();
    const timer = setInterval(load, 1_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [waiting, botId]);

  const setEnabled = (next: boolean): void => {
    if (status === null || acting) return;
    const token = ++ticket.current;
    setCapturing(false);
    setPreview(null);
    setApprovals([]);
    setActing(true);
    void window.deepseekBot.host
      .call("permission.policy.set", {
        capability: "screen.capture",
        mode: next ? "ask" : "deny",
      })
      .then((response) => {
        PERMISSION_METHODS["permission.policy.set"].response.parse(response);
        if (!alive.current || ticket.current !== token) return;
        setBanner({
          notice: { key: next ? "screen.enabledNotice" : "screen.disabledNotice" },
          error: false,
        });
        return loadCore(token);
      })
      .catch((error: unknown) => {
        if (!alive.current || ticket.current !== token) return;
        setBanner({ notice: screenHostNotice(error), error: true });
      })
      .finally(() => {
        if (alive.current && ticket.current === token) setActing(false);
      });
  };

  const refreshWindows = (): void => {
    if (status === null || !status.supported || refreshing) return;
    const seq = ++refreshSeq.current;
    setRefreshing(true);
    void window.deepseekBot.host
      .call("screen.windows.list", {})
      .then((response) => {
        if (!alive.current || refreshSeq.current !== seq) return;
        setWindows(METHOD_CONTRACTS["screen.windows.list"].response.parse(response).windows);
        // No success banner: the refreshed list is the feedback (2026-11).
        setBanner(null);
      })
      .catch((error: unknown) => {
        if (!alive.current || refreshSeq.current !== seq) return;
        setBanner({ notice: screenHostNotice(error), error: true });
      })
      .finally(() => {
        if (alive.current && refreshSeq.current === seq) setRefreshing(false);
      });
  };

  const chooseWindow = (id: string | null): void => {
    if (status === null || !status.supported || acting) return;
    const token = ++ticket.current;
    setCapturing(false);
    setPreview(null);
    setApprovals([]);
    setPendingDeleteId(null);
    setActing(true);
    void window.deepseekBot.host
      .call("screen.target.set", { botId, id })
      .then((response) => {
        if (!alive.current || ticket.current !== token) return;
        setStatus(METHOD_CONTRACTS["screen.target.set"].response.parse(response));
        setBanner({
          notice: { key: id === null ? "screen.windowCleared" : "screen.windowSelected" },
          error: false,
        });
        return window.deepseekBot.host.call("screen.results.list", { botId });
      })
      .then((response) => {
        if (response === undefined || !alive.current || ticket.current !== token) return;
        setResults(METHOD_CONTRACTS["screen.results.list"].response.parse(response).results);
      })
      .catch((error: unknown) => {
        if (!alive.current || ticket.current !== token) return;
        setBanner({ notice: screenHostNotice(error), error: true });
      })
      .finally(() => {
        if (alive.current && ticket.current === token) setActing(false);
      });
  };

  const capture = (mode: "image" | "ocr"): void => {
    if (
      status === null ||
      !status.supported ||
      !status.enabled ||
      status.target === null ||
      capturing ||
      status.busy ||
      acting
    ) {
      return;
    }
    const token = ticket.current;
    setCapturing(true);
    setBanner(null);
    void window.deepseekBot.host
      .call("screen.request", { botId, mode })
      .then(async (response) => {
        if (!alive.current || ticket.current !== token) return;
        const result = METHOD_CONTRACTS["screen.request"].response.parse(response);
        const listed = METHOD_CONTRACTS["screen.results.list"].response.parse(
          await window.deepseekBot.host.call("screen.results.list", { botId }),
        );
        if (!alive.current || ticket.current !== token) return;
        setResults(listed.results);
        const read = METHOD_CONTRACTS["screen.result.read"].response.parse(
          await window.deepseekBot.host.call("screen.result.read", { botId, id: result.id }),
        );
        if (!alive.current || ticket.current !== token || read.result.id !== result.id) return;
        setPreview(read);
        setBanner({ notice: { key: "screen.captured" }, error: false });
      })
      .catch((error: unknown) => {
        if (!alive.current || ticket.current !== token) return;
        setBanner({ notice: screenHostNotice(error), error: true });
      })
      .finally(() => {
        if (alive.current && ticket.current === token) setCapturing(false);
      });
  };

  const cancel = (): void => {
    const token = ticket.current;
    void window.deepseekBot.host
      .call("screen.cancel", { botId })
      .then((response) => {
        if (!alive.current || ticket.current !== token) return;
        const parsed = METHOD_CONTRACTS["screen.cancel"].response.parse(response);
        setBanner({
          notice: { key: parsed.cancelled ? "screen.cancelled" : "screen.nothingToCancel" },
          error: false,
        });
      })
      .catch((error: unknown) => {
        if (!alive.current || ticket.current !== token) return;
        setBanner({ notice: screenHostNotice(error), error: true });
      });
  };

  const review = (id: string): void => {
    const token = ticket.current;
    setActing(true);
    void window.deepseekBot.host
      .call("screen.result.read", { botId, id })
      .then((response) => {
        if (!alive.current || ticket.current !== token) return;
        const parsed = METHOD_CONTRACTS["screen.result.read"].response.parse(response);
        if (parsed.result.id !== id) return;
        setPreview(parsed);
        setPendingDeleteId(null);
      })
      .catch((error: unknown) => {
        if (!alive.current || ticket.current !== token) return;
        setBanner({ notice: screenHostNotice(error), error: true });
      })
      .finally(() => {
        if (alive.current && ticket.current === token) setActing(false);
      });
  };

  const remove = (id: string): void => {
    const token = ticket.current;
    setActing(true);
    void window.deepseekBot.host
      .call("screen.result.delete", { botId, id })
      .then(async (response) => {
        if (!alive.current || ticket.current !== token) return;
        METHOD_CONTRACTS["screen.result.delete"].response.parse(response);
        setPreview((current) => (current?.result.id === id ? null : current));
        setPendingDeleteId(null);
        setBanner({ notice: { key: "screen.deleted" }, error: false });
        const listed = METHOD_CONTRACTS["screen.results.list"].response.parse(
          await window.deepseekBot.host.call("screen.results.list", { botId }),
        );
        if (!alive.current || ticket.current !== token) return;
        setResults(listed.results);
      })
      .catch((error: unknown) => {
        if (!alive.current || ticket.current !== token) return;
        setBanner({ notice: screenHostNotice(error), error: true });
      })
      .finally(() => {
        if (alive.current && ticket.current === token) setActing(false);
      });
  };

  const decide = (approval: AppApproval, choice: "once" | "deny"): void => {
    const token = ticket.current;
    void window.deepseekBot.host
      .call("permission.approval.decide", approvalDecision(approval, choice))
      .then((response) => {
        if (!alive.current || ticket.current !== token) return;
        PERMISSION_METHODS["permission.approval.decide"].response.parse(response);
        setApprovals((current) => current.filter((item) => item.id !== approval.id));
        setBanner({
          notice: { key: choice === "deny" ? "permissions.denied" : "screen.approvedOnce" },
          error: false,
        });
      })
      .catch(() => {
        if (!alive.current || ticket.current !== token) return;
        setBanner({ notice: { key: "permissions.decisionFailed" }, error: true });
      });
  };

  const canCapture =
    status !== null &&
    status.supported &&
    status.enabled &&
    status.target !== null &&
    !capturing &&
    !status.busy &&
    !acting;
  const previewSrc = preview === null ? null : screenPreviewDataUrl(preview.imageBase64);

  return (
    <>
      <SettingsSwitch
        checked={status?.enabled === true}
        onChange={setEnabled}
        label={t("permissions.screenAndWindowAwareness")}
      />
      {status !== null && !status.supported ? (
        <p className="settings-soon" role="status">
          {t("screen.unsupported")}
        </p>
      ) : null}
      <div className="settings-row">
        <span>{t("screen.windowLabel")}</span>
        <span className="key-input-wrap">
          <CustomSelect
            value={status?.target?.id ?? ""}
            options={[
              { value: "", label: t("screen.noWindow") },
              ...windowOptions(windows, status?.target ?? null).map((item) => ({
                value: item.id,
                label: item.title,
              })),
            ]}
            ariaLabel={t("screen.windowLabel")}
            disabled={status === null || !status.supported || capturing || acting}
            onChange={(next) => chooseWindow(next === "" ? null : next)}
          />
          <button
            type="button"
            className="pill-btn"
            disabled={status === null || !status.supported || refreshing}
            onClick={refreshWindows}
          >
            {refreshing ? t("screen.refreshing") : t("screen.refreshWindows")}
          </button>
        </span>
      </div>
      <div className="settings-row">
        <span>{t("screen.actionsLabel")}</span>
        <span className="screen-actions">
          <button
            type="button"
            className="pill-btn"
            disabled={!canCapture}
            onClick={() => capture("image")}
          >
            {t("screen.captureImage")}
          </button>
          <button
            type="button"
            className="pill-btn"
            disabled={!canCapture}
            onClick={() => capture("ocr")}
          >
            {t("screen.captureOcr")}
          </button>
          <button
            type="button"
            className="pill-btn"
            disabled={!(capturing || status?.busy === true)}
            onClick={cancel}
          >
            {t("shell.cancel")}
          </button>
        </span>
      </div>
      {approvals.map((approval) => {
        const title = approvalWindowTitle(approval.params);
        const mode =
          approval.params.mode === "ocr"
            ? "screen.modeOcr"
            : approval.params.mode === "image"
              ? "screen.modeImage"
              : null;
        const allowOnce = approvalChoices(approval).includes("once");
        return (
          <div
            key={approval.id}
            className="choice-card"
            role="group"
            data-testid="screen-approval"
            aria-label={t("permissions.approvalFor", [approval.tool])}
          >
            <div className="choice-question">{t("permissions.allowQuestion")}</div>
            <p className="choice-answered">
              {t("permissions.capabilitiesLine", [capabilityLabel("screen.capture")])}
            </p>
            {mode !== null ? <p className="choice-answered">{t(mode)}</p> : null}
            {title !== null ? <p className="choice-answered">{title}</p> : null}
            <p className="choice-answered">{t("permissions.onceGrant", [approval.expiresAt])}</p>
            <div className="choice-options">
              {allowOnce ? (
                <button
                  type="button"
                  className="choice-option"
                  onClick={() => decide(approval, "once")}
                >
                  {t("shell.scopeOnce")}
                </button>
              ) : null}
              <button
                type="button"
                className="choice-option"
                onClick={() => decide(approval, "deny")}
              >
                {t("permissions.deny")}
              </button>
            </div>
          </div>
        );
      })}
      <div className="settings-row">
        <span>{t("screen.resultsTitle")}</span>
        <span className="settings-soon">
          {results.length === 0 ? t("screen.noResults") : String(results.length)}
        </span>
      </div>
      <ul className="screen-results">
        {results.map((result) => (
          <li key={result.id} className="screen-result">
            <span>
              {t(result.mode === "ocr" ? "screen.modeOcr" : "screen.modeImage")}
              {" · "}
              {t("screen.resultSize", [result.width, result.height])}
            </span>
            {pendingDeleteId === result.id ? (
              <span className="screen-actions">
                <button
                  type="button"
                  className="pill-btn"
                  disabled={acting}
                  onClick={() => remove(result.id)}
                >
                  {t("screen.confirmDelete")}
                </button>
                <button
                  type="button"
                  className="pill-btn"
                  disabled={acting}
                  onClick={() => setPendingDeleteId(null)}
                >
                  {t("screen.keep")}
                </button>
              </span>
            ) : (
              <span className="screen-actions">
                <button
                  type="button"
                  className="pill-btn"
                  disabled={acting}
                  onClick={() => review(result.id)}
                >
                  {t("screen.review")}
                </button>
                <button
                  type="button"
                  className="pill-btn"
                  disabled={acting}
                  onClick={() => setPendingDeleteId(result.id)}
                >
                  {t("screen.delete")}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {preview !== null ? (
        <div className="screen-preview" aria-label={t("screen.previewLabel")}>
          {previewSrc !== null ? (
            <img src={previewSrc} alt={t("screen.previewLabel")} />
          ) : (
            <p className="form-error" role="alert">
              {t("screen.previewInvalid")}
            </p>
          )}
          {preview.text !== null ? (
            <>
              <div className="settings-section-title">{t("screen.ocrTextLabel")}</div>
              <pre className="screen-ocr-text">{preview.text}</pre>
            </>
          ) : preview.result.hasOcr ? (
            <p className="settings-soon">{t("screen.noOcrText")}</p>
          ) : null}
        </div>
      ) : null}
      {banner !== null ? (
        <p
          className={banner.error ? "form-error" : "settings-ok"}
          role={banner.error ? "alert" : "status"}
        >
          {noticeText(banner.notice)}
        </p>
      ) : null}
    </>
  );
}
