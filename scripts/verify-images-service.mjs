import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
let hooks = [], cursor = 0;
const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
 useState: initial => { const index = cursor++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], value => { hooks[index] = value; }]; },
 useRef: initial => { const index = cursor++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; }, useEffect() {} }; React.default = React;
const load = path => { const exports = {}; vm.runInNewContext(compile(fs.readFileSync(path, "utf8")), { exports,
 require: name => { if (name === "react") return React; if (name === "../imageSave") return { saveGeneratedImageBytes() { assert.fail("render alone cannot save"); } }; if (name.endsWith(".css")) return {}; throw Error(`unexpected dependency ${name}`); },
 setTimeout() { assert.fail("no delayed fake images"); }, localStorage: { getItem() { assert.fail("no fake local gallery"); }, setItem() { assert.fail("no fake local generation"); } } }); return exports; };
const all = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(all)] : [];
// The Images route now has a real readonly service surface. Its actual JSX,
// listener/identity lifecycle and disabled write controls have a dedicated fixture.
await import("./verify-images-view.mjs");
const { generatedImageState: state, GeneratedImageCard: Card } = load("src/components/GeneratedImageCard.tsx");
const completed = result => ({ type: "imageGeneration", id: "generated", status: "completed", result });
assert.equal(state(completed("iVBORw0KGgo=")).src, "data:image/png;base64,iVBORw0KGgo=");
assert.equal(state(completed("data:image/png;base64,AA==")).src, "data:image/png;base64,AA==");
assert.equal(state(completed("https://example.invalid/image.png")).src, "https://example.invalid/image.png");
assert.equal(state(completed("D:/images/output.png")).path, "D:/images/output.png");
assert.equal(state({ ...completed("AAAA"), savedPath: "D:/saved.png" }).path, "D:/saved.png");
assert.match(state(completed("")).message, /未返回/);
assert.match(state({ ...completed(""), fileId: "attachment" }).message, /暂时无法读取/);
assert.match(state(completed("javascript:bad()")).message, /无法识别/);
for (const item of [{ ...completed("AAAA"), status: "failed" }, { ...completed("AAAA"), status: "inProgress" },
 { ...completed("AAAA"), status: "interrupted" }, { ...completed("AAAA"), failure: { type: "usageLimitExceeded", limitId: "image", resetsAt: 100 } }]) {
 assert.equal(state(item).src, undefined, "no success image for failed/pending/interrupted/limited result");
}
assert.match(state({ ...completed("AAAA"), status: "inProgress" }, "interrupted").message, /已中断/);
assert.match(state({ ...completed(""), failure: { type: "usageLimitExceeded", limitId: "image", resetsAt: 100 } }).message, /1970-01-01T00:01:40/);
let opened;
const render = item => { cursor = 0; return Card({ item, onOpenFile: path => { opened = path; } }); };
all(render(completed("D:/output.png"))).find(node => node.type === "button").props.onClick(); assert.equal(opened, "D:/output.png");
hooks = [];
const image = all(render(completed("AAAA"))).find(node => node.type === "img"); assert.ok(image); image.props.onError();
assert.ok(all(render(completed("AAAA"))).some(node => node.props.role === "alert"));
assert.ok(all(render(completed("BBBB"))).some(node => node.type === "img"), "new result can load after previous failure");
const app = fs.readFileSync("src/App.tsx", "utf8"); assert.ok(app.includes("<ImagesView />"));
assert.ok(app.includes('<GeneratedImageCard')); assert.ok(!app.includes("onStartChatWithImage="));
console.log("PASS IM01/IM04/IM05 production JSX: no fake gallery/generation; real inline/path previews, failure/limit/interruption/empty/fileId states, decode failure and revised-result recovery; no live generation or native save claim");
