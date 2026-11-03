import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(fs.readFileSync("src/fileEditorSave.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(io) {
  const exports = {};
  vm.runInNewContext(code, {
    exports, TextDecoder,
    require(name) { assert.equal(name, "./fsClient"); return io; },
  });
  return exports.saveFileEditorSnapshot;
}
function fixture() {
  let disk = Buffer.from("base"), writes = 0, current = true;
  const io = {
    readFileBytes: async () => disk,
    writeFileText: async (_, text) => { writes++; disk = Buffer.from(text); },
  };
  return {
    io, save: (...args) => load(io)("file", "base", "draft", () => current, ...args),
    set disk(text) { disk = Buffer.from(text); },
    get disk() { return disk.toString(); },
    get writes() { return writes; },
    invalidate() { current = false; },
  };
}
{
  const f = fixture(); f.disk = "external";
  assert.equal(await f.save(), "conflict");
  assert.equal(f.writes, 0);
  assert.equal(f.disk, "external");
}
{
  const f = fixture();
  assert.equal(await f.save(), "saved");
  assert.equal(f.disk, "draft");
  assert.equal(f.writes, 1);
  assert.equal(await f.save(), "saved");
  assert.equal(f.writes, 1, "readback recovery must not rewrite already-saved content");
}
{
  const f = fixture();
  f.io.readFileBytes = async () => { f.invalidate(); return Buffer.from("base"); };
  assert.equal(await f.save(), "obsolete");
  assert.equal(f.writes, 0, "navigation during preflight prevents the write");
}
for (const stage of ["preflight", "write", "readback"]) {
  const f = fixture(); let reads = 0, writes = 0;
  f.io.readFileBytes = async () => {
    reads++;
    if (stage === "preflight" || (stage === "readback" && reads === 2)) throw Error(stage);
    return Buffer.from("base");
  };
  f.io.writeFileText = async () => { writes++; if (stage === "write") throw Error(stage); };
  await assert.rejects(f.save(), new RegExp(stage));
  assert.equal(writes, stage === "preflight" ? 0 : 1, "failures never trigger a fallback write");
}
{
  const f = fixture();
  f.io.writeFileText = async () => { f.disk = "third-party"; };
  assert.equal(await f.save(), "conflict", "readback must confirm the submitted content");
}
{
  const f = fixture();
  f.io.readFileBytes = async () => Uint8Array.of(0xff);
  await assert.rejects(f.save(), /encoded data|encoding/i);
  assert.equal(f.writes, 0, "undecodable bytes must not be compared through replacement characters");
}
// Real isolated disk IO through the production guard; not a live app-server test.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-editor-save-"));
const file = path.join(dir, "roundtrip.txt");
try {
  const text = "\uFEFF中文\r\n";
  fs.writeFileSync(file, text);
  const save = load({
    readFileBytes: file => fs.promises.readFile(file),
    writeFileText: (file, content) => fs.promises.writeFile(file, content),
  });
  assert.equal(await save(file, text, `${text}draft`, () => true), "saved");
  assert.deepEqual(fs.readFileSync(file), Buffer.from(`${text}draft`), "BOM and CRLF survive");
  fs.writeFileSync(file, "external edit");
  assert.equal(await save(file, `${text}draft`, "local draft", () => true), "conflict");
  assert.equal(fs.readFileSync(file, "utf8"), "external edit");
} finally {
  fs.unlinkSync(file);
  fs.rmdirSync(dir);
}
const drawer = fs.readFileSync("src/components/DiffDrawer.tsx", "utf8");
const callback = drawer.slice(drawer.indexOf("const saveEditedFile ="), drawer.indexOf("// External file selection"));
assert.match(callback, /saveFileEditorSnapshot/);
assert.doesNotMatch(callback, /invoke\(|fsWriteFileText\(/, "editor save cannot bypass the guard");
console.log("PASS file save preflight/readback, conflict preservation, invalidation, failure without fallback, and isolated BOM/CRLF disk roundtrip; atomicity and native IPC unverified");
