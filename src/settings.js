"use strict";

const fs = require("fs");
const path = require("path");

/** 初期の採用率。通常コメントは 10%。スパチャは金額が上がるほど高くなる。 */
const DEFAULT_SETTINGS = {
  apiKey: "",
  videoId: "",
  normalRate: 10,
  tiers: [
    { minAmount: 100, rate: 30 },
    { minAmount: 500, rate: 60 },
    { minAmount: 1000, rate: 80 },
    { minAmount: 2000, rate: 100 },
  ],
  ttsEnabled: true,
  logOther: false,
  gameMode: "today",
};

/**
 * 画面やファイルから来た設定を、保存して使える形に整える。
 */
function sanitizeSettings(input) {
  const src = input && typeof input === "object" ? input : {};
  const tiers = (Array.isArray(src.tiers) ? src.tiers : DEFAULT_SETTINGS.tiers)
    .map((tier) => ({
      minAmount: Number(tier && tier.minAmount),
      rate: clampStoredRate(tier && tier.rate),
    }))
    .filter((tier) => Number.isFinite(tier.minAmount) && tier.minAmount > 0 && tier.rate !== null);
  tiers.sort((a, b) => a.minAmount - b.minAmount);
  return {
    apiKey: String(src.apiKey || "").trim(),
    videoId: String(src.videoId || "").trim(),
    normalRate: clampStoredRate(src.normalRate, 10),
    tiers,
    ttsEnabled: src.ttsEnabled !== false,
    logOther: src.logOther === true,
    gameMode: src.gameMode === "endless" ? "endless" : "today",
  };
}

/** 採用率欄の値を 0〜100 にする。不正な値は fallback、fallback も無ければ null。 */
function clampStoredRate(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback === undefined ? null : fallback;
  }
  return Math.min(100, Math.max(0, n));
}

/**
 * 設定ファイルを読む。無い、または壊れているときは初期値を返す。
 */
function loadSettings(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return sanitizeSettings(DEFAULT_SETTINGS);
  }
}

/**
 * 設定を JSON で保存し、整えた結果を返す。
 */
function saveSettings(filePath, input) {
  const settings = sanitizeSettings(input);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), "utf8");
  return settings;
}

module.exports = {
  DEFAULT_SETTINGS,
  sanitizeSettings,
  loadSettings,
  saveSettings,
};
