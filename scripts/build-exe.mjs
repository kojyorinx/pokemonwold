import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "node_modules", "electron-builder", "cli.js");

const child = spawn(process.execPath, [cli, "--win", "portable", "--x64"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
  },
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
