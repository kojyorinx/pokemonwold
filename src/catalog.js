/**
 * 全国図鑑の日本語名を検索・抽選する。
 * データは PokeAPI の pokemon_species_names（言語 ja）から作った静的ファイル。
 */

import { readFileSync } from "node:fs";
import { normalizePokemonName } from "./kana.js";

/** チャットでよく略される表記を公式名の正規化形へ寄せる */
const ALIASES = new Map([
  ["ニドランメス", "ニドラン♀"],
  ["ニドランオス", "ニドラン♂"],
]);

/**
 * 図鑑エントリの配列から検索辞書を作る。
 * @param {{ id: number, name: string }[]} entries
 */
export function loadCatalog(entries) {
  /** @type {Map<string, { id: number, name: string, canonical: string }>} */
  const byKey = new Map();
  const list = [];

  for (const entry of entries) {
    const canonical = normalizePokemonName(entry.name);
    const item = { id: entry.id, name: entry.name, canonical };
    list.push(item);
    byKey.set(canonical, item);

    // 「タイプ:ヌル」を「タイプヌル」でも引けるようにする
    const compact = canonical.replace(/:/g, "");
    if (compact !== canonical && !byKey.has(compact)) {
      byKey.set(compact, item);
    }
  }

  return {
    list,

    /**
     * 入力文字列から図鑑エントリを探す。未知なら null。
     * @param {string} raw
     */
    find(raw) {
      const key = normalizePokemonName(raw);
      const aliased = ALIASES.get(key);
      return byKey.get(aliased ? normalizePokemonName(aliased) : key) ?? null;
    },

    /**
     * 直前の正解を避けて1匹選ぶ。
     * @param {() => number} random 0以上1未満
     * @param {number | null} avoidId
     */
    pick(random, avoidId) {
      if (list.length === 0) {
        throw new Error("図鑑が空です");
      }
      const index = Math.min(list.length - 1, Math.floor(random() * list.length));
      let choice = list[index];
      if (choice.id === avoidId && list.length > 1) {
        choice = list[(index + 1) % list.length];
      }
      return choice;
    },
  };
}

/**
 * data/pokemon-ja.json を読み込む。
 * @param {string} filePath
 */
export function loadCatalogFromFile(filePath) {
  const entries = JSON.parse(readFileSync(filePath, "utf8"));
  return loadCatalog(entries);
}
