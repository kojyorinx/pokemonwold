/**
 * デスクトップアプリを Windows の exe にまとめる。
 * できた pokemonwold.exe はウィンドウで起動し、ブラウザは開かない。
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

execFileSync(process.execPath, [path.join(rootDir, "node_modules", "electron-builder", "cli.js"), "--win", "portable", "--x64"], {
  cwd: rootDir,
  stdio: "inherit",
  env: {
    ...process.env,
    // コード署名は使わない。Linux から Windows 向け exe を作るため。
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
  },
});
