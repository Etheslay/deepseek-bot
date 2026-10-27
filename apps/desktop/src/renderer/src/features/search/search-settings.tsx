/**
 * Saved SearXNG endpoint. Saving stores the address; it does not contact the service.
 */
import { useCallback, useEffect, useState, type JSX } from "react";
import { METHOD_CONTRACTS } from "@deepseek-bot/contracts";
import { type Notice, noticeText, t, useLanguage } from "../../i18n.js";

export function SearchSettings(): JSX.Element {
  const [endpoint, setEndpoint] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  useLanguage();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const response = await window.deepseekBot.host.call("search.config.get", {});
    const parsed = METHOD_CONTRACTS["search.config.get"].response.parse(response);
    setSaved(parsed.endpoint);
    setEndpoint(parsed.endpoint ?? "");
    setNotice((current) => (current?.key === "search.configReadFailed" ? null : current));
  }, []);

  useEffect(() => {
    let active = true;
    void load().catch(() => {
      if (active) setNotice({ key: "search.configReadFailed" });
    });
    return () => {
      active = false;
    };
  }, [load]);

  const save = (value: string | null): void => {
    setBusy(true);
    void window.deepseekBot.host
      .call("search.config.set", { endpoint: value })
      .then((response) => {
        const parsed = METHOD_CONTRACTS["search.config.set"].response.parse(response);
        setSaved(parsed.endpoint);
        setEndpoint(parsed.endpoint ?? "");
        setNotice(parsed.endpoint === null ? { key: "search.endpointCleared" } : { key: "search.endpointSaved" });
      })
      .catch(() => {
        setNotice({ key: "search.endpointSaveFailed" });
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <>
      <div className="settings-section-title">{t("search.sectionTitle")}</div>
      <div className="settings-card">
        <div className="settings-row">
          <span>{t("search.endpointLabel")}</span>
          <span className="key-input-wrap">
            <input
              aria-label={t("search.endpointLabel")}
              className="settings-select key-input"
              value={endpoint}
              placeholder={saved ?? t("shell.notConfigured")}
              onChange={(event) => setEndpoint(event.target.value)}
            />
            <button
              type="button"
              className="pill-btn"
              disabled={busy || endpoint.trim().length === 0}
              onClick={() => save(endpoint.trim())}
            >
              {t("shell.save")}
            </button>
            <button type="button" className="pill-btn" disabled={busy || saved === null} onClick={() => save(null)}>
              {t("search.clear")}
            </button>
          </span>
        </div>
        {notice !== null ? <div role="status">{noticeText(notice)}</div> : null}
      </div>
    </>
  );
}
