/**
 * 配信者画面。トークンは sessionStorage にだけ残し、APIキーは状態表示へ返さない。
 */

const tokenInput = document.querySelector("#token");
const videoIdInput = document.querySelector("#video-id");
const apiKeyInput = document.querySelector("#api-key");
const guessInput = document.querySelector("#guess");
const errorBox = document.querySelector("#error");
const roundStatus = document.querySelector("#round-status");
const ytStatus = document.querySelector("#yt-status");
const log = document.querySelector("#log");
const testModeCard = document.querySelector("#test-mode");
const testNote = document.querySelector("#test-note");

tokenInput.value = sessionStorage.getItem("hostToken") || "";

const overlayUrl = document.querySelector("#overlay-url");
const copyOverlay = document.querySelector("#copy-overlay");
const previewOverlay = document.querySelector("#preview-overlay");

/**
 * アプリ内で起動したときはトークンを自動入力し、外部ブラウザは使わない。
 */
function setupDesktop() {
  if (!window.pokemonwold) {
    previewOverlay.hidden = true;
    overlayUrl.textContent = `${location.origin}/overlay.html`;
    copyOverlay.addEventListener("click", async () => {
      await navigator.clipboard.writeText(overlayUrl.textContent);
      copyOverlay.textContent = "コピーしました";
    });
    return Promise.resolve();
  }

  copyOverlay.addEventListener("click", async () => {
    await window.pokemonwold.copyOverlayUrl();
    copyOverlay.textContent = "コピーしました";
  });
  previewOverlay.addEventListener("click", () => {
    window.pokemonwold.previewOverlay();
  });

  return Promise.all([window.pokemonwold.hostToken(), window.pokemonwold.overlayUrl()]).then(([token, url]) => {
    tokenInput.value = token;
    sessionStorage.setItem("hostToken", token);
    overlayUrl.textContent = url;
  });
}

/**
 * @param {string} path
 * @param {object} [body]
 */
async function post(path, body) {
  const token = tokenInput.value.trim();
  sessionStorage.setItem("hostToken", token);
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-host-token": token,
    },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "操作に失敗しました");
  }
  return payload;
}

/**
 * @param {object} state
 */
function render(state) {
  const answer = state.answer ? `正解は ${state.answer}` : `${state.length}文字 / 残り ${state.maxGuesses - state.rows.length} 回`;
  roundStatus.textContent = `${state.phase} ・ ${answer}`;
  const yt = state.youtube;
  testModeCard.classList.toggle("active", Boolean(state.testMode?.enabled));
  if (state.testMode?.enabled) {
    ytStatus.textContent = "テストモード中。YouTube配信なしでチャットを再現しています";
  } else if (yt?.running) {
    ytStatus.textContent = `接続中 ${yt.videoId} / 新しい発言 ${yt.seen} 件`;
  } else if (yt) {
    ytStatus.textContent = yt.error || "チャット未接続";
  }
  log.replaceChildren();
  for (const event of state.log || []) {
    const item = document.createElement("li");
    item.textContent = event.text;
    log.append(item);
  }
}

async function refresh() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (response.ok) render(await response.json());
  } catch {
    ytStatus.textContent = "サーバーに接続できていません";
  }
}

function showError(error) {
  errorBox.textContent = error instanceof Error ? error.message : "操作に失敗しました";
}

document.querySelector("#connect").addEventListener("click", async () => {
  errorBox.textContent = "";
  try {
    render(await post("/api/youtube/start", {
      videoId: videoIdInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
    }));
    apiKeyInput.value = "";
  } catch (error) {
    showError(error);
  }
});

document.querySelector("#disconnect").addEventListener("click", async () => {
  errorBox.textContent = "";
  try {
    render(await post("/api/youtube/stop"));
  } catch (error) {
    showError(error);
  }
});

document.querySelector("#test-start").addEventListener("click", async () => {
  errorBox.textContent = "";
  try {
    render(await post("/api/test/start"));
    testNote.textContent = "視聴者名とチャットを入れて、配信中と同じルールで送れます。";
  } catch (error) {
    showError(error);
  }
});

document.querySelector("#test-stop").addEventListener("click", async () => {
  errorBox.textContent = "";
  try {
    render(await post("/api/test/stop"));
    testNote.textContent = "テストモードを終了しました。";
  } catch (error) {
    showError(error);
  }
});

document.querySelector("#chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.textContent = "";
  try {
    const state = await post("/api/test/chat", {
      author: document.querySelector("#chat-author").value,
      text: document.querySelector("#chat-text").value,
      moderator: document.querySelector("#chat-mod").checked,
    });
    render(state);
    testNote.textContent = state.notice || "";
    document.querySelector("#chat-text").value = "";
  } catch (error) {
    showError(error);
  }
});

document.querySelector("#guess-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.textContent = "";
  try {
    render(await post("/api/guess", { name: guessInput.value, author: "配信者" }));
    guessInput.value = "";
  } catch (error) {
    showError(error);
  }
});

document.querySelector("#new-round").addEventListener("click", async () => {
  errorBox.textContent = "";
  try {
    render(await post("/api/round"));
  } catch (error) {
    showError(error);
  }
});

document.querySelector("#reset-all").addEventListener("click", async () => {
  errorBox.textContent = "";
  guessInput.value = "";
  document.querySelector("#chat-text").value = "";
  document.querySelector("#chat-mod").checked = false;
  testNote.textContent = "開始すると、名前だけの発言が回答になります。";
  try {
    render(await post("/api/reset"));
  } catch (error) {
    showError(error);
  }
});

document.querySelector("#reveal").addEventListener("click", async () => {
  errorBox.textContent = "";
  try {
    render(await post("/api/reveal"));
  } catch (error) {
    showError(error);
  }
});

setupDesktop().then(() => {
  refresh();
  setInterval(refresh, 1000);
});
