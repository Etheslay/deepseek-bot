/**
 * Chrome bookmark import panel (D22, FR-19).
 *
 * Read-only by design: main lists Chrome profiles that have a Bookmarks file,
 * previews a few entries, and imports the chosen profile's bookmarks into the
 * app's own data directory. Cookies, passwords, payment data and browsing
 * history are never read — the boundary is written into SECURITY_DATA §4 and the
 * panel states it in the UI.
 *
 * Without the preload bridge (plain browser preview) every action degrades to a
 * disabled control plus an explanation, never a fake success.
 */
import { useCallback, useEffect, useState, type JSX } from "react";
import { t } from "../../i18n.js";
import { formatFullDateTime } from "../../i18n.js";
import type {
  ChromeClearResult,
  ChromeExportResult,
  ChromeImportResult,
  ChromePreviewResult,
  ChromeScanResult,
  ChromeStateResult,
} from "../../../../shared/system-integration.js";

type ChromeBridge = {
  scan: () => Promise<ChromeScanResult>;
  preview: (token: string) => Promise<ChromePreviewResult>;
  import: (token: string) => Promise<ChromeImportResult>;
  state: () => Promise<ChromeStateResult>;
  clear: () => Promise<ChromeClearResult>;
  export: () => Promise<ChromeExportResult>;
};

function bridge(): ChromeBridge | null {
  if (typeof window === "undefined") {
    return null;
  }
  const api = window.deepseekBot;
  if (!api || !("system" in api)) {
    return null;
  }
  return api.system.chrome as ChromeBridge;
}

export function ChromeImportPanel(props: { onToast: (message: string) => void }): JSX.Element {
  const api = bridge();
  const [scan, setScan] = useState<ChromeScanResult | null>(null);
  const [busy, setBusy] = useState<"scan" | "preview" | "import" | "export" | "clear" | null>(null);
  const [preview, setPreview] = useState<ChromePreviewResult | null>(null);
  const [state, setState] = useState<ChromeStateResult | null>(null);

  const refreshState = useCallback(async (): Promise<void> => {
    if (!api) {
      return;
    }
    setState(await api.state());
  }, [api]);

  useEffect(() => {
    void refreshState().catch(() => undefined);
  }, [refreshState]);

  if (api === null) {
    return (
      <div className="settings-row">
        <span>{t("d22.chromeSection")}</span>
        <span className="settings-soon">{t("d22.chromeNeedsShell")}</span>
      </div>
    );
  }

  const run = async (
    label: "scan" | "preview" | "import" | "export" | "clear",
    action: () => Promise<void>,
  ): Promise<void> => {
    setBusy(label);
    try {
      await action();
    } catch (error) {
      props.onToast(t("d22.chromeFailed", [error instanceof Error ? error.message : String(error)]));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="chrome-import" data-testid="chrome-import">
      <div className="settings-row">
        <span>{t("d22.chromeSource")}</span>
        <span className="settings-soon">
          {scan === null ? t("d22.chromeNotScanned") : scan.rootPath || t("d22.chromeNoneFound")}
        </span>
      </div>
      <div className="settings-row">
        <span>{t("d22.chromeScan")}</span>
        <button
          type="button"
          className="pill-btn"
          disabled={busy !== null}
          onClick={() =>
            void run("scan", async () => {
              const result = await api.scan();
              setScan(result);
              setPreview(null);
              if (result.profiles.length === 0) {
                props.onToast(t("d22.chromeNoneFound"));
              }
            })
          }
        >
          {busy === "scan" ? t("d22.chromeScanning") : t("d22.chromeScan")}
        </button>
      </div>
      {scan !== null && scan.profiles.length > 0 && (
        <ul className="chrome-profiles" aria-label={t("d22.chromeProfiles")}>
          {scan.profiles.map((profile) => (
            <li key={profile.token} className="chrome-profile">
              <span className="chrome-profile-name">{profile.name}</span>
              <span className="settings-soon">{t("d22.chromeBookmarks", [profile.bookmarkCount])}</span>
              <span className="chrome-profile-actions">
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={busy !== null}
                  onClick={() =>
                    void run("preview", async () => {
                      setPreview(await api.preview(profile.token));
                    })
                  }
                >
                  {t("d22.chromePreview")}
                </button>
                <button
                  type="button"
                  className="pill-btn"
                  disabled={busy !== null}
                  onClick={() =>
                    void run("import", async () => {
                      const result = await api.import(profile.token);
                      if (result.error !== null) {
                        props.onToast(t("d22.chromeFailed", [result.error]));
                      } else {
                        props.onToast(t("d22.chromeImported", [result.imported]));
                      }
                      await refreshState();
                    })
                  }
                >
                  {busy === "import" ? t("d22.chromeImporting") : t("d22.chromeImport")}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {preview !== null && (
        <div className="chrome-preview" role="region" aria-label={t("d22.chromePreview")}>
          <p className="settings-hint">
            {preview.error !== null
              ? t("d22.chromeFailed", [preview.error])
              : `${preview.profile?.name ?? ""} · ${t("d22.chromeBookmarks", [preview.total])}`}
          </p>
          <ul>
            {preview.samples.map((item) => (
              <li key={item.url}>
                <span className="chrome-item-name">{item.name}</span>
                <code className="chrome-item-url">{item.url}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="settings-row">
        <span>{t("d22.chromeImportedSection")}</span>
        <span className="settings-soon">
          {state === null || state.imported === 0
            ? t("d22.chromeEmpty")
            : t("d22.chromeImportedAt", [
                `${state.profileName ?? ""} · ${state.importedAt === null ? "" : formatFullDateTime(state.importedAt)}`,
              ])}
        </span>
      </div>
      {state !== null && state.imported > 0 && (
        <>
          <div className="settings-row">
            <span>{t("d22.chromeExport")}</span>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy !== null}
              onClick={() =>
                void run("export", async () => {
                  const result = await api.export();
                  if ("error" in result) {
                    props.onToast(t("d22.chromeFailed", [result.error]));
                  } else {
                    props.onToast(t("d22.chromeExported", [result.filePath]));
                  }
                })
              }
            >
              {t("d22.chromeExport")}
            </button>
          </div>
          <div className="settings-row">
            <span>{t("d22.chromeClear")}</span>
            <button
              type="button"
              className="ghost-btn danger"
              disabled={busy !== null}
              onClick={() =>
                void run("clear", async () => {
                  await api.clear();
                  await refreshState();
                  setPreview(null);
                })
              }
            >
              {t("d22.chromeClear")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
