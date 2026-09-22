"use strict";

const tiersEl = document.getElementById("tiers");
const logEl = document.getElementById("log");
const speakingEl = document.getElementById("speaking");

/**
 * 保存済みの設定を入力欄へ戻す。
 */
function fillSettings(settings) {
  document.getElementById("apiKey").value = settings.apiKey || "";
  document.getElementById("videoId").value = settings.videoId || "";
  document.getElementById("normalRate").value = settings.normalRate;
  document.getElementById("ttsEnabled").checked = settings.ttsEnabled !== false;
  document.getElementById("logOther").checked = settings.logOther === true;
  tiersEl.innerHTML = "";
  (settings.tiers || []).forEach((tier) => addTierRow(tier.minAmount, tier.rate));
}

/**
 * スパチャ金額と採用率の入力行を足す。
 */
function addTierRow(minAmount, rate) {
  const row = document.createElement("div");
  row.className = "tier";
  row.innerHTML = `
    <label>最低金額<input class="tier-amount" type="number" min="1" step="1" value="${Number(minAmount) || 100}" /></label>
    <label>採用率（%）<input class="tier-rate" type="number" min="0" max="100" step="1" value="${Number(rate) || 0}" /></label>
    <button type="button" class="secondary remove-tier">削除</button>
  `;
  row.querySelector(".remove-tier").addEventListener("click", () => row.remove());
  tiersEl.appendChild(row);
}

/**
 * 画面の入力内容を設定オブジェクトにする。
 */
function collectSettings() {
  const tiers = [...document.querySelectorAll(".tier")].map((row) => ({
    minAmount: Number(row.querySelector(".tier-amount").value),
    rate: Number(row.querySelector(".tier-rate").value),
  }));
  return {
    apiKey: document.getElementById("apiKey").value.trim(),
    videoId: document.getElementById("videoId").value.trim(),
    normalRate: Number(document.getElementById("normalRate").value),
    tiers,
    ttsEnabled: document.getElementById("ttsEnabled").checked,
    logOther: document.getElementById("logOther").checked,
  };
}

/**
 * 接続状態の表示を更新する。
 */
function renderStatus(status, stats) {
  const youtubeBadge = document.getElementById("youtubeBadge");
  const siteBadge = document.getElementById("siteBadge");
  youtubeBadge.className = `badge ${status.youtube || "idle"}`;
  siteBadge.className = `badge ${status.site || "loading"}`;
  youtubeBadge.textContent = status.youtube === "live" ? "配信チャット接続中" : status.youtube === "connecting" ? "接続しています" : status.youtube === "error" ? "配信チャットエラー" : "配信チャット未接続";
  siteBadge.textContent = status.site === "ready" ? "本家サイト操作可" : status.site === "error" ? "本家サイトエラー" : "本家サイト読込中";
  document.getElementById("youtubeDetail").textContent = status.youtubeDetail || "";
  document.getElementById("siteDetail").textContent = status.siteDetail || "";
  document.getElementById("busyLine").textContent = status.busy ? `本家サイトへ入力中: ${status.busyName}` : "";
  const received = stats ? stats.received : 0;
  const adopted = stats ? stats.adopted : 0;
  document.getElementById("statsLine").textContent = `受け取ったコメント ${received} 件 / 採用 ${adopted} 件`;
}

/**
 * ログを1行追加し、一番下が見えるようにする。
 */
function appendLog(row) {
  const item = document.createElement("li");
  item.className = row.level || "info";
  const time = document.createElement("time");
  time.dateTime = row.time;
  time.textContent = new Date(row.time).toLocaleTimeString("ja-JP");
  item.appendChild(time);
  item.append(row.message);
  logEl.appendChild(item);
  logEl.scrollTop = logEl.scrollHeight;
}

/**
 * 採用コメントを日本語音声で読む。
 * Windows ではメイン側の音声合成を使い、それ以外はここの音声合成を使う。
 */
function speak(payload) {
  const text = typeof payload === "string" ? payload : payload.text;
  speakingEl.hidden = false;
  speakingEl.textContent = `読み上げ中: ${text}`;
  window.clearTimeout(speak.hideTimer);
  speak.hideTimer = window.setTimeout(() => {
    speakingEl.hidden = true;
  }, 4000);
  const audible = typeof payload === "string" ? true : payload.audible !== false;
  if (!audible || !window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  const voice = speechSynthesis.getVoices().find((item) => item.lang && item.lang.toLowerCase().startsWith("ja"));
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}

document.getElementById("addTier").addEventListener("click", () => addTierRow(100, 30));

document.getElementById("settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await window.host.saveSettings(collectSettings());
});

document.getElementById("connectButton").addEventListener("click", () => {
  window.host.connect(collectSettings());
});

document.getElementById("disconnectButton").addEventListener("click", () => {
  window.host.disconnect();
});

document.getElementById("testSend").addEventListener("click", () => {
  const amountValue = document.getElementById("testAmount").value;
  window.host.testChat({
    settings: collectSettings(),
    author: document.getElementById("testAuthor").value,
    text: document.getElementById("testText").value,
    amount: amountValue === "" ? null : Number(amountValue),
    force: document.getElementById("testForce").checked,
  });
});

document.getElementById("focusSite").addEventListener("click", () => window.host.focusSite());
document.getElementById("reloadSite").addEventListener("click", () => window.host.reloadSite());

document.getElementById("speakTest").addEventListener("click", async () => {
  const result = await window.host.speakTest({ settings: collectSettings(), text: "テスト、ピカチュウ" });
  if (!result.ok) {
    speakingEl.hidden = false;
    speakingEl.textContent = "読み上げをオンにしてから試してください";
  }
});

window.host.onLog(appendLog);
window.host.onStatus((status) => renderStatus(status, status.stats));
window.host.onSpeak(speak);

if (window.speechSynthesis) {
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
  speechSynthesis.getVoices();
}

window.host.getState().then((state) => {
  fillSettings(state.settings);
  renderStatus(state.status, state.stats);
  (state.log || []).forEach(appendLog);
});
