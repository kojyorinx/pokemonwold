import assert from "node:assert/strict";
import test from "node:test";
import { loadCatalog, loadCatalogFromFile } from "../src/catalog.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePokemonName } from "../src/kana.js";
import { createSession } from "../src/session.js";
import { applyGuess, createRound, scoreGuess } from "../src/wordle.js";

test("同梱図鑑は全国1025匹で、代表的な名前を引ける", () => {
  const filePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "pokemon-ja.json");
  const catalog = loadCatalogFromFile(filePath);
  assert.equal(catalog.list.length, 1025);
  assert.equal(catalog.find("フシギダネ")?.id, 1);
  assert.equal(catalog.find("モモワロウ")?.id, 1025);
  assert.equal(catalog.find("タイプヌル")?.name, "タイプ：ヌル");
});

test("ひらがなと末尾の句読点を公式名と同じ形にする", () => {
  assert.equal(normalizePokemonName(" ぴかちゅう！ "), "ピカチュウ");
  assert.equal(normalizePokemonName("ポリゴン２"), "ポリゴン2");
  assert.equal(normalizePokemonName("タイプ：ヌル"), "タイプ:ヌル");
});

test("同じ文字の在庫を超えた分は灰色にする", () => {
  const tiles = scoreGuess("AAAC", "AABC");
  assert.deepEqual(
    tiles.map((tile) => tile.state),
    ["correct", "correct", "absent", "correct"],
  );
});

test("図鑑の別名と文字数違いをラウンドが区別する", () => {
  const catalog = loadCatalog([
    { id: 25, name: "ピカチュウ" },
    { id: 29, name: "ニドラン♀" },
    { id: 4, name: "ヒトカゲ" },
  ]);
  assert.equal(catalog.find("ニドランメス")?.id, 29);
  assert.equal(catalog.find("タイプヌル"), null);

  const session = createSession({
    catalog,
    random: () => 0,
  });
  assert.equal(session.publicState().answer, null);
  assert.equal(session.publicState().length, 5);

  const wrongLength = session.guess("ヒトカゲ", { author: "視聴者A", authorId: "a" });
  assert.equal(wrongLength.code, "length");

  const first = session.guess("ヒトカゲ", { author: "視聴者A", authorId: "a" });
  assert.equal(first.code, "length");

  const miss = session.guess("ライチュウ", { author: "視聴者A", authorId: "a" });
  assert.equal(miss.code, "unknown");

  const wrong = session.guess("ピカチュウ", { author: "視聴者A", authorId: "a" });
  assert.equal(wrong.ok, true);
  assert.equal(session.publicState().phase, "won");
  assert.equal(session.publicState().answer, "ピカチュウ");
});

test("視聴者は1ラウンドに1回までで、配信者は続けて回答できる", () => {
  const catalog = loadCatalog([
    { id: 25, name: "ピカチュウ" },
    { id: 26, name: "ライチュウ" },
  ]);
  const session = createSession({ catalog, random: () => 0 });
  const viewer = { author: "視聴者", authorId: "viewer" };
  assert.equal(session.guess("ライチュウ", viewer).ok, true);
  const second = session.guess("ピカチュウ", viewer);
  assert.equal(second.code, "once");

  const host = session.guess("ピカチュウ", { author: "配信者", authorId: "host", privileged: true });
  assert.equal(host.ok, true);
  assert.equal(session.publicState().phase, "won");
});

test("6回外すと正解を公開する", () => {
  const names = ["ピカチュウ", "ライチュウ", "カイリュー", "ガルーラ", "サンダース", "ブースター", "シャワーズ"];
  const catalog = loadCatalog(names.map((name, index) => ({ id: index + 1, name })));
  const round = createRound(catalog.find("ピカチュウ"), 6);
  for (const name of names.slice(1)) {
    const applied = applyGuess(round, {
      canonical: catalog.find(name).canonical,
      author: name,
      authorId: name,
    });
    assert.equal(applied.ok, true);
  }
  assert.equal(round.status, "lost");
});
