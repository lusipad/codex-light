import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";

const settings = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
for (const unused of ["voiceEngine", "voiceAutoSendDelay", "voiceHotkey", "voiceEnabled", "voiceLanguage"]) {
  assert.ok(!settings.includes(unused), `VS01: remove ineffective ${unused}`);
}
assert.ok(settings.includes('activeSection === "voice" && <VoiceSettings />'));
assert.ok(settings.includes('activeSection !== "voice" && activeSection !== "archived-chats"'));
const source = fs.readFileSync("src/components/ComposerBox.tsx", "utf8");
const ast = ts.createSourceFile("ComposerBox.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = {};
function visit(node) {
  if (ts.isVariableDeclaration(node) && ["stopDictation", "toggleDictation"].includes(node.name.getText(ast))) {
    functions[node.name.getText(ast)] = node.initializer.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
let created = [], active = false, error = null, text = "prefix", starts = 0, stops = 0;
class Recognition {
  constructor() { created.push(this); }
  start() { starts++; }
  abort() { stops++; }
}
const scope = {
  window: { SpeechRecognition: Recognition }, navigator: { language: "zh-CN" },
  recognitionRef: { current: null }, dictationContext: { current: { key: "a", prompt: text } },
  setIsDictating: value => { active = value; }, setDictationError: value => { error = value; },
  onPromptInputChange: value => { text = value; scope.dictationContext.current.prompt = value; },
};
const context = vm.createContext(scope);
for (const name of ["stopDictation", "toggleDictation"]) {
  scope[name] = vm.runInContext(ts.transpileModule(`(${functions[name]})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
}
const result = (value, final) => Object.assign([{ transcript: value }], { isFinal: final });
scope.toggleDictation();
assert.equal(active, true);
assert.equal(starts, 1);
const first = created.at(-1), lateResult = first.onresult;
first.onresult({ results: [result("one ", true), result("tw", false)] });
assert.equal(text, "prefix one tw");
first.onresult({ results: [result("one ", true), result("two", true)] });
assert.equal(text, "prefix one two");
scope.toggleDictation();
assert.equal(active, false); assert.equal(stops, 1); assert.equal(starts, 1);
lateResult({ results: [result("late", true)] }); assert.equal(text, "prefix one two");
scope.toggleDictation(); const second = created.at(-1);
scope.dictationContext.current.key = "b";
second.onresult({ results: [result("wrong thread", true)] }); assert.equal(text, "prefix one two");
scope.stopDictation(); scope.toggleDictation(); const third = created.at(-1);
scope.dictationContext.current.prompt = "manual"; text = "manual";
third.onresult({ results: [result("overwrite", true)] }); assert.equal(text, "manual");
assert.equal(active, false);
scope.toggleDictation(); const fourth = created.at(-1);
fourth.onerror({ error: "not-allowed" });
assert.match(error, /not-allowed/); assert.equal(active, false);
scope.window.SpeechRecognition = class { start() { throw Error("start failed"); } abort() {} };
scope.toggleDictation(); assert.match(error, /start failed/); assert.equal(active, false);
scope.window.SpeechRecognition = undefined;
scope.toggleDictation(); assert.match(error, /不支持/);
scope.window.SpeechRecognition = Recognition;
scope.toggleDictation();
const unmounted = created.at(-1), oldResult = unmounted.onresult;
scope.stopDictation(false);
oldResult({ results: [result("after unmount", true)] });
assert.equal(text, "manual");
assert.ok(source.includes("return () => stopDictation(false);"));
assert.ok(source.includes("[dictationSessionKey]"));
const app = fs.readFileSync("src/App.tsx", "utf8");
assert.equal((app.match(/dictationSessionKey=\{promptDraftKey\}/g) || []).length, 2);
console.log("PASS VS01-VS04: remove ineffective settings; production dictation callbacks accumulate results, stop safely, isolate sessions/manual edits and surface failures");
const view = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/components/VoiceSettings.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText, { exports: view, require: name => {
  assert.equal(name, "react");
  return { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }) };
} });
const nodes = node => node && typeof node === "object" ? [node, ...node.children.flatMap(nodes)] : [];
const rendered = view.VoiceSettings();
assert.match(JSON.stringify(rendered), /尚未连接官方语音设置服务/);
assert.ok(nodes(rendered).some(node => node.props.role === "status"));
assert.ok(!nodes(rendered).some(node => ["input", "select", "button"].includes(node.type)));
console.log("PASS VS01 rendered cloud capability state without fake settings or save controls");
