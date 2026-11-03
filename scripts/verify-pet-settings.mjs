import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";

const app = fs.readFileSync("src/App.tsx", "utf8");
assert.ok(!app.includes('if (!prev || prev === "codex") return list[0].id'), "PT02 refresh cannot silently select first pet");
const compile = path => ts.transpileModule(fs.readFileSync(path, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
let slots = [], cursor = 0, effects = [], state, invoke;
const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
  useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial }; },
  useEffect: fn => effects.push(fn),
};
const production = {};
let decodeFailure = false;
class DecodedImage {
  naturalWidth = 1536; naturalHeight = 2288;
  set src(value) { Promise.resolve().then(() => decodeFailure ? this.onerror() : this.onload()); }
}
vm.runInNewContext(compile("src/petPreferences.ts"), { exports: production,
  Image: DecodedImage,
  require: name => name === "react" ? react : { tauriInvoke: (...args) => invoke(...args) },
});
let stored = { selectedAvatarId: null, petSize: 112, petVisibility: "always-visible" }, pets = [], writes = 0;
invoke = async (command, args) => {
  if (command === "pets_list_installed") return pets;
  if (command === "pet_preferences_update") { writes++; stored = { ...stored, ...args.patch }; }
  return stored;
};
const render = () => { cursor = 0; effects = []; state = production.usePetPreferences(); };
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
render(); const cleanup = effects[0](); await flush(); render();
assert.equal(state.ready, true); assert.equal(state.preferences.petSize, 112);
assert.equal(await state.save({ petSize: 160 }), true); render();
assert.equal(state.preferences.petSize, 160);
assert.equal(stored.selectedAvatarId, null);
await assert.rejects(async () => production.parsePetPreferences({ ...stored, petSize: 79 }), /格式/);
await assert.rejects(async () => production.parsePetPreferences({ ...stored, petSize: 112.5 }), /格式/);
assert.equal(await state.save({ selectedAvatarId: "missing" }), false);
assert.equal(writes, 1, "unknown asset cannot be saved");
await state.load(); render();
let release;
invoke = async command => {
  if (command === "pet_preferences_update") { writes++; return new Promise(resolve => { release = resolve; }); }
  return command === "pets_list_installed" ? [] : stored;
};
const first = state.save({ petVisibility: "on-demand" });
await state.save({ petVisibility: "on-demand" });
assert.equal(writes, 2);
stored = { ...stored, petVisibility: "on-demand" };
release(stored); assert.equal(await first, true); render();
assert.equal(state.preferences.petVisibility, "on-demand");
invoke = async command => {
  if (command === "pet_preferences_update") return { ...stored, petSize: 200 };
  if (command === "pets_list_installed") return [];
  throw Error("readback unavailable");
};
assert.equal(await state.save({ petSize: 200 }), false); render();
assert.equal(state.preferences.petSize, 160); assert.equal(state.ready, false);
assert.match(state.error, /readback unavailable/);
invoke = async command => command === "pets_list_installed" ? [] : stored;
await state.load(); render(); assert.equal(state.ready, true);
invoke = async command => command === "pet_preferences_update" ? new Promise(resolve => { release = resolve; }) : stored;
const late = state.save({ petSize: 170 }); cleanup(); const before = slots.slice();
release({ ...stored, petSize: 170 }); await late;
assert.deepEqual(slots, before);
console.log("PASS PT01/PT03: production preferences/readback, bounds, no unknown asset, single-flight, failed-readback lock, retry and unmount");

slots = []; pets = [{ id: "one", displayName: "One", spriteVersionNumber: 2, spritesheetDataUrl: "data:image/webp;base64,c2hlZXQ=" }];
invoke = async command => command === "pets_list_installed" ? pets : stored;
render(); let dispose = effects[0](); await flush(); render();
assert.equal(state.pets.length, 1); assert.equal(state.preferences.selectedAvatarId, null, "loading does not select first pet");
pets = []; await state.load(); render();
assert.equal(state.pets.length, 0, "empty refresh clears obsolete assets");
pets = [{ id: "one", displayName: "One", spriteVersionNumber: 2, spritesheetDataUrl: "data:image/webp;base64,bad" }];
decodeFailure = true; await state.load(); render();
assert.equal(state.ready, false); assert.match(state.error, /无法解码/); dispose();
console.log("PASS PT02: empty-refresh clearing and browser-decoder failure gate; mocked decoder does not prove actual WebP service integration");

slots = []; let miniTree, sendCount = 0, sendResult, closed = 0;
const listeners = new Map(), mini = {};
vm.runInNewContext(compile("src/components/MiniPetWidget.tsx"), {
  exports: mini, setTimeout: () => 1, clearTimeout: () => {},
  document: { addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name) },
  require: name => name === "react" ? react : name === "../types" ? { PET_SPECIES_LIST: [{ id: "codex", name: "Local", emoji: "*" }] }
    : name === "./PetSprite" ? { PetSprite: "PetSprite" } : {},
});
const miniProps = { visible: true, species: "one", size: 160, visibility: "on-demand", isStreaming: false,
  installedPets: [{ id: "one", displayName: "One", spritesheetDataUrl: "data:image/webp;base64,x", spriteVersionNumber: 1 }],
  onQuickPrompt: async () => { sendCount++; return new Promise(resolve => { sendResult = resolve; }); }, onClose: () => closed++ };
const renderMini = () => { cursor = 0; effects = []; miniTree = mini.MiniPetWidget(miniProps); };
const nodes = node => node && typeof node === "object" ? [node, ...node.children.flatMap(nodes)] : [];
const input = () => nodes(miniTree).find(node => node.type === "input");
const avatar = () => nodes(miniTree).find(node => node.props["data-testid"] === "avatar-mascot-button");
renderMini(); const miniCleanup = effects[0](); const outsideCleanup = effects[1]();
miniTree.props.ref.current = { contains: () => false };
listeners.get("click")({ target: {} }); assert.equal(closed, 1);
outsideCleanup(); assert.equal(listeners.has("click"), false);
assert.equal(avatar().props.style.width, 160);
assert.equal(nodes(miniTree).find(node => node.type === "PetSprite").props.spriteVersionNumber, 1);
avatar().props.onClick(); renderMini();
input().props.onChange({ target: { value: "draft" } }); renderMini();
input().props.onKeyDown({ key: "Enter", nativeEvent: { isComposing: true }, preventDefault: () => assert.fail() });
assert.equal(sendCount, 0);
const sendButton = () => nodes(miniTree).find(node => node.props.title === "Send message (Enter)");
const request = sendButton().props.onClick(); await sendButton().props.onClick();
assert.equal(sendCount, 1);
sendResult(false); await request; renderMini();
assert.equal(input().props.value, "draft"); assert.match(JSON.stringify(miniTree), /发送结果未确认/);
const accepted = sendButton().props.onClick(); sendResult(true); await accepted; renderMini();
assert.equal(input(), undefined);
avatar().props.onClick(); renderMini();
assert.equal(input().props.value, "");
input().props.onChange({ target: { value: "retry" } }); renderMini();
const final = sendButton().props.onClick(); miniCleanup(); const snapshot = slots.slice();
sendResult(true); await final; assert.deepEqual(slots, snapshot);
miniProps.species = "missing"; renderMini();
assert.match(JSON.stringify(miniTree), /宠物不可用/);
console.log("PASS PT04: production Mini size/version, on-demand cleanup, IME, send single-flight, failed draft retention, acknowledged cleanup, unmount isolation and missing-resource state");

slots = []; let settingsTree, patches = [];
const settings = {};
vm.runInNewContext(compile("src/components/PetsSettings.tsx"), { exports: settings,
  require: name => name === "react" ? react : name === "../types" ? { PET_SPECIES_LIST: [] }
    : name === "../bridge" ? { tauriInvoke: async () => { throw Error("folder failed"); } } : { PetSprite: "PetSprite" },
});
const settingsState = { preferences: stored, pets: [], ready: true, busy: false, error: null,
  save: async patch => { patches.push(patch); return true; }, load: async () => {} };
const renderSettings = () => { cursor = 0; effects = []; settingsTree = settings.PetsSettings({ state: settingsState, visible: false, onSetVisible: () => {} }); };
renderSettings(); const range = nodes(settingsTree).find(node => node.type === "input");
assert.equal(range.props.min, 80); assert.equal(range.props.max, 224);
await range.props.onKeyUp({ currentTarget: { value: "180" } });
assert.equal(patches.at(-1).petSize, 180);
await range.props.onPointerUp({ currentTarget: { value: "200" } });
assert.equal(patches.at(-1).petSize, 200);
const buttonText = node => node.children.join("");
settingsState.preferences = { ...stored, petSize: 112 };
renderSettings();
nodes(settingsTree).find(node => node.type === "input").props.onChange({ target: { value: "201" } });
renderSettings();
assert.equal(nodes(settingsTree).find(node => node.type === "input").props.value, 201);
await nodes(settingsTree).find(node => node.type === "button" && buttonText(node) === "重置大小").props.onClick();
assert.equal(patches.at(-1).petSize, 112);
renderSettings();
assert.equal(nodes(settingsTree).find(node => node.type === "input").props.value, 112, "reset also clears unsaved draft when persisted size already equals default");
await nodes(settingsTree).find(node => node.type === "button" && buttonText(node) === "打开本地宠物目录").props.onClick();
renderSettings(); assert.match(JSON.stringify(settingsTree), /folder failed/);
const view = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
assert.ok(view.includes('<PetsSettings state={petPreferencesState}'));
assert.ok(!view.includes("setPetScale") && !view.includes("setPetVisibility"));
console.log("PASS PT03 actual settings slider keyboard/pointer/reset writes, folder failure and shared state wiring");
