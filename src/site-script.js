"use strict";

/**
 * 本家サイトのキーボード配列。
 * normal は「通常」、extra は「゛゜小」。
 * ページ内で実行する関数へ、このまま渡す。
 */
const KEYBOARDS = {
  normal: [
    ["ア", "カ", "サ", "タ", "ナ", "ハ", "マ", "ヤ", "ラ", "ワ"],
    ["イ", "キ", "シ", "チ", "ニ", "ヒ", "ミ", "", "リ", ""],
    ["ウ", "ク", "ス", "ツ", "ヌ", "フ", "ム", "ユ", "ル", "ン"],
    ["エ", "ケ", "セ", "テ", "ネ", "ヘ", "メ", "", "レ", ""],
    ["オ", "コ", "ソ", "ト", "ノ", "ホ", "モ", "ヨ", "ロ", "ー"],
  ],
  extra: [
    ["ァ", "ガ", "ザ", "ダ", "", "バ", "パ", "ャ", "", "♀"],
    ["ィ", "ギ", "ジ", "ヂ", "", "ビ", "ピ", "", "", "♂"],
    ["ゥ", "グ", "ズ", "ヅ", "ッ", "ブ", "プ", "ュ", "ヴ", ""],
    ["ェ", "ゲ", "ゼ", "デ", "", "ベ", "ペ", "", "", "２"],
    ["ォ", "ゴ", "ゾ", "ド", "", "ボ", "ポ", "ョ", "", "Ｚ"],
  ],
};

/**
 * 本家サイトの画面内でポケモン名を1件入力する。
 * Electron の executeJavaScript から呼ばれるため、外の変数は参照しない。
 */
async function typePokemonName(name, boards) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const compact = (value) => String(value || "").replace(/\s+/g, "");

  const keyboardRoot = () => document.querySelector(".keyboard");

  const visibleButtons = () => {
    const root = keyboardRoot();
    if (!root) return [];
    return [...root.querySelectorAll("button")].filter((button) => {
      const style = window.getComputedStyle(button);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  };

  const findKey = (ch) => visibleButtons().find((button) => button.querySelector(".char") && compact(button.innerText) === ch);

  const findToggle = (label) => visibleButtons().find((button) => compact(button.innerText) === label);

  const findEnter = () => visibleButtons().find((button) => compact(button.innerText) === "ENTER");

  const findBackspace = () => visibleButtons().find((button) => button.querySelector(".mdi-backspace-outline"));

  const postedText = () =>
    [...document.querySelectorAll(".char--posted")]
      .filter((el) => !el.closest(".keyboard"))
      .map((el) => compact(el.textContent))
      .join("");

  const layoutOf = (ch) => {
    const has = (rows) => (rows || []).some((row) => row.includes(ch));
    if (has(boards && boards.normal)) return "normal";
    if (has(boards && boards.extra)) return "extra";
    return "";
  };

  const undo = async (count) => {
    for (let i = 0; i < count; i += 1) {
      const backspace = findBackspace();
      if (!backspace) break;
      backspace.click();
      await sleep(30);
    }
  };

  try {
    const chars = [...String(name || "")];
    if (!chars.length) return { ok: false, reason: "empty" };
    if (!keyboardRoot() || !findEnter()) return { ok: false, reason: "not-ready" };

    const before = postedText();
    keyboardRoot().scrollIntoView({ block: "center" });
    const typed = [];

    for (const ch of chars) {
      const layout = layoutOf(ch);
      if (!layout) {
        await undo(typed.length);
        return { ok: false, reason: "missing-key", detail: ch };
      }
      let key = findKey(ch);
      if (!key) {
        const toggle = findToggle(layout === "normal" ? "通常" : "゛゜小");
        if (toggle) toggle.click();
        for (let i = 0; i < 30 && !key; i += 1) {
          await sleep(50);
          key = findKey(ch);
        }
      }
      if (!key) {
        await undo(typed.length);
        return { ok: false, reason: "missing-key", detail: ch };
      }
      key.scrollIntoView({ block: "center", inline: "center" });
      key.click();
      typed.push(ch);
      await sleep(40);
    }

    const enter = findEnter();
    if (!enter) {
      await undo(typed.length);
      return { ok: false, reason: "no-enter" };
    }
    enter.scrollIntoView({ block: "center" });
    enter.click();

    // 文字ごとの色アニメーションが終わってから、盤面に名前が載ったか確認する
    await sleep(chars.length * 300 + 400);
    let gained = "";
    for (let i = 0; i < 25; i += 1) {
      const after = postedText();
      gained = after.startsWith(before) ? after.slice(before.length) : "";
      if (gained === name) {
        await sleep(600);
        return { ok: true };
      }
      await sleep(200);
    }
    await undo(chars.length);
    return { ok: false, reason: "not-accepted", detail: gained };
  } catch (error) {
    return { ok: false, reason: "exception", detail: String((error && error.message) || error) };
  }
}

/**
 * 本家サイトのキーボードが操作できる状態かをページ内で確認する。
 */
function siteReady() {
  const root = document.querySelector(".keyboard");
  if (!root) return false;
  return [...root.querySelectorAll("button")].some((button) => String(button.innerText || "").replace(/\s+/g, "") === "ENTER");
}

module.exports = {
  KEYBOARDS,
  typePokemonName,
  siteReady,
};
