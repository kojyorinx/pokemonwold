"use strict";

const winnerEl = document.getElementById("winner");
const winnerName = document.getElementById("winnerName");
const winnerAnswer = document.getElementById("winnerAnswer");
const winnerHint = document.getElementById("winnerHint");
const rankingEl = document.getElementById("ranking");
const rankingEmpty = document.getElementById("rankingEmpty");
const rankingDate = document.getElementById("rankingDate");

/**
 * クリアした人と、今日の正解数ランキングを画面へ反映する。
 */
function renderRanking(data) {
  const view = data || { lastWinner: null, ranking: [], date: "" };
  const winner = view.lastWinner;
  rankingDate.textContent = view.date ? `${view.date}（日本時間）` : "";
  if (winner && winner.author) {
    winnerEl.classList.add("cleared");
    winnerHint.textContent = "最終コメント";
    winnerName.textContent = winner.author;
    const mode = winner.mode === "endless" ? "エンドレス" : "今日のお題";
    winnerAnswer.textContent = winner.name ? `${mode} 「${winner.name}」 今日 ${winner.count} 問` : mode;
  } else {
    winnerEl.classList.remove("cleared");
    winnerHint.textContent = "ゲームをクリアした人";
    winnerName.textContent = "まだクリアしていません";
    winnerAnswer.textContent = "";
  }

  rankingEl.innerHTML = "";
  const rows = view.ranking || [];
  rankingEmpty.hidden = rows.length > 0;
  rows.forEach((row) => {
    const item = document.createElement("li");
    if (row.rank === 1) item.classList.add("top");
    if (winner && winner.author === row.author) item.classList.add("winner-row");
    item.innerHTML = `<span class="rank">${row.rank}位</span><span class="author"></span><span class="clears">${row.clears}問</span>`;
    item.querySelector(".author").textContent = row.author;
    rankingEl.appendChild(item);
  });
}

window.host.onRanking(renderRanking);
window.host.getRanking().then(renderRanking);
