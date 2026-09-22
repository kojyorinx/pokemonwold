"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { evaluateComment, adoptionRate } = require("../src/logic");
const { sanitizeSettings } = require("../src/settings");
const { parseVideoId, parseLiveItem } = require("../src/youtube");
const { KEYBOARDS } = require("../src/site-script");

const names = new Set(["ピカチュウ", "ミュウ", "フシギダネ"]);
const settings = sanitizeSettings({
  normalRate: 10,
  tiers: [
    { minAmount: 100, rate: 30 },
    { minAmount: 500, rate: 60 },
    { minAmount: 1000, rate: 80 },
    { minAmount: 2000, rate: 100 },
  ],
});

test("通常コメントの採用率は10%で、乱数が下回ったときだけ採用する", () => {
  const hit = evaluateComment({ text: "ピカチュウ", amount: null, settings, names, rng: () => 0.05 });
  assert.equal(hit.adopted, true);
  assert.equal(hit.rate, 10);
  const miss = evaluateComment({ text: " ピカチュウ ", amount: null, settings, names, rng: () => 0.1 });
  assert.equal(miss.adopted, false);
  assert.equal(miss.reason, "rate");
});

test("スパチャは達した段階のうち一番高い採用率を使う", () => {
  assert.equal(adoptionRate(50, settings), 10);
  assert.equal(adoptionRate(100, settings), 30);
  assert.equal(adoptionRate(500, settings), 60);
  assert.equal(adoptionRate(1500, settings), 80);
  assert.equal(adoptionRate(2000, settings), 100);
  const adopted = evaluateComment({ text: "ミュウ", amount: 2000, settings, names, rng: () => 0.9996 });
  assert.equal(adopted.adopted, true);
  assert.equal(adopted.rate, 100);
});

test("全角カタカナのポケモン名以外は採用しない", () => {
  assert.equal(evaluateComment({ text: "ぴかちゅう", settings, names }).reason, "not-katakana");
  assert.equal(evaluateComment({ text: "ピカチュウ！", settings, names }).reason, "not-katakana");
  assert.equal(evaluateComment({ text: "ｱｱｱｱｱ", settings, names }).reason, "not-katakana");
  assert.equal(evaluateComment({ text: "アアアアア", settings, names }).reason, "unknown");
  assert.equal(evaluateComment({ text: "   ", settings, names }).reason, "empty");
});

test("テストの強制採用でも名前の条件は外さない", () => {
  const forced = evaluateComment({ text: "フシギダネ", settings, names, force: true, rng: () => 0.99 });
  assert.equal(forced.adopted, true);
  assert.equal(forced.reason, "forced");
  const rejected = evaluateComment({ text: "こんにちは", settings, names, force: true });
  assert.equal(rejected.adopted, false);
  assert.equal(rejected.reason, "not-katakana");
});

test("ゲームモードは今日のお題かエンドレスだけを保存する", () => {
  assert.equal(sanitizeSettings({}).gameMode, "today");
  assert.equal(sanitizeSettings({ gameMode: "endless" }).gameMode, "endless");
  assert.equal(sanitizeSettings({ gameMode: "challenge" }).gameMode, "today");
});

test("設定の採用率は0から100に収まる", () => {
  const stored = sanitizeSettings({ normalRate: 140, tiers: [{ minAmount: 10, rate: -5 }, { minAmount: 0, rate: 50 }] });
  assert.equal(stored.normalRate, 100);
  assert.deepEqual(stored.tiers, [{ minAmount: 10, rate: 0 }]);
});

test("配信URLから動画IDを取り出す", () => {
  assert.equal(parseVideoId("abcdefghijk"), "abcdefghijk");
  assert.equal(parseVideoId("https://www.youtube.com/watch?v=abcdefghijk&feature=share"), "abcdefghijk");
  assert.equal(parseVideoId("https://youtu.be/abcdefghijk"), "abcdefghijk");
  assert.equal(parseVideoId("https://www.youtube.com/live/abcdefghijk"), "abcdefghijk");
  assert.equal(parseVideoId("https://example.com/"), "");
});

test("ライブ配信チャットの文字コメントとスパチャを分ける", () => {
  assert.deepEqual(
    parseLiveItem({
      id: "m1",
      authorDetails: { displayName: "視聴者" },
      snippet: { type: "textMessageEvent", textMessageDetails: { messageText: "ミュウ" } },
    }),
    { id: "m1", author: "視聴者", text: "ミュウ", amount: null, amountLabel: "" }
  );
  assert.deepEqual(
    parseLiveItem({
      id: "m2",
      authorDetails: { displayName: "支援者" },
      snippet: {
        type: "superChatEvent",
        superChatDetails: { userComment: "ピカチュウ", amountMicros: "500000000", amountDisplayString: "¥500" },
      },
    }),
    { id: "m2", author: "支援者", text: "ピカチュウ", amount: 500, amountLabel: "¥500" }
  );
  assert.equal(parseLiveItem({ id: "m3", snippet: { type: "superStickerEvent" } }), null);
});

test("本家サイトのキーボードで入力できる全角カタカナ名だけを辞書に持つ", () => {
  const file = path.join(__dirname, "..", "data", "pokemon-kata.json");
  const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
  const keys = new Set(
    [...KEYBOARDS.normal, ...KEYBOARDS.extra].flat().filter(Boolean)
  );
  assert.ok(catalog.includes("ピカチュウ"));
  assert.ok(catalog.includes("ミュウ"));
  assert.equal(catalog.includes("ニドラン♀"), false);
  assert.equal(catalog.includes("ポリゴン２"), false);
  for (const name of catalog) {
    assert.match(name, /^[\u30A1-\u30FA\u30FC]+$/);
    assert.ok(name.length <= 5);
    for (const ch of name) assert.ok(keys.has(ch), `${name} の ${ch}`);
  }
});

const os = require("os");
const { isNewClear, recordClear, loadRanking, resetRanking, rankingList, tokyoDate } = require("../src/ranking");

test("入力の前後で新しくクリアしたときだけ正解にする", () => {
  assert.equal(isNewClear({ cleared: false, clearCount: 0 }, { cleared: true, clearCount: 0 }), true);
  assert.equal(isNewClear({ cleared: false, clearCount: 0 }, { cleared: true, clearCount: 1 }), true);
  assert.equal(isNewClear({ cleared: true, clearCount: 1 }, { cleared: true, clearCount: 1 }), false);
  assert.equal(isNewClear({ cleared: true, clearCount: 1 }, { cleared: true, clearCount: 2 }), true);
  assert.equal(isNewClear({ cleared: false, clearCount: 0 }, { cleared: false, clearCount: 0 }), false);
});

test("今日の正解数は名前ごとに増え、多い順に並ぶ", () => {
  const file = path.join(os.tmpdir(), `pokemonwold-ranking-${Date.now()}.json`);
  const now = Date.parse("2026-09-22T12:00:00+09:00");
  const first = recordClear(file, { author: "視聴者B", name: "ミュウ", mode: "today" }, now);
  assert.equal(first.lastWinner.author, "視聴者B");
  assert.equal(first.lastWinner.count, 1);
  recordClear(file, { author: "視聴者A", name: "ピカチュウ", mode: "endless" }, now);
  const third = recordClear(file, { author: "視聴者A", name: "フシギダネ", mode: "endless" }, now);
  assert.deepEqual(
    third.ranking.map((row) => [row.rank, row.author, row.clears]),
    [
      [1, "視聴者A", 2],
      [2, "視聴者B", 1],
    ]
  );
  assert.equal(third.lastWinner.author, "視聴者A");
  assert.equal(third.lastWinner.count, 2);
  assert.equal(loadRanking(file, now).date, tokyoDate(now));
  const nextDay = resetRanking(file, Date.parse("2026-09-23T01:00:00+09:00"));
  assert.equal(nextDay.ranking.length, 0);
  assert.equal(nextDay.lastWinner, null);
  fs.unlinkSync(file);
});

test("日付が変わると今日の正解数は空からになる", () => {
  const file = path.join(os.tmpdir(), `pokemonwold-ranking-day-${Date.now()}.json`);
  const day1 = Date.parse("2026-09-22T23:00:00+09:00");
  recordClear(file, { author: "視聴者A", name: "ミュウ", mode: "today" }, day1);
  const day2 = Date.parse("2026-09-23T00:30:00+09:00");
  const loaded = loadRanking(file, day2);
  assert.equal(loaded.date, "2026-09-23");
  assert.deepEqual(loaded.scores, {});
  assert.deepEqual(rankingList({ 視聴者A: 3, 視聴者C: 3, 視聴者B: 1 }).map((row) => row.author), ["視聴者A", "視聴者C", "視聴者B"]);
  fs.unlinkSync(file);
});
