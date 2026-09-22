/**
 * ポケモンWordle配信ツールの起動口。
 * .env があれば読み、ホストトークン未設定ならその場で発行する。
 */

import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./server.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * KEY=VALUE 形式の .env を process.env へ入れる。既存の環境変数は上書きしない。
 * @param {string} filePath
 */
function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(rootDir, ".env"));

const hostToken = process.env.HOST_TOKEN?.trim() || randomBytes(18).toString("hex");
const port = Number(process.env.PORT || 3000);
const { server, youtube } = createApp({ hostToken });

const videoId = process.env.YOUTUBE_VIDEO_ID?.trim();
const apiKey = process.env.YOUTUBE_API_KEY?.trim();
if (videoId && apiKey) {
  youtube.start({ apiKey, videoId }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
  });
}

server.listen(port, () => {
  console.log(`ポケモンWordle 配信ツール http://localhost:${port}`);
  console.log(`OBSオーバーレイ http://localhost:${port}/overlay.html`);
  console.log(`ホストトークン: ${hostToken}`);
});
