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

  const shown = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  // 今日のお題とエンドレスは同時に存在する。見えているモードだけを操作する。
  const keyboardRoot = () => [...document.querySelectorAll(".keyboard")].find(shown);

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

  // 見えている盤面だけを見る。隠れたモードの文字は混ぜない。
  const postedText = () => {
    const board = [...document.querySelectorAll(".words")].find(shown);
    if (!board) return "";
    return [...board.querySelectorAll(".char--posted")].map((el) => compact(el.textContent)).join("");
  };

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

    // 色が付くアニメーションのあと、盤面の末尾にその名前が載るまで待つ
    const deadline = Date.now() + 15000;
    let gained = "";
    while (Date.now() < deadline) {
      const after = postedText();
      gained = after.startsWith(before) ? after.slice(before.length) : "";
      if (gained === name) {
        await sleep(500);
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
  const shown = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const root = [...document.querySelectorAll(".keyboard")].find(shown);
  if (!root) return false;
  return [...root.querySelectorAll("button")].some((button) => String(button.innerText || "").replace(/\s+/g, "") === "ENTER");
}

/**
 * 本家サイトの「今日のお題」または「エンドレス」を表示する。
 * エンドレスが START 待ちのときは needsStart を返す。
 */
async function selectGameMode(mode) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const compact = (value) => String(value || "").replace(/\s+/g, "");
  const wanted = mode === "endless" ? "endless" : "today";
  const label = wanted === "endless" ? "エンドレス" : "今日のお題";

  const findOwner = () => {
    const root = document.querySelector("#app") && document.querySelector("#app").__vue__;
    const stack = root ? [root] : [];
    const seen = new Set();
    while (stack.length) {
      const vm = stack.pop();
      if (!vm || seen.has(vm)) continue;
      seen.add(vm);
      if (vm.$data && Object.prototype.hasOwnProperty.call(vm.$data, "tab")) return vm;
      stack.push(...(vm.$children || []));
    }
    return null;
  };

  try {
    const owner = findOwner();
    if (owner) {
      owner.tab = wanted;
    } else {
      const tab = [...document.querySelectorAll(".v-tab")].find((el) => compact(el.textContent) === label);
      if (!tab) return { ok: false, reason: "no-tab" };
      tab.click();
    }

    let active = "";
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      active = compact((document.querySelector(".v-tab--active") || {}).textContent);
      if (active === label) break;
      await sleep(50);
    }
    if (active !== label) return { ok: false, reason: "not-switched", detail: active };
    await sleep(200);

    const shown = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const findStartButton = () =>
      [...document.querySelectorAll("button")].find((button) => shown(button) && compact(button.innerText) === "ゲーム開始");
    const startDialogOpen = () =>
      [...document.querySelectorAll(".v-dialog__content--active")].some((dialog) => compact(dialog.innerText).includes("START"));

    // プレイ前のエンドレスは「ゲーム開始」から出題設定を開く。
    if (wanted === "endless") {
      const begin = findStartButton();
      if (begin) begin.click();
      await sleep(400);
    }
    const needsStart = wanted === "endless" && (startDialogOpen() || !!findStartButton());
    return { ok: true, mode: wanted, label, needsStart };
  } catch (error) {
    return { ok: false, reason: "exception", detail: String((error && error.message) || error) };
  }
}

/**
 * 見えているモードのクリア状態を、本家サイトの Vue データから読む。
 */
function inspectGameState() {
  const shown = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const board = [...document.querySelectorAll(".words")].find(shown);
  const root = document.querySelector("#app") && document.querySelector("#app").__vue__;
  const stack = root ? [root] : [];
  const seen = new Set();
  let vm = null;
  while (stack.length) {
    const node = stack.pop();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node.postedPokemon) && typeof node.cleared === "boolean") {
      if (board && node.$el && node.$el.contains(board)) {
        vm = node;
        break;
      }
      if (!vm) vm = node;
    }
    stack.push(...(node.$children || []));
  }
  if (!vm) {
    return { ready: false, cleared: false, failed: false, clearCount: 0, lastName: "", lastAllGreen: false };
  }
  const last = (vm.postedPokemon && vm.postedPokemon[vm.postedPokemon.length - 1]) || [];
  const lastName = last.map((cell) => (cell && cell.char) || "").join("");
  const lastAllGreen = last.length === 5 && last.every((cell) => cell && (cell.color === "green" || cell.color === "orange darken-3"));
  return {
    ready: true,
    cleared: vm.cleared === true || lastAllGreen,
    failed: vm.failed === true,
    clearCount: Number(vm.clearCount) || 0,
    lastName,
    lastAllGreen,
  };
}

module.exports = {
  KEYBOARDS,
  typePokemonName,
  siteReady,
  selectGameMode,
  inspectGameState,
};
