import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true,
} }).outputText;
const all = node => node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(all)] : [];
const text = node => node && typeof node === "object" ? (node.children ?? []).map(text).join("") : typeof node === "string" ? node : "";
let activeRuntime, nextUrl = 0;
let lateUpdates = 0;
const revoked = [], reads = [], metadata = [], listeners = new Map(), saves = [], animationFrames = new Map(), observers = [], blobs = [];
let frameSequence = 0;
class DomNode {
  isConnected = true;
  attributes = {};
  scrollLeft = 0; scrollTop = 0;
  events = new Map(); captures = new Set();
  focus() { document.activeElement = this; }
  getAttribute(key) { return this.attributes[key]; }
  contains(target) { return all(this.node).some(node => node.dom === target); }
  querySelectorAll() { return all(this.node).filter(node => node.type === "button" && !node.props.disabled).map(node => node.dom); }
  getBoundingClientRect() { return { width: 800, height: 600, left: 0, top: 0 }; }
  addEventListener(name, callback) { this.events.set(name, callback); }
  removeEventListener(name, callback) { if (this.events.get(name) === callback) this.events.delete(name); }
  setPointerCapture(id) { this.captures.add(id); } hasPointerCapture(id) { return this.captures.has(id); } releasePointerCapture(id) { this.captures.delete(id); }
}
const document = { body: {}, activeElement: null, focused: true, hasFocus() { return this.focused; },
  addEventListener(name, callback) { const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set); },
  removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
};
const react = {
  Fragment: "fragment",
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useRef(initial) { const run = activeRuntime, i = run.cursor++; return run.slots[i] ??= { current: initial }; },
  useState(initial) { const run = activeRuntime, i = run.cursor++; if (!(i in run.slots)) run.slots[i] = typeof initial === "function" ? initial() : initial;
    return [run.slots[i], value => { if (run.unmounted) lateUpdates++; const next = typeof value === "function" ? value(run.slots[i]) : value; if (!Object.is(next, run.slots[i])) { run.slots[i] = next; run.dirty = true; } }]; },
  useMemo(factory, deps) { const run = activeRuntime, i = run.cursor++, old = run.slots[i]; if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) run.slots[i] = { deps, value: factory() }; return run.slots[i].value; },
  useEffect(effect, deps) { const run = activeRuntime, i = run.cursor++, old = run.slots[i]; if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) run.effects.push(() => { old?.cleanup?.(); run.slots[i] = { deps, cleanup: effect() }; }); },
};
const module = { exports: {} };
vm.runInNewContext(compile(fs.readFileSync("src/components/AppshotAttachment.tsx", "utf8")), {
  exports: module.exports, document, Node: DomNode, Uint8Array, Blob,
  window: { addEventListener(name, callback) { const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set); }, removeEventListener(name, callback) { listeners.get(name)?.delete(callback); } },
  ResizeObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } },
  requestAnimationFrame: callback => { animationFrames.set(++frameSequence, callback); return frameSequence; }, cancelAnimationFrame: id => animationFrames.delete(id),
  URL: class extends URL { static createObjectURL(blob) { blobs.push(blob); return `blob:appshot-${++nextUrl}`; } static revokeObjectURL(value) { revoked.push(value); } },
  require(name) {
    if (name === "react") return react;
    if (name === "react-dom") return { createPortal: child => ({ type: "portal", props: {}, children: [child] }) };
    if (name === "lucide-react") return { X: "close-icon" };
    if (name === "../imageSave") return { savePreviewImageBytes: src => new Promise((resolve, reject) => saves.push({ src, resolve, reject })) };
    if (name === "../fsClient") return {
      getMetadata: async path => { metadata.push(path); return { isFile: true, isDirectory: false }; },
      readFileBase64: path => new Promise((resolve, reject) => reads.push({ path, resolve, reject })),
      base64ToBytes: value => new Uint8Array(Buffer.from(value, "base64")),
    };
    return {};
  },
});
function mount(component, props) {
  const run = { cursor: 0, slots: [], effects: [], dirty: true, tree: null, props };
  const render = () => {
    for (let i = 0; run.dirty; i++) {
      assert.ok(i < 30, "hook render must settle"); run.dirty = false; run.cursor = 0; activeRuntime = run; run.tree = component(run.props);
      for (const node of all(run.tree)) {
        node.dom = node.props.ref?.current ?? new DomNode(); node.dom.node = node; node.dom.attributes = node.props;
        if (node.props.ref) node.props.ref.current = node.dom;
      }
      run.effects.splice(0).forEach(effect => effect());
    }
    for (const [id, callback] of animationFrames) { animationFrames.delete(id); callback(); }
    return run.tree;
  };
  render();
  return { render, find: predicate => all(render()).find(predicate), setProps(next) { run.props = next; run.dirty = true; render(); },
    unmount() { run.unmounted = true; for (const slot of run.slots) slot?.cleanup?.(); }, get tree() { return render(); } };
}
const flush = async mounted => { for (let i = 0; i < 12; i++) await Promise.resolve(); mounted.render(); };
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const context = { appName: "Private App", bundleIdentifier: "fixture", windowTitle: "  Window title  ", axTree: "line one\n<script>literal</script>\nline three", imagePath: null, imageName: "fixture.png", imageDataUrl: image };
const props = { id: "attachment-a", context };
const slot = mount(module.exports.AppshotAttachment, { id: "pending-only", context: null, pending: true, handoffHeightReady: false, onRemove: () => assert.fail("pending capture has no remove action") });
assert.equal(slot.find(node => node.props["data-appshot-attachment"] === "true").props["aria-busy"], undefined);
assert.equal(slot.find(node => node.props["data-appshot-attachment"] === "true").props.role, undefined);
assert.equal(slot.find(node => node.type === "img"), undefined, "pending does not invent an image");
assert.equal(slot.find(node => node.type === "button"), undefined, "pending is not previewable or removable");
const pendingStyle = slot.find(node => node.props["data-appshot-attachment"] === "true").props.style;
assert.equal(pendingStyle.height, 0); assert.equal(pendingStyle.width, 0); assert.equal(pendingStyle.flexBasis, 0);
assert.match(pendingStyle.marginRight, /\* -1/);
slot.unmount();
const card = mount(module.exports.AppshotAttachment, { ...props, pending: true });
assert.equal(card.find(node => node.props["data-appshot-attachment"] === "true").props.role, undefined);
assert.equal(card.find(node => node.type === "img"), undefined, "composer cannot use screenshot as transition placeholder");
assert.equal(card.find(node => node.props["data-appshot-attachment"] === "true").props.onClick, undefined);
card.setProps(props);
const trigger = card.find(node => node.props.role === "button");
assert.equal(trigger.props["aria-label"], "Window title");
assert.equal(trigger.props.style.height, 148);
trigger.props.onClick(); card.render();
const previewNode = card.find(node => typeof node.type === "function");
assert.ok(previewNode, "a real completed screenshot opens the dedicated preview");
const preview = mount(previewNode.type, previewNode.props);
assert.ok(preview.find(node => node.type === "img" && node.props.src === image));
assert.equal(listeners.get("focusin").size, 1);
const modal = preview.find(node => node.props.role === "dialog");
const controls = all(preview.tree).filter(node => node.type === "button" && !node.props.disabled);
document.activeElement = controls.at(-1).dom;
let tabPrevented = 0;
modal.props.onKeyDown({ key: "Tab", nativeEvent: {}, preventDefault() { tabPrevented++; } });
assert.equal(document.activeElement, controls[0].dom, "Tab wraps within preview");
modal.props.onKeyDown({ key: "Tab", shiftKey: true, nativeEvent: {}, preventDefault() { tabPrevented++; } });
assert.equal(document.activeElement, controls.at(-1).dom, "Shift+Tab wraps within preview");
assert.equal(tabPrevented, 2);
document.activeElement = new DomNode();
for (const contain of listeners.get("focusin")) contain({ target: document.activeElement });
assert.equal(document.activeElement, controls.at(-1).dom, "external DOM focus is contained while modal is open");
const toggle = preview.find(node => node.type === "button" && text(node) === "查看文本");
toggle.props.onClick(); preview.render();
assert.equal(text(preview.find(node => node.type === "pre")), context.axTree, "AX is literal text with original newlines");
assert.equal(text(preview.find(node => node.props.className === "appshot-text-heading")), "纯文本");
assert.ok(all(preview.tree).every(node => !node.props.dangerouslySetInnerHTML));
let prevented = 0, stopped = 0;
preview.find(node => node.props.role === "dialog").props.onKeyDown({ key: "Escape", nativeEvent: { isComposing: true }, preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
assert.equal(prevented, 0, "IME Escape must not close the preview");
preview.find(node => node.props.role === "dialog").props.onKeyDown({ key: "Escape", nativeEvent: {}, preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
assert.equal(prevented, 1); assert.equal(stopped, 1);
card.render(); assert.equal(card.find(node => typeof node.type === "function"), undefined);
preview.unmount(); assert.equal(listeners.get("focusin").size, 0); assert.equal(document.activeElement, trigger.dom);

const noText = mount(previewNode.type, { ...previewNode.props, text: " \n  " });
assert.equal(noText.find(node => node.type === "button" && text(node) === "查看文本"), undefined);
document.focused = false; document.activeElement = null; noText.unmount(); assert.equal(document.activeElement, null, "do not steal focus from another application"); document.focused = true;
const replaced = mount(previewNode.type, previewNode.props);
trigger.dom.attributes = { ...trigger.dom.attributes, "data-appshot-id": "replacement" };
document.activeElement = null; replaced.unmount();
assert.equal(document.activeElement, null, "closing a retired attachment must not focus a replacement card");
let removed = 0;
card.setProps({ ...props, onRemove: () => removed++ });
card.find(node => node.props["aria-label"] === "移除 Window title").props.onClick({ stopPropagation() { stopped++; } });
assert.equal(removed, 1); assert.equal(card.find(node => typeof node.type === "function"), undefined);
card.find(node => node.props.role === "button").props.onClick(); card.render();
card.setProps({ ...props, id: "other" });
card.setProps(props);
assert.equal(card.find(node => typeof node.type === "function"), undefined, "attachment A-B-A cannot resurrect an old preview");
card.setProps({ ...props, context: { ...context, transitionSnapshotDataUrl: image, transitionSnapshotHeight: 90 } });
assert.equal(card.find(node => node.props["data-appshot-attachment"] === "true").props.style.height, 98);
assert.equal(card.find(node => node.type === "img").props.src, image);
const thread = mount(module.exports.AppshotAttachment, { ...props, variant: "thread", context: { ...context, appIconDataUrl: image } });
assert.equal(text(thread.find(node => node.props.className === "appshot-thread-title")), "Window title");
assert.ok(thread.find(node => node.props.className === "appshot-app-icon"));
assert.ok(thread.find(node => node.type === "img" && node.props.alt === "Window title"));

const historical = mount(module.exports.AppshotAttachment, { id: "history-a", context: { ...context, imageDataUrl: null, imagePath: "file:///D:/private/first.png" } });
await flush(historical); assert.equal(reads.at(-1).path, "D:/private/first.png");
const oldRead = reads.at(-1);
historical.setProps({ id: "history-b", context: { ...context, imageDataUrl: null, imagePath: "D:/private/second.png" } }); await flush(historical);
oldRead.resolve(image.split(",")[1]); await flush(historical);
assert.equal(historical.find(node => node.props.role === "button"), undefined, "late historical image cannot enable a different attachment");
reads.at(-1).resolve(image.split(",")[1]); await flush(historical);
assert.ok(historical.find(node => node.props.role === "button"));
historical.unmount(); assert.ok(revoked.includes("blob:appshot-1"));
for (const path of ["https://example.test/image.png", "file://remote/private.png", "relative.png"]) {
  const before = reads.length;
  const blocked = mount(module.exports.AppshotAttachment, { id: path, context: { ...context, imageDataUrl: null, imagePath: path } });
  await flush(blocked); assert.equal(reads.length, before); assert.equal(blocked.find(node => node.props.role === "button"), undefined); blocked.unmount();
}
const failed = mount(module.exports.AppshotAttachment, { id: "bad", context: { ...context, imageDataUrl: null, imagePath: "D:/private/bad.png" } });
await flush(failed); reads.at(-1).resolve(Buffer.from("<html>not an image</html>").toString("base64")); await flush(failed);
assert.equal(failed.find(node => node.props.role === "button"), undefined);
assert.equal(text(failed.find(node => node.props.role === "status")), "无法加载快照图片"); failed.unmount();
card.unmount(); thread.unmount();
const complete = mount(previewNode.type, { ...previewNode.props, text: " \nplain text\n " });
assert.ok(complete.find(node => node.props["aria-label"] === "下载图片"), "the screenshot remains downloadable in both visual and text preview");
assert.equal(saves.length, 0, "mounting preview must not save a file");
complete.find(node => node.type === "img").props.onLoad({ currentTarget: { naturalWidth: 1600, naturalHeight: 1200 } }); complete.render();
assert.equal(text(complete.find(node => node.props.className === "appshot-preview-zoom")), "50%");
complete.find(node => node.props["aria-label"] === "放大图片").props.onClick(); complete.render();
assert.equal(text(complete.find(node => node.props.className === "appshot-preview-zoom")), "67%");
assert.equal(module.exports.dispatchImagePreviewZoom({ type: "reset-zoom" }), true); complete.render();
assert.equal(text(complete.find(node => node.props.className === "appshot-preview-zoom")), "50%");
const area = complete.find(node => node.props.className === "appshot-preview-viewport");
let wheelPrevented = 0;
area.dom.events.get("wheel")({ ctrlKey: false, preventDefault() { wheelPrevented++; } });
assert.equal(wheelPrevented, 0, "ordinary wheel keeps scrolling");
area.dom.events.get("wheel")({ ctrlKey: true, deltaMode: 0, deltaY: -200, clientX: 200, clientY: 100, preventDefault() { wheelPrevented++; }, stopPropagation() {} }); complete.render();
assert.equal(wheelPrevented, 1); assert.equal(text(complete.find(node => node.props.className === "appshot-preview-zoom")), "136%");
complete.find(node => node.props["aria-label"] === "下载图片").props.onClick(); complete.render();
assert.equal(saves.length, 1); assert.equal(saves[0].src, image);
complete.find(node => node.props["aria-label"] === "下载图片").props.onClick(); assert.equal(saves.length, 1, "pending save must not duplicate");
saves[0].resolve(null); await flush(complete); assert.equal(complete.find(node => node.props.role === "alert"), undefined, "cancel is not reported as saved or error");
complete.find(node => node.type === "button" && text(node) === "查看文本").props.onClick(); complete.render();
assert.equal(text(complete.find(node => node.type === "pre")), "plain text", "official text preview trims only outer whitespace");
assert.equal(complete.find(node => node.props.className === "appshot-preview-zoom"), undefined);
assert.equal(module.exports.dispatchImagePreviewZoom({ type: "step-zoom", delta: 1 }), true, "AX modal consumes global zoom without zooming the App"); complete.render();
assert.equal(complete.find(node => node.props.className === "appshot-preview-zoom"), undefined);
complete.find(node => node.props["aria-label"] === "下载图片").props.onClick(); saves.at(-1).reject(new Error("private failure")); await flush(complete);
assert.equal(text(complete.find(node => node.props.role === "alert")), "无法保存图片");
complete.find(node => node.type === "button" && text(node) === "查看文本").props.onClick(); complete.render();
module.exports.dispatchImagePreviewZoom({ type: "reset-zoom" }); complete.render();
const touchArea = complete.find(node => node.props.className === "appshot-preview-viewport");
const pointer = (id, x, y) => ({ pointerType: "touch", pointerId: id, clientX: x, clientY: y, currentTarget: touchArea.dom, preventDefault() {}, stopPropagation() {} });
touchArea.dom.scrollLeft = 80; touchArea.dom.scrollTop = 60;
touchArea.props.onPointerDownCapture(pointer(1, 100, 100));
touchArea.props.onPointerMoveCapture(pointer(1, 80, 70));
assert.equal(touchArea.dom.scrollLeft, 100); assert.equal(touchArea.dom.scrollTop, 90, "single-finger panning moves the actual viewport");
touchArea.props.onPointerDownCapture(pointer(2, 180, 70));
touchArea.props.onPointerMoveCapture(pointer(2, 280, 70)); complete.render();
assert.equal(text(complete.find(node => node.props.className === "appshot-preview-zoom")), "100%", "pinch scales from the two-finger distance ratio");
const movedArea = complete.find(node => node.props.className === "appshot-preview-viewport");
movedArea.props.onPointerCancelCapture(pointer(1, 80, 70)); movedArea.props.onPointerUpCapture(pointer(2, 280, 70));
assert.equal(touchArea.dom.captures.size, 0);
let outsideClosed = 0;
const outside = mount(previewNode.type, { ...previewNode.props, onClose: () => outsideClosed++ });
const outsideArea = outside.find(node => node.props.className === "appshot-preview-viewport");
outsideArea.props.onPointerDown({ target: outsideArea.dom, currentTarget: outsideArea.dom });
assert.equal(outsideClosed, 1, "empty image-viewport area closes the whole lightbox"); outside.unmount();
complete.find(node => node.props["aria-label"] === "下载图片").props.onClick();
const pendingSave = saves.at(-1), beforeLate = lateUpdates;
complete.unmount();
pendingSave.reject(new Error("late private failure")); for (let i = 0; i < 12; i++) await Promise.resolve();
assert.equal(lateUpdates, beforeLate, "a retired save cannot update an unmounted preview");
assert.equal(module.exports.dispatchImagePreviewZoom({ type: "reset-zoom" }), false);
assert.equal(listeners.get("resize").size, 0); assert.ok(observers.every(observer => observer.disconnected));
const gallery = mount(module.exports.UserImageAttachments, { id: "images", sources: [image, "data:image/png;base64,bad=", image] });
const thumbnails = all(gallery.tree).filter(node => typeof node.type === "function");
assert.equal(thumbnails.length, 3);
thumbnails[1].props.onUnavailable(); gallery.render();
const available = all(gallery.tree).filter(node => typeof node.type === "function");
available[0].props.onOpenChange(true); gallery.render();
available[0].props.onNext(); gallery.render();
assert.equal(all(gallery.tree).filter(node => typeof node.type === "function")[2].props.open, true, "gallery skips unavailable image and preserves source order");
available[0].props.onOpenChange(false); gallery.render();
assert.equal(all(gallery.tree).filter(node => typeof node.type === "function")[2].props.open, true, "late close from previous item cannot close the selected image");
gallery.setProps({ id: "other-images", sources: [image] });
available[0].props.onOpenChange(true); gallery.render();
assert.equal(all(gallery.tree).find(node => typeof node.type === "function").props.open, false, "retired gallery cannot open a new scope");
const thumb = mount(available[0].type, available[0].props);
assert.equal(thumb.find(node => node.props.role === "button").props["aria-label"], "用户附件");
thumb.find(node => node.type === "img").props.onError(); thumb.render();
assert.equal(thumb.find(node => node.props.role === "button"), undefined, "decoded image failure removes preview qualification");
thumb.unmount(); gallery.unmount();
// Tiny generated fixtures are encoded once, not a runtime dependency or network resource.
const formatFixtures = {
  png: image.split(",")[1],
  jpeg: "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJoAcC7/2Q==",
  gif: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  webp: "UklGRjgAAABXRUJQVlA4ICwAAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+9IiH/npmvMH+Tn/yC0rlu7AAAA==",
  avif: "AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAAXBtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAADRpbG9jAAAAAERAAAIAAQAAAAABlAABAAAAAAAAACMAAgAAAAABtwABAAAAAAAAABQAAAA4aWluZgAAAAAAAgAAABVpbmZlAgAAAAABAABhdjAxAAAAABVpbmZlAgAAAAACAABhdjAxAAAAAA5waXRtAAAAAAABAAAAr2lwcnAAAACKaXBjbwAAAAxhdjFDgSACAAAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQAcAAAAAA5waXhpAAAAAAEIAAAAOGF1eEMAAAAAdXJuOm1wZWc6bXBlZ0I6Y2ljcDpzeXN0ZW1zOmF1eGlsaWFyeTphbHBoYQAAAAAdaXBtYQAAAAAAAAACAAEDgQIDAAIEhAIFhgAAABppcmVmAAAAAAAAAA5hdXhsAAIAAQABAAAAP21kYXQSAAoHOAAGkBDQaTIWGUJjBMAANAAAkEDJHGFDnamzP6UHChIACgQYAAYVMgoYAAABAAIhG6Ng",
};
for (const [format, encoded] of Object.entries(formatFixtures)) {
  const source = `data:image/${format};base64,${encoded}`;
  const group = mount(module.exports.UserImageAttachments, { id: `format-${format}`, sources: [source] });
  const item = all(group.tree).find(node => typeof node.type === "function");
  const inline = mount(item.type, item.props);
  assert.ok(inline.find(node => node.props.role === "button"), `ordinary ${format} inline image keeps preview qualification`);
  inline.find(node => node.type === "img").props.onError(); inline.render();
  inline.setProps({ ...item.props });
  assert.equal(inline.find(node => node.props.role === "button"), undefined, `${format} decode failure cannot regain preview on rerender`);
  inline.unmount(); group.unmount();
  const localGroup = mount(module.exports.UserImageAttachments, { id: `file-${format}`, sources: [`D:/private/image.${format}`] });
  const localProps = all(localGroup.tree).find(node => typeof node.type === "function").props;
  const localItem = mount(item.type, localProps);
  await flush(localItem); reads.at(-1).resolve(encoded); await flush(localItem);
  assert.ok(localItem.find(node => node.props.role === "button"), `ordinary local ${format} remains previewable`);
  assert.equal(blobs.at(-1).type, `image/${format}`, `local ${format} preserves its actual Blob MIME`);
  const blobSource = localItem.find(node => node.type === "img").props.src;
  localItem.find(node => node.type === "img").props.onError(); localItem.render();
  localItem.setProps({ ...localProps });
  assert.equal(localItem.find(node => node.props.role === "button"), undefined, `local ${format} decode failure cannot be re-enabled by identical props`);
  localItem.unmount(); localGroup.unmount(); assert.ok(revoked.includes(blobSource));
  if (!["png", "jpeg"].includes(format)) {
    const captureOnly = mount(module.exports.AppshotAttachment, { id: `capture-${format}`, context: { ...context, imageDataUrl: source } });
    assert.equal(captureOnly.find(node => node.props.role === "button"), undefined, `ordinary ${format} support must not claim a new Appshot capture format`);
    captureOnly.unmount();
  }
}
const corruptWebp = Buffer.from(formatFixtures.webp, "base64"); corruptWebp[4]++;
const badAvif = Buffer.alloc(24); badAvif.writeUInt32BE(16); badAvif.write("ftypmif1", 4); badAvif.write("avif", 16);
for (const [format, bytes] of [["webp", corruptWebp], ["avif", badAvif], ["gif", Buffer.from("not-a-gif-file")]]) {
  const blockedGroup = mount(module.exports.UserImageAttachments, { id: `corrupt-${format}`, sources: [`D:/private/corrupt.${format}`] });
  const blockedNode = all(blockedGroup.tree).find(node => typeof node.type === "function");
  const blockedItem = mount(blockedNode.type, blockedNode.props), before = blobs.length;
  await flush(blockedItem); reads.at(-1).resolve(bytes.toString("base64")); await flush(blockedItem);
  assert.equal(blobs.length, before, `malformed ${format} cannot be wrapped in a misleading image Blob`);
  assert.equal(blockedItem.find(node => node.props.role === "button"), undefined);
  blockedItem.unmount(); blockedGroup.unmount();
}
const avifGroup = mount(module.exports.UserImageAttachments, { id: "avif-download", sources: [`data:image/avif;base64,${formatFixtures.avif}`] });
const avifNode = all(avifGroup.tree).find(node => typeof node.type === "function");
const avifItem = mount(avifNode.type, { ...avifNode.props, open: true });
const avifPreviewNode = avifItem.find(node => typeof node.type === "function");
const avifPreview = mount(avifPreviewNode.type, avifPreviewNode.props);
avifPreview.find(node => node.type === "img").props.onLoad({ currentTarget: { naturalWidth: 1, naturalHeight: 1 } }); avifPreview.render();
avifPreview.find(node => node.props["aria-label"] === "下载图片").props.onClick();
assert.match(saves.at(-1).src, /^data:image\/avif;/, "ordinary AVIF uses the current shared preview save boundary");
saves.at(-1).resolve(null); await flush(avifPreview);
avifPreview.unmount(); avifItem.unmount(); avifGroup.unmount();
console.log("Appshot dedicated card, pending, literal AX, Escape/focus cleanup, actual image sources and historical-file lifecycle passed; native/pixel parity not verified.");
