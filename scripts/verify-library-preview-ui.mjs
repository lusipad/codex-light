import assert from "node:assert/strict";
import { harness } from "./verify-library-service.mjs";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const walk = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(walk)] : [];
const text = tree => walk(tree).flatMap(node => node.children.filter(child => typeof child === "string")).join(" ");
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const access = { available: true, identity: { accountId: "a", userId: "u", generation: 1 }, onedrive: false };
let h = harness(); h.render(); await flush(); h.accesses.at(-1).resolve(access); await flush();
h.reads.at(-1).resolve({ items: [{ node: { id: "libfile_a", name: "真实文本.txt", kind: "file" } }], cursor: null }); await flush();
const file = walk(h.render()).find(node => node.type === "button" && text(node) === "真实文本.txt");
assert.ok(file, "ordinary native file must activate the production preview pane");
file.props.onClick({ currentTarget: { focus() {} } });
assert.ok(walk(h.render()).some(node => node.type === "LibraryPreviewPane"), "preview uses a side pane rather than metadata-only text");
const oldPane = walk(h.render()).find(node => node.type === "LibraryPreviewPane");
file.props.onClick({ currentTarget: { focus() {} } });
const newPane = walk(h.render()).find(node => node.type === "LibraryPreviewPane");
assert.equal(oldPane.props.request.controller.signal.aborted, true);
oldPane.props.onClose(); assert.ok(walk(h.render()).some(node => node.type === "LibraryPreviewPane"), "old close must not close a newer file");
h.invalidate(); assert.equal(newPane.props.request.controller.signal.aborted, true);
assert.equal(walk(h.render()).some(node => node.type === "LibraryPreviewPane"), false);

let directClosed = 0;
const direct = harness(null, new Map(), undefined, { id: "libfile_direct", onClose: () => directClosed++ });
assert.match(text(direct.render()), /正在加载预览/);
await flush();
direct.accesses.at(-1).reject(Error("资格读取失败")); await flush();
assert.match(text(direct.render()), /资格读取失败/);
walk(direct.render()).find(node => node.type === "button" && text(node) === "重试").props.onClick();
direct.render(); await flush(); direct.accesses.at(-1).resolve(access); await flush();
const directPane = walk(direct.render()).find(node => node.type === "LibraryPreviewPane");
assert.equal(directPane.props.standalone, true);
assert.equal(directPane.props.request.id, "libfile_direct");
assert.equal(direct.reads.length, 0, "direct preview does not fetch the directory");
direct.invalidate();
assert.equal(directPane.props.request.controller.signal.aborted, true);
assert.equal(directClosed, 1);
assert.equal(walk(direct.render()).some(node => node.type === "LibraryPreviewPane"), false);
direct.unmount();

const denied = harness(null, new Map(), undefined, { id: "libfile_direct", onClose: () => {} });
denied.render(); await flush(); denied.accesses.at(-1).resolve({ ...access, available: false }); await flush();
assert.match(text(denied.render()), /无法访问资料库/);
assert.equal(walk(denied.render()).some(node => node.type === "LibraryPreviewPane"), false);
denied.unmount();

const compile = file => ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
} }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const preview = {}; vm.runInNewContext(compile("src/libraryPreview.ts"), { exports: preview });
function paneHarness(stored = null) {
  const hooks = [], effects = [], metadata = [], contents = [], revoked = [], created = [], downloads = [], timers = new Map(), listeners = new Map();
  let cursor = 0, writes = 0, nextTimer = 0, props, box = { width: 1200, height: 800 }, resizeCallback;
  const storage = new Map(stored === null ? [] : [["app-shell:right-panel-width:v3", stored]]);
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    useState: initial => { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial; return [hooks[i], value => { writes++; hooks[i] = typeof value === "function" ? value(hooks[i]) : value; }]; },
    useRef: initial => { const i = cursor++; if (!(i in hooks)) hooks[i] = { current: initial }; return hooks[i]; },
    useEffect: (effect, deps) => { const i = cursor++, old = hooks[i]; if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) {
      hooks[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = effect(); });
    } },
  }; React.default = React; React.useLayoutEffect = React.useEffect;
  const exports = {};
  vm.runInNewContext(compile("src/components/LibraryPreviewPane.tsx"), {
    exports, AbortController, TextDecoder, Blob,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    ResizeObserver: class { constructor(callback) { resizeCallback = callback; } observe() {} disconnect() {} },
    URL: { createObjectURL: blob => { created.push(blob); return `blob:fixture-${created.length}`; }, revokeObjectURL: url => revoked.push(url) },
    document: { body: { appendChild() {} }, createElement: tag => {
      assert.equal(tag, "a");
      return { click() { downloads.push([this.href, this.download]); }, remove() {} };
    } },
    window: { addEventListener: (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); }, removeEventListener: (name, fn) => listeners.get(name)?.delete(fn) },
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id),
    require: name => {
      if (name === "react") return React;
      if (name === "lucide-react") return { Download: "Download", File: "File", FileImage: "FileImage", FileVideo: "FileVideo", X: "X" };
      if (name.endsWith(".css")) return {};
      if (name === "./MarkdownView") return { MarkdownView: "MarkdownView" };
      if (name === "../libraryPreview") return preview;
      if (name === "../chatgptService") return { serviceErrorMessage: error => error.message ?? error.code };
      if (name === "../libraryClient") return {
        readLibraryFile: (access, id, signal) => { const job = deferred(); metadata.push({ access, id, signal, ...job }); return job.promise; },
        readLibraryFileContent: (access, file, signal, mode) => { const job = deferred(); contents.push({ access, file, signal, mode, ...job }); return job.promise; },
      };
      assert.fail(name);
    },
  });
  return { metadata, contents, revoked, created, downloads, storage,
    render(next = props) { props = next; cursor = 0; const tree = exports.LibraryPreviewPane(props);
      tree.props.ref.current = { parentElement: { getBoundingClientRect: () => box } };
      while (effects.length) effects.shift()(); return tree; },
    resizeBox(next) { box = next; resizeCallback(); },
    dispatch(name, event) { for (const callback of [...(listeners.get(name) ?? [])]) callback(event); },
    timers() { for (const [id, callback] of timers) { timers.delete(id); callback(); } },
    unmount() { for (const hook of hooks) hook?.cleanup?.(); }, get writes() { return writes; },
    listenerCount(name) { return listeners.get(name)?.size ?? 0; },
  };
}
const request = (id = "libfile_a") => ({ id, name: id, access, controller: new AbortController() });
const fileInfo = (name, mime = "text/plain", size = 20) => ({ id: "libfile_a", file_name: name, file_id: "file-a", mime_type: mime, file_size_bytes: size });
const byType = (p, type) => walk(p.render()).find(node => node.type === type);
const byButton = (p, name) => walk(p.render()).find(node => node.type === "button" && (node.props["aria-label"] === name || text(node) === name));
for (const excluded of [{ provider: "google_drive" }, { state: "trashed" }, { library_artifact_type: "flashcards" }, { file_size_bytes: 41943041 }]) {
  const pane = paneHarness();
  pane.render({ request: request(), onClose() {} });
  pane.metadata[0].resolve({ ...fileInfo("表格.csv", "text/csv"), ...excluded }); await flush();
  assert.equal(byButton(pane, "下载文件"), undefined);
  pane.unmount();
}
const downloadPane = paneHarness(), downloadRequest = request();
downloadPane.render({ request: downloadRequest, onClose() {} });
downloadPane.metadata[0].resolve(fileInfo("表格.csv", "text/csv")); await flush();
assert.equal(downloadPane.contents.length, 0);
const downloadButton = byButton(downloadPane, "下载文件");
assert.ok(downloadButton, "an unsupported ordinary file still has a download action");
downloadButton.props.onClick(); downloadButton.props.onClick();
assert.equal(downloadPane.contents.length, 1);
assert.equal(downloadPane.contents[0].mode, "download");
assert.equal(byButton(downloadPane, "下载文件").props.disabled, true);
downloadPane.contents[0].reject(Error("network")); await flush();
assert.match(text(downloadPane.render()), /无法下载文件/);
assert.equal(downloadPane.downloads.length, 0);
byButton(downloadPane, "下载文件").props.onClick();
const original = new Uint8Array([239, 187, 191, 0, 255, 10]);
downloadPane.contents[1].resolve({ bytes: original.buffer, mimeType: "text/csv" }); await flush();
assert.deepEqual(downloadPane.downloads, [["blob:fixture-1", "表格.csv"]]);
assert.deepEqual(new Uint8Array(await downloadPane.created[0].arrayBuffer()), original);
downloadPane.timers();
assert.deepEqual(downloadPane.revoked, ["blob:fixture-1"]);
byButton(downloadPane, "下载文件").props.onClick();
downloadRequest.controller.abort();
assert.equal(downloadPane.contents[2].signal.aborted, true);
downloadPane.render({ request: request("libfile_next"), onClose() {} });
downloadPane.contents[2].resolve({ bytes: original.buffer, mimeType: "text/csv" }); await flush();
assert.equal(downloadPane.downloads.length, 1);
assert.doesNotMatch(text(downloadPane.render()), /无法下载文件/);
downloadPane.unmount();

let closed = 0, p = paneHarness(), req = request(); p.render({ request: req, onClose: () => closed++ });
assert.equal(p.metadata.length, 1); assert.equal(p.contents.length, 0, "metadata must precede bytes");
p.metadata[0].resolve(fileInfo("真实.txt")); await flush(); assert.equal(p.contents.length, 1);
p.contents[0].resolve({ bytes: new TextEncoder().encode("中文\n  保留空白").buffer, mimeType: "text/plain" }); await flush();
assert.equal(text(byType(p, "pre")), "中文\n  保留空白"); assert.equal(byType(p, "pre").props.dir, "ltr");
assert.equal(byType(p, "aside").props["aria-label"], "文件预览");
assert.equal(walk(p.render()).some(node => node.props.role === "dialog"), false);

req = request("libfile_b"); p.render({ request: req, onClose: () => closed++ });
assert.equal(byType(p, "pre"), undefined, "switch hides prior content before await");
const late = p.metadata.at(-1); req.controller.abort(); late.resolve(fileInfo("late.txt")); await flush();
assert.equal(p.contents.length, 1, "aborted metadata never starts byte read"); p.unmount();

p = paneHarness(); req = request(); p.render({ request: req, onClose: () => closed++ });
p.metadata[0].resolve(fileInfo("notes.md", "text/markdown", null)); await flush();
p.contents[0].resolve({ bytes: new TextEncoder().encode("").buffer, mimeType: "text/markdown" }); await flush();
assert.equal(byType(p, "MarkdownView").props.content, ""); assert.equal(byType(p, "MarkdownView").props.remoteContent, "no-remote-images");
p.unmount();

for (const type of ["writing_block", "automation_plan", "flashcards", "app_block", "site_preview", "chat_message_snapshot"]) {
  p = paneHarness(); p.render({ request: request(), onClose() {} });
  p.metadata[0].resolve({ ...fileInfo("artifact.txt"), library_artifact_type: type }); await flush();
  assert.equal(p.contents.length, 0, `${type} must not masquerade as ordinary text preview`);
  assert.match(text(p.render()), /无法显示预览/); p.unmount();
}

for (const failure of [{ status: 403, message: "forbidden" }, { status: 404, message: "missing" }, { code: "not_found", message: "missing" }]) {
  p = paneHarness(); p.render({ request: request(), onClose() {} }); p.metadata[0].reject(failure); await flush();
  assert.match(text(p.render()), /无法打开此文件/); assert.equal(byButton(p, "重试"), undefined); p.unmount();
}
p = paneHarness(); p.render({ request: request(), onClose() {} }); p.metadata[0].reject(Error("network")); await flush();
byButton(p, "重试").props.onClick(); p.render(); assert.equal(p.metadata.length, 2); p.unmount();

for (const [name, mime, size] of [["big.txt", "text/plain", 41943041], ["unknown.png", "image/png", null], ["video.mp4", "video/mp4", 20]]) {
  p = paneHarness(); p.render({ request: request(), onClose() {} }); p.metadata[0].resolve(fileInfo(name, mime, size)); await flush();
  assert.equal(p.contents.length, 0); assert.match(text(p.render()), size === 41943041 ? /文件过大/ : /无法预览/); p.unmount();
}
p = paneHarness(); p.render({ request: request(), onClose() {} });
p.metadata[0].resolve(fileInfo("视频文件.mp4", "video/mp4")); await flush();
const fallback = walk(p.render()).find(node => node.props.className === "library-preview-unavailable");
assert.ok(fallback, "unrenderable ordinary files show the centered download fallback");
assert.match(text(fallback), /无法预览.*视频文件\.mp4.*下载文件/);
const fallbackDownload = walk(fallback).find(node => node.type === "button" && text(node) === "下载文件");
fallbackDownload.props.onClick(); byButton(p, "下载文件").props.onClick();
assert.equal(p.contents.length, 1);
assert.equal(walk(p.render()).filter(node => node.type === "button" && (node.props["aria-label"] === "下载文件" || text(node) === "下载文件")
  && node.props.disabled).length, 2, "both entry points share the pending state");
p.unmount();
assert.equal(p.contents[0].signal.aborted, true);
p = paneHarness(); p.render({ request: request(), onClose() {} });
p.metadata[0].resolve({ ...fileInfo("不可下载.bin", "application/octet-stream"), provider: "google_drive" }); await flush();
assert.match(text(p.render()), /此类文件无法下载/);
assert.equal(byButton(p, "下载文件"), undefined);
p.unmount();
p = paneHarness(); req = request(); p.render({ request: req, onClose() {} }); p.metadata[0].resolve(fileInfo("image.png", "image/png", 41943040)); await flush();
assert.equal(p.contents.length, 1, "40MiB equality permits read");
p.contents[0].resolve({ bytes: new Uint8Array([1, 2]).buffer, mimeType: "image/png" }); await flush();
const image = byType(p, "img"); assert.equal(image.props.alt, "image.png"); assert.equal(image.props.style.visibility, "hidden");
image.props.onLoad(); assert.equal(byType(p, "img").props.style.visibility, "visible");
image.props.onError(); assert.equal(byType(p, "img"), undefined); byButton(p, "重试预览").props.onClick(); p.render();
assert.deepEqual(p.revoked, ["blob:fixture-1"]); assert.equal(p.metadata.length, 2);
req.controller.abort(); assert.equal(p.metadata[1].signal.aborted, true); p.unmount();

p = paneHarness(); req = request(); p.render({ request: req, onClose() {} });
p.metadata[0].resolve(fileInfo("first.png", "image/png")); await flush();
p.contents[0].resolve({ bytes: new Uint8Array([1]).buffer, mimeType: "image/png" }); await flush();
const oldImage = byType(p, "img");
p.render({ request: request("libfile_second"), onClose() {} });
p.metadata[1].resolve(fileInfo("second.png", "image/png")); await flush();
p.contents[1].resolve({ bytes: new Uint8Array([2]).buffer, mimeType: "image/png" }); await flush(); p.render();
oldImage.props.onLoad(); oldImage.props.onError();
assert.equal(byType(p, "img").props.alt, "second.png"); assert.equal(byType(p, "img").props.style.visibility, "hidden");
assert.deepEqual(p.revoked, ["blob:fixture-1"]); p.unmount(); assert.deepEqual(p.revoked, ["blob:fixture-1", "blob:fixture-2"]);

p = paneHarness(); p.render({ request: request(), onClose() {} }); p.metadata[0].resolve(fileInfo("a.txt")); await flush();
const pendingBytes = p.contents[0]; p.unmount(); const writes = p.writes;
pendingBytes.resolve({ bytes: new Uint8Array([1]).buffer, mimeType: "text/plain" }); await flush(); assert.equal(p.writes, writes);

p = paneHarness(); req = request(); closed = 0; p.render({ request: req, onClose: () => closed++ });
p.dispatch("keydown", { key: "Escape", isComposing: true }); p.timers(); assert.equal(closed, 0);
p.dispatch("keydown", { key: "Escape", keyCode: 229 }); p.timers(); assert.equal(closed, 0);
const prevented = { key: "Escape", defaultPrevented: false }; p.dispatch("keydown", prevented); prevented.defaultPrevented = true; p.timers(); assert.equal(closed, 0);
p.dispatch("keydown", { key: "Escape" }); p.timers(); assert.equal(closed, 1);
p.dispatch("keydown", { key: "Escape" }); p.unmount(); p.timers(); assert.equal(closed, 1); assert.equal(p.listenerCount("keydown"), 0);

for (const [stored, expected] of [[null, 700], ["NaN", 700], ["0.4", 480], ["500", 500], ["-1", 320], ["2", 320]]) {
  p = paneHarness(stored); p.render({ request: request(), onClose() {} }); assert.equal(byType(p, "aside").props.style.width, expected);
  p.unmount();
}
p = paneHarness("0.4"); p.render({ request: request(), onClose() {} });
let separator = walk(p.render()).find(node => node.props.role === "separator");
separator.props.onKeyDown({ key: "ArrowLeft", nativeEvent: {}, preventDefault() {} });
assert.equal(p.storage.get("app-shell:right-panel-width:v3"), String(490 / 1200));
p.resizeBox({ width: 800, height: 600 }); assert.equal(byType(p, "aside").props.style.width, 490 / 1200 * 800);
p.resizeBox({ width: 640, height: 600 }); assert.equal(byType(p, "aside").props.style.width, "100%");
assert.equal(walk(p.render()).some(node => node.props.role === "separator"), false); p.unmount();
p = paneHarness(String(490 / 1200)); p.render({ request: request(), onClose() {} }); assert.equal(byType(p, "aside").props.style.width, 490); p.unmount();
p = paneHarness("0.4"); p.render({ request: request(), onClose() {} });
separator = walk(p.render()).find(node => node.props.role === "separator");
separator.props.onPointerDown({ button: 0, clientX: 200, preventDefault() {} });
p.dispatch("pointermove", { clientX: 100 }); assert.equal(byType(p, "aside").props.style.width, 580);
p.dispatch("pointerup", {}); assert.equal(p.storage.get("app-shell:right-panel-width:v3"), String(580 / 1200));
assert.equal(p.listenerCount("pointermove"), 0); assert.equal(p.listenerCount("pointerup"), 0);
separator = walk(p.render()).find(node => node.props.role === "separator");
separator.props.onPointerDown({ button: 0, clientX: 200, preventDefault() {} });
p.render({ request: request("libfile_next"), onClose() {} });
assert.equal(p.listenerCount("pointermove"), 0, "switching file cancels an active resize");
assert.equal(p.listenerCount("pointerup"), 0); p.unmount();
console.log("PASS 18F production Library/PreviewPane: native open/right pane, current-request close, metadata before bytes, text/readonly markdown, permission retry boundary, 40MiB/unknown image, real image lifecycle and URL release, identity/unmount/late cancellation, deferred Escape/IME, measured width ratio/keyboard/reopen/narrow clamp. Controlled hooks/bridge/DOM fixture; not account HTTP/browser/native/pixel evidence.");
