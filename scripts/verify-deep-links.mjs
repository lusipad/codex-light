import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/deepLinks.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const defer = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const thread = id => ({ thread: { id } });
const threadLink = (generation, threadId) => ({ generation, kind: "thread", threadId });
const cloudLink = generation => ({ generation, kind: "cloud_environment_create" });

function fixture(overrides = {}, initial = threadLink(1, A)) {
  const calls = [], listeners = [], selected = [], errors = [], cloudOpened = [];
  const controller = new AbortController();
  let pending = initial, revision = 0;
  const behavior = {
    read: async id => thread(id),
    acknowledge: async generation => {
      if (pending?.generation !== generation) return false;
      pending = null;
      return true;
    },
    listen: async () => {},
    ...overrides,
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: module.exports,
    require(name) {
      assert.equal(name, "./bridge");
      return {
        async tauriInvoke(command, args) {
          calls.push([command, args]);
          if (command === "deep_link_pending") return pending;
          assert.equal(command, "deep_link_acknowledge");
          return behavior.acknowledge(args.generation);
        },
        async callAppServer(method, args) {
          assert.equal(method, "thread/read", "receiver must never start/fork a thread or start a turn");
          assert.equal(args.includeTurns, false);
          calls.push([method, args]);
          return behavior.read(args.threadId);
        },
        async tauriListen(name, callback) {
          const item = { name, callback, active: true };
          listeners.push(item);
          await behavior.listen(name);
          return () => { item.active = false; };
        },
      };
    },
  });
  const installation = module.exports.installDeepLinkReceiver({
    signal: controller.signal,
    navigationRevision: () => revision,
    selectThread: async id => { selected.push(id); },
    openCloudEnvironmentCreate: () => cloudOpened.push("create"),
    onError: message => errors.push(message),
  });
  return {
    calls, listeners, selected, errors, cloudOpened, controller, installation,
    emit(name = "native-deep-link") {
      for (const item of listeners) if (item.active && item.name === name) item.callback({});
    },
    setPending(value) { pending = value; },
    navigate() { revision++; },
    count(method) { return calls.filter(([name]) => name === method).length; },
    async cleanup() { controller.abort(); (await installation)(); await settle(); },
  };
}

// Pending data predates the listener: query only after both listeners are installed.
{
  const gate = defer();
  const f = fixture({ listen: name => name === "native-deep-link" ? gate.promise : Promise.resolve() });
  await settle();
  assert.equal(f.count("deep_link_pending"), 0);
  gate.resolve();
  await f.installation; await settle();
  assert.deepEqual(f.selected, [A]);
  assert.deepEqual(f.listeners.map(item => item.name), ["native-deep-link", "chatgpt-service:invalidated"]);
  await f.cleanup();
  assert.ok(f.listeners.every(item => !item.active));
}

// Duplicate wakeups cannot invalidate the in-flight read or select twice.
{
  const read = defer(), f = fixture({ read: () => read.promise });
  await f.installation; await settle();
  f.emit(); f.emit(); await settle();
  assert.equal(f.count("thread/read"), 1);
  read.resolve(thread(A)); await settle();
  assert.deepEqual(f.selected, [A]);
  f.emit(); await settle();
  assert.deepEqual(f.selected, [A]);
  await f.cleanup();
}

// A slow lookup must not overwrite a later, faster B.
{
  const readA = defer(), f = fixture({ read: id => id === A ? readA.promise : Promise.resolve(thread(B)) });
  await f.installation; await settle();
  f.setPending(threadLink(2, B)); f.emit(); await settle();
  assert.deepEqual(f.selected, [B]);
  readA.resolve(thread(A)); await settle();
  assert.deepEqual(f.selected, [B]);
  assert.equal(f.count("deep_link_acknowledge"), 1);
  await f.cleanup();
}

// A rejected obsolete acknowledgement re-queries the latest native generation.
{
  const ack = defer();
  let first = true;
  const f = fixture({ acknowledge: () => first ? (first = false, ack.promise) : Promise.resolve(true) });
  await f.installation; await settle();
  f.setPending(threadLink(2, B));
  ack.resolve(false); await settle();
  assert.deepEqual(f.selected, [B]);
  assert.equal(f.count("thread/read"), 2);
  await f.cleanup();
}

// A newer request arriving during acknowledgement invalidates the old result.
{
  const ack = defer();
  const f = fixture({ acknowledge: generation => generation === 1 ? ack.promise : Promise.resolve(true) });
  await f.installation; await settle();
  f.setPending(threadLink(2, B)); f.emit(); await settle();
  ack.resolve(true); await settle();
  assert.deepEqual(f.selected, [B]);
  await f.cleanup();
}

// Later manual navigation wins even while metadata or acknowledgement is pending.
for (const phase of ["read", "acknowledge"]) {
  const delayed = defer();
  const f = fixture({ [phase]: () => delayed.promise });
  await f.installation; await settle();
  f.navigate(); delayed.resolve(phase === "read" ? thread(A) : true); await settle();
  assert.deepEqual(f.selected, []);
  assert.deepEqual(f.errors, []);
  await f.cleanup();
}

for (const read of [async () => null, async () => thread(B), async () => { throw Error("offline"); }]) {
  const f = fixture({ read });
  await f.installation; await settle();
  assert.deepEqual(f.selected, []);
  assert.equal(f.errors.length, 1);
  assert.equal(f.count("deep_link_acknowledge"), 1);
  await f.cleanup();
}

// Identity invalidation and unmount suppress both successful and failing late work.
for (const invalidate of ["identity", "unmount"]) {
  for (const phase of ["read", "acknowledge"]) {
    for (const failure of [false, true]) {
      const delayed = defer(), f = fixture({ [phase]: () => delayed.promise });
      await f.installation; await settle();
      if (invalidate === "identity") f.emit("chatgpt-service:invalidated");
      else await f.cleanup();
      if (failure) delayed.reject(Error("late offline"));
      else delayed.resolve(phase === "read" ? thread(A) : true);
      await settle();
      assert.deepEqual(f.selected, []);
      assert.deepEqual(f.errors, []);
      assert.equal(f.count("deep_link_acknowledge"), phase === "read" ? 0 : 1);
      await f.cleanup();
    }
  }
}

// Identity changes leave native pending unacknowledged; the same generation can retry.
{
  const oldRead = defer(), retryRead = defer();
  let reads = 0;
  const f = fixture({ read: () => ++reads === 1 ? oldRead.promise : retryRead.promise });
  await f.installation; await settle();
  f.emit("chatgpt-service:invalidated");
  assert.equal(f.count("deep_link_acknowledge"), 0);
  f.emit(); f.emit(); await settle();
  assert.equal(f.count("thread/read"), 2, "same generation must retry exactly once after invalidation");
  retryRead.resolve(thread(A)); await settle();
  assert.deepEqual(f.selected, [A]);
  oldRead.resolve(thread(A)); await settle();
  f.emit(); await settle();
  assert.deepEqual(f.selected, [A], "old identity and duplicate wake must not select twice");
  assert.equal(f.count("deep_link_acknowledge"), 1);
  await f.cleanup();
}

// Unmount during listener installation must still release the eventual listeners.
{
  const delayed = defer();
  const f = fixture({ listen: () => delayed.promise });
  f.controller.abort(); delayed.resolve();
  (await f.installation)(); await settle();
  assert.ok(f.listeners.every(item => !item.active));
  assert.equal(f.count("deep_link_pending"), 0);
}

// A failed second listener releases the first and reports only the live error.
{
  const f = fixture({ listen: async name => {
    if (name === "chatgpt-service:invalidated") throw Error("listen unavailable");
  } });
  await f.installation; await settle();
  assert.equal(f.listeners[0].active, false);
  assert.equal(f.errors.length, 1);
  assert.equal(f.count("thread/read"), 0);
  await f.cleanup();
}

// Cold queue and later wake use the same handshake without local conversation metadata.
for (const cold of [true, false]) {
  const f = fixture({}, cold ? cloudLink(1) : null);
  await f.installation; await settle();
  if (!cold) {
    assert.deepEqual(f.cloudOpened, []);
    f.setPending(cloudLink(1));
  }
  f.emit(); f.emit(); await settle();
  assert.deepEqual(f.cloudOpened, ["create"]);
  assert.deepEqual(f.selected, []);
  assert.equal(f.count("thread/read"), 0);
  assert.equal(f.count("deep_link_acknowledge"), 1);
  await f.cleanup();
}
{
  const ack = defer();
  const f = fixture({ acknowledge: () => ack.promise }, cloudLink(1));
  await f.installation; await settle();
  f.navigate(); ack.resolve(true); await settle();
  assert.deepEqual(f.cloudOpened, []);
  await f.cleanup();
}

// Static integration checks complement the production-controller VM tests.
const app = fs.readFileSync("src/App.tsx", "utf8");
const install = app.indexOf("const installed = installDeepLinkReceiver(");
assert.ok(install > 0);
const effect = app.slice(app.lastIndexOf("useEffect(() => {", install), app.indexOf("]);", install) + 3);
assert.match(effect, /if \(isQuickChatWindow \|\| isThreadWindow \|\| !appServerStatus\.connected \|\| !threadEventsReady\) return/);
assert.match(effect, /navigationRevision:[\s\S]*navigationRequestRef\.current[\s\S]*deepLinkRouteRef\.current\.revision/);
assert.match(effect, /signal: pending\.signal/);
assert.match(effect, /selectThread,/);
assert.match(effect, /openCloudEnvironmentCreate:[\s\S]*cloudDraftRef\.current\?\.session\.setup[\s\S]*setActiveRoute\("cloud-create"\)/);
assert.match(effect, /pending\.abort\(\)/);
assert.match(effect, /installed\.then\(unlisten => unlisten\(\)\)/);
assert.match(effect, /\[isQuickChatWindow, isThreadWindow, appServerStatus\.connected, threadEventsReady, accountInfo,/);
assert.match(app, /deepLinkRouteRef\.current\.revision \+ 1/);
assert.doesNotMatch(source, /["'](?:thread\/start|thread\/fork|turn\/start)["']/);

// Rust checks below inspect source wiring only; they do not execute a native window.
const rust = fs.readFileSync("src-tauri/src/deep_links.rs", "utf8");
const receiveStart = rust.indexOf("pub async fn receive_args(");
const receive = rust.slice(receiveStart, rust.indexOf("#[tauri::command]", receiveStart));
assert.ok(receiveStart >= 0);
assert.match(receive, /if app\.get_webview_window\("main"\)\.is_none\(\)/);
assert.match(receive, /app\.config\(\)\.app\.windows\.iter\(\)\.find\(\|config\| config\.label == "main"\)/);
const rebuild = receive.indexOf("WebviewWindowBuilder::from_config(app, config)");
const build = receive.indexOf(".build()", rebuild);
const show = receive.indexOf("crate::menu::show_main_window(app)");
const emit = receive.indexOf('app.emit_to("main", EVENT, ())');
assert.ok(rebuild >= 0 && build > rebuild && show > build && emit > show,
  "missing main must be rebuilt from configured main before show and wake");
assert.match(receive, /if state\.peek\("main"\)\?\.is_some\(\)/);
assert.doesNotMatch(receive, /if\s+(?:state\.)?enqueue|if\s+changed/,
  "same pending URL must still wake after identity invalidation");
const lib = fs.readFileSync("src-tauri/src/lib.rs", "utf8");
const receiverStart = lib.indexOf("while let Some(args) = receiver.recv().await");
const receiver = lib.slice(receiverStart, lib.indexOf("\n                });", receiverStart));
assert.ok(receiverStart >= 0);
assert.match(receiver, /deep_links::receive_args\(&handle, &args\)\.await/);
assert.match(receiver, /}\s*eprintln!\("应用实例接收器已停止。"\);[\s\S]*handle\.exit\(1\);/,
  "closed instance receiver must exit instead of leaving an orphan primary");

console.log("PASS deep-link production controller: pending handshake, latest generation, duplicate wake, navigation, metadata, invalidation and cleanup");
console.log("PASS App static wiring: main-only, connected + threadEventsReady, account lifecycle, navigation revision, abort/unlisten");
console.log("PASS Rust static wiring only: configured main rebuild before wake, same-pending wake, awaited receiver and exit on listener loss");
console.log("Not covered: native IPC execution, OS scheme registration, real service, official UI or pixel parity");
