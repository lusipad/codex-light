import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the production component, with only React commit/effects and IO
// controlled. Browser visibility and physical scrolling are separate checks.
const compiled = ts.transpileModule(fs.readFileSync("src/components/LibraryPagination.tsx", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText;
function fixture({ io = true, committedRef = true } = {}) {
  const hooks = [], effects = [], observers = [];
  let cursor = 0, tree;
  const react = {
    createElement(type, props, ...children) {
      const node = { type, props: props ?? {}, children };
      if (props?.ref) props.ref.current = committedRef ? node : null;
      return node;
    },
    useRef(initial) { const index = cursor++; return hooks[index] ??= { current: initial }; },
    useEffect(effect, deps) {
      const index = cursor++, previous = hooks[index];
      if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
        effects.push(() => { previous?.cleanup?.(); hooks[index] = { deps, cleanup: effect() }; });
      }
    },
  }; react.default = react; react.useLayoutEffect = react.useEffect;
  class Observer {
    constructor(callback, options) { this.callback = callback; this.options = options; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  }
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: name => { assert.equal(name, "react"); return react; },
    ...(io ? { IntersectionObserver: Observer } : {}) });
  return {
    observers,
    render(props) { cursor = 0; tree = exports.LibraryPagination(props); while (effects.length) effects.shift()(); return tree; },
    unmount() { hooks.forEach(hook => hook?.cleanup?.()); },
  };
}

const props = { hasNextPage: true, fetching: false, onLoadNextPage() {} };
let calls = 0;
let h = fixture();
const tree = h.render({ ...props, onLoadNextPage: () => { calls++; assert.equal(h.observers[0].disconnected, true, "disconnect before dispatch prevents a synchronous second entry"); } });
assert.equal(tree.type, "div"); assert.ok("data-library-pagination" in tree.props);
assert.equal(tree.props.onClick, undefined, "production sentinel must not grow a fixture-only button or click path");
assert.equal(h.observers.length, 1); assert.equal(h.observers[0].target, tree);
assert.equal(h.observers[0].options, undefined, "ordinary Library uses the official default viewport and margin");
const first = h.observers[0]; first.callback([{ isIntersecting: false }]); assert.equal(calls, 0);
first.callback([{ isIntersecting: false }, { isIntersecting: true }]); assert.equal(calls, 1);
first.callback([{ isIntersecting: true }]); assert.equal(calls, 1, "queued repeated notification cannot dispatch twice");
h.unmount(); first.callback([{ isIntersecting: true }]); assert.equal(calls, 1);

for (const disabled of [{ hasNextPage: false }, { fetching: true }]) {
  h = fixture(); h.render({ ...props, ...disabled, onLoadNextPage: () => calls++ });
  assert.equal(h.observers.length, 0, "no observer during in-flight read, terminal cursor or pagination error gate"); h.unmount();
}
h = fixture({ committedRef: false }); h.render(props); assert.equal(h.observers.length, 0, "no null DOM observation"); h.unmount();

h = fixture(); let oldCalls = 0, newCalls = 0;
h.render({ ...props, onLoadNextPage: () => oldCalls++ });
const beforeUpdate = h.observers[0];
h.render({ ...props, onLoadNextPage: () => newCalls++ });
assert.equal(h.observers.length, 1, "callback-only render updates the current callback without replacing the visibility observer");
beforeUpdate.callback([{ isIntersecting: true }]); assert.equal(oldCalls, 0); assert.equal(newCalls, 1);
h.unmount();

h = fixture(); h.render({ ...props, onLoadNextPage: () => oldCalls++ });
const old = h.observers[0]; h.render({ ...props, fetching: true, onLoadNextPage: () => newCalls++ });
assert.equal(old.disconnected, true); old.callback([{ isIntersecting: true }]); assert.equal(oldCalls, 0); assert.equal(newCalls, 1, "cleanup cancels already queued entries");
h.render({ ...props, onLoadNextPage: () => newCalls++ }); assert.equal(h.observers.length, 2);
h.observers[1].callback([{ isIntersecting: true }]); assert.equal(newCalls, 2); h.unmount();

for (const disabled of [{ hasNextPage: false }, { fetching: true }]) {
  h = fixture({ io: false }); let count = 0;
  h.render({ ...props, ...disabled, onLoadNextPage: () => count++ }); assert.equal(count, 0); h.unmount();
}
h = fixture({ io: false }); let fallback = 0;
h.render({ ...props, onLoadNextPage: () => fallback++ }); assert.equal(fallback, 1, "official missing-IO fallback immediately requests the next page");
h.render({ ...props, onLoadNextPage: () => fallback++ }); assert.equal(fallback, 1, "callback identity alone does not rerun fallback"); h.unmount();
h = fixture({ io: false }); h.render({ ...props, onLoadNextPage: () => fallback++ }); assert.equal(fallback, 2, "new page-key mount can continue an empty intermediate page"); h.unmount();
console.log("PASS 18I actual LibraryPagination: guarded default IO, intersect-only one-shot, disconnect-before-dispatch, latest callback, queued-entry cleanup, rearm on fetch completion, no-IO fallback and page-key remount; controlled lifecycle, not browser/native scrolling");
