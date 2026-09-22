/**
 * 単体実行ファイルの起動口。
 * 画面と図鑑はビルド時に埋め込み、.env は exe と同じフォルダから読む。
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { loadCatalog } from "./catalog.js";
import { loadEnvFile } from "./env.js";
import { embeddedCatalog, embeddedPublic } from "./embedded-assets.js";
import { createApp } from "./server.js";

// 日本語の起動ログを Windows のコンソールでも読めるようにする
if (process.platform === "win32") {
  try {
    spawn("cmd", ["/c", "chcp", "65001"], { stdio: "ignore", windowsHide: true });
  } catch {
    // コードページ変更に失敗しても起動は続ける
  }
}

loadEnvFile(path.join(path.dirname(process.execPath), ".env"));

const hostToken = process.env.HOST_TOKEN?.trim() || randomBytes(18).toString("hex");
const port = Number(process.env.PORT || 3000);
const { server, youtube } = createApp({
  hostToken,
  catalog: loadCatalog(embeddedCatalog),
  files: embeddedPublic,
});

const videoId = process.env.YOUTUBE_VIDEO_ID?.trim();
const apiKey = process.env.YOUTUBE_API_KEY?.trim();
if (videoId && apiKey) {
  youtube.start({ apiKey, videoId }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
  });
}

/**
 * ホスト画面を標準ブラウザで開く。
 * @param {string} url
 */
function openBrowser(url) {
  if (process.env.POKEMONWOLD_NO_BROWSER === "1") return;
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return;
  }
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [url], { detached: true, stdio: "ignore" }).unref();
}

server.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    console.error(`ポート ${port} は使用中です。同じフォルダの .env で PORT を変えてください。`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exit(1);
});

server.listen(port, () => {
  const hostUrl = `http://localhost:${port}`;
  console.log(`ポケモンWordle 配信ツール ${hostUrl}`);
  console.log(`OBSオーバーレイ ${hostUrl}/overlay.html`);
  console.log(`ホストトークン: ${hostToken}`);
  openBrowser(hostUrl);
});
