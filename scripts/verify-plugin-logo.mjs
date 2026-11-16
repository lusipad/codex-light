import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(fs.readFileSync("src/components/PluginLogo.tsx", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText;
const exports = {}, calls = [], deferred = [], revoked = [], slots = [], mutations = [];
let index = 0, dirty = true, effects = [], currentTheme = "light", sequence = 0;
const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useState(initial) { const i = index++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; dirty = true; }]; },
  useEffect(run, deps) { const i = index++, old = slots[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: run() }; }); },
};
vm.runInNewContext(source, { exports, Uint8Array, Blob, URL: class extends URL { static createObjectURL() { return `blob:private-${++sequence}`; } static revokeObjectURL(url) { revoked.push(url); } },
  require: name => name === "react" ? { ...react, default: react } : {
    getMetadata: async path => { calls.push(["metadata", path]); return { isFile: true, isDirectory: false }; },
    readFileBase64: path => { calls.push(["read", path]); return new Promise((resolve, reject) => deferred.push({ resolve, reject })); },
    base64ToBytes: text => new Uint8Array(Buffer.from(text, "base64")),
    joinFsPath: (root, name) => `${root.replace(/[\\/]+$/, "")}/${name}`,
  },
  document: { documentElement: { getAttribute: () => currentTheme } },
  window: { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
  MutationObserver: class { constructor(callback) { this.callback = callback; mutations.push(this); } observe() {} disconnect() { this.disconnected = true; } },
});
const summary = { id: "private", name: "private", source: { type: "local", path: "D:/private/plugin" }, interface: { logo: "assets/logo.png", logoDark: "assets/dark.png" } };
const candidates = exports.pluginLogoCandidates(summary, false);
assert.deepEqual(JSON.parse(JSON.stringify(candidates)), [{ kind: "file", value: "D:/private/plugin/assets/logo.png" }, { kind: "file", value: "D:/private/plugin/assets/dark.png" }]);
assert.equal(exports.pluginLogoCandidates({ ...summary, source: { type: "git", url: "https://example.test/repo" } }, false).length, 0);
for (const path of ["../secret.png", "assets/../../secret.png", "https://example.test/logo.png", "javascript:alert(1)"]) assert.equal(exports.pluginLogoCandidates({ ...summary, interface: { logo: path } }, false).length, 0);
for (const url of ["javascript:alert(1)", "http://example.test/a", "data:image/png;base64,AA==", "https://secret@example.test/a", "file:///D:/a"]) assert.equal(exports.pluginLogoCandidates({ ...summary, interface: { logoUrl: url } }, false).length, 0);
assert.equal(exports.pluginLogoCandidates({ ...summary, interface: { logoUrl: "https://example.test/a.png", logoUrlDark: "https://example.test/b.png" } }, true)[0].value, "https://example.test/b.png");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
assert.equal(exports.pluginLogoMime(new Uint8Array(png)), "image/png");
assert.equal(exports.pluginLogoMime(new Uint8Array(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"))), "image/gif");
assert.equal(exports.pluginLogoMime(new Uint8Array([255, 216, 255, 224, 255, 217])), "image/jpeg");
const webp = Buffer.alloc(20); webp.write("RIFF", 0); webp.writeUInt32LE(12, 4); webp.write("WEBP", 8);
assert.equal(exports.pluginLogoMime(new Uint8Array(webp)), "image/webp"); webp.writeUInt32LE(99, 4); assert.equal(exports.pluginLogoMime(new Uint8Array(webp)), null);
for (const bytes of [Buffer.from("<svg/>"), Buffer.from("<!doctype html>"), Buffer.from("PNG"), Buffer.alloc(2 * 1024 * 1024 + 1)]) assert.equal(exports.pluginLogoMime(new Uint8Array(bytes)), null);
let plugin = summary, output;
function render() { for (let count = 0; dirty; count++) { assert.ok(count < 30); dirty = false; index = 0; output = exports.usePluginLogoSource(plugin); const pending = effects; effects = []; pending.forEach(run => run()); } return output; }
async function settle() { render(); for (let i = 0; i < 10; i++) await Promise.resolve(); render(); for (let i = 0; i < 10; i++) await Promise.resolve(); return render(); }
render(); await settle(); assert.deepEqual(calls.slice(0, 2), [["metadata", "D:/private/plugin/assets/logo.png"], ["read", "D:/private/plugin/assets/logo.png"]]);
deferred.shift().resolve(png.toString("base64")); await settle(); assert.equal(output.src, "blob:private-1");
output.onError(); await settle(); assert.ok(revoked.includes("blob:private-1")); assert.equal(calls.at(-1)[1], "D:/private/plugin/assets/dark.png");
deferred.shift().resolve(Buffer.from("<html>bad</html>").toString("base64")); await settle(); assert.equal(output.src, null);
plugin = { ...summary, id: "second" }; dirty = true; render(); await settle(); const oldRead = deferred.shift();
plugin = { ...summary, id: "third", interface: { logoUrl: "https://example.test/third.png" } }; dirty = true; render(); await settle(); oldRead.resolve(png.toString("base64")); await settle(); assert.equal(output.src, "https://example.test/third.png", "stale binary must not replace new scope");
plugin = summary; dirty = true; render(); await settle(); const lightRead = deferred.shift(); currentTheme = "dark"; mutations.at(-1).callback(); render(); await settle(); assert.equal(calls.at(-1)[1], "D:/private/plugin/assets/dark.png");
lightRead.resolve(png.toString("base64")); await settle(); assert.equal(output.src, null, "old theme cannot flash light logo");
deferred.shift().resolve(png.toString("base64")); await settle(); const latest = output.src; assert.match(latest, /^blob:/);
for (const slot of slots) slot?.cleanup?.(); assert.ok(revoked.includes(latest)); assert.ok(mutations.every(observer => observer.disconnected));
console.log("Plugin logo real filesystem parameters, fallback, bytes, theme, stale scope and cleanup passed.");
