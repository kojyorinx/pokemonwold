"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/**
 * 操作画面からメイン処理を呼ぶための窓口。
 * API キーなどの処理はメイン側に置き、画面は結果だけを受け取る。
 */
contextBridge.exposeInMainWorld("host", {
  getState: () => ipcRenderer.invoke("get-state"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
  connect: (settings) => ipcRenderer.invoke("connect", settings),
  disconnect: () => ipcRenderer.invoke("disconnect"),
  testChat: (payload) => ipcRenderer.invoke("test-chat", payload),
  reloadSite: () => ipcRenderer.invoke("reload-site"),
  focusSite: () => ipcRenderer.invoke("focus-site"),
  setGameMode: (settings) => ipcRenderer.invoke("set-game-mode", settings),
  speakTest: (payload) => ipcRenderer.invoke("speak-test", payload),
  onLog: (callback) => ipcRenderer.on("log", (_event, row) => callback(row)),
  onStatus: (callback) => ipcRenderer.on("status", (_event, status) => callback(status)),
  onSpeak: (callback) => ipcRenderer.on("speak", (_event, text) => callback(text)),
});
