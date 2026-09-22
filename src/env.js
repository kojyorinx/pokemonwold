/**
 * exe と同じフォルダ、または開発時のプロジェクト直下にある .env を読む。
 */

import { existsSync, readFileSync } from "node:fs";

/**
 * KEY=VALUE 形式の .env を process.env へ入れる。既存の環境変数は上書きしない。
 * @param {string} filePath
 */
export function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
