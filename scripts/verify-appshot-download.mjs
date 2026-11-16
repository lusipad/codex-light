import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const options = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 };
const calls = [], fetched = [], client = {}, saving = {};
let imageType = "image/png", bytes = fs.readFileSync("src-tauri/icons/icon.png"), result = null;
const bridge = { tauriInvoke: async (method, params) => { calls.push([method, params]); return result; } };
const protocol = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/protocol.ts", "utf8"), { compilerOptions: options }).outputText, { exports: protocol });
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/fsClient.ts", "utf8"), { compilerOptions: options }).outputText, {
  exports: client, require: name => name === "./bridge" ? bridge : name === "./protocol" ? protocol : assert.fail(name), btoa, atob, TextDecoder, TextEncoder,
});
const now = new Date("2026-11-17T03:04:05.000Z");
class FixedDate extends Date { constructor() { super(now); } }
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/imageSave.ts", "utf8"), { compilerOptions: options }).outputText, {
  exports: saving, Date: FixedDate, Intl, document: { documentElement: { lang: "zh-CN" } },
  require: name => name === "./bridge" ? bridge : name === "./fsClient" ? client : assert.fail(name),
  fetch: async src => { fetched.push(src); return { ok: true, blob: async () => new Blob([bytes], { type: imageType }) }; },
});
assert.equal(await saving.savePreviewImageBytes("blob:private-owned-image"), null, "native cancellation remains null, not a success message");
const date = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now);
assert.equal(calls[0][0], "preview_image_save");
assert.equal(calls[0][1].suggestedFileName, `ChatGPT 图像 ${date}.png`, "use click-time localized date rather than app/window/image title");
assert.equal(calls[0][1].dataBase64, bytes.toString("base64"), "save the exact owned PNG bytes");
imageType = "image/jpeg"; bytes = Buffer.from([255, 216, 255, 217]); result = "private-native-path";
assert.equal(await saving.savePreviewImageBytes("blob:private-jpeg"), result);
assert.equal(calls.at(-1)[1].suggestedFileName, `ChatGPT 图像 ${date}.jpg`, "blob MIME determines extension");
const count = calls.length, fetchedCount = fetched.length;
await assert.rejects(saving.savePreviewImageBytes("https://example.invalid/private.png"));
assert.equal(fetched.length, fetchedCount, "local-history download does not invent remote image fetching");
imageType = "text/html";
await assert.rejects(saving.savePreviewImageBytes("blob:not-an-image"));
assert.equal(calls.length, count, "unknown bytes/MIME do not open a save dialog");
const native = fs.readFileSync("src-tauri/src/image_save.rs", "utf8").split("pub async fn preview_image_save")[1].split("#[tauri::command]")[0];
assert.match(native, /dirs::download_dir\(\)/, "read actual system Downloads location");
assert.match(native, /\.set_directory\(directory\)/);
assert.doesNotMatch(native, /\.set_title\(|\.add_filter\(/, "source default dialog does not specify title or format filters");
console.log("PASS preview download: actual bytes, click-time localized filename, blob MIME, null cancel and source-equivalent default dialog options; no file saved");
