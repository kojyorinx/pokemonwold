"use strict";

/**
 * YouTube Data API のライブ配信チャットを定期的に受け取る。
 * 通常の動画コメントは対象にしない。
 */
class LiveChat {
  constructor({ apiKey, videoId, onMessage, onStatus }) {
    this.apiKey = apiKey;
    this.videoId = videoId;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.generation = 0;
    this.seen = new Set();
  }

  /** 受信を止める。進行中の待ちも世代番号で無効にする。 */
  stop() {
    this.generation += 1;
  }

  /**
   * 配信中のチャット ID を解決してから、新しいコメントだけを渡す。
   * 接続直後の1ページは既に流れている履歴なので捨てる。
   */
  async start() {
    const token = ++this.generation;
    this.onStatus({ state: "connecting", detail: "ライブ配信チャットを確認しています" });
    let chatId;
    try {
      chatId = await resolveLiveChatId(this.apiKey, this.videoId);
    } catch (error) {
      if (token !== this.generation) return;
      this.onStatus({ state: "error", detail: cleanApiMessage(error) });
      return;
    }
    if (token !== this.generation) return;
    this.onStatus({ state: "live", detail: "ライブ配信チャットを受信しています" });

    let pageToken = "";
    let primed = false;
    while (token === this.generation) {
      let data;
      try {
        data = await fetchLiveMessages(this.apiKey, chatId, pageToken);
      } catch (error) {
        if (token !== this.generation) return;
        this.onStatus({ state: "error", detail: cleanApiMessage(error) });
        await sleep(5000);
        continue;
      }
      if (token !== this.generation) return;
      pageToken = data.nextPageToken || pageToken;
      const wait = Math.max(1000, Number(data.pollingIntervalMillis) || 5000);
      if (!primed) {
        primed = true;
        await sleep(wait);
        continue;
      }
      for (const item of data.items || []) {
        if (token !== this.generation) return;
        const message = parseLiveItem(item);
        if (!message || this.seen.has(message.id)) continue;
        this.seen.add(message.id);
        if (this.seen.size > 5000) {
          const oldest = this.seen.values().next().value;
          this.seen.delete(oldest);
        }
        this.onMessage(message);
      }
      await sleep(wait);
    }
  }
}

/**
 * 動画 URL または動画 ID から YouTube の動画 ID を取り出す。
 */
function parseVideoId(input) {
  const text = String(input || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    const fromQuery = url.searchParams.get("v");
    if (fromQuery) return fromQuery;
    const live = url.pathname.match(/\/live\/([^/?#]+)/);
    if (live) return live[1];
    if (url.hostname === "youtu.be") {
      const shortId = url.pathname.split("/").filter(Boolean)[0];
      if (shortId) return shortId;
    }
  } catch {
    // URL でなければ動画 ID として扱う
  }
  if (/^[\w-]{6,}$/.test(text)) return text;
  return "";
}

/**
 * 配信中のチャット ID を動画情報から取得する。
 */
async function resolveLiveChatId(apiKey, videoId) {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "liveStreamingDetails");
  url.searchParams.set("id", videoId);
  url.searchParams.set("key", apiKey);
  const data = await apiGet(url);
  const chatId = data.items && data.items[0] && data.items[0].liveStreamingDetails && data.items[0].liveStreamingDetails.activeLiveChatId;
  if (!chatId) {
    throw new Error("ライブ配信中のチャットが見つかりません。配信中の URL か動画 ID を指定してください");
  }
  return chatId;
}

/**
 * チャットメッセージを1ページ取得する。
 */
async function fetchLiveMessages(apiKey, chatId, pageToken) {
  const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
  url.searchParams.set("part", "snippet,authorDetails");
  url.searchParams.set("liveChatId", chatId);
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  url.searchParams.set("key", apiKey);
  return apiGet(url);
}

/**
 * API の1件を、コメント本文とスパチャ金額に分ける。
 * 文字コメントとスパチャ以外（スタンプなど）は null。
 */
function parseLiveItem(item) {
  const snippet = (item && item.snippet) || {};
  const author = (item && item.authorDetails && item.authorDetails.displayName) || "名無し";
  const id = item && item.id;
  if (!id) return null;
  if (snippet.type === "textMessageEvent") {
    return {
      id,
      author,
      text: (snippet.textMessageDetails && snippet.textMessageDetails.messageText) || "",
      amount: null,
      amountLabel: "",
    };
  }
  if (snippet.type === "superChatEvent") {
    const detail = snippet.superChatDetails || {};
    const micros = Number(detail.amountMicros || 0);
    return {
      id,
      author,
      text: detail.userComment || "",
      amount: Number.isFinite(micros) ? micros / 1e6 : null,
      amountLabel: detail.amountDisplayString || "",
    };
  }
  return null;
}

/** API キーがエラー文に混ざらないようにする。 */
function cleanApiMessage(error) {
  return String((error && error.message) || error).replace(/key=[^&\s]+/gi, "key=(hidden)");
}

async function apiGet(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data.error && data.error.message) || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  LiveChat,
  parseVideoId,
  parseLiveItem,
};
