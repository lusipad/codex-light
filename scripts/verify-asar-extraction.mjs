// Local official-archive integrity check; not a UI or product parity test.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";

const archive = "C:/Users/lus/Codex/_internal/app/resources/app.asar";
const fd = fs.openSync(archive, "r");
try {
  const headerSizeBuf = Buffer.alloc(16);
  fs.readSync(fd, headerSizeBuf, 0, 16, 0);
  const jsonSize = headerSizeBuf.readUInt32LE(12);
  const json = Buffer.alloc(jsonSize);
  fs.readSync(fd, json, 0, jsonSize, 16);
  const header = JSON.parse(json.toString("utf8"));
  const expression = fs.readFileSync("scripts/extract-asar-file.mjs", "utf8").match(/const baseOffset = ([^;]+);/)?.[1];
  assert.ok(expression, "check the actual extractor offset declaration");
  const baseOffset = vm.runInNewContext(expression, { headerSizeBuf, jsonSize });
  for (const name of ["webview/assets/zh-CN-3ed9eb1db28a.js", "webview/assets/app-initial-fd3c4b862660.js"]) {
    let entry = header;
    for (const part of name.split("/")) entry = entry.files[part];
    const bytes = Buffer.alloc(entry.size);
    fs.readSync(fd, bytes, 0, bytes.length, baseOffset + Number(entry.offset));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.integrity.hash, `${name} must match archive integrity, including first and last bytes`);
  }
  console.log("PASS actual ASAR extractor offset matches archived integrity for language and app shell chunks");
} finally {
  fs.closeSync(fd);
}
