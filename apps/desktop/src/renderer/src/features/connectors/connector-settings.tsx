/**
 * Local connector catalog. Register, list, enable and disable stay on this
 * machine. MCP discovery contacts a service only after an explicit click.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { METHOD_CONTRACTS } from "@deepseek-bot/contracts";

type ConnectorRecord = {
  id: string;
  name: string;
  enabled: boolean;
  credentialRef: string | null;
  endpoint: string | null;
  kind?: "sd-webui" | "mcp-http" | undefined;
};

export function ConnectorSettings(): JSX.Element {
  const [connectors, setConnectors] = useState<ConnectorRecord[] | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"sd-webui" | "mcp-http">("sd-webui");
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
        ...(kind === "mcp-http" ? { kind } : {}),
        ...(kind === "mcp-http" || ref.length === 0 ? {} : { credentialRef: ref }),
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
            <select
              aria-label="连接器类型"
              className="settings-select"
              value={kind}
              onChange={(event) => setKind(event.target.value as typeof kind)}
            >
              <option value="sd-webui">Stable Diffusion WebUI</option>
              <option value="mcp-http">MCP HTTP</option>
            </select>
            <input
              aria-label="连接器名称"
              className="settings-select key-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {kind === "sd-webui" ? (
              <input
                aria-label="凭据引用"
                className="settings-select key-input"
                value={credentialRef}
                placeholder="cred: 引用，可留空"
                onChange={(event) => setCredentialRef(event.target.value)}
              />
            ) : null}
            <input
              aria-label="连接器端点"
              className="settings-select key-input"
              value={endpoint}
              placeholder={
                kind === "mcp-http"
                  ? "http://127.0.0.1:8080/mcp，可留空"
                  : "http://127.0.0.1:7860，可留空"
              }
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
        {(connectors ?? []).some((connector) => connector.kind === "mcp-http") ? (
          <McpSettings
            connectors={(connectors ?? []).filter((connector) => connector.kind === "mcp-http")}
          />
        ) : null}
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
          placeholder={
            connector.kind === "mcp-http" ? "http://127.0.0.1:8080/mcp" : "http://127.0.0.1:7860"
          }
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

function McpSettings({ connectors }: { connectors: ConnectorRecord[] }): JSX.Element {
  const [bots, setBots] = useState<Array<{ id: string; name: string }> | null>(null);
  const [botId, setBotId] = useState("");
  const [serverId, setServerId] = useState(connectors[0]?.id ?? "");
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void window.deepseekBot.host
      .call("bot.list", {})
      .then((response) => {
        const parsed = METHOD_CONTRACTS["bot.list"].response.parse(response);
        if (!active) return;
        const available = parsed.bots.filter((bot) => bot.archivedAt === null);
        setBots(available);
        setBotId(available[0]?.id ?? "");
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const connector = connectors.find((item) => item.id === serverId) ?? connectors[0];
  return (
    <section aria-label="MCP 工具授权">
      <p>启用服务不会授予工具权限；每次 MCP 调用都需要单次审批。</p>
      <label>
        机器人{" "}
        <select
          className="settings-select"
          aria-label="MCP 机器人"
          value={botId}
          onChange={(event) => setBotId(event.target.value)}
        >
          {(bots ?? []).map((bot) => (
            <option key={bot.id} value={bot.id}>
              {bot.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        服务{" "}
        <select
          className="settings-select"
          aria-label="MCP 服务"
          value={connector?.id ?? ""}
          onChange={(event) => setServerId(event.target.value)}
        >
          {connectors.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {error ? <p role="alert">机器人读取失败，无法编辑工具授权</p> : null}
      {bots?.length === 0 ? <p role="status">没有可授权的机器人</p> : null}
      {connector && botId ? (
        <McpTools
          key={`${botId}:${connector.id}:${connector.enabled}:${connector.endpoint}`}
          botId={botId}
          connector={connector}
        />
      ) : null}
    </section>
  );
}

function McpTools({
  botId,
  connector,
}: {
  botId: string;
  connector: ConnectorRecord;
}): JSX.Element {
  const alive = useRef(true);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [tools, setTools] = useState<Array<{
    name: string;
    description?: string | undefined;
  }> | null>(null);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    alive.current = true;
    void window.deepseekBot.host
      .call("connector.mcp.grants.get", { botId })
      .then((response) => {
        const parsed = METHOD_CONTRACTS["connector.mcp.grants.get"].response.parse(response);
        if (!alive.current) return;
        setAllowed(
          parsed.servers.find((server) => server.serverId === connector.id)?.allowedTools ?? [],
        );
        setLoading(false);
      })
      .catch(() => {
        if (alive.current) setNotice("工具白名单读取失败，请重新选择机器人重试");
      });
    return () => {
      alive.current = false;
    };
  }, [botId, connector.id]);

  async function discover(): Promise<void> {
    if (!connector.enabled || !connector.endpoint || discovering) return;
    setDiscovering(true);
    setNotice("");
    try {
      const response = await window.deepseekBot.host.call("connector.mcp.discover", {
        id: connector.id,
      });
      const parsed = METHOD_CONTRACTS["connector.mcp.discover"].response.parse(response);
      if (!alive.current) return;
      setTools(parsed.tools);
      if (parsed.tools.length === 0) setNotice("服务未返回可用工具");
    } catch {
      if (alive.current) setNotice("工具发现失败，请检查服务是否连接并重试");
    } finally {
      if (alive.current) setDiscovering(false);
    }
  }

  async function save(names: string[]): Promise<void> {
    if (loading || saving) return;
    setSaving(true);
    try {
      const response = await window.deepseekBot.host.call("connector.mcp.grants.set", {
        botId,
        id: connector.id,
        allowedTools: names,
      });
      const parsed = METHOD_CONTRACTS["connector.mcp.grants.set"].response.parse(response);
      if (!alive.current) return;
      setAllowed(
        parsed.servers.find((server) => server.serverId === connector.id)?.allowedTools ?? [],
      );
      setNotice(names.length === 0 ? "已清空工具白名单" : "已保存工具白名单");
    } catch {
      if (alive.current) setNotice("工具白名单保存失败");
    } finally {
      if (alive.current) setSaving(false);
    }
  }

  const unavailable = allowed.filter((name) => !tools?.some((tool) => tool.name === name));
  const choices = [
    ...(tools ?? []),
    ...unavailable.map((name) => ({ name, description: "未在本次发现中提供，取消勾选可移除" })),
  ];
  return (
    <div className="settings-card">
      {!connector.enabled ? <p role="status">服务已停用，请先启用以发现工具</p> : null}
      {!connector.endpoint ? <p role="status">服务未配置端点</p> : null}
      <button
        className="pill-btn"
        type="button"
        disabled={!connector.enabled || !connector.endpoint || discovering}
        onClick={() => void discover()}
      >
        {discovering ? "正在发现工具…" : "发现工具"}
      </button>
      {loading ? <p role="status">正在读取工具白名单</p> : null}
      <fieldset disabled={loading || saving}>
        <legend>仅允许勾选的工具（默认不授权）</legend>
        {choices.map((tool) => (
          <label className="settings-row" key={tool.name}>
            <input
              type="checkbox"
              aria-label={`允许工具 ${tool.name}`}
              checked={allowed.includes(tool.name)}
              onChange={(event) =>
                setAllowed((current) =>
                  event.target.checked
                    ? [...current, tool.name]
                    : current.filter((name) => name !== tool.name),
                )
              }
            />
            <span>{tool.name}</span>
            {tool.description ? <span>{tool.description}</span> : null}
          </label>
        ))}
      </fieldset>
      <button
        className="pill-btn"
        type="button"
        disabled={loading || saving}
        onClick={() => void save(allowed)}
      >
        保存工具白名单
      </button>
      <button
        className="pill-btn"
        type="button"
        disabled={loading || saving}
        onClick={() => void save([])}
      >
        清空工具白名单
      </button>
      {notice ? <p role="status">{notice}</p> : null}
    </div>
  );
}
