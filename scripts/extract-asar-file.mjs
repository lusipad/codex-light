import fs from "node:fs";
import path from "node:path";

const asarPath = "C:/Users/lus/Codex/_internal/app/resources/app.asar";
const fd = fs.openSync(asarPath, "r");

const headerSizeBuf = Buffer.alloc(16);
fs.readSync(fd, headerSizeBuf, 0, 16, 0);
const jsonSize = headerSizeBuf.readUInt32LE(12);

const headerBuf = Buffer.alloc(jsonSize);
fs.readSync(fd, headerBuf, 0, jsonSize, 16);
const header = JSON.parse(headerBuf.toString("utf8"));
const baseOffset = 8 + headerSizeBuf.readUInt32LE(4);

export function extractFile(internalPath, outputPath) {
  const parts = internalPath.replace(/^[\/\\]+/, "").split(/[\/\\]+/);
  let cur = header;
  for (const p of parts) {
    if (!cur.files || !cur.files[p]) {
      throw new Error(`Path component not found: ${p} in ${internalPath}`);
    }
    cur = cur.files[p];
  }

  if (typeof cur.size !== "number" || typeof cur.offset !== "string") {
    throw new Error(`Not a file: ${internalPath}`);
  }

  const offset = baseOffset + parseInt(cur.offset, 10);
  const size = cur.size;

  const contentBuf = Buffer.alloc(size);
  fs.readSync(fd, contentBuf, 0, size, offset);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, contentBuf);
  console.log(`Extracted: ${internalPath} (${size} bytes) -> ${outputPath}`);
}

const targets = [
  ["webview/assets/chatgpt-conversation-turn-content-6f261d5a5a27.css", ".ref/scratch/files/turn-content.css"],
  ["webview/assets/chatgpt-conversation-turn-content-e0f324df56f5.js", ".ref/scratch/files/turn-content.js"],
  ["webview/assets/collapsed-turn-disclosure-541fb0b033c7.js", ".ref/scratch/files/collapsed-disclosure.js"],
  ["webview/assets/local-conversation-turn-202a34d13919.js", ".ref/scratch/files/local-turn.js"],
  ["webview/assets/turn-preview-body-items-84e9457d1850.js", ".ref/scratch/files/turn-preview-body.js"]
];

for (const [intPath, outPath] of targets) {
  try {
    extractFile(intPath, outPath);
  } catch (err) {
    console.error(err.message);
  }
}
