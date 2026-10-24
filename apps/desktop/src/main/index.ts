import { app, BrowserWindow, Menu, Tray, nativeImage, session } from "electron";
import { join } from "node:path";
import { createPrimaryWindowSenderGuard } from "./ipc/guards.js";
import { registerIpcHandlers, unregisterIpcHandlers } from "./ipc/registry.js";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

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

function createTray(win: BrowserWindow): Tray {
  const next = new Tray(resolveTrayIcon());
  next.setToolTip("DeepSeek Bot");
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show",
      click: () => {
        win.show();
        win.focus();
      },
    },
    {
      label: "Hide",
      click: () => {
        win.hide();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  next.setContextMenu(contextMenu);
  next.on("double-click", () => {
    win.show();
    win.focus();
  });
  return next;
}

function registerShellIpc(win: BrowserWindow): void {
  registerIpcHandlers(
    {
      getAppInfo: () => ({
        name: app.getName(),
        version: app.getVersion(),
        platform: process.platform,
      }),
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
    },
    createPrimaryWindowSenderGuard(() => mainWindow),
  );
}

function denyAllPermissions(): void {
  // The shell needs no media, notification, clipboard or similar capabilities.
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => {
      callback(false);
    },
  );
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, _permission) => false,
  );
}

if (gotLock) {
  app.whenReady().then(() => {
    if (process.platform === "win32") {
      app.setAppUserModelId("com.deepseekbot.desktop");
    }

    denyAllPermissions();

    mainWindow = createMainWindow();
    tray = createTray(mainWindow);
    registerShellIpc(mainWindow);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
        registerShellIpc(mainWindow);
      } else if (mainWindow) {
        mainWindow.show();
      }
    });
  });

  app.on("before-quit", () => {
    isQuitting = true;
    unregisterIpcHandlers();
    tray?.destroy();
    tray = null;
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && isQuitting) {
      app.quit();
    }
  });
}

