import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the actual component, with React hooks and the native boundary controlled.
// This tests component behavior; it does not prove physical window or pixel parity.
const code = ts.transpileModule(fs.readFileSync("src/components/AppTitleBar.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function mount({ maximized = false, pendingListen = false, pendingQuery = false, native = true } = {}) {
  const values = [], effects = [], commands = [], queries = [];
  let cursor = 0, resize, unlistened = 0;
  const listener = deferred();
  const windowApi = {
    isMaximized: () => {
      if (!pendingQuery) return Promise.resolve(maximized);
      const query = deferred(); queries.push(query); return query.promise;
    },
    onResized: callback => {
      resize = callback;
      return pendingListen ? listener.promise : Promise.resolve(() => { unlistened++; });
    },
    minimize: async () => { commands.push("minimize"); },
    toggleMaximize: async () => { commands.push("maximize"); },
    close: async () => { commands.push("close"); },
  };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
    useId: () => "titlebar",
    useRef: value => ({ current: value }),
    useState: initial => {
      const index = cursor++;
      if (!(index in values)) values[index] = initial;
      return [values[index], value => { values[index] = value; }];
    },
    useEffect: callback => { effects.push(callback); },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    exports: module.exports,
    require: name => name === "react" ? react : name === "@tauri-apps/api/window" ? { getCurrentWindow: () => windowApi } : {},
    window: native ? { __TAURI_INTERNALS__: {} } : {}, console,
  });
  const render = () => {
    cursor = 0;
    return module.exports.AppTitleBar({ canGoBack: false, canGoForward: false, sidebarCollapsed: false, onCommand: x => commands.push(x) });
  };
  render();
  const cleanups = effects.map(effect => effect());
  const all = node => node && typeof node === "object" ? [node, ...node.children.flatMap(all)] : [];
  return {
    button: label => all(render()).find(node => node.type === "button" && node.props["aria-label"] === label),
    commands, queries,
    resize: async value => { maximized = value; resize(); await flush(); },
    cleanup: () => { for (const cleanup of cleanups) cleanup?.(); },
    completeListener: () => listener.resolve(() => { unlistened++; }),
    unlistened: () => unlistened,
  };
}

{
  const view = mount(); await flush();
  assert.ok(view.button("最大化"), "normal window must offer maximize");
  assert.equal(view.button("最大化").children[0].props.maximized, false);
  await view.button("最大化").props.onClick(); await flush();
  assert.deepEqual(view.commands, ["maximize"]);
  await view.resize(true);
  assert.ok(view.button("还原"), "native maximize must update accessible action and icon state");
  assert.equal(view.button("还原").props.title, "还原");
  assert.equal(view.button("还原").children[0].props.maximized, true);
  await view.resize(false);
  assert.ok(view.button("最大化"), "native restore must reset action");
  view.button("最小化").props.onClick(); view.button("关闭").props.onClick(); await flush();
  assert.deepEqual(view.commands, ["maximize", "minimize", "close"]);
  view.cleanup(); assert.equal(view.unlistened(), 1);
}
{
  const view = mount({ maximized: true }); await flush();
  assert.ok(view.button("还原"), "initially maximized windows must initialize correctly");
  view.cleanup();
}
{
  const view = mount({ pendingListen: true }); await flush(); view.cleanup();
  view.completeListener(); await flush();
  assert.equal(view.unlistened(), 1, "late listener registration must be released after unmount");
}
{
  const view = mount({ pendingQuery: true }); await flush();
  await view.resize(true);
  assert.ok(view.queries.length >= 2);
  view.queries.at(-1).resolve(true); await flush();
  view.queries[0].resolve(false); await flush();
  assert.ok(view.button("还原"), "stale initial query must not overwrite newer resize state");
  view.cleanup();
}
{
  const view = mount({ native: false }); await flush();
  view.button("最大化").props.onClick(); await flush();
  assert.deepEqual(view.commands, ["window-unavailable"]);
  view.cleanup();
}
{
  const view = mount({ pendingQuery: true }); await flush(); view.cleanup();
  view.queries[0].resolve(true); await flush();
  assert.ok(view.button("最大化"), "query completing after unmount must not update state");
}
console.log("PASS titlebar component: initial/maximize/restore, native commands, unmount/late subscription, stale query, browser fallback (L2)");
