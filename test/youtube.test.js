import assert from "node:assert/strict";
import test from "node:test";
import { loadCatalog } from "../src/catalog.js";
import { createSession } from "../src/session.js";
import { extractTextMessages, handleChatMessage, YoutubeLiveChat } from "../src/youtube.js";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function textItem(id, message, author = {}) {
  return {
    id,
    snippet: {
      type: "textMessageEvent",
      textMessageDetails: { messageText: message },
    },
    authorDetails: {
      displayName: author.displayName || "視聴者",
      channelId: author.channelId || id,
      isChatOwner: Boolean(author.isChatOwner),
      isChatModerator: Boolean(author.isChatModerator),
    },
  };
}

test("スーパーチャットなどは無視し、通常発言だけ残す", () => {
  const messages = extractTextMessages({
    items: [
      textItem("1", "ピカチュウ"),
      { id: "2", snippet: { type: "superChatEvent", displayMessage: "スパチャ" } },
    ],
  });
  assert.deepEqual(messages.map((message) => message.text), ["ピカチュウ"]);
});

test("接続前のチャットは回答にせず、その後の名前だけを渡す", async () => {
  let calls = 0;
  const received = [];
  const chat = new YoutubeLiveChat({
    async fetchImpl(url) {
      const href = String(url);
      if (href.includes("/videos")) {
        return jsonResponse({
          items: [{ liveStreamingDetails: { activeLiveChatId: "live-chat" } }],
        });
      }
      calls += 1;
      if (calls === 1) {
        return jsonResponse({
          items: [textItem("old", "フシギダネ")],
          nextPageToken: "next",
          pollingIntervalMillis: 1,
        });
      }
      return jsonResponse({
        items: [textItem("new", "ヒトカゲ")],
        nextPageToken: "later",
        pollingIntervalMillis: 1,
      });
    },
    async sleep() {
      if (calls >= 2) chat.stop();
    },
    onMessage(message) {
      received.push(message.text);
    },
  });

  await chat.start({ apiKey: "test-key", videoId: "video1234" });
  assert.deepEqual(received, ["ヒトカゲ"]);
  assert.equal(chat.status().running, false);
});

test("モデレーターの !new だけが次の問題へ進める", () => {
  const catalog = loadCatalog([
    { id: 25, name: "ピカチュウ" },
    { id: 4, name: "ヒトカゲ" },
  ]);
  let index = 0;
  const session = createSession({
    catalog,
    random: () => index++,
  });
  assert.equal(session.publicState().length, 5);

  handleChatMessage(session, {
    text: "!new",
    author: "視聴者",
    authorId: "v",
    isOwner: false,
    isModerator: false,
  });
  assert.equal(session.publicState().length, 5);

  handleChatMessage(session, {
    text: "!new",
    author: "モデレーター",
    authorId: "mod",
    isOwner: false,
    isModerator: true,
  });
  assert.equal(session.publicState().length, 4);

  handleChatMessage(session, {
    text: "ぴかちゅう",
    author: "視聴者",
    authorId: "v",
    isOwner: false,
    isModerator: false,
  });
  assert.equal(session.publicState().phase, "playing");
  assert.equal(session.publicState().rows.length, 0);
});
