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

/**
 * 開発時にソースツリーから図鑑と画面を読む基準ディレクトリ。
 * exe では埋め込みデータを渡すので、このパスは使わない。
 */
function projectRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

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
 * @param {{ hostToken: string, catalog?: ReturnType<import("./catalog.js").loadCatalog>, session?: ReturnType<typeof createSession>, youtube?: YoutubeLiveChat, catalogPath?: string, files?: Record<string, string> }} options
 */
export function createApp(options) {
  const catalog = options.catalog ?? loadCatalogFromFile(options.catalogPath ?? path.join(projectRoot(), "data", "pokemon-ja.json"));
  const session = options.session ?? createSession({ catalog });
  const youtube = options.youtube ?? new YoutubeLiveChat({
    onMessage(message) {
      handleChatMessage(session, message);
    },
  });
  // 配信していないときの疑似チャット。YouTube接続とは同時に使わない。
  let testMode = false;

  /**
   * 画面へ返す状態。プレイ中の正解はセッション側で隠している。
   * @param {Record<string, unknown>} [extra]
   */
  function snapshot(extra = {}) {
    return {
      ...session.publicState(),
      youtube: youtube.status(),
      testMode: { enabled: testMode },
      ...extra,
    };
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/api/state") {
        sendJson(res, 200, snapshot());
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
          ...snapshot(),
          error: result.ok ? null : result.message,
          code: result.ok ? null : result.code,
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/round") {
        session.startRound();
        sendJson(res, 200, snapshot());
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/reveal") {
        session.reveal();
        sendJson(res, 200, snapshot());
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/reset") {
        // 盤面だけでなく、配信接続とテストモードも初期状態へ戻す
        youtube.stop();
        testMode = false;
        session.resetAll();
        sendJson(res, 200, snapshot());
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/test/start") {
        youtube.stop();
        testMode = true;
        sendJson(res, 200, snapshot());
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/test/stop") {
        testMode = false;
        sendJson(res, 200, snapshot());
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/test/chat") {
        const body = await readJson(req);
        if (!testMode) {
          sendJson(res, 400, { ...snapshot(), error: "テストモードを開始してください" });
          return;
        }
        const author = String(body.author || "テスト視聴者").trim() || "テスト視聴者";
        const outcome = handleChatMessage(session, {
          text: String(body.text || ""),
          author,
          authorId: `test:${author}`,
          isOwner: Boolean(body.moderator),
          isModerator: Boolean(body.moderator),
        });
        sendJson(res, 200, { ...snapshot(), error: null, notice: describeTestChat(outcome) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/youtube/start") {
        const body = await readJson(req);
        try {
          await youtube.start({ apiKey: body.apiKey, videoId: body.videoId });
          const status = youtube.status();
          if (status.running) testMode = false;
          sendJson(res, status.running ? 200 : 400, {
            ...snapshot(),
            error: status.error || null,
          });
        } catch (error) {
          sendJson(res, 400, {
            ...snapshot(),
            error: error instanceof Error ? error.message : "接続に失敗しました",
          });
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/youtube/stop") {
        youtube.stop();
        sendJson(res, 200, snapshot());
        return;
      }

      if (req.method === "GET") {
        await serveStatic(url.pathname, res, options.files);
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
 * 疑似チャットの結果をホスト画面の一言に変える。
 * @param {{ handled?: boolean, ignored?: boolean, command?: string, result?: { ok?: boolean, message?: string } }} outcome
 */
function describeTestChat(outcome) {
  if (outcome.command === "new") return "出題を切り替えました";
  if (outcome.command === "reset") return "盤面と履歴をリセットしました";
  if (outcome.command === "open") return "正解を開きました";
  if (outcome.ignored) return "モデレーター以外はそのコマンドを使えません";
  if (outcome.result?.ok) return "チャットを盤面に反映しました";
  if (outcome.result?.message) return outcome.result.message;
  return "ポケモン名ではないので無視しました";
}

/**
 * public/ のファイル、または exe に埋め込んだファイルを返す。
 * 埋め込み時は登録されたパスだけを返し、ディレクトリ脱出は拒否する。
 * @param {string} pathname
 * @param {import("node:http").ServerResponse} res
 * @param {Record<string, string> | undefined} files
 */
async function serveStatic(pathname, res, files) {
  const requested = pathname === "/" ? "/host.html" : pathname;
  if (files) {
    const body = Object.hasOwn(files, requested) ? files[requested] : undefined;
    if (body === undefined) {
      sendJson(res, 404, { error: "見つかりません" });
      return;
    }
    const type = CONTENT_TYPES.get(path.extname(requested)) ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
    return;
  }

  const publicDir = path.join(projectRoot(), "public");
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
