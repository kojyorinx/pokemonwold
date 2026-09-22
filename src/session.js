/**
 * 配信全体で共有するポケモンWordleの進行。
 * YouTubeチャットとホスト画面の両方が同じラウンドを更新する。
 */

import { applyGuess, createRound, MAX_GUESSES } from "./wordle.js";

/**
 * @param {{ catalog: ReturnType<import("./catalog.js").loadCatalog>, random?: () => number, now?: () => number, maxGuesses?: number }} options
 */
export function createSession(options) {
  const random = options.random ?? Math.random;
  const now = options.now ?? (() => Date.now());
  const maxGuesses = options.maxGuesses ?? MAX_GUESSES;
  const log = [];
  let round = null;
  let lastEvent = null;

  /**
   * オーバーレイに出す短い出来事を残す。
   * @param {{ type: string, text: string }} event
   */
  function pushEvent(event) {
    lastEvent = { ...event, at: now() };
    log.push(lastEvent);
    if (log.length > 40) log.shift();
  }

  function startRound() {
    const entry = options.catalog.pick(random, round?.id ?? null);
    round = createRound(entry, maxGuesses);
    pushEvent({
      type: "new",
      text: `${round.length}文字のポケモンです。チャットに名前だけ送ってください`,
    });
    return publicState();
  }

  /**
   * 回答・履歴・表示中の正解を消し、新しい出題から始める。
   */
  function resetAll() {
    log.length = 0;
    lastEvent = null;
    const entry = options.catalog.pick(random, round?.id ?? null);
    round = createRound(entry, maxGuesses);
    pushEvent({
      type: "reset",
      text: `全てリセットしました。${round.length}文字のポケモンです`,
    });
    return publicState();
  }

  /**
   * 回答を処理する。図鑑に無い発言は配信チャットを汚さないよう silent にする。
   * @param {string} rawName
   * @param {{ author?: string, authorId?: string, privileged?: boolean }} actor
   */
  function guess(rawName, actor = {}) {
    const name = String(rawName ?? "").trim();
    if (!name) {
      return failure("empty", "名前を入力してください", false);
    }

    const entry = options.catalog.find(name);
    if (!entry) {
      return failure("unknown", "ポケモンの名前ではありません", true);
    }

    if (Array.from(entry.canonical).length !== round.length) {
      const message = `文字数が違います（このラウンドは${round.length}文字）`;
      pushEvent({ type: "length", text: `${actor.author || "ゲスト"}: ${message}` });
      return failure("length", message, false);
    }

    const applied = applyGuess(round, {
      canonical: entry.canonical,
      author: actor.author || "ゲスト",
      authorId: actor.authorId || "",
      privileged: Boolean(actor.privileged),
    });

    if (!applied.ok) {
      pushEvent({ type: applied.code, text: `${actor.author || "ゲスト"}: ${applied.message}` });
      return { ok: false, code: applied.code, message: applied.message, silent: false, state: publicState() };
    }

    if (applied.won) {
      pushEvent({ type: "won", text: `${actor.author || "ゲスト"} が正解！ ${round.displayName}` });
    } else if (round.status === "lost") {
      pushEvent({ type: "lost", text: `残念。正解は ${round.displayName} でした` });
    } else {
      pushEvent({ type: "guess", text: `${actor.author || "ゲスト"} が ${entry.name} と回答` });
    }

    return { ok: true, state: publicState() };
  }

  /**
   * @param {string} code
   * @param {string} message
   * @param {boolean} silent
   */
  function failure(code, message, silent) {
    return { ok: false, code, message, silent, state: publicState() };
  }

  /** 正解を公開してラウンドを終える */
  function reveal() {
    if (round.status === "playing") {
      round.status = "lost";
      pushEvent({ type: "reveal", text: `正解は ${round.displayName} でした` });
    }
    return publicState();
  }

  /** 視聴者向けに正解を隠した状態 */
  function publicState() {
    const finished = round.status !== "playing";
    return {
      phase: round.status,
      length: round.length,
      maxGuesses: round.maxGuesses,
      rows: round.guesses.map((guess) => ({
        author: guess.author,
        tiles: guess.tiles,
      })),
      answer: finished ? round.displayName : null,
      dexId: finished ? round.id : null,
      lastEvent,
      log: log.slice(-12),
    };
  }

  startRound();

  return { startRound, resetAll, guess, reveal, publicState };
}
