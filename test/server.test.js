import assert from "node:assert/strict";
import test from "node:test";
import { loadCatalog } from "../src/catalog.js";
import { createApp } from "../src/server.js";
import { createSession } from "../src/session.js";

/**
 * @param {import("node:http").Server} server
 * @param {string} method
 * @param {string} path
 * @param {{ token?: string, body?: object }} [options]
 */
async function request(server, method, pathname, options = {}) {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(options.token ? { "x-host-token": options.token } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  return { status: response.status, payload };
}

test("ホスト操作はトークンが必要で、プレイ中の正解は漏れない", async () => {
  const catalog = loadCatalog([
    { id: 25, name: "ピカチュウ" },
    { id: 4, name: "ヒトカゲ" },
  ]);
  const session = createSession({ catalog, random: () => 0 });
  const { server } = createApp({ hostToken: "secret-token", catalog, session });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const state = await request(server, "GET", "/api/state");
    assert.equal(state.status, 200);
    assert.equal(state.payload.answer, null);
    assert.equal(state.payload.length, 5);

    const denied = await request(server, "POST", "/api/guess", { body: { name: "ピカチュウ" } });
    assert.equal(denied.status, 401);

    const overlay = await request(server, "GET", "/overlay.html");
    assert.equal(overlay.status, 200);
    assert.match(overlay.payload, /ポケモンWordle/);

    const wrong = await request(server, "POST", "/api/guess", {
      token: "secret-token",
      body: { name: "ヒトカゲ" },
    });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.payload.code, "length");

    const won = await request(server, "POST", "/api/guess", {
      token: "secret-token",
      body: { name: "ぴかちゅう" },
    });
    assert.equal(won.status, 200);
    assert.equal(won.payload.phase, "won");
    assert.equal(won.payload.answer, "ピカチュウ");

    const escaped = await request(server, "GET", "/../package.json");
    assert.equal(escaped.status, 404);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("埋め込みファイルは登録された画面だけを返す", async () => {
  const catalog = loadCatalog([{ id: 25, name: "ピカチュウ" }]);
  const session = createSession({ catalog, random: () => 0 });
  const { server } = createApp({
    hostToken: "secret-token",
    catalog,
    session,
    files: {
      "/host.html": "<!DOCTYPE html><title>埋め込みホスト</title>",
      "/overlay.html": "<!DOCTYPE html><title>埋め込みオーバーレイ</title>",
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const host = await request(server, "GET", "/");
    const overlay = await request(server, "GET", "/overlay.html");
    const missing = await request(server, "GET", "/../package.json");
    assert.equal(host.status, 200);
    assert.match(host.payload, /埋め込みホスト/);
    assert.match(overlay.payload, /埋め込みオーバーレイ/);
    assert.equal(missing.status, 404);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("テストモードは配信なしで視聴者チャットを再現する", async () => {
  const catalog = loadCatalog([
    { id: 25, name: "ピカチュウ" },
    { id: 4, name: "ヒトカゲ" },
    { id: 26, name: "ライチュウ" },
  ]);
  const session = createSession({ catalog, random: () => 0 });
  const { server } = createApp({ hostToken: "secret-token", catalog, session });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const denied = await request(server, "POST", "/api/test/start");
    assert.equal(denied.status, 401);

    const started = await request(server, "POST", "/api/test/start", { token: "secret-token" });
    assert.equal(started.status, 200);
    assert.equal(started.payload.testMode.enabled, true);
    assert.equal(started.payload.length, 5);

    await request(server, "POST", "/api/test/stop", { token: "secret-token" });
    const blocked = await request(server, "POST", "/api/test/chat", {
      token: "secret-token",
      body: { author: "テスト視聴者", text: "ライチュウ" },
    });
    assert.equal(blocked.status, 400);

    await request(server, "POST", "/api/test/start", { token: "secret-token" });
    const wrongLength = await request(server, "POST", "/api/test/chat", {
      token: "secret-token",
      body: { author: "テスト視聴者", text: "ヒトカゲ" },
    });
    assert.equal(wrongLength.payload.rows.length, 0);
    assert.match(wrongLength.payload.notice, /文字数/);

    const ignored = await request(server, "POST", "/api/test/chat", {
      token: "secret-token",
      body: { author: "テスト視聴者", text: "こんにちは" },
    });
    assert.equal(ignored.payload.notice, "ポケモンの名前ではありません");
    assert.equal(ignored.payload.rows.length, 0);

    const guess = await request(server, "POST", "/api/test/chat", {
      token: "secret-token",
      body: { author: "テスト視聴者", text: "らいちゅう" },
    });
    assert.equal(guess.payload.rows.length, 1);
    assert.equal(guess.payload.phase, "playing");

    const second = await request(server, "POST", "/api/test/chat", {
      token: "secret-token",
      body: { author: "テスト視聴者", text: "ピカチュウ" },
    });
    assert.match(second.payload.notice, /1人1回/);

    const viewerOnly = await request(server, "POST", "/api/test/chat", {
      token: "secret-token",
      body: { author: "ただの視聴者", text: "!new" },
    });
    assert.equal(viewerOnly.payload.length, 5);

    const reset = await request(server, "POST", "/api/test/chat", {
      token: "secret-token",
      body: { author: "モデレーター", text: "!new", moderator: true },
    });
    assert.equal(reset.payload.length, 4);
    assert.equal(reset.payload.notice, "出題を切り替えました");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("全てリセットは盤面と履歴とテストモードを消す", async () => {
  const catalog = loadCatalog([
    { id: 25, name: "ピカチュウ" },
    { id: 26, name: "ライチュウ" },
  ]);
  const session = createSession({ catalog, random: () => 0 });
  const { server } = createApp({ hostToken: "secret-token", catalog, session });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const denied = await request(server, "POST", "/api/reset");
    assert.equal(denied.status, 401);

    await request(server, "POST", "/api/test/start", { token: "secret-token" });
    const guessed = await request(server, "POST", "/api/test/chat", {
      token: "secret-token",
      body: { author: "テスト視聴者", text: "ライチュウ" },
    });
    assert.equal(guessed.payload.rows.length, 1);

    const reset = await request(server, "POST", "/api/reset", { token: "secret-token" });
    assert.equal(reset.status, 200);
    assert.equal(reset.payload.rows.length, 0);
    assert.equal(reset.payload.phase, "playing");
    assert.equal(reset.payload.answer, null);
    assert.equal(reset.payload.testMode.enabled, false);
    assert.equal(reset.payload.log.length, 1);
    assert.match(reset.payload.log[0].text, /全てリセットしました/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
