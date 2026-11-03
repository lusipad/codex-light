import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const endpoint = process.env.QUICK_CHAT_CDP_ENDPOINT;
assert.ok(endpoint && /^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(endpoint), "isolated local CDP endpoint required");
const output = path.resolve(process.env.QUICK_CHAT_SMOKE_OUTPUT || ".ref/parity/17/native-actual");
fs.mkdirSync(output, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(action, message, limit = 30000) {
  const deadline = Date.now() + limit; let last;
  while (Date.now() < deadline) {
    try { const value = await action(); if (value) return value; } catch (error) { last = error; }
    await pause(250);
  }
  throw Error(`${message}: ${last?.message ?? "condition not reached"}`);
}
class Page {
  constructor(socket) {
    this.socket = socket; this.sequence = 0; this.pending = new Map();
    socket.onmessage = event => {
      const result = JSON.parse(event.data), pending = this.pending.get(result.id);
      if (!pending) return;
      this.pending.delete(result.id); clearTimeout(pending.timer);
      if (result.error) pending.reject(Error(result.error.message)); else pending.resolve(result.result);
    };
  }
  static async connect(target) {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    return new Page(socket);
  }
  call(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 15000);
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  invoke(command, args = {}) { return this.evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(args)})`); }
  async draft(value) {
    await this.evaluate(`(()=>{const input=document.querySelector('.codex-two-tier-composer textarea');input.focus();input.setSelectionRange(0,input.value.length);})()`);
    await this.call("Input.insertText", { text: value });
    await waitFor(async () => await this.evaluate("document.querySelector('.codex-two-tier-composer textarea')?.value") === value, "draft input did not reach React");
  }
  close() { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error("CDP closed")); } this.pending.clear(); this.socket.close(); }
}
const targets = async () => await (await fetch(`${endpoint}/json/list`)).json();
let main, quick;
const evidence = { scope: "isolated native window smoke; zero model turns", checks: [], screenshots: [], nativeReferenceComparison: "not_executed" };
try {
  const mainTarget = await waitFor(async () => (await targets()).find(target => target.type === "page" && /tauri\.localhost|^tauri:|localhost:1420/.test(target.url) && !target.url.includes("utility=")), "main webview not exposed");
  main = await Page.connect(mainTarget);
  await waitFor(() => main.evaluate("Boolean(window.__TAURI_INTERNALS__ && document.querySelector('.codex-two-tier-composer textarea'))"), "main composer not ready");
  await main.draft("native-main-draft-sentinel");
  await main.invoke("quick_chat_toggle");
  const quickTarget = await waitFor(async () => (await targets()).find(target => target.type === "page" && target.url.includes("utility=quick-chat")), "native quick-chat target missing");
  quick = await Page.connect(quickTarget);
  await waitFor(() => quick.evaluate("Boolean(document.querySelector('.hotkey-window-container.native .codex-two-tier-composer textarea'))"), "native utility composer not ready");
  assert.equal(await quick.evaluate("Boolean(document.querySelector('.codex-app-layout'))"), false, "utility must not mount main shell");
  const size = await main.invoke("plugin:window|inner_size", { label: "quick-chat" });
  const ratio = await quick.evaluate("window.devicePixelRatio");
  assert.equal(Math.round(size.width / ratio), 470); assert.equal(Math.round(size.height / ratio), 640);
  evidence.geometry = { physical: size, devicePixelRatio: ratio, logical: { width: size.width / ratio, height: size.height / ratio } };
  const windows = await main.invoke("plugin:window|get_all_windows"); assert.equal(windows.filter(label => label === "quick-chat").length, 1);
  await quick.draft("native-utility-draft-sentinel");
  assert.equal(await main.evaluate("document.querySelector('.codex-two-tier-composer textarea').value"), "native-main-draft-sentinel");
  const drafts = await quick.evaluate("({main:JSON.parse(localStorage.getItem('codex_composer_prompt_drafts_v1')),utility:JSON.parse(localStorage.getItem('codex_quick_chat_prompt_drafts_v1'))})");
  assert.equal(drafts.main.home, "native-main-draft-sentinel"); assert.equal(drafts.utility.home, "native-utility-draft-sentinel");
  evidence.checks.push("native singleton and logical 470x640", "separate renderer/root and persisted draft isolation");
  await quick.evaluate("document.querySelector('button[aria-label=关闭]').click()");
  await waitFor(async () => !(await main.invoke("plugin:window|is_visible", { label: "quick-chat" })), "close button did not hide native window");
  await main.invoke("quick_chat_toggle");
  assert.equal(await quick.evaluate("document.querySelector('.codex-two-tier-composer textarea').value"), "native-utility-draft-sentinel");
  await main.invoke("plugin:window|close", { label: "quick-chat" });
  await waitFor(async () => !(await main.invoke("plugin:window|is_visible", { label: "quick-chat" })), "OS close request did not hide");
  await main.invoke("quick_chat_toggle");
  assert.equal(await quick.evaluate("document.querySelector('.codex-two-tier-composer textarea').value"), "native-utility-draft-sentinel");
  assert.equal((await targets()).filter(target => target.type === "page" && target.url.includes("utility=quick-chat")).length, 1);
  evidence.checks.push("button and CloseRequested hide without renderer destruction", "reopen retains exact draft and one webview");
  await Promise.all([main.invoke("quick_chat_toggle"), main.invoke("quick_chat_toggle")]);
  assert.equal(await main.invoke("plugin:window|is_visible", { label: "quick-chat" }), true);
  assert.equal((await main.invoke("plugin:window|get_all_windows")).filter(label => label === "quick-chat").length, 1);
  evidence.checks.push("concurrent toggle remains singleton");
  const thread = await main.invoke("app_server_call", { method: "thread/start", params: { cwd: process.env.CODEX_HOME, ephemeral: true } });
  const threadId = thread.thread?.id ?? thread.threadId; assert.ok(threadId);
  await quick.invoke("quick_chat_continue", { threadId });
  await waitFor(async () => await main.evaluate("document.querySelector('.codex-app-layout')?.getAttribute('data-active-thread-id')") === threadId, "main did not select handed-off real thread");
  assert.equal(await main.invoke("plugin:window|is_visible", { label: "quick-chat" }), false);
  evidence.threadId = threadId;
  evidence.checks.push("real zero-turn thread handoff selects same ID in main and hides utility");
  await main.invoke("quick_chat_toggle");
  assert.equal(await quick.evaluate("document.querySelector('.codex-two-tier-composer textarea').value"), "native-utility-draft-sentinel");
  const shot = await quick.call("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(output, "native-quick-chat.png"), Buffer.from(shot.data, "base64")); evidence.screenshots.push("native-quick-chat.png");
  evidence.status = "passed";
  console.log("PASS native singleton, size, renderer/draft isolation, button/OS hide, reopen, concurrent toggle and real thread handoff; zero model turns");
} catch (error) { evidence.status = "failed"; evidence.error = String(error); throw error; }
finally { fs.writeFileSync(path.join(output, "native-smoke.json"), JSON.stringify(evidence, null, 2) + "\n"); quick?.close(); main?.close(); }
