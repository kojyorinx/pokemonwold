/**
 * 操作画面へ、トークンとオーバーレイ操作だけを渡す。
 * ページ内のスクリプトから Node 自体は触らせない。
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pokemonwold", {
  /** このアプリが発行したホストトークン */
  hostToken: () => ipcRenderer.invoke("host-token"),
  /** OBS に貼るオーバーレイのURL */
  overlayUrl: () => ipcRenderer.invoke("overlay-url"),
  /** オーバーレイURLをクリップボードへ入れる */
  copyOverlayUrl: () => ipcRenderer.invoke("copy-overlay"),
  /** オーバーレイをアプリ内ウィンドウで開く */
  previewOverlay: () => ipcRenderer.invoke("preview-overlay"),
});
