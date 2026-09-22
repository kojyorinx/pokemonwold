/**
 * オーバーレイ・ホスト画面・操作APIを同じプロセスで配信する。
 * 正解はプレイ中の状態レスポンスに含めない。
 */

import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { loadCatalogFromFile } from "./catalog.js";
import { createSession } from "./session.js";
import { handleChatMessage, YoutubeLiveChat } from "./youtube.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(rootDir, "public");

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

/**
 * ホスト用トークンが一致するか。長さが違う比較で例外にしない。
 * @param {string} expected
 * @param {string | undefined} actual
 */
function tokenMatches(expected, actual) {
  const left = Buffer.from(expected);
  const right = Buffer.from(String(actual ?? ""));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * @param {import("node:http").IncomingMessage} req
 */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(Object.assign(new Error("リクエストが大きすぎます"), { status: 413 }));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("JSONを読み取れません"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

/**
 * アプリ本体を組み立てる。テストからポート0で起動できる。
 * @param {{ hostToken: string, catalog?: ReturnType<import("./catalog.js").loadCatalog>, session?: ReturnType<typeof createSession>, youtube?: YoutubeLiveChat, catalogPath?: string }} options
 */
export function createApp(options) {
  const catalog = options.catalog ?? loadCatalogFromFile(options.catalogPath ?? path.join(rootDir, "data", "pokemon-ja.json"));
  const session = options.session ?? createSession({ catalog });
  const youtube = options.youtube ?? new YoutubeLiveChat({
    onMessage(message) {
      handleChatMessage(session, message);
    },
  });

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/api/state") {
        sendJson(res, 200, { ...session.publicState(), youtube: youtube.status() });
        return;
      }

      const hostOnly = req.method === "POST" && url.pathname.startsWith("/api/");
      if (hostOnly && !tokenMatches(options.hostToken, req.headers["x-host-token"])) {
        sendJson(res, 401, { error: "ホストトークンが違います" });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/guess") {
        const body = await readJson(req);
        const result = session.guess(body.name, {
          author: body.author || "配信者",
          authorId: "host",
          privileged: true,
        });
        sendJson(res, result.ok ? 200 : 400, {
          ...result.state,
          youtube: youtube.status(),
          error: result.ok ? null : result.message,
          code: result.ok ? null : result.code,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/round") {
        sendJson(res, 200, { ...session.startRound(), youtube: youtube.status() });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/reveal") {
        sendJson(res, 200, { ...session.reveal(), youtube: youtube.status() });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/youtube/start") {
        const body = await readJson(req);
        try {
          await youtube.start({ apiKey: body.apiKey, videoId: body.videoId });
          const status = youtube.status();
          sendJson(res, status.running ? 200 : 400, {
            ...session.publicState(),
            youtube: status,
            error: status.error || null,
          });
        } catch (error) {
          sendJson(res, 400, {
            ...session.publicState(),
            youtube: youtube.status(),
            error: error instanceof Error ? error.message : "接続に失敗しました",
          });
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/youtube/stop") {
        youtube.stop();
        sendJson(res, 200, { ...session.publicState(), youtube: youtube.status() });
        return;
      }

      if (req.method === "GET") {
        await serveStatic(url.pathname, res);
        return;
      }

      sendJson(res, 404, { error: "見つかりません" });
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 500;
      sendJson(res, status, { error: error instanceof Error ? error.message : "サーバーエラー" });
    }
  });

  return { server, session, youtube };
}

/**
 * public/ のファイルを返す。ディレクトリ脱出は拒否する。
 * @param {string} pathname
 * @param {import("node:http").ServerResponse} res
 */
async function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "/host.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, requested));
  const insidePublic = filePath === publicDir || filePath.startsWith(`${publicDir}${path.sep}`);
  if (!insidePublic) {
    sendJson(res, 404, { error: "見つかりません" });
    return;
  }

  try {
    await access(filePath);
  } catch {
    sendJson(res, 404, { error: "見つかりません" });
    return;
  }

  const type = CONTENT_TYPES.get(path.extname(filePath)) ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  createReadStream(filePath).pipe(res);
}
