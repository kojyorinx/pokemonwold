"use strict";

const { spawn } = require("child_process");

/**
 * Windows の音声合成で読み上げる。
 * 日本語の音声が入っていれば、その音声を選ぶ。
 */
function speakWindows(text) {
  const spoken = String(text || "").slice(0, 80);
  if (!spoken) return;
  const payload = Buffer.from(spoken, "utf8").toString("base64");
  const command = [
    "Add-Type -AssemblyName System.Speech",
    `$t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))`,
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    "$s.Rate = 0",
    "try {",
    "  foreach ($v in $s.GetInstalledVoices()) {",
    "    if ($v.VoiceInfo.Culture.Name -like 'ja*') { $s.SelectVoice($v.VoiceInfo.Name); break }",
    "  }",
    "} catch {}",
    "$s.Speak($t)",
  ].join("\n");
  const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", command], {
    windowsHide: true,
    stdio: "ignore",
  });
  child.on("error", () => {});
}

/**
 * 採用コメントの読み上げ文を作る。
 */
function speakLine(author, name) {
  return `${author}さん、${name}`.slice(0, 80);
}

module.exports = {
  speakWindows,
  speakLine,
};
