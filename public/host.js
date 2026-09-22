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

tokenInput.value = sessionStorage.getItem("hostToken") || "";

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
  if (!yt) return;
  ytStatus.textContent = yt.running
    ? `接続中 ${yt.videoId} / 新しい発言 ${yt.seen} 件`
    : yt.error || "チャット未接続";
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

document.querySelector("#reveal").addEventListener("click", async () => {
  errorBox.textContent = "";
  try {
    render(await post("/api/reveal"));
  } catch (error) {
    showError(error);
  }
});

refresh();
setInterval(refresh, 1000);
