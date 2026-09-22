"use strict";

/** 全角カタカナ（長音「ー」を含む）だけかを判定する正規表現 */
const KATAKANA_ONLY = /^[\u30A1-\u30FA\u30FC]+$/;

/**
 * 採用率を 0 から 100 の範囲に収める。
 * 数値でないときは fallback を返す。
 */
function clampRate(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, n));
}

/**
 * 通常コメント、またはスパチャ金額に対応する採用率（%）を返す。
 * 金額以上の段階のうち、もっとも高い最低金額の採用率を使う。
 * 該当する段階がなければ通常コメントの採用率になる。
 */
function adoptionRate(amount, settings) {
  const normal = clampRate(settings && settings.normalRate, 10);
  const yen = Number(amount);
  if (!Number.isFinite(yen) || yen <= 0) return normal;
  const tiers = Array.isArray(settings && settings.tiers) ? settings.tiers : [];
  const matched = tiers
    .filter((tier) => Number(tier.minAmount) > 0 && Number(tier.minAmount) <= yen)
    .sort((a, b) => Number(b.minAmount) - Number(a.minAmount));
  if (!matched.length) return normal;
  return clampRate(matched[0].rate, normal);
}

/**
 * コメントを採用してよいか判定する。
 * 全角カタカナのみ、かつポケモン名のときだけ抽選する。
 * force が真のときは抽選を通さず、名前の条件を満たせば採用する（テスト用）。
 */
function evaluateComment({ text, amount, settings, names, force = false, rng = Math.random }) {
  const name = String(text ?? "").trim();
  if (!name) {
    return { adopted: false, reason: "empty", name: null, rate: null, roll: null, message: "コメントが空です" };
  }
  if (!KATAKANA_ONLY.test(name)) {
    return {
      adopted: false,
      reason: "not-katakana",
      name: null,
      rate: null,
      roll: null,
      message: "全角カタカナだけを受け付けます",
    };
  }
  if (!names.has(name)) {
    return {
      adopted: false,
      reason: "unknown",
      name,
      rate: null,
      roll: null,
      message: "ポケモンの名前ではありません",
    };
  }
  const rate = adoptionRate(amount, settings);
  if (force) {
    return {
      adopted: true,
      reason: "forced",
      name,
      rate,
      roll: null,
      message: "テストのため採用率を通さず採用しました",
    };
  }
  // 100% のときも取りこぼさないよう、表示用の丸めとは別に生の乱数で比べる
  const raw = rng() * 100;
  const roll = Math.round(raw * 10) / 10;
  if (raw < rate) {
    return {
      adopted: true,
      reason: "adopted",
      name,
      rate,
      roll,
      message: `採用しました（採用率${rate}%、乱数${roll}）`,
    };
  }
  return {
    adopted: false,
    reason: "rate",
    name,
    rate,
    roll,
    message: `採用率${rate}%の判定で見送りました（乱数${roll}）`,
  };
}

module.exports = {
  KATAKANA_ONLY,
  clampRate,
  adoptionRate,
  evaluateComment,
};
