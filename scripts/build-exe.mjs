/**
 * 画面と図鑑を埋め込んだ単体実行ファイルを作る。
 * 同じ Node 版の Windows 向け node.exe に SEA ブロブを注入し、dist/pokemonwold.exe を出力する。
 */

import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const bundlePath = path.join(distDir, "bundle.cjs");
const blobPath = path.join(distDir, "sea-prep.blob");
const configPath = path.join(distDir, "sea-config.json");
const exePath = path.join(distDir, "pokemonwold.exe");
const sentinel = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

/**
 * public/ の配信ファイルを URL パスから中身へ対応づける。
 * @returns {Record<string, string>}
 */
function readPublicFiles() {
  const files = {};
  const publicDir = path.join(rootDir, "public");
  for (const name of readdirSync(publicDir)) {
    if (!/\.(html|css|js)$/.test(name)) continue;
    files[`/${name}`] = readFileSync(path.join(publicDir, name), "utf8");
  }
  return files;
}

/**
 * SEA に渡す単一スクリプトへ、図鑑と画面を閉じ込める。
 */
async function bundleApp() {
  const embeddedPublic = readPublicFiles();
  const embeddedCatalog = JSON.parse(readFileSync(path.join(rootDir, "data", "pokemon-ja.json"), "utf8"));
  mkdirSync(distDir, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(rootDir, "src", "exe.js")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: bundlePath,
    plugins: [
      {
        name: "embed-assets",
        setup(build) {
          // exe.js の埋め込みモジュールだけ、ビルド時のファイル内容に差し替える
          build.onResolve({ filter: /embedded-assets\.js$/ }, () => ({
            path: "embedded-assets.js",
            namespace: "embed-assets",
          }));
          build.onLoad({ filter: /.*/, namespace: "embed-assets" }, () => ({
            loader: "js",
            contents: `export const embeddedPublic = ${JSON.stringify(embeddedPublic)};
export const embeddedCatalog = ${JSON.stringify(embeddedCatalog)};
`,
          }));
        },
      },
    ],
  });
}

/**
 * 今の Node と同じ版の実行ファイルへブロブを注入する。
 * @param {string} sourceBinary
 * @param {string} outputPath
 */
function injectSea(sourceBinary, outputPath) {
  copyFileSync(sourceBinary, outputPath);
  execFileSync(
    process.execPath,
    [
      path.join(rootDir, "node_modules", "postject", "dist", "cli.js"),
      outputPath,
      "NODE_SEA_BLOB",
      blobPath,
      "--sentinel-fuse",
      sentinel,
    ],
    { stdio: "inherit" },
  );
}

/**
 * 注入した Linux バイナリが画面と図鑑を配信できるか確認する。
 * @param {string} binaryPath
 */
function assertLinuxBinary(binaryPath) {
  const port = "38123";
  const child = spawn(binaryPath, [], {
    env: {
      ...process.env,
      PORT: port,
      HOST_TOKEN: "exe-test-token",
      POKEMONWOLD_NO_BROWSER: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(waitReady);
      if (error) reject(error);
      else resolve();
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`起動確認がタイムアウトしました\n${logs}`));
    }, 15000);

    child.on("exit", (code, signal) => {
      if (settled) return;
      finish(new Error(`単体バイナリが終了しました (${code ?? signal})\n${logs}`));
    });

    const waitReady = setInterval(async () => {
      if (settled || !logs.includes("ホストトークン")) return;
      clearInterval(waitReady);
      try {
        const state = await fetch(`http://127.0.0.1:${port}/api/state`);
        const overlay = await fetch(`http://127.0.0.1:${port}/overlay.html`);
        const body = await state.json();
        const html = await overlay.text();
        if (!state.ok || body.answer !== null || !Array.isArray(body.rows)) {
          throw new Error(`状態APIが不正です ${state.status}`);
        }
        if (!overlay.ok || !html.includes("ポケモンWordle")) {
          throw new Error("オーバーレイが埋め込まれていません");
        }
        const denied = await fetch(`http://127.0.0.1:${port}/api/round`, { method: "POST" });
        if (denied.status !== 401) throw new Error("トークンなしの操作を拒否できません");
        child.kill("SIGTERM");
        finish();
      } catch (error) {
        child.kill("SIGKILL");
        finish(error);
      }
    }, 200);
  });
}

/**
 * 署名付き node.exe にリソースを足すと署名が壊れるため、証明書テーブルを外す。
 * @param {string} filePath
 */
function stripAuthenticode(filePath) {
  const buf = readFileSync(filePath);
  const peOffset = buf.readUInt32LE(0x3c);
  if (buf.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") {
    throw new Error("PEヘッダが見つかりません");
  }
  const optionalOffset = peOffset + 24;
  const magic = buf.readUInt16LE(optionalOffset);
  if (magic !== 0x20b) throw new Error("64bit の Windows 実行ファイルではありません");

  // 証明書ディレクトリの VirtualAddress はファイル上の位置を指す
  const certDir = optionalOffset + 144;
  const certOffset = buf.readUInt32LE(certDir);
  const certSize = buf.readUInt32LE(certDir + 4);
  buf.writeUInt32LE(0, certDir);
  buf.writeUInt32LE(0, certDir + 4);
  const trimmed = certOffset > 0 && certOffset + certSize <= buf.length ? buf.subarray(0, certOffset) : buf;
  writeFileSync(filePath, trimmed);
}

/**
 * 同じバージョンの Windows 向け node.exe を取得する。
 * @returns {Promise<string>}
 */
async function downloadWindowsNode() {
  const version = process.versions.node;
  const url = `https://nodejs.org/dist/v${version}/win-x64/node.exe`;
  const destination = path.join(distDir, "node-win-x64.exe");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Windows 向け Node の取得に失敗しました (${response.status}) ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(destination, bytes);
  return destination;
}

mkdirSync(distDir, { recursive: true });
await bundleApp();
writeFileSync(
  configPath,
  JSON.stringify(
    {
      main: bundlePath,
      output: blobPath,
      disableExperimentalSEAWarning: true,
    },
    null,
    2,
  ),
);
execFileSync(process.execPath, ["--experimental-sea-config", configPath], { stdio: "inherit" });

const linuxBinary = path.join(distDir, "pokemonwold-linux");
injectSea(process.execPath, linuxBinary);
await assertLinuxBinary(linuxBinary);

const windowsNode = await downloadWindowsNode();
stripAuthenticode(windowsNode);
injectSea(windowsNode, exePath);
rmSync(windowsNode, { force: true });
rmSync(linuxBinary, { force: true });
console.log(`作成しました: ${exePath}`);
