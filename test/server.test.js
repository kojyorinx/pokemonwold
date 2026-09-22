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
