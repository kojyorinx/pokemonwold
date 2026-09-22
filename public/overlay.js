/**
 * オーバーレイは /api/state を定期的に読んで盤面だけを描く。
 * 正解はサーバーがプレイ中に隠している。
 */

const board = document.querySelector("#board");
const status = document.querySelector("#status");
const feedback = document.querySelector("#feedback");

const phaseLabel = {
  playing: "チャットの回答を待っています",
  won: "正解しました",
  lost: "ラウンド終了",
};

/**
 * @param {string} text
 */
function text(target, value) {
  target.textContent = value;
}

/**
 * @param {object} state
 */
function render(state) {
  const length = state.length || 5;
  text(status, `${phaseLabel[state.phase] || ""} ・ ${length}文字`);
  if (state.answer) {
    text(status, `${phaseLabel[state.phase]} ・ 正解は ${state.answer}`);
  }
  text(feedback, state.lastEvent?.text || "");

  board.replaceChildren();
  const rows = state.rows || [];
  for (let i = 0; i < state.maxGuesses; i += 1) {
    const row = document.createElement("div");
    row.className = "row";
    row.style.setProperty("--length", String(length));
    const guess = rows[i];
    for (let col = 0; col < length; col += 1) {
      const tile = document.createElement("div");
      const cell = guess?.tiles?.[col];
      tile.className = cell ? `tile filled ${cell.state}` : "tile";
      tile.textContent = cell?.ch || "";
      row.append(tile);
    }
    board.append(row);
  }
}

async function refresh() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) return;
    render(await response.json());
  } catch {
    text(feedback, "盤面を取得できていません");
  }
}

refresh();
setInterval(refresh, 1000);
