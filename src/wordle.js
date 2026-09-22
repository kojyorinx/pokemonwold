/**
 * ポケモン名を1文字ずつ判定するWordleルール。
 * 緑は位置も文字も一致、黄は文字だけ一致、灰は名前に含まれない。
 */

/** 1ラウンドの最大回答数 */
export const MAX_GUESSES = 6;

/**
 * 重複文字を考慮してタイルの色を決める。
 * @param {string} guess 正規化済みの回答
 * @param {string} secret 正規化済みの正解
 * @returns {{ ch: string, state: "correct" | "present" | "absent" }[]}
 */
export function scoreGuess(guess, secret) {
  const guessChars = Array.from(guess);
  const secretChars = Array.from(secret);
  const tiles = guessChars.map((ch) => ({ ch, state: "absent" }));
  const leftover = new Map();

  // 先に完全一致を確定し、残った正解文字だけを黄色の在庫にする
  for (let i = 0; i < secretChars.length; i += 1) {
    if (guessChars[i] === secretChars[i]) {
      tiles[i].state = "correct";
    } else {
      leftover.set(secretChars[i], (leftover.get(secretChars[i]) ?? 0) + 1);
    }
  }

  for (let i = 0; i < guessChars.length; i += 1) {
    if (tiles[i].state === "correct") continue;
    const stock = leftover.get(guessChars[i]) ?? 0;
    if (stock > 0) {
      tiles[i].state = "present";
      leftover.set(guessChars[i], stock - 1);
    }
  }

  return tiles;
}

/**
 * 共有ボード1回分を作る。
 * @param {{ id: number, name: string, canonical: string }} entry
 * @param {number} [maxGuesses]
 */
export function createRound(entry, maxGuesses = MAX_GUESSES) {
  return {
    id: entry.id,
    displayName: entry.name,
    secret: entry.canonical,
    length: Array.from(entry.canonical).length,
    maxGuesses,
    guesses: [],
    /** 視聴者ごとの回答済みチャネルID */
    guessers: new Set(),
    /** すでに出た正規化名 */
    usedNames: new Set(),
    status: "playing",
  };
}

/**
 * ラウンドが続行中なら回答を1件追加する。
 * 呼び出し側で名前の存在と文字数は確認済みである前提。
 * @param {ReturnType<typeof createRound>} round
 * @param {{ canonical: string, author: string, authorId: string, privileged?: boolean }} attempt
 * @returns {{ ok: true, tiles: ReturnType<typeof scoreGuess>, won: boolean } | { ok: false, code: string, message: string }}
 */
export function applyGuess(round, attempt) {
  if (round.status !== "playing") {
    return { ok: false, code: "finished", message: "このラウンドは終わっています" };
  }

  if (round.usedNames.has(attempt.canonical)) {
    return { ok: false, code: "duplicate", message: "そのポケモンはもう回答されています" };
  }

  // 配信者・モデレーター以外は1ラウンド1回まで
  if (!attempt.privileged && attempt.authorId && round.guessers.has(attempt.authorId)) {
    return { ok: false, code: "once", message: "このラウンドの回答は1人1回までです" };
  }

  const tiles = scoreGuess(attempt.canonical, round.secret);
  round.guesses.push({
    canonical: attempt.canonical,
    tiles,
    author: attempt.author || "ゲスト",
    authorId: attempt.authorId || "",
  });
  round.usedNames.add(attempt.canonical);
  if (attempt.authorId) round.guessers.add(attempt.authorId);

  const won = tiles.every((tile) => tile.state === "correct");
  if (won) {
    round.status = "won";
  } else if (round.guesses.length >= round.maxGuesses) {
    round.status = "lost";
  }

  return { ok: true, tiles, won };
}
