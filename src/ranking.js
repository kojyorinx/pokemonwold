"use strict";

const fs = require("fs");
const path = require("path");

/**
 * 日本時間の日付（YYYY-MM-DD）を返す。
 * 今日の正解数は、この日付が変わったときに空から数え直す。
 */
function tokyoDate(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

/** その日のランキングの初期状態。 */
function emptyState(date = tokyoDate()) {
  return { date, scores: {}, lastWinner: null };
}

/**
 * 入力の前後で、新しくクリアしたかを判定する。
 * 今日のお題は cleared が立つ。エンドレスは clearCount も増える。
 */
function isNewClear(before, after) {
  if (!after || after.cleared !== true) return false;
  const prevCount = Number(before && before.clearCount) || 0;
  const nextCount = Number(after.clearCount) || 0;
  if (nextCount > prevCount) return true;
  return after.cleared === true && !(before && before.cleared);
}

/**
 * 正解数の多い順に並べ、同数なら名前順にする。
 */
function rankingList(scores) {
  return Object.entries(scores || {})
    .map(([author, clears]) => ({ author, clears: Number(clears) || 0 }))
    .filter((row) => row.clears > 0)
    .sort((a, b) => b.clears - a.clears || a.author.localeCompare(b.author, "ja"))
    .map((row, index) => ({ rank: index + 1, author: row.author, clears: row.clears }));
}

/** 画面へ渡す形に整える。 */
function rankingView(state) {
  return {
    date: state.date,
    lastWinner: state.lastWinner,
    ranking: rankingList(state.scores),
  };
}

/**
 * 保存済みのランキングを読む。日付が今日でなければ空にする。
 */
function loadRanking(filePath, now = Date.now()) {
  const today = tokyoDate(now);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!data || data.date !== today) return emptyState(today);
    const scores = data.scores && typeof data.scores === "object" ? data.scores : {};
    const cleaned = {};
    for (const [author, clears] of Object.entries(scores)) {
      const n = Number(clears);
      if (author && Number.isFinite(n) && n > 0) cleaned[author] = n;
    }
    return {
      date: today,
      scores: cleaned,
      lastWinner: data.lastWinner && data.lastWinner.author ? data.lastWinner : null,
    };
  } catch {
    return emptyState(today);
  }
}

function writeRanking(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
}

/**
 * クリアした人の正解数を1増やし、最終コメントとして記録する。
 */
function recordClear(filePath, { author, name, mode }, now = Date.now()) {
  const state = loadRanking(filePath, now);
  const who = String(author || "名無し").trim() || "名無し";
  state.scores[who] = (Number(state.scores[who]) || 0) + 1;
  state.lastWinner = {
    author: who,
    name: String(name || ""),
    mode: mode === "endless" ? "endless" : "today",
    time: new Date(now).toISOString(),
    count: state.scores[who],
  };
  writeRanking(filePath, state);
  return rankingView(state);
}

/** 今日の正解数を空に戻す。 */
function resetRanking(filePath, now = Date.now()) {
  const state = emptyState(tokyoDate(now));
  writeRanking(filePath, state);
  return rankingView(state);
}

module.exports = {
  tokyoDate,
  emptyState,
  isNewClear,
  rankingList,
  rankingView,
  loadRanking,
  recordClear,
  resetRanking,
};
