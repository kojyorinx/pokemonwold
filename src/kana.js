/**
 * チャット入力と図鑑名を同じ形にそろえる文字列処理。
 * ひらがな・全角英数・空白のゆれで判定が割れないようにする。
 */

/**
 * ひらがなをカタカナへ変換する。
 * @param {string} value
 * @returns {string}
 */
function hiraganaToKatakana(value) {
  return value.replace(/[\u3041-\u3096]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60),
  );
}

/**
 * ポケモン名の比較用に正規化する。
 * 空白は除き、全角英数は半角へ寄せる。記号のうち中黒だけは無視する。
 * @param {string} value
 * @returns {string}
 */
export function normalizePokemonName(value) {
  const folded = String(value ?? "").normalize("NFKC").trim();
  const katakana = hiraganaToKatakana(folded);
  // チャット末尾の句読点は名前の一部ではない
  return katakana.replace(/[\s・]/g, "").replace(/[!?.,。、]+$/g, "").toUpperCase();
}
