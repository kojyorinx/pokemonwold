/**
 * アプリウィンドウの裏側で動かすローカルサーバー。
 * このPCの中だけで待ち受け、標準ブラウザは開かない。
 */

import { randomBytes } from "node:crypto";
import path from "node:path";
import { loadEnvFile } from "./env.js";
import { createApp } from "./server.js";

/**
 * .env を読んでサーバーを起動し、画面から使うトークンとポートを返す。
 * @param {{ envDir: string }} options
 * @returns {Promise<{ server: import("node:http").Server, port: number, hostToken: string }>}
 */
export function startEmbeddedServer(options) {
  loadEnvFile(path.join(options.envDir, ".env"));
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

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    // OBS は同じPCのブラウザソースからだけ届ければよい
    server.listen(port, "127.0.0.1", () => {
      resolve({ server, port: Number(port), hostToken });
    });
  });
}
