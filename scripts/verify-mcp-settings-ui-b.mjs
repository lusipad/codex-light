import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export function mcpFixture(entries = []) {
  const config = { mcp_servers: Object.fromEntries(entries.filter(row => row.source === "user").map(row => [row.name, row.userRaw])) };
  return { cwd: "C:/isolated", snapshot: { config, origins: {}, layers: [] }, requirements: null,
    userLayer: { filePath: "C:/isolated/home/config.toml", version: "v1", config }, entries };
}
export function mcpEntry(name, raw = { command: "node", enabled: true }, source = "user") {
  return { name, raw, userRaw: source === "user" ? raw : null, transport: typeof raw.command === "string" ? "stdio" : typeof raw.url === "string" ? "http" : "unknown",
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : raw.enabled == null ? true : null, source, readOnlyReason: source === "user" ? null : "来源只读" };
}
export function createMcpSettingsHarness(options = {}) {
  let slots = [], cursor = 0, effects = [], scheduled = [], changed = false, tree, state, focused = "";
  const calls = [], frames = [], listeners = new Map(), windows = new Map(), oldCallbackRefs = [];
  let fixture = options.snapshot ?? mcpFixture(), read = options.read ?? (async () => fixture), write = options.write ?? (async () => { throw Error("fixture write not configured"); });
  let protocol = options.protocol ?? (async () => ({ data: [], nextCursor: null })), restart = options.restart ?? (async () => ({}));
  let guard = null, updated = 0, stateUpdates = 0;
  const props = { cwd: "C:/isolated", connectionIdentity: "connected:one", onConfigUpdated: () => { updated++; }, onRestartAppServer: () => restart(), onNavigationGuardChange: value => { guard = value; } };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { changed = true; stateUpdates++; } slots[index] = next; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useEffect(callback, deps) {
      const index = cursor++, old = effects[index];
      if (!old || !deps || deps.some((value, i) => !Object.is(value, old.deps[i]))) scheduled.push(() => { old?.cleanup?.(); effects[index] = { deps, cleanup: callback() }; });
    },
  };
  const bridge = {
    callAppServer: (...args) => { calls.push(args); return protocol(...args); },
    tauriListen: async (name, callback) => { const set = listeners.get(name) || new Set(); listeners.set(name, set); set.add(callback); return () => set.delete(callback); },
    isTauriRuntime: () => false, tauriInvoke: async () => ({}),
  };
  const window = {
    addEventListener(name, callback) { const set = windows.get(name) || new Set(); windows.set(name, set); set.add(callback); },
    removeEventListener(name, callback) { windows.get(name)?.delete(callback); },
  };
  function load(file, imports) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
    }).outputText, { exports, window, require: name => name === "react" ? react : name.endsWith(".css") ? {} : imports[name], requestAnimationFrame: callback => frames.push(callback) });
    return exports;
  }
  const status = load("src/mcpStatus.ts", { "./bridge": bridge });
  const core = load("src/mcpSettingsState.ts", { "./bridge": bridge, "./mcpStatus": status, "./mcpSettings": {
    readMcpSettings: cwd => { calls.push(["read-config", cwd]); return read(cwd); },
    writeMcpServer: (before, action) => { calls.push(["write-config", before, action]); return write(before, action); },
  } });
  const { McpSettings } = load("src/components/McpSettings.tsx", { "../mcpSettingsState": { ...core, useMcpSettingsState: args => (state = core.useMcpSettingsState(args)) },
    "../bridge": bridge, "./Icons": { CloseIcon: () => null } });
  const nodes = node => node && typeof node === "object" ? [node, ...(node.children || []).flatMap(nodes)] : [];
  const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
  const modal = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const render = () => {
    let count = 0;
    do {
      assert.ok(count++ < 12, "production hook effects must converge"); cursor = 0; changed = false;
      oldCallbackRefs.splice(0).forEach(ref => ref(null)); tree = McpSettings(props);
      for (const node of nodes(tree)) {
        const element = { focus() { focused = node.props.id || node.props["aria-label"] || text(node); } };
        if (typeof node.props.ref === "function") { node.props.ref(element); oldCallbackRefs.push(node.props.ref); }
        else if (node.props.ref) node.props.ref.current = node.type === "dialog" ? modal : element;
      }
      scheduled.splice(0).forEach(effect => effect());
    } while (changed);
    frames.splice(0).forEach(callback => callback()); return tree;
  };
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  return { props, calls, core, nodes, text, modal, render, settle,
    async tick() { await settle(); render(); },
    get tree() { return tree; }, get state() { return state; }, get guard() { return guard; }, get focused() { return focused; }, get updated() { return updated; },
    get updateCount() { return stateUpdates; },
    setFixture(value) { fixture = value; }, setRead(value) { read = value; }, setWrite(value) { write = value; }, setProtocol(value) { protocol = value; }, setRestart(value) { restart = value; },
    button(label) { const found = nodes(tree).find(node => node.type === "button" && text(node) === label); assert.ok(found, `button ${label}`); return found; },
    input(id) { const found = nodes(tree).find(node => node.props.id === id); assert.ok(found, `input ${id}`); return found; },
    emit(name, payload = {}) { for (const callback of listeners.get(name) || []) callback(payload); },
    focus() { for (const callback of windows.get("focus") || []) callback(); },
    unmount() { effects.forEach(effect => effect?.cleanup?.()); oldCallbackRefs.splice(0).forEach(ref => ref(null)); },
    get listenerCount() { return [...listeners.values(), ...windows.values()].reduce((sum, set) => sum + set.size, 0); },
    values() { return slots.filter(value => value === null || typeof value !== "object"); },
  };
}

async function verify() {
  const h = createMcpSettingsHarness({ snapshot: mcpFixture([
    mcpEntry("user_server", { command: "node", args: ["arg with spaces", ""], env: { visible: "old", unknown: { preserve: true } }, startup_timeout_sec: 42, enabled: true }),
    mcpEntry("project_server", { command: "node", enabled: true }, "project"),
    mcpEntry("plugin_server", { url: "https://example.invalid/mcp" }, "plugin"),
  ]), protocol: async () => ({ data: [{ name: "status_only", authStatus: "notLoggedIn", tools: {} }], nextCursor: null }) });
  h.render(); await h.tick();
  const { core } = h;
  const draft = core.mcpDraft();
  draft.label = "  My . SERVER  "; draft.command = " node "; draft.args = ["arg with spaces", "", '"quoted"'];
  draft.env = [{ key: " KEY ", value: " value " }, { key: "EMPTY", value: "" }, { key: "", value: "drop" }];
  draft.envVars = [" A ", " ", "B"]; draft.cwd = " C:/with spaces ";
  const serialized = JSON.parse(JSON.stringify(core.serializeMcpDraft(draft)));
  assert.deepEqual(serialized, { command: " node ", args: ["arg with spaces", "", '"quoted"'], env: { " KEY ": " value ", EMPTY: "" }, env_vars: ["A", "B"], cwd: " C:/with spaces " });
  assert.equal(core.generateMcpServerKey(draft.label, ["my_-_server"]), "my_-_server-2");
  draft.transport = "http"; draft.url = "  custom raw URL  "; draft.bearer = " TOKEN ";
  draft.headers = [{ key: " x-test ", value: "" }, { key: "x-test", value: " later " }];
  draft.envHeaders = [{ key: " x-env ", value: " ENV " }, { key: "empty", value: " " }];
  assert.deepEqual(JSON.parse(JSON.stringify(core.serializeMcpDraft(draft))), { url: "  custom raw URL  ", bearer_token_env_var: "TOKEN", http_headers: { "x-test": " later " }, env_http_headers: { "x-env": "ENV" } });
  assert.ok(h.text(h.tree).includes("来自插件")); assert.ok(h.text(h.tree).includes("status_only"));
  assert.equal(h.nodes(h.tree).find(node => node.props["aria-label"] === "project_server 启用").props.disabled, true);
  assert.ok(!h.nodes(h.tree).some(node => node.props["aria-label"] === "plugin_server 启用"));
  assert.ok(!h.text(h.tree).includes("快速预设"));
  console.log("PASS MCP-B01: production draft/serializer preserves exact array/map semantics and slug collisions; user/project/plugin/status-only rows use truthful controls without presets");

  h.nodes(h.tree).find(node => node.props["aria-label"] === "user_server 设置").props.onClick(); h.render(); await h.tick();
  assert.equal(h.input("mcp-detail-name").props.disabled, true); assert.equal(h.input("mcp-detail-transport").props.disabled, true);
  assert.ok(h.text(h.tree).includes("更新 user_server MCP"));
  const initial = h.state.editor.initial;
  const modified = { ...h.state.editor.draft, env: [{ key: "visible", value: "new" }] };
  const changes = core.mcpDraftChanges(initial, modified);
  assert.deepEqual(JSON.parse(JSON.stringify(changes)), { env: { visible: "new", unknown: { preserve: true } } }, "unknown map values not exposed by fields must survive string-row edits");
  h.state.change(modified); h.render();
  let release;
  h.setWrite(() => new Promise(resolve => { release = resolve; }));
  h.button("保存").props.onClick(); h.button("保存").props.onClick(); h.render();
  assert.equal(h.calls.filter(([name]) => name === "write-config").length, 1); assert.equal(h.guard(() => assert.fail("busy navigation")), false);
  const sent = h.calls.find(([name]) => name === "write-config");
  assert.equal(sent[1].userLayer.version, "v1"); assert.deepEqual(JSON.parse(JSON.stringify(sent[2])), { type: "update", name: "user_server", changes: { env: { visible: "new", unknown: { preserve: true } } } });
  release({ verification: "rejected", snapshot: sent[1], requiresRestart: false, error: "CAS conflict" }); await h.tick();
  assert.ok(h.text(h.tree).includes("CAS conflict")); assert.equal(h.state.editor.draft.env[0].value, "new");
  h.button("返回").props.onClick(); h.render(); assert.equal(h.modal.open, true);
  h.button("继续编辑").props.onClick(); h.render(); assert.equal(h.state.editor.draft.env[0].value, "new");
  let navigation = 0, clean;
  h.guard(() => { clean = h.guard(() => {}); navigation++; }); h.render(); h.button("放弃更改").props.onClick(); h.render();
  assert.equal(navigation, 1); assert.equal(clean, true); assert.equal(h.focused, "user_server 设置");
  console.log("PASS MCP-B02: actual embedded edit UI locks transport/key, sends only changes from original CAS snapshot, preserves unknown maps, single-flight/failure drafts and synchronous dirty-navigation discard");

  h.button("添加服务器").props.onClick(); h.render();
  h.input("mcp-detail-name").props.onChange({ target: { value: "HTTP Test" } }); h.render();
  h.input("mcp-detail-transport").props.onChange({ target: { value: "http" } }); h.render();
  h.input("mcp-detail-url").props.onChange({ target: { value: "raw URL preserved" } }); h.render();
  assert.equal(h.button("保存").props.disabled, false, "official editor does not invent a URL-connectivity preflight");
  const before = h.state.editor.snapshot;
  h.setWrite(async () => ({ verification: "pending", snapshot: null, requiresRestart: true, error: "delivery unknown" }));
  h.button("保存").props.onClick(); await h.tick(); const pendingCalls = h.calls.filter(([name]) => name === "write-config").length;
  h.button("保存").props.onClick(); await h.tick(); assert.equal(h.calls.filter(([name]) => name === "write-config").length, pendingCalls);
  assert.ok(h.state.pending); assert.equal(h.input("mcp-detail-url").props.value, "raw URL preserved");
  const added = mcpEntry("http_test", { url: "raw URL preserved", enabled: true });
  const after = { ...before, userLayer: { ...before.userLayer, version: "v2" }, entries: [...before.entries, added] };
  h.setFixture(after); await h.state.reload(); h.render(); assert.equal(h.state.editor, null); assert.equal(h.state.pending, false); assert.equal(h.state.requiresRestart, true);
  assert.equal(h.calls.filter(([name]) => name === "write-config").length, pendingCalls);
  const restartGate = {};
  let restarts = 0;
  h.setRestart(() => { restarts++; return new Promise((resolve, reject) => { restartGate.resolve = resolve; restartGate.reject = reject; }); });
  h.nodes(h.tree).find(node => node.props["aria-label"] === "http_test 设置").props.onClick(); h.render();
  h.state.change({ ...h.state.editor.draft, url: "dirty before restart" }); h.render();
  h.button("重启").props.onClick(); h.render();
  assert.equal(h.modal.open, true, "restarting with an unsaved draft requires explicit discard confirmation");
  assert.equal(restarts, 0, "the app-server must not restart before the dirty navigation guard is accepted");
  h.button("继续编辑").props.onClick(); h.render(); assert.equal(h.state.editor.draft.url, "dirty before restart"); assert.equal(restarts, 0);
  h.button("重启").props.onClick(); h.render(); h.button("放弃更改").props.onClick(); h.render();
  assert.equal(restarts, 1); assert.equal(h.guard(() => {}), false); restartGate.reject(Error("restart denied")); await h.tick();
  assert.equal(h.state.requiresRestart, true); assert.ok(h.text(h.tree).includes("restart denied"));
  h.setRestart(async () => { h.props.connectionIdentity = "disconnected:one"; h.render(); await h.tick(); h.props.connectionIdentity = "connected:two"; h.render(); await h.tick(); });
  const successfulRestart = h.state.restart(); h.render(); await successfulRestart; await h.tick();
  assert.equal(h.state.requiresRestart, false, "confirmed restart and real status reads survive connection prop changes");
  console.log("PASS MCP-B03: HTTP creation, pending delivery only verifies without replay, restart failure keeps dirty state and explicit successful restart/status readback survives reconnect epochs");

  h.nodes(h.tree).find(node => node.props["aria-label"] === "http_test 设置").props.onClick(); h.render();
  h.state.change({ ...h.state.editor.draft, url: "unsaved external draft" }); h.render();
  h.setFixture({ ...after, userLayer: { ...after.userLayer, version: "v3" } }); h.emit("mcp-settings-changed"); await h.tick();
  assert.equal(h.state.editor.draft.url, "unsaved external draft"); assert.equal(h.state.externalChange, true);
  h.button("重新加载").props.onClick(); h.render(); h.button("继续编辑").props.onClick(); h.render(); assert.equal(h.state.editor.draft.url, "unsaved external draft");
  h.button("重新加载").props.onClick(); h.render(); h.button("放弃更改").props.onClick(); await h.tick(); assert.equal(h.state.editor.draft.url, "raw URL preserved");
  h.setWrite(async (snapshot, action) => {
    assert.equal(action.type, "remove");
    const exposed = { ...snapshot, entries: snapshot.entries.map(entry => entry.name === "http_test" ? mcpEntry("http_test", { url: "lower layer" }, "project") : entry) };
    h.setFixture(exposed); return { verification: "confirmed", snapshot: exposed, requiresRestart: true, error: null };
  });
  h.button("卸载").props.onClick(); await h.tick(); assert.equal(h.state.editor, null);
  assert.equal(h.nodes(h.tree).find(node => node.props["aria-label"] === "http_test 启用").props.disabled, true, "uninstall may expose a truthful lower read-only layer");
  let lateRead;
  h.setRead(() => new Promise(resolve => { lateRead = resolve; })); h.focus(); h.render();
  const nextScope = mcpFixture([mcpEntry("next_workspace")]); h.setRead(async () => nextScope); h.props.cwd = "C:/next"; h.render(); await h.tick();
  lateRead(after); await h.tick(); assert.ok(h.text(h.tree).includes("next_workspace")); assert.ok(!h.text(h.tree).includes("http_test"));
  h.unmount(); await h.settle(); assert.equal(h.listenerCount, 0); assert.equal(h.guard, null);
  console.log("PASS MCP-B04: cross-window draft/CAS conflict protection, explicit reload, single-server uninstall exposes lower layer, workspace-late read and unmount listeners/guard isolation");

  const uninstallRaw = { command: "node", enabled: true };
  const uninstallBefore = mcpFixture([mcpEntry("remove_pending", uninstallRaw)]);
  const pendingRemove = createMcpSettingsHarness({ snapshot: uninstallBefore,
    write: async () => ({ verification: "pending", snapshot: null, requiresRestart: true, error: "remove delivery unknown" }) });
  pendingRemove.render(); await pendingRemove.tick();
  pendingRemove.state.open(pendingRemove.state.entries[0]); pendingRemove.render(); await pendingRemove.state.remove(); pendingRemove.render();
  assert.equal(pendingRemove.state.pending, true);
  const overlayEntry = { ...mcpEntry("remove_pending", { command: "project-node" }, "project"), userRaw: uninstallRaw };
  const overlay = { ...uninstallBefore, entries: [overlayEntry] };
  pendingRemove.setFixture(overlay); await pendingRemove.state.reload(); pendingRemove.render();
  assert.equal(pendingRemove.state.pending, true, "a higher project origin cannot prove the pending user uninstall was applied");
  assert.ok(pendingRemove.state.editor); assert.match(pendingRemove.state.error, /remove delivery unknown/);
  for (const userLayer of [null,
    { ...overlay.userLayer, config: { mcp_servers: null } },
    { ...overlay.userLayer, config: { mcp_servers: [] } },
    { ...overlay.userLayer, filePath: "C:/other/config.toml", config: {} }]) {
    pendingRemove.setFixture({ ...overlay, userLayer }); await pendingRemove.state.reload(); pendingRemove.render();
    assert.equal(pendingRemove.state.pending, true, "missing, malformed or different user layers cannot confirm the original uninstall");
  }
  pendingRemove.setFixture({ ...overlay, userLayer: { ...overlay.userLayer, config: { ...overlay.userLayer.config, mcp_servers: {} } }, entries: [{ ...overlayEntry, userRaw: null }] });
  await pendingRemove.state.reload(); pendingRemove.render();
  assert.equal(pendingRemove.state.pending, false); assert.equal(pendingRemove.state.editor, null);
  assert.equal(pendingRemove.state.entries[0].source, "project", "confirmed user removal must retain the actually visible project server");
  assert.equal(pendingRemove.calls.filter(([name]) => name === "write-config").length, 1);
  pendingRemove.unmount();
  console.log("PASS MCP-B05: unknown uninstall verifies actual user-layer key absence, never an effective-source overlay, while retaining a real lower/project entry and never replaying the mutation");

  const embedded = createMcpSettingsHarness({ snapshot: mcpFixture([mcpEntry("alpha"), mcpEntry("beta")]) });
  Object.assign(embedded.props, { embedded: true, externalQuery: "alpha", createRequest: 0 });
  embedded.render(); await embedded.tick();
  assert.equal(embedded.state.editor, null, "initial zero does not open an editor");
  assert.ok(embedded.text(embedded.tree).includes("alpha")); assert.ok(!embedded.text(embedded.tree).includes("beta"));
  assert.ok(!embedded.nodes(embedded.tree).some(node => node.props.type === "search"));
  assert.ok(!embedded.nodes(embedded.tree).some(node => node.type === "h3" && embedded.text(node) === "服务器"));
  embedded.props.createRequest++; embedded.render(); assert.ok(embedded.state.editor);
  embedded.state.change({ ...embedded.state.editor.draft, label: "preserved", command: "node" }); embedded.render();
  embedded.props.createRequest++; embedded.render(); assert.equal(embedded.modal.open, true); assert.equal(embedded.state.editor.draft.label, "preserved");
  embedded.button("继续编辑").props.onClick(); embedded.render(); assert.equal(embedded.state.editor.draft.label, "preserved");
  embedded.props.createRequest++; embedded.render(); embedded.button("放弃更改").props.onClick(); embedded.render();
  assert.equal(embedded.state.editor.draft.label, "", "confirmed discard runs the same guarded add action");
  embedded.state.change({ ...embedded.state.editor.draft, label: "old-scope", command: "node" }); embedded.render();
  embedded.props.createRequest++; embedded.render(); assert.equal(embedded.modal.open, true);
  const staleConfirm = embedded.button("放弃更改").props.onClick;
  embedded.props.cwd = "C:/new-scope"; embedded.render(); await embedded.tick();
  embedded.props.createRequest++; embedded.render(); embedded.state.change({ ...embedded.state.editor.draft, label: "new-scope", command: "node" }); embedded.render();
  staleConfirm(); embedded.render();
  assert.equal(embedded.state.editor.draft.label, "new-scope", "old confirmation cannot discard or open an editor in a new scope");
  embedded.state.discard(); embedded.render();
  embedded.setFixture({ ...mcpFixture(), userLayer: null }); await embedded.state.reload(); embedded.render();
  embedded.props.createRequest++; embedded.render(); assert.equal(embedded.state.editor, null, "external add cannot bypass unavailable user layer");
  embedded.unmount(); assert.equal(embedded.listenerCount, 0);

  let resolveRead;
  const loadingCreate = createMcpSettingsHarness({ read: () => new Promise(resolve => { resolveRead = resolve; }) });
  Object.assign(loadingCreate.props, { embedded: true, createRequest: 0 }); loadingCreate.render();
  loadingCreate.props.createRequest++; loadingCreate.render(); resolveRead(mcpFixture()); await loadingCreate.tick();
  assert.equal(loadingCreate.state.editor, null, "unavailable add is consumed, not replayed after late configuration load");
  loadingCreate.unmount();
  console.log("PASS MCP-B06: embedded search/header, external create respects dirty confirmation, scope, user-layer availability and late loading without replay");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await verify();
