/**
 * Local connector catalog. Register, list, enable and disable stay on this
 * machine. Nothing here opens a session or calls the connector; the
 * endpoint (D19) is the loopback address of the local service and is only
 * stored, never probed.
 */
import { useCallback, useEffect, useState, type JSX } from "react";
import { METHOD_CONTRACTS } from "@deepseek-bot/contracts";
import { type Notice, noticeText, t, useLanguage } from "../../i18n.js";

type ConnectorRecord = {
  id: string;
  name: string;
  enabled: boolean;
  credentialRef: string | null;
  endpoint: string | null;
};

export function ConnectorSettings(): JSX.Element {
  const [connectors, setConnectors] = useState<ConnectorRecord[] | null>(null);
  const [name, setName] = useState("");
  const [credentialRef, setCredentialRef] = useState("");
  const [endpoint, setEndpoint] = useState("");
  useLanguage();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const response = await window.deepseekBot.host.call("connector.list", {});
    const parsed = METHOD_CONTRACTS["connector.list"].response.parse(response);
    setConnectors(parsed.connectors);
    setNotice((current) => (current?.key === "connectors.readFailed" ? null : current));
  }, []);

  useEffect(() => {
    let active = true;
    void load().catch(() => {
      if (active) setNotice({ key: "connectors.readFailed" });
    });
    return () => {
      active = false;
    };
  }, [load]);

  async function register(): Promise<void> {
    const trimmed = name.trim();
    if (trimmed.length === 0 || busy) return;
    const ref = credentialRef.trim();
    const url = endpoint.trim();
    setBusy(true);
    try {
      await window.deepseekBot.host.call("connector.register", {
        name: trimmed,
        ...(ref.length === 0 ? {} : { credentialRef: ref }),
        ...(url.length === 0 ? {} : { endpoint: url }),
      });
      setName("");
      setCredentialRef("");
      setEndpoint("");
      setNotice({ key: "connectors.registered" });
      await load();
    } catch {
      setNotice({ key: "connectors.registerFailed" });
    } finally {
      setBusy(false);
    }
  }

  async function saveEndpoint(id: string, value: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await window.deepseekBot.host.call("connector.setEndpoint", {
        id,
        endpoint: value.trim().length === 0 ? null : value.trim(),
      });
      setNotice(value.trim().length === 0 ? { key: "connectors.endpointCleared" } : { key: "connectors.endpointSaved" });
      await load();
    } catch {
      setNotice({ key: "connectors.endpointSaveFailed" });
    } finally {
      setBusy(false);
    }
  }

  async function setEnabled(id: string, enabled: boolean): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await window.deepseekBot.host.call(enabled ? "connector.enable" : "connector.disable", {
        id,
      });
      setNotice(enabled ? { key: "connectors.enabled" } : { key: "connectors.disabled" });
      await load();
    } catch {
      setNotice({ key: "connectors.updateFailed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="settings-section-title">{t("connectors.sectionTitle")}</div>
      <div className="settings-card">
        <div className="settings-row">
          <span>{t("runs.name")}</span>
          <span className="key-input-wrap">
            <input
              aria-label={t("connectors.name")}
              className="settings-select key-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <input
              aria-label={t("connectors.credentialRef")}
              className="settings-select key-input"
              value={credentialRef}
              placeholder={t("connectors.credentialRefPlaceholder")}
              onChange={(event) => setCredentialRef(event.target.value)}
            />
            <input
              aria-label={t("connectors.endpoint")}
              className="settings-select key-input"
              value={endpoint}
              placeholder={t("connectors.endpointPlaceholder")}
              onChange={(event) => setEndpoint(event.target.value)}
            />
            <button
              type="button"
              className="pill-btn"
              disabled={busy || name.trim().length === 0}
              onClick={() => void register()}
            >
              {t("connectors.register")}
            </button>
          </span>
        </div>
        {notice !== null ? <div role="status">{noticeText(notice)}</div> : null}
        {(connectors ?? []).map((connector) => (
          <ConnectorRow
            key={connector.id}
            connector={connector}
            busy={busy}
            onToggle={() => void setEnabled(connector.id, !connector.enabled)}
            onSaveEndpoint={(value) => void saveEndpoint(connector.id, value)}
          />
        ))}
      </div>
    </>
  );
}

function ConnectorRow({
  connector,
  busy,
  onToggle,
  onSaveEndpoint,
}: {
  connector: ConnectorRecord;
  busy: boolean;
  onToggle(): void;
  onSaveEndpoint(value: string): void;
}): JSX.Element {
  const [draft, setDraft] = useState(connector.endpoint ?? "");
  return (
    <div className="settings-row">
      <span>{connector.name}</span>
      <span>{connector.enabled ? t("automation.statusEnabled") : t("automation.statusDisabled")}</span>
      <span className="key-input-wrap">
        <input
          aria-label={t("connectors.endpointAria", [connector.name])}
          className="settings-select key-input"
          value={draft}
          placeholder="http://127.0.0.1:7860"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="button"
          className="pill-btn"
          disabled={busy}
          onClick={() => onSaveEndpoint(draft)}
        >
          {t("connectors.saveEndpoint")}
        </button>
        <button type="button" className="pill-btn" disabled={busy} onClick={onToggle}>
          {connector.enabled ? t("automation.disable") : t("automation.enable")}
        </button>
      </span>
    </div>
  );
}
