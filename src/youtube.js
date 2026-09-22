/**
 * YouTube Data API v3 で配信チャットを読み、テキスト発言だけをゲームへ渡す。
 * 接続直後に既に流れていた発言は答えに使わない。
 */

const VIDEOS_ENDPOINT = "https://www.googleapis.com/youtube/v3/videos";
const CHAT_ENDPOINT = "https://www.googleapis.com/youtube/v3/liveChat/messages";

/**
 * liveChat.messages のレスポンスから通常メッセージを取り出す。
 * @param {any} body
 * @returns {{ id: string, text: string, author: string, authorId: string, isOwner: boolean, isModerator: boolean }[]}
 */
export function extractTextMessages(body) {
  const items = Array.isArray(body?.items) ? body.items : [];
  const messages = [];

  for (const item of items) {
    if (item?.snippet?.type !== "textMessageEvent") continue;
    const text = item.snippet.textMessageDetails?.messageText ?? item.snippet.displayMessage ?? "";
    messages.push({
      id: String(item.id ?? ""),
      text: String(text),
      author: item.authorDetails?.displayName || "視聴者",
      authorId: item.authorDetails?.channelId || "",
      isOwner: Boolean(item.authorDetails?.isChatOwner),
      isModerator: Boolean(item.authorDetails?.isChatModerator),
    });
  }

  return messages;
}

/**
 * ライブチャットのポーリングを担当する。
 */
export class YoutubeLiveChat {
  /**
   * @param {{ fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, onMessage?: (msg: any) => void, onStatus?: (status: object) => void }} [deps]
   */
  constructor(deps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.onMessage = deps.onMessage ?? (() => {});
    this.onStatus = deps.onStatus ?? (() => {});
    this.generation = 0;
    this.running = false;
    this.videoId = "";
    this.liveChatId = "";
    this.error = "";
    this.seen = 0;
  }

  /** ホスト画面へ返す接続状態。APIキーは含めない。 */
  status() {
    return {
      running: this.running,
      videoId: this.videoId,
      liveChatId: this.liveChatId,
      error: this.error,
      seen: this.seen,
    };
  }

  /** ポーリングを止める */
  stop() {
    this.generation += 1;
    this.running = false;
    this.onStatus(this.status());
  }

  /**
   * 動画IDからアクティブなチャットを開き、新しい発言を監視する。
   * @param {{ apiKey: string, videoId: string }} config
   */
  async start(config) {
    const apiKey = String(config.apiKey ?? "").trim();
    const videoId = String(config.videoId ?? "").trim();
    if (!apiKey) throw new Error("YouTube Data API キーがありません");
    if (!/^[\w-]{6,}$/.test(videoId)) throw new Error("動画IDの形式が正しくありません");

    this.stop();
    const generation = this.generation;
    this.running = true;
    this.videoId = videoId;
    this.liveChatId = "";
    this.error = "";
    this.seen = 0;
    this.onStatus(this.status());

    const videoUrl = new URL(VIDEOS_ENDPOINT);
    videoUrl.searchParams.set("part", "liveStreamingDetails");
    videoUrl.searchParams.set("id", videoId);
    videoUrl.searchParams.set("key", apiKey);

    let videoResponse;
    let videoBody;
    try {
      videoResponse = await this.fetchImpl(videoUrl);
      videoBody = await videoResponse.json();
    } catch (error) {
      this.fail(generation, error instanceof Error ? error.message : "動画情報の取得に失敗しました");
      return;
    }
    if (!videoResponse.ok) {
      this.fail(generation, videoBody?.error?.message || `YouTube API ${videoResponse.status}`);
      return;
    }

    const liveChatId = videoBody?.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
    if (!liveChatId) {
      this.fail(generation, "ライブ配信中のチャットIDを取得できませんでした");
      return;
    }

    if (generation !== this.generation) return;
    this.liveChatId = liveChatId;
    this.onStatus(this.status());
    await this.poll(generation, apiKey);
  }

  /**
   * @param {number} generation
   * @param {string} message
   */
  fail(generation, message) {
    if (generation !== this.generation) return;
    this.error = message;
    this.running = false;
    this.onStatus(this.status());
  }

  /**
   * 停止されるまでチャットを読み続ける。
   * 最初の1ページは接続前の発言なので答えに使わず、次ページから渡す。
   * @param {number} generation
   * @param {string} apiKey
   */
  async poll(generation, apiKey) {
    let pageToken = null;
    let primed = false;

    while (generation === this.generation) {
      const url = new URL(CHAT_ENDPOINT);
      url.searchParams.set("part", "snippet,authorDetails");
      url.searchParams.set("liveChatId", this.liveChatId);
      url.searchParams.set("key", apiKey);
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      let body;
      let response;
      try {
        response = await this.fetchImpl(url);
        body = await response.json();
      } catch (error) {
        if (generation !== this.generation) return;
        this.error = error instanceof Error ? error.message : "チャットの取得に失敗しました";
        this.onStatus(this.status());
        await this.sleep(5000);
        continue;
      }

      if (generation !== this.generation) return;

      if (!response.ok) {
        this.error = body?.error?.message || `YouTube API ${response.status}`;
        this.onStatus(this.status());
        await this.sleep(body?.pollingIntervalMillis || 5000);
        continue;
      }

      this.error = "";
      if (primed) {
        for (const message of extractTextMessages(body)) {
          this.seen += 1;
          this.onMessage(message);
        }
      }
      primed = true;
      pageToken = body.nextPageToken || pageToken;
      this.onStatus(this.status());
      await this.sleep(body.pollingIntervalMillis || 5000);
    }
  }
}

/**
 * チャットコマンドとポケモン名回答をセッションへ振り分ける。
 * @param {ReturnType<import("./session.js").createSession>} session
 * @param {{ text: string, author: string, authorId: string, isOwner: boolean, isModerator: boolean }} message
 */
export function handleChatMessage(session, message) {
  const text = message.text.trim();
  if (!text) return { handled: false };

  if (text.startsWith("!")) {
    const command = text.slice(1).trim().split(/\s+/)[0]?.toLowerCase();
    if (!message.isOwner && !message.isModerator) {
      return { handled: true, ignored: true };
    }
    if (command === "new" || command === "reset") {
      session.startRound();
      return { handled: true, command: "new" };
    }
    if (command === "open" || command === "answer") {
      session.reveal();
      return { handled: true, command: "open" };
    }
    return { handled: true, ignored: true };
  }

  const result = session.guess(text, {
    author: message.author,
    authorId: message.authorId || message.author,
    privileged: message.isOwner || message.isModerator,
  });
  return { handled: result.ok || !result.silent, result };
}
