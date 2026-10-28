/**
 * Local connector catalog. Register, list, enable and disable stay on this
 * machine. MCP discovery contacts a service only after an explicit click.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { METHOD_CONTRACTS } from "@deepseek-bot/contracts";
import { type Notice, noticeText, t, useLanguage } from "../../i18n.js";
import { CustomSelect } from "../../components/custom-select.js";

type ConnectorKind = "sd-webui" | "mcp-http" | "mcp-stdio";

type ConnectorRecord = {
  id: string;
  name: string;
  enabled: boolean;
  credentialRef: string | null;
  endpoint: string | null;
  command?: string | null | undefined;
  args?: readonly string[] | null | undefined;
  credentialEnv?: string | null | undefined;
  kind?: ConnectorKind | undefined;
};

function isMcp(kind: ConnectorRecord["kind"]): boolean {
  return kind === "mcp-http" || kind === "mcp-stdio";
}

function mcpReady(connector: ConnectorRecord): boolean {
  return connector.kind === "mcp-stdio" ? Boolean(connector.command) : Boolean(connector.endpoint);
}

export function ConnectorSettings(): JSX.Element {
  const [connectors, setConnectors] = useState<ConnectorRecord[] | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ConnectorKind>("sd-webui");
  const [credentialRef, setCredentialRef] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [credentialEnv, setCredentialEnv] = useState("");
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

  function selectKind(next: ConnectorKind): void {
    setKind(next);
    setCredentialRef("");
    setEndpoint("");
    setCommand("");
    setArgsText("");
    setCredentialEnv("");
  }

  async function register(): Promise<void> {
    const trimmed = name.trim();
    if (trimmed.length === 0 || busy) return;
    const ref = credentialRef.trim();
    const url = endpoint.trim();
    const executable = command.trim();
    const envName = credentialEnv.trim();
    let args: string[] | undefined;
    if (kind === "mcp-stdio" && argsText.trim().length > 0) {
      try {
        const parsed = JSON.parse(argsText) as unknown;
        if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw new Error();
        args = parsed;
      } catch {
        setNotice({ key: "connectors.registerFailed" });
        return;
      }
    }
    setBusy(true);
    try {
      await window.deepseekBot.host.call("connector.register", {
        name: trimmed,
        ...(kind === "sd-webui" ? {} : { kind }),
        ...(ref.length === 0 ? {} : { credentialRef: ref }),
        ...(kind === "mcp-stdio"
          ? {
              command: executable,
              ...(args ? { args } : {}),
              ...(envName.length === 0 ? {} : { credentialEnv: envName }),
            }
          : url.length === 0
            ? {}
            : { endpoint: url }),
      });
      setName("");
      setCredentialRef("");
      setEndpoint("");
      setCommand("");
      setArgsText("");
      setCredentialEnv("");
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

  async function saveCommand(id: string, executable: string, argsValue: string): Promise<void> {
    if (busy) return;
    let args: string[] = [];
    if (argsValue.trim().length > 0) {
      try {
        const parsed = JSON.parse(argsValue) as unknown;
        if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw new Error();
        args = parsed;
      } catch {
        setNotice({ key: "connectors.commandSaveFailed" });
        return;
      }
    }
    setBusy(true);
    try {
      await window.deepseekBot.host.call("connector.setCommand", {
        id,
        command: executable.trim(),
        args,
      });
      setNotice({ key: "connectors.commandSaved" });
      await load();
    } catch {
      setNotice({ key: "connectors.commandSaveFailed" });
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
        <div className="settings-row connector-register">
          <span className="connector-register-label">{t("connectors.registerLabel")}</span>
          <span className="connector-fields">
            <CustomSelect
              ariaLabel={t("connectors.kindLabel")}
              value={kind}
              options={[
                { value: "sd-webui", label: "Stable Diffusion WebUI" },
                { value: "mcp-http", label: "MCP HTTP" },
                { value: "mcp-stdio", label: "MCP stdio" },
              ]}
              onChange={(next) => selectKind(next as ConnectorKind)}
            />
            <input
              aria-label={t("connectors.name")}
              className="settings-select key-input"
              placeholder={t("connectors.namePlaceholder")}
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
            {kind === "mcp-stdio" ? (
              <>
                <input
                  aria-label={t("connectors.command")}
                  className="settings-select key-input"
                  value={command}
                  placeholder={t("connectors.commandPlaceholder")}
                  onChange={(event) => setCommand(event.target.value)}
                />
                <input
                  aria-label={t("connectors.args")}
                  className="settings-select key-input"
                  value={argsText}
                  placeholder={t("connectors.argsPlaceholder")}
                  onChange={(event) => setArgsText(event.target.value)}
                />
                <input
                  aria-label={t("connectors.credentialEnv")}
                  className="settings-select key-input"
                  value={credentialEnv}
                  placeholder={t("connectors.credentialEnvPlaceholder")}
                  onChange={(event) => setCredentialEnv(event.target.value)}
                />
              </>
            ) : (
              <input
                aria-label={t("connectors.endpoint")}
                className="settings-select key-input"
                value={endpoint}
                placeholder={
                  kind === "mcp-http"
                    ? t("connectors.endpointPlaceholderMcp")
                    : t("connectors.endpointPlaceholder")
                }
                onChange={(event) => setEndpoint(event.target.value)}
              />
            )}
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
            onSaveCommand={(executable, argsValue) => void saveCommand(connector.id, executable, argsValue)}
          />
        ))}
        {(connectors ?? []).some((connector) => isMcp(connector.kind)) ? (
          <McpSettings
            connectors={(connectors ?? []).filter((connector) => isMcp(connector.kind))}
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
  onSaveCommand,
}: {
  connector: ConnectorRecord;
  busy: boolean;
  onToggle(): void;
  onSaveEndpoint(value: string): void;
  onSaveCommand(command: string, args: string): void;
}): JSX.Element {
  const [draft, setDraft] = useState(connector.endpoint ?? "");
  const [commandDraft, setCommandDraft] = useState(connector.command ?? "");
  const [argsDraft, setArgsDraft] = useState(
    connector.args && connector.args.length > 0 ? JSON.stringify(connector.args) : "",
  );
  const stdio = connector.kind === "mcp-stdio";
  return (
    <div className="settings-row">
      <span>{connector.name}</span>
      <span>{connector.enabled ? t("automation.statusEnabled") : t("automation.statusDisabled")}</span>
      <span className="connector-fields">
        {stdio ? (
          <>
            <input
              aria-label={t("connectors.commandAria", [connector.name])}
              className="settings-select key-input"
              value={commandDraft}
              placeholder={t("connectors.commandPlaceholder")}
              onChange={(event) => setCommandDraft(event.target.value)}
            />
            <input
              aria-label={t("connectors.argsAria", [connector.name])}
              className="settings-select key-input"
              value={argsDraft}
              placeholder={t("connectors.argsPlaceholder")}
              onChange={(event) => setArgsDraft(event.target.value)}
            />
            <button
              type="button"
              className="pill-btn"
              disabled={busy || commandDraft.trim().length === 0}
              onClick={() => onSaveCommand(commandDraft, argsDraft)}
            >
              {t("connectors.saveCommand")}
            </button>
          </>
        ) : (
          <>
        <input
          aria-label={t("connectors.endpointAria", [connector.name])}
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
          {t("connectors.saveEndpoint")}
        </button>
          </>
        )}
        <button type="button" className="pill-btn" disabled={busy} onClick={onToggle}>
          {connector.enabled ? t("automation.disable") : t("automation.enable")}
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
    <section aria-label={t("connectors.mcpToolGrants")}>
      <p>{t("connectors.mcpGrantHint")}</p>
      <label>
        {t("shell.bot")}{" "}
        <CustomSelect
          ariaLabel={t("connectors.mcpBots")}
          value={botId}
          options={(bots ?? []).map((bot) => ({ value: bot.id, label: bot.name }))}
          onChange={(next) => setBotId(next)}
        />
      </label>
      <label>
        {t("connectors.servicePicker")}
        <CustomSelect
          ariaLabel={t("connectors.mcpServices")}
          value={connector?.id ?? ""}
          options={connectors.map((item) => ({ value: item.id, label: item.name }))}
          onChange={(next) => setServerId(next)}
        />
      </label>
      {error ? <p role="alert">{t("connectors.botListFailedForGrants")}</p> : null}
      {bots?.length === 0 ? <p role="status">{t("connectors.noBotsToGrant")}</p> : null}
      {connector && botId ? (
        <McpTools
          key={`${botId}:${connector.id}:${connector.enabled}:${connector.endpoint ?? ""}:${connector.command ?? ""}`}
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
  useLanguage();
  const [notice, setNotice] = useState<Notice | null>(null);
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
        if (alive.current) setNotice({ key: "connectors.allowlistLoadFailed" });
      });
    return () => {
      alive.current = false;
    };
  }, [botId, connector.id]);

  async function discover(): Promise<void> {
    if (!connector.enabled || !mcpReady(connector) || discovering) return;
    setDiscovering(true);
    setNotice(null);
    try {
      const response = await window.deepseekBot.host.call("connector.mcp.discover", {
        id: connector.id,
      });
      const parsed = METHOD_CONTRACTS["connector.mcp.discover"].response.parse(response);
      if (!alive.current) return;
      setTools(parsed.tools);
      if (parsed.tools.length === 0) setNotice({ key: "connectors.noToolsReturned" });
    } catch {
      if (alive.current) setNotice({ key: "connectors.discoverFailed" });
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
      setNotice(
        names.length === 0 ? { key: "connectors.allowlistCleared" } : { key: "connectors.allowlistSaved" },
      );
    } catch {
      if (alive.current) setNotice({ key: "connectors.allowlistSaveFailed" });
    } finally {
      if (alive.current) setSaving(false);
    }
  }

  const unavailable = allowed.filter((name) => !tools?.some((tool) => tool.name === name));
  const choices = [
    ...(tools ?? []),
    ...unavailable.map((name) => ({ name, description: t("connectors.toolNotDiscovered") })),
  ];
  return (
    <div className="settings-card">
      {!connector.enabled ? <p role="status">{t("connectors.serviceDisabled")}</p> : null}
      {connector.enabled && !mcpReady(connector) ? (
        <p role="status">
          {connector.kind === "mcp-stdio"
            ? t("connectors.serviceNoCommand")
            : t("connectors.serviceNoEndpoint")}
        </p>
      ) : null}
      <button
        className="pill-btn"
        type="button"
        disabled={!connector.enabled || !mcpReady(connector) || discovering}
        onClick={() => void discover()}
      >
        {discovering ? t("connectors.discoveringTools") : t("connectors.discoverTools")}
      </button>
      {loading ? <p role="status">{t("connectors.loadingAllowlist")}</p> : null}
      <fieldset disabled={loading || saving}>
        <legend>{t("connectors.allowlistLegend")}</legend>
        {choices.map((tool) => (
          <label className="settings-row" key={tool.name}>
            <input
              type="checkbox"
              aria-label={t("connectors.allowToolAria", [tool.name])}
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
        {t("connectors.saveAllowlist")}
      </button>
      <button
        className="pill-btn"
        type="button"
        disabled={loading || saving}
        onClick={() => void save([])}
      >
        {t("connectors.clearAllowlist")}
      </button>
      {notice !== null ? <p role="status">{noticeText(notice)}</p> : null}
    </div>
  );
}
