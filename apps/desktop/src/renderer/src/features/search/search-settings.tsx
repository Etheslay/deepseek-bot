/**
 * Saved SearXNG endpoint. Saving stores the address; it does not contact the service.
 */
import { useCallback, useEffect, useState, type JSX } from "react";
import { METHOD_CONTRACTS } from "@deepseek-bot/contracts";

export function SearchSettings(): JSX.Element {
  const [endpoint, setEndpoint] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const response = await window.deepseekBot.host.call("search.config.get", {});
    const parsed = METHOD_CONTRACTS["search.config.get"].response.parse(response);
    setSaved(parsed.endpoint);
    setEndpoint(parsed.endpoint ?? "");
    setNotice((current) => (current === "搜索配置读取失败" ? null : current));
  }, []);

  useEffect(() => {
    let active = true;
    void load().catch(() => {
      if (active) setNotice("搜索配置读取失败");
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
        setNotice(parsed.endpoint === null ? "已清除搜索地址" : "已保存搜索地址");
      })
      .catch(() => {
        setNotice("搜索地址保存失败");
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <>
      <div className="settings-section-title">网络搜索（SearXNG，只保存地址）</div>
      <div className="settings-card">
        <div className="settings-row">
          <span>SearXNG 地址</span>
          <span className="key-input-wrap">
            <input
              aria-label="SearXNG 地址"
              className="settings-select key-input"
              value={endpoint}
              placeholder={saved ?? "未配置"}
              onChange={(event) => setEndpoint(event.target.value)}
            />
            <button
              type="button"
              className="pill-btn"
              disabled={busy || endpoint.trim().length === 0}
              onClick={() => save(endpoint.trim())}
            >
              保存
            </button>
            <button type="button" className="pill-btn" disabled={busy || saved === null} onClick={() => save(null)}>
              清除
            </button>
          </span>
        </div>
        {notice !== null ? <div role="status">{notice}</div> : null}
      </div>
    </>
  );
}
