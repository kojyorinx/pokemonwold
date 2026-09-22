/**
 * ポケモンWordle配信ツールの起動口。
 * .env があれば読み、ホストトークン未設定ならその場で発行する。
 */

import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "./env.js";
import { createApp } from "./server.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
