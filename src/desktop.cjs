"use strict";

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { evaluateComment } = require("./logic");
const { loadSettings, saveSettings } = require("./settings");
const { LiveChat, parseVideoId } = require("./youtube");
const { KEYBOARDS, typePokemonName, siteReady, selectGameMode } = require("./site-script");
const { speakWindows, speakLine } = require("./tts");

const SITE_URL = "https://wordle.mega-yadoran.jp/";

/** 背景に回っても、本家サイトの入力アニメーションが遅れないようにする */
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let hostWindow = null;
let siteWindow = null;
let settings = null;
let settingsFile = "";
let names = new Set();
let chat = null;
let chain = Promise.resolve();
let log = [];
let stats = { received: 0, adopted: 0 };
let status = {
  youtube: "idle",
  youtubeDetail: "ライブ配信チャットは未接続です",
  site: "loading",
  siteDetail: "本家サイトを開いています",
  busy: false,
  busyName: "",
};

/**
 * 設定ファイルを置く場所。
 * 配布した exe では exe と同じフォルダ、開発中はプロジェクト直下。
 */
function configDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (app.isPackaged) return path.dirname(process.execPath);
  return path.join(__dirname, "..");
}

/**
 * 操作画面へ状態を送る。
 */
function pushStatus(partial) {
  status = { ...status, ...partial };
  if (hostWindow && !hostWindow.isDestroyed()) {
    hostWindow.webContents.send("status", { ...status, stats });
  }
}

/**
 * 画面のログへ1行追加する。
 */
function pushLog(entry) {
  const row = {
    time: new Date().toISOString(),
    level: entry.level || "info",
    message: entry.message,
  };
  log.push(row);
  if (log.length > 300) log.shift();
  if (hostWindow && !hostWindow.isDestroyed()) {
    hostWindow.webContents.send("log", row);
  }
}

/**
 * 本家サイトへの入力を1件ずつ順番に行う。
 */
function enqueue(job) {
  chain = chain.then(job).catch((error) => {
    pushLog({ level: "error", message: String((error && error.message) || error) });
  });
  return chain;
}

/**
 * ページ内関数を本家サイトのウィンドウで実行する。
 */
async function runOnSite(fn, ...args) {
  if (!siteWindow || siteWindow.isDestroyed()) {
    createSiteWindow();
  }
  const code = `(${fn.toString()})(${args.map((arg) => JSON.stringify(arg)).join(",")})`;
  return siteWindow.webContents.executeJavaScript(code, true);
}

/**
 * キーボードが出るまで待ってから、ポケモン名を入力する。
 */
async function typeOnSite(name) {
  const mode = await applyGameMode({ announce: false });
  if (!mode || !mode.ok) return mode || { ok: false, reason: "mode" };
  if (mode.needsStart) return { ok: false, reason: "need-start" };
  return runOnSite(typePokemonName, name, KEYBOARDS);
}

/**
 * 保存されているゲームモードを本家サイトへ反映する。
 * 入力の待ち行列の中から呼ぶ。ここから再度待ち行列へは入れない。
 */
async function applyGameMode({ announce }) {
  const ready = await waitForSite();
  if (!ready) return { ok: false, reason: "not-ready" };
  const result = await runOnSite(selectGameMode, settings.gameMode || "today");
  if (result && result.ok) {
    const extra = result.needsStart ? "。本家サイトの START を押すと出題が始まります" : "";
    pushStatus({ site: "ready", siteDetail: `${result.label}を操作できます${extra}` });
    if (announce) pushLog({ level: "info", message: `${result.label}を表示しています${extra}` });
  }
  return result;
}

/**
 * ENTER キーが見えるまで本家サイトの読み込みを待つ。
 */
async function waitForSite() {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    if (!siteWindow || siteWindow.isDestroyed()) return false;
    try {
      const ready = await runOnSite(siteReady);
      if (ready) {
        pushStatus({ site: "ready", siteDetail: "本家サイトを操作できます" });
        return true;
      }
    } catch {
      // 読み込み途中は次の確認まで待つ
    }
    await sleep(300);
  }
  pushStatus({ site: "error", siteDetail: "本家サイトのキーボードが見つかりません" });
  return false;
}

/**
 * コメント1件を判定し、採用したら読み上げて本家サイトへ入力する。
 */
function handleComment({ author, text, amount, amountLabel, force, source }) {
  stats.received += 1;
  const result = evaluateComment({
    text,
    amount,
    settings,
    names,
    force: source === "test" && force === true,
    rng: Math.random,
  });
  const who = author || "名無し";
  const showInLog = source === "test" || result.reason !== "not-katakana" || settings.logOther;
  if (showInLog && result.reason !== "empty") {
    const money = amountLabel || (amount ? `${amount}` : "");
    const prefix = money ? `${who}（スパチャ ${money}）` : who;
    pushLog({
      level: result.adopted ? "adopt" : "skip",
      message: `${prefix}: ${result.message}${result.name ? `「${result.name}」` : ""}`,
    });
  }
  if (!result.adopted) {
    pushStatus({});
    return result;
  }
  stats.adopted += 1;
  pushStatus({});
  enqueue(async () => {
    pushStatus({ busy: true, busyName: result.name });
    if (settings.ttsEnabled) speakAloud(speakLine(who, result.name));
    const typed = await typeOnSite(result.name);
    if (typed && typed.ok) {
      pushLog({ level: "adopt", message: `本家サイトへ「${result.name}」を入力しました` });
    } else if (typed && typed.reason === "need-start") {
      pushLog({
        level: "error",
        message: `「${result.name}」はエンドレスが始まる前なので入力できません。本家サイトの START を押してください`,
      });
    } else {
      const reason = typed && typed.reason ? typed.reason : "unknown";
      const detail = typed && typed.detail ? ` ${typed.detail}` : "";
      pushLog({
        level: "error",
        message: `「${result.name}」を本家サイトへ入力できませんでした（${reason}${detail}）`,
      });
    }
    pushStatus({ busy: false, busyName: "" });
  });
  return result;
}

function createHostWindow() {
  hostWindow = new BrowserWindow({
    x: 16,
    y: 24,
    width: 560,
    height: 1040,
    minWidth: 420,
    minHeight: 640,
    title: "ポケモンWordle チャット連携",
    backgroundColor: "#f6f3ea",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  hostWindow.loadFile(path.join(__dirname, "..", "public", "index.html"));
  hostWindow.on("closed", () => {
    hostWindow = null;
    if (chat) chat.stop();
    app.quit();
  });
}

function createSiteWindow() {
  if (siteWindow && !siteWindow.isDestroyed()) {
    siteWindow.focus();
    return;
  }
  siteWindow = new BrowserWindow({
    x: 590,
    y: 24,
    width: 1280,
    height: 1100,
    title: "ポケモンWordle",
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:wordle",
      backgroundThrottling: false,
    },
  });
  siteWindow.webContents.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  );
  siteWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  siteWindow.webContents.on("will-navigate", (event, url) => {
    if (!isSiteUrl(url)) event.preventDefault();
  });
  siteWindow.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (isMainFrame && isSiteUrl(url)) {
      pushStatus({ site: "error", siteDetail: `本家サイトを開けませんでした（${description || code}）` });
    }
  });
  siteWindow.webContents.on("did-finish-load", () => {
    pushStatus({ site: "loading", siteDetail: "本家サイトを読み込みました" });
    enqueue(() => applyGameMode({ announce: true }));
  });
  siteWindow.on("closed", () => {
    siteWindow = null;
    pushStatus({ site: "error", siteDetail: "本家サイトのウィンドウを閉じました" });
  });
  pushStatus({ site: "loading", siteDetail: "本家サイトを開いています" });
  siteWindow.loadURL(SITE_URL);
}

function registerIpc() {
  ipcMain.handle("get-state", () => ({
    settings,
    log,
    status,
    stats,
  }));

  ipcMain.handle("save-settings", (_event, input) => {
    settings = saveSettings(settingsFile, input);
    pushLog({ level: "info", message: "設定を保存しました" });
    return settings;
  });

  ipcMain.handle("connect", async (_event, input) => {
    settings = saveSettings(settingsFile, input);
    const videoId = parseVideoId(settings.videoId);
    if (!settings.apiKey) {
      pushStatus({ youtube: "error", youtubeDetail: "YouTube Data API キーを入力してください" });
      return status;
    }
    if (!videoId) {
      pushStatus({ youtube: "error", youtubeDetail: "配信の URL か動画 ID を入力してください" });
      return status;
    }
    if (chat) chat.stop();
    chat = new LiveChat({
      apiKey: settings.apiKey,
      videoId,
      onStatus: (next) => pushStatus({ youtube: next.state, youtubeDetail: next.detail }),
      onMessage: (message) => handleComment({ ...message, source: "youtube", force: false }),
    });
    chat.start();
    return status;
  });

  ipcMain.handle("disconnect", () => {
    if (chat) chat.stop();
    chat = null;
    pushStatus({ youtube: "idle", youtubeDetail: "ライブ配信チャットを切断しました" });
    pushLog({ level: "info", message: "ライブ配信チャットを切断しました" });
    return status;
  });

  ipcMain.handle("test-chat", (_event, payload) => {
    const body = payload || {};
    settings = saveSettings(settingsFile, body.settings || settings);
    const amount = body.amount === "" || body.amount === null || body.amount === undefined ? null : Number(body.amount);
    return handleComment({
      author: String(body.author || "テスト").trim() || "テスト",
      text: body.text,
      amount: Number.isFinite(amount) ? amount : null,
      amountLabel: Number.isFinite(amount) && amount > 0 ? `${amount}` : "",
      force: body.force === true,
      source: "test",
    });
  });

  ipcMain.handle("reload-site", () => {
    if (!siteWindow || siteWindow.isDestroyed()) {
      createSiteWindow();
      return;
    }
    pushStatus({ site: "loading", siteDetail: "本家サイトを読み込み直しています" });
    siteWindow.loadURL(SITE_URL);
  });

  ipcMain.handle("focus-site", () => {
    if (!siteWindow || siteWindow.isDestroyed()) createSiteWindow();
    else siteWindow.focus();
  });

  ipcMain.handle("set-game-mode", (_event, input) => {
    settings = saveSettings(settingsFile, input);
    const label = settings.gameMode === "endless" ? "エンドレス" : "今日のお題";
    pushLog({ level: "info", message: `${label}へ切り替えています` });
    enqueue(() => applyGameMode({ announce: true }));
    return settings;
  });

  ipcMain.handle("speak-test", (_event, payload) => {
    const body = payload || {};
    settings = saveSettings(settingsFile, body.settings || settings);
    if (!settings.ttsEnabled) return { ok: false };
    speakAloud(String(body.text || "テスト、ピカチュウ").slice(0, 80));
    return { ok: true };
  });
}

/**
 * 採用コメントを読み上げる。
 * Windows では OS の音声合成、それ以外は操作画面の音声合成を使う。
 */
function speakAloud(line) {
  pushLog({ level: "info", message: `読み上げ: ${line}` });
  if (process.platform === "win32") speakWindows(line);
  if (hostWindow && !hostWindow.isDestroyed()) {
    hostWindow.webContents.send("speak", { text: line, audible: process.platform !== "win32" });
  }
}

/** 本家サイトの URL かどうか。別ページへの移動は止める。 */
function isSiteUrl(url) {
  try {
    return new URL(url).hostname === "wordle.mega-yadoran.jp";
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (hostWindow) {
      if (hostWindow.isMinimized()) hostWindow.restore();
      hostWindow.focus();
    }
  });

  app.whenReady().then(() => {
    settingsFile = path.join(configDir(), "settings.json");
    settings = loadSettings(settingsFile);
    const nameFile = path.join(__dirname, "..", "data", "pokemon-kata.json");
    names = new Set(JSON.parse(fs.readFileSync(nameFile, "utf8")));
    registerIpc();
    createHostWindow();
    createSiteWindow();
  });
}

app.on("window-all-closed", () => {
  if (chat) chat.stop();
  app.quit();
});
