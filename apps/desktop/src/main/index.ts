import { app, BrowserWindow, nativeImage, safeStorage, session } from "electron";
import { delimiter, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createPrimaryWindowSenderGuard } from "./ipc/guards.js";
import { registerIpcHandlers, unregisterIpcHandlers } from "./ipc/registry.js";
import {
  spawnHostProcess,
  isAllowedHostMethod,
  type HostProcessClient,
} from "./host-client.js";
import { checkUpdates, downloadAndInstallUpdate, setAppVersion } from "./updates.js";
import { initMainLocale, setMainLanguagePreference, tr } from "./i18n.js";
import { createTrayController, sendTrayAction, type TrayController } from "./tray.js";
import {
  createNotificationController,
  sendNotificationClick,
} from "./notifications.js";
import {
  clearChromeImport,
  exportChromeImportToMarkdown,
  importChromeProfile,
  previewChromeProfile,
  readChromeImport,
  scanChromeProfiles,
} from "./chrome-bookmarks.js";
import { DATA_ROOT_DIR_NAME, HOST_EVENT_CHAT_STREAM, HOST_EVENT_MISSED, SYSTEM_EVENT_WINDOW_FOCUS } from "../shared/ipc-channels.js";
import { pickKnowledgeFile } from "./knowledge-import.js";
import { pickVoiceFile } from "./voice-pick.js";
import { listBackups, type RestoreOutcome } from "./backups.js";
import {
  applyHardwareAccelerationPreference,
  getHardwareAcceleration,
  setHardwareAcceleration,
} from "./hardware-acceleration.js";

let mainWindow: BrowserWindow | null = null;
let trayController: TrayController | null = null;
let isQuitting = false;
let hostClient: HostProcessClient | null = null;

const notifications = createNotificationController({
  getWindow: () => mainWindow,
  send: (event) => sendNotificationClick(mainWindow, event),
});

function quitApplication(): void {
  isQuitting = true;
  app.quit();
}

/**
 * Data root mirrors storage's layout (env override first). The storage
 * package itself is not imported here: its index pulls node:sqlite, which
 * Electron 38's bundled Node 22 does not provide (ARCHITECTURE §4) — the
 * Host child owns the database.
 */
function resolveDataRoot(): string {
  const override = process.env["DEEPSEEK_BOT_DATA_ROOT"];
  if (override !== undefined && override.length > 0) {
    return override;
  }
  return join(app.getPath("appData"), DATA_ROOT_DIR_NAME);
}

/**
 * Decrypt one credential ref through DPAPI (safeStorage). The Host only ever
 * sees the resulting key transiently inside the harness child's environment.
 */
async function decryptCredential(credentialRef: string): Promise<string> {
  if (!/^cred:[0-9a-fA-F-]{36}$/.test(credentialRef)) {
    throw new Error(`malformed credential ref: ${credentialRef.slice(0, 9)}…`);
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("credential encryption is not available on this system");
  }
  const fileName = `${credentialRef.slice("cred:".length)}.blob`;
  const blob = readFileSync(join(resolveDataRoot(), "credentials", fileName));
  return safeStorage.decryptString(blob);
}

/**
 * Dev-only profile redirect: this machine intermittently denies Chromium's
 * ProcessSingleton lock inside the real %APPDATA% profile (error 5), which
 * kills every unpacked launch before the window opens. A dev run can point
 * the profile at a writable location via DSB_DEV_USER_DATA; packaged builds
 * never read this.
 */
if (!app.isPackaged && process.env.DSB_DEV_USER_DATA !== undefined) {
  app.setPath("userData", process.env.DSB_DEV_USER_DATA);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function resolvePreloadPath(): string {
  return join(__dirname, "../preload/index.cjs");
}

function resolveTrayIcon(): Electron.NativeImage {
  const candidates = [
    join(process.resourcesPath, "assets", "tray.png"),
    join(app.getAppPath(), "assets", "tray.png"),
    join(__dirname, "../../assets/tray.png"),
  ];
  for (const candidate of candidates) {
    const img = nativeImage.createFromPath(candidate);
    if (!img.isEmpty()) {
      return img;
    }
  }
  return nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOUlEQVR4nGNgoAXwzf73HxsmWyNRBhGrGachFBlAqmYMQ6hqACFAewMGJgwGPh1QJSkTYxBBjeQAAMGI0HQM57YaAAAAAElFTkSuQmCC",
  );
}

function isAppOwnedUrl(url: string): boolean {
  if (url.startsWith("file:")) {
    return true;
  }
  if (url.startsWith("http://localhost:") || url.startsWith("http://127.0.0.1:")) {
    return true;
  }
  return false;
}

function attachNavigationGuards(win: BrowserWindow): void {
  win.webContents.on("will-navigate", (event, url) => {
    if (!isAppOwnedUrl(url)) {
      event.preventDefault();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppOwnedUrl(url)) {
      return { action: "allow" };
    }
    return { action: "deny" };
  });
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0f0f10",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#0f0f10",
      symbolColor: "#ececf1",
      height: 52,
    },
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  attachNavigationGuards(win);

  win.on("ready-to-show", () => {
    win.show();
  });

  // Some Windows sessions never fire ready-to-show for a window that starts
  // hidden (the first frame never gets composited), leaving the app invisible
  // with a working renderer. Once the page has loaded, give ready-to-show a
  // short grace period, then show the window anyway.
  win.webContents.once("did-finish-load", () => {
    setTimeout(() => {
      if (!win.isDestroyed() && !win.isVisible()) {
        win.show();
      }
    }, 1_000);
  });

  win.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

/**
 * Persist the API key: safeStorage ciphertext goes to the credential blob
 * store; the Host only receives the opaque `cred:` reference. Plaintext
 * fallback is forbidden (SECURITY_DATA §1).
 */
async function saveApiKey(key: unknown): Promise<{ configured: boolean }> {
  if (typeof key !== "string") {
    throw new Error(tr("main.keyMustBeString"));
  }
  const trimmed = key.trim();
  if (trimmed.length < 20 || trimmed.length > 200 || !trimmed.startsWith("sk-")) {
    throw new Error(tr("main.keyFormatInvalid"));
  }
  if (!hostClient) {
    throw new Error(tr("main.hostNotReady"));
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(tr("main.credentialStoreUnavailable"));
  }
  const id = randomUUID();
  const credentialRef = `cred:${id}`;
  const credentialsDir = join(resolveDataRoot(), "credentials");
  mkdirSync(credentialsDir, { recursive: true });
  writeFileSync(join(credentialsDir, `${id}.blob`), safeStorage.encryptString(trimmed));
  await hostClient.call("settings.update", { patch: { apiKeyRef: credentialRef } });
  return { configured: true };
}
function registerShellIpc(win: BrowserWindow): void {
  registerIpcHandlers(
    {
      getAppInfo: () => ({
        name: app.getName(),
        version: app.getVersion(),
        platform: process.platform,
        locale: app.getLocale(),
      }),
      saveKey: (key) => saveApiKey(key),
      importKnowledge: () => pickKnowledgeFile(win),
      voicePickFile: (kind) => pickVoiceFile(win, kind),
      checkUpdates: () => checkUpdates(),
      downloadAndInstallUpdate: () => downloadAndInstallUpdate(),
      setLanguage: (preference) => setMainLanguagePreference(preference),
      hostCall: async (method, payload) => {
        // Humanized errors (streaming-reply era UX): the channel never throws —
        // it resolves an envelope so the renderer gets the Host's own message
        // and stable code without Electron's "Error invoking remote method"
        // wrapping, which used to bury the useful sentence under noise.
        if (!isAllowedHostMethod(method)) {
          return {
            ok: false as const,
            error: { code: "INVALID_INPUT", message: "unknown host method", retryable: false },
          };
        }
        if (hostClient === null) {
          return {
            ok: false as const,
            error: {
              code: "RUNTIME_UNAVAILABLE",
              message: "host process is not running",
              retryable: false,
            },
          };
        }
        try {
          if (method === "data.restore") {
            // The restore handler replaces the database on disk; the running
            // Host is dead afterwards (handlers.ts). Replace the child before
            // the renderer sees the result, so follow-up calls hit the fresh
            // process instead of failing with "host process has exited".
            await hostClient.call(method, payload);
            await restartHost();
            return { ok: true as const, result: { restored: true, hostRestarted: true } satisfies RestoreOutcome };
          }
          return { ok: true as const, result: await hostClient.call(method, payload) };
        } catch (error) {
          const hostError = error as { code?: unknown; message?: unknown; retryable?: unknown };
          return {
            ok: false as const,
            error: {
              code: typeof hostError.code === "string" ? hostError.code : "RUNTIME_UNAVAILABLE",
              message:
                hostError instanceof Error ? hostError.message : String(hostError ?? "host call failed"),
              retryable: hostError.retryable === true,
            },
          };
        }
      },
      listBackups: () => listBackups(resolveDataRoot()),
      hardwareAcceleration: (enabled: unknown) => {
        if (enabled === undefined) {
          return Promise.resolve(getHardwareAcceleration());
        }
        if (typeof enabled !== "boolean") {
          return Promise.reject(new Error(tr("d24.hardwareAccelNotBoolean")));
        }
        return Promise.resolve(setHardwareAcceleration(enabled));
      },
      showWindow: () => {
        win.show();
        win.focus();
      },
      hideWindow: () => {
        win.hide();
      },
      minimizeWindow: () => {
        win.minimize();
      },
      toggleMaximizeWindow: () => {
        if (win.isMaximized()) {
          win.unmaximize();
        } else {
          win.maximize();
        }
      },
      closeWindow: () => {
        // Routes through the close handler: hides to tray unless quitting.
        win.close();
      },
      setTitleBarOverlay: (colors) => {
        // Renderer re-colors the native window-control strip on theme switch.
        win.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor });
      },
      traySync: (payload) => {
        trayController?.sync(payload);
      },
      showNotification: (request) => notifications.show(request),
      chromeScan: () => scanChromeProfiles(),
      chromePreview: (token) => previewChromeProfile(token),
      chromeImport: (token) => importChromeProfile(resolveDataRoot(), token),
      chromeState: () => readChromeImport(resolveDataRoot()),
      chromeClear: () => clearChromeImport(resolveDataRoot()),
      chromeExport: () => exportChromeImportToMarkdown(resolveDataRoot()),
    },
    createPrimaryWindowSenderGuard(() => mainWindow),
  );
}

function attachFocusEvents(win: BrowserWindow): void {
  // D22: the renderer gates notifications on real focus, because
  // document.hasFocus() is false while the window is hidden to the tray.
  const send = (focused: boolean): void => {
    if (!win.isDestroyed()) {
      win.webContents.send(SYSTEM_EVENT_WINDOW_FOCUS, { focused });
    }
  };
  win.on("focus", () => send(true));
  win.on("blur", () => send(false));
  win.on("show", () => send(true));
  win.on("hide", () => send(false));
}

function denyAllPermissions(): void {
  // Only renderer-initiated clipboard WRITES are allowed (user copies message text);
  // everything else (media, notifications, clipboard read, ...) stays denied.
  const allowedPermissions = new Set(["clipboard-sanitized-write"]);
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(allowedPermissions.has(permission));
    },
  );
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => allowedPermissions.has(permission),
  );
}

/**
 * Spawn the Host child and bind it to the shell (missed-notice forwarding).
 * Re-entrant: `data.restore` invalidates the running Host (its database
 * handle is replaced on disk), so the main process shuts it down and calls
 * this again over the restored data.
 */
function startHost(): void {
  // The Host owns the database, engine, scheduler and the pinned Harness
  // adapter (D12). It starts with the shell and dies with it; renderer
  // contract calls forward through the HOST_CALL channel. The entry ships
  // as an extraResource when packaged and falls back to the monorepo build
  // in development.
  const hostEntryCandidates = [
    join(process.resourcesPath, "host", "main.js"),
    join(app.getAppPath(), "..", "..", "packages", "host", "dist", "main.js"),
  ];
  // The bundled Host still resolves the pinned Harness package through
  // NODE_PATH in a source checkout (the packaged app ships it in resources).
  const devHarnessModules = join(
    app.getAppPath(),
    "..",
    "..",
    "packages",
    "harness-adapter",
    "node_modules",
  );
  hostClient = spawnHostProcess({
    entryPath: hostEntryCandidates.find((candidate) => existsSync(candidate)) ?? hostEntryCandidates[0]!,
    dataRoot: resolveDataRoot(),
    decryptCredential,
    childEnv: (parent) =>
      existsSync(devHarnessModules)
        ? {
            NODE_PATH: [devHarnessModules, parent["NODE_PATH"]].filter(Boolean).join(delimiter),
          }
        : {},
  });
  hostClient.onMissed((notices) => {
    if (mainWindow !== null && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(HOST_EVENT_MISSED, notices);
    }
  });
  // B6: live assistant segments for the streaming bubble (best-effort push).
  hostClient.onChatStream((notice) => {
    if (mainWindow !== null && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(HOST_EVENT_CHAT_STREAM, notice);
    }
  });
}

/**
 * Replace the Host child after a successful data.restore. Pending calls on
 * the old client fail fast with RUNTIME_UNAVAILABLE; the fresh process opens
 * the restored database.
 */
async function restartHost(): Promise<void> {
  const previous = hostClient;
  hostClient = null;
  await previous?.shutdown();
  startHost();
}

if (gotLock) {
  // Chromium's toggle only counts before app.ready (hardware-acceleration.ts).
  applyHardwareAccelerationPreference();

  app.whenReady().then(() => {
    if (process.platform === "win32") {
      app.setAppUserModelId("com.deepseekbot.desktop");
    }
    // D22: main speaks the desktop locale until the renderer syncs its choice.
    initMainLocale(app.getLocale());
    // D24: version source for update checks; silent first check fails soft
    // (no releases yet) and only surfaces when the renderer asks.
    setAppVersion(app.getVersion());
    void checkUpdates().catch(() => undefined);

    denyAllPermissions();

    startHost();

    mainWindow = createMainWindow();
    // D22: one tray whose icon mirrors the active bot's avatar; the renderer
    // pushes the bot list (with rasterised avatars) through tray:sync.
    trayController = createTrayController({
      getWindow: () => mainWindow,
      quit: quitApplication,
      appName: app.getName(),
      defaultIcon: resolveTrayIcon,
      send: (event) => sendTrayAction(mainWindow, event),
    });
    attachFocusEvents(mainWindow);
    registerShellIpc(mainWindow);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
        attachFocusEvents(mainWindow);
        registerShellIpc(mainWindow);
      } else if (mainWindow) {
        mainWindow.show();
      }
    });
  });

  app.on("before-quit", () => {
    isQuitting = true;
    unregisterIpcHandlers();
    trayController?.destroy();
    trayController = null;
    // Graceful host teardown: host/shutdown request, exit wait, kill fallback.
    void hostClient?.shutdown();
    hostClient = null;
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && isQuitting) {
      app.quit();
    }
  });
}



