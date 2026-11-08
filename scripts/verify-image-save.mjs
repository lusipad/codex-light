import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const output = ts.transpileModule(fs.readFileSync("src/imageSave.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const calls = []; let diskBytes = "local-base64", answer = "D:/saved.png", networkError, readError, nativeError;
const exports = {};
vm.runInNewContext(output, { exports, Uint8Array, fetch: async url => { calls.push(["fetch", url]); if (networkError) return { ok: false, status: 403 }; return { ok: true, arrayBuffer: async () => new Uint8Array([137,80,78,71]).buffer }; },
 require: name => name === "./bridge" ? { tauriInvoke: async (command, params) => { calls.push([command, params]); if (nativeError) throw nativeError; return answer; } }
 : name === "./fsClient" ? { readFileBase64: async path => { calls.push(["read", path]); if (readError) throw readError; return diskBytes; }, bytesToBase64: bytes => Buffer.from(bytes).toString("base64") } : assert.fail(name) });
const save = exports.saveGeneratedImageBytes;
assert.equal(await save({ path: "D:/generated.png" }), answer);
assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ["generated_image_save", { dataBase64: diskBytes }]);
assert.equal(calls.some(call => call[0] === "fetch"), false);
await save({ src: "data:image/png;base64,iVBORw==" }); assert.equal(calls.at(-1)[1].dataBase64, "iVBORw==");
const beforeOriginal = calls.length;
await exports.saveDecodedImage("data:image/avif;base64,AAEC", "中文原图");
assert.deepEqual(JSON.parse(JSON.stringify(calls.slice(beforeOriginal))), [["generated_image_save", { dataBase64: "AAEC", suggestedTitle: "中文原图" }]]);
await assert.rejects(exports.saveDecodedImage("https://example.invalid/image.png", "外部来源"), /无法读取/);
answer = null; assert.equal(await save({ src: "https://example.invalid/image.png" }), null, "cancel is not success");
let count = calls.filter(call => call[0] === "generated_image_save").length;
networkError = true; await assert.rejects(save({ src: "https://example.invalid/image.png" }), /403/);
assert.equal(calls.filter(call => call[0] === "generated_image_save").length, count, "HTTP error cannot reach save dialog"); networkError = false;
readError = Error("source gone"); await assert.rejects(save({ path: "D:/missing.png" }), /source gone/); readError = null;
nativeError = Error("disk full"); await assert.rejects(save({ src: "data:image/png;base64,iVBORw==" }), /disk full/);
await assert.rejects(save({}), /无法读取/);
console.log("PASS IS01-IS04 production byte-transfer helper: local/data/HTTP bytes, cancel, HTTP/read/native failures and no fake saved result");

let hooks = [], cursor = 0, cleanups = [], writes = 0, pendingSave, saveCalls = 0;
const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
 useState: initial => { const index = cursor++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], value => { writes++; hooks[index] = value; }]; },
 useRef: initial => { const index = cursor++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; },
 useEffect: effect => { const index = cursor++; if (!(index in hooks)) { hooks[index] = true; cleanups.push(effect()); } } }; React.default = React;
const component = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/components/GeneratedImageCard.tsx", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText,
 { exports: component, require: name => name === "react" ? React : name === "../imageSave" ? { saveGeneratedImageBytes: () => { saveCalls++; return new Promise((resolve, reject) => { pendingSave = { resolve, reject }; }); } } : assert.fail(name) });
const nodes = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(nodes)] : [];
const render = (result = "AAAA") => { cursor = 0; return component.GeneratedImageCard({ item: { id: "image", type: "imageGeneration", status: "completed", result }, onOpenFile() {} }); };
const saveButton = tree => nodes(tree).find(node => node.type === "button" && node.children.some(text => typeof text === "string" && text.includes("保存")));
const flush = async () => { for (let tick = 0; tick < 12; tick++) await Promise.resolve(); };
saveButton(render()).props.onClick(); saveButton(render()).props.onClick(); assert.equal(saveCalls, 1, "duplicate save must remain single flight"); assert.equal(saveButton(render()).props.disabled, true);
pendingSave.resolve(null); await flush(); assert.doesNotMatch(JSON.stringify(render()), /已保存/); assert.equal(saveButton(render()).props.disabled, false);
saveButton(render()).props.onClick(); pendingSave.reject(Error("disk denied")); await flush(); assert.ok(nodes(render()).some(node => node.props.role === "alert" && JSON.stringify(node).includes("disk denied")));
saveButton(render()).props.onClick(); pendingSave.resolve("D:/confirmed.png"); await flush(); assert.match(JSON.stringify(render()), /已保存：D:\/confirmed.png/);
saveButton(render()).props.onClick(); render("BBBB"); pendingSave.resolve("D:/old-result.png"); await flush(); assert.doesNotMatch(JSON.stringify(render("BBBB")), /old-result/);
saveButton(render("BBBB")).props.onClick(); cleanups.forEach(cleanup => cleanup?.()); const previousWrites = writes; pendingSave.resolve("D:/after-unmount.png"); await flush(); assert.equal(writes, previousWrites, "late save cannot update unmounted card");
console.log("PASS IS02/IS05 production component: repeated clicks single flight, cancellation has no success, failure/retry, confirmed result, source change and unmount ignore late feedback");
