/**
 * Local connector catalog. Register, list, enable and disable stay on this
 * machine. Nothing here opens a session or calls the connector; the
 * endpoint (D19) is the loopback address of the local service and is only
 * stored, never probed.
 */
import { useCallback, useEffect, useState, type JSX } from "react";
import { METHOD_CONTRACTS } from "@deepseek-bot/contracts";

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
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const response = await window.deepseekBot.host.call("connector.list", {});
    const parsed = METHOD_CONTRACTS["connector.list"].response.parse(response);
    setConnectors(parsed.connectors);
    setNotice((current) => (current === "连接器读取失败" ? null : current));
  }, []);

  useEffect(() => {
    let active = true;
    void load().catch(() => {
      if (active) setNotice("连接器读取失败");
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
      setNotice("已登记连接器");
      await load();
    } catch {
      setNotice("连接器注册失败");
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
      setNotice(value.trim().length === 0 ? "已清除连接器端点" : "已保存连接器端点");
      await load();
    } catch {
      setNotice("连接器端点保存失败");
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
      setNotice(enabled ? "已启用连接器" : "已停用连接器");
      await load();
    } catch {
      setNotice("连接器更新失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="settings-section-title">连接器（只登记，默认关闭）</div>
      <div className="settings-card">
        <div className="settings-row">
          <span>名称</span>
          <span className="key-input-wrap">
            <input
              aria-label="连接器名称"
              className="settings-select key-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <input
              aria-label="凭据引用"
              className="settings-select key-input"
              value={credentialRef}
              placeholder="cred: 引用，可留空"
              onChange={(event) => setCredentialRef(event.target.value)}
            />
            <input
              aria-label="连接器端点"
              className="settings-select key-input"
              value={endpoint}
              placeholder="http://127.0.0.1:7860，可留空"
              onChange={(event) => setEndpoint(event.target.value)}
            />
            <button
              type="button"
              className="pill-btn"
              disabled={busy || name.trim().length === 0}
              onClick={() => void register()}
            >
              注册
            </button>
          </span>
        </div>
        {notice !== null ? <div role="status">{notice}</div> : null}
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
      <span>{connector.enabled ? "已启用" : "已关闭"}</span>
      <span className="key-input-wrap">
        <input
          aria-label={`${connector.name} 端点`}
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
          存端点
        </button>
        <button type="button" className="pill-btn" disabled={busy} onClick={onToggle}>
          {connector.enabled ? "停用" : "启用"}
        </button>
      </span>
    </div>
  );
}
