/**
 * ポケモンWordleをデスクトップアプリのウィンドウとして開く。
 * 操作画面はアプリ内に表示し、外部ブラウザは起動しない。
 */

const { app, BrowserWindow, clipboard, dialog, ipcMain } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

/** @type {import("electron").BrowserWindow | null} */
let mainWindow = null;
/** @type {import("electron").BrowserWindow | null} */
let overlayWindow = null;
/** @type {import("node:http").Server | null} */
let server = null;
let hostToken = "";
let port = 0;

/**
 * 設定ファイルを探す場所。ポータブル exe では配布したフォルダを優先する。
 */
function configDirectory() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (app.isPackaged) return path.dirname(app.getPath("exe"));
  return path.join(__dirname, "..");
}

/**
 * OBS に渡すオーバーレイのURL。
 */
function overlayUrl() {
  return `http://127.0.0.1:${port}/overlay.html`;
}

/**
 * オーバーレイをアプリ内の別ウィンドウで見せる。
 */
function openOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.focus();
    return;
  }
  overlayWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    title: "ポケモンWordle オーバーレイ",
    autoHideMenuBar: true,
    backgroundColor: "#10151f",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  overlayWindow.loadURL(overlayUrl());
  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
}

/**
 * 配信者向けの操作ウィンドウを作る。
 */
function openMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 900,
    minWidth: 760,
    minHeight: 640,
    title: "ポケモンWordle",
    autoHideMenuBar: true,
    backgroundColor: "#10151f",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 画面内のリンクから外部ブラウザへ飛ばさない
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(overlayUrl())) openOverlayWindow();
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      const serverModule = await import(pathToFileURL(path.join(__dirname, "desktop-server.js")).href);
      const started = await serverModule.startEmbeddedServer({ envDir: configDirectory() });
      server = started.server;
      hostToken = started.hostToken;
      port = started.port;
    } catch (error) {
      const message = error && error.code === "EADDRINUSE"
        ? `ポート ${process.env.PORT || 3000} は使用中です。同じフォルダの .env で PORT を変えてください。`
        : (error instanceof Error ? error.message : "起動に失敗しました");
      dialog.showErrorBox("ポケモンWordle を起動できません", message);
      app.quit();
      return;
    }

    ipcMain.handle("host-token", () => hostToken);
    ipcMain.handle("overlay-url", () => overlayUrl());
    ipcMain.handle("copy-overlay", () => {
      clipboard.writeText(overlayUrl());
    });
    ipcMain.handle("preview-overlay", () => {
      openOverlayWindow();
    });

    openMainWindow();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", () => {
    server?.close();
  });
}
