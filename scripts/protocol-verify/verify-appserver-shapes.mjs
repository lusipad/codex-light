// Verify the exact payload shapes our frontend sends are accepted by the real app-server.
// Uses only cheap/validation-only calls. Creates one empty thread and deletes it afterwards.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const outDir = ".ref/protocol-probe";
fs.mkdirSync(outDir, { recursive: true });
const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-shapes-"));
const codexHome = path.join(isolatedRoot, "home");
const cwd = path.join(isolatedRoot, "workspace");
fs.mkdirSync(codexHome); fs.mkdirSync(cwd);

const child = spawn(process.platform === "win32" ? "codex.cmd" : "codex", [
  "app-server",
  "--listen",
  "stdio://",
], {
  shell: process.platform === "win32",
  windowsHide: true,
  cwd,
  env: { ...process.env, CODEX_HOME: codexHome, OPENAI_API_KEY: "", CODEX_API_KEY: "" },
  stdio: ["pipe", "pipe", "pipe"],
});

let buf = "";
const waiters = new Map();
let nextId = 1;
let childExited = false;
const closed = new Promise(resolve => child.once("exit", () => {
  childExited = true;
  for (const waiter of waiters.values()) waiter({ localTransportFailure: true });
  waiters.clear(); resolve();
}));
child.on("error", () => {
  childExited = true;
  for (const waiter of waiters.values()) waiter({ localTransportFailure: true });
  waiters.clear();
});
child.stdout.setEncoding("utf8");
child.stdout.on("data", (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id != null && (msg.result !== undefined || msg.error !== undefined)) {
        const w = waiters.get(String(msg.id));
        if (w) {
          waiters.delete(String(msg.id));
          w(msg);
        }
      }
    } catch {}
  }
});
child.stderr.on("data", (d) => {
  const s = String(d);
  if (/ERROR|error/.test(s)) fs.appendFileSync(outDir + "/_verify-stderr.log", s);
});

function rpc(method, params, timeoutMs = 30000) {
  const id = nextId++;
  if (childExited) return Promise.reject(Error("app-server exited before RPC"));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { waiters.delete(String(id)); reject(Error(`${method}: timeout`)); }, timeoutMs);
    waiters.set(String(id), (msg) => {
      clearTimeout(t);
      if (msg.localTransportFailure) { reject(Error(`${method}: app-server exited`)); return; }
      resolve(msg);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
}
const errText = (msg) =>
  msg?.error ? (typeof msg.error === "string" ? msg.error : JSON.stringify(msg.error)) : "";

try {
  const init = await rpc("initialize", {
    clientInfo: { name: "codex-tauri-native", title: "Codex Light", version: "0.1.0" },
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  record("initialize", !init.error, errText(init));
  if (init.error) throw Error("initialize failed; protocol shapes are unverified");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }) + "\n");

  // 1. thread/start with the exact params App.tsx now sends
  const threadRes = await rpc("thread/start", {
    cwd,
    model: "gpt-6.1-sol",
    approvalPolicy: "on-request",
    approvalsReviewer: "auto_review",
    sandbox: "workspace-write",
  });
  const threadId = threadRes?.result?.threadId || threadRes?.result?.thread?.id;
  record(
    "thread/start {approvalPolicy:on-request, approvalsReviewer:auto_review, sandbox:workspace-write}",
    !threadRes.error && !!threadId,
    errText(threadRes)
  );

  // 2. turn/steer shape (invalid ids -> should fail with not-found, NOT invalid request)
  const steer = await rpc("turn/steer", {
    threadId: threadId || "00000000-0000-0000-0000-000000000000",
    expectedTurnId: "11111111-1111-1111-1111-111111111111",
    input: [{ type: "text", text: "ping" }],
  });
  record(
    "turn/steer {expectedTurnId,input[]} accepted shape",
    !errText(steer).includes("Invalid request") && !errText(steer).includes("missing field"),
    errText(steer)
  );

  // 3. turn/interrupt shape
  const interrupt = await rpc("turn/interrupt", {
    threadId: threadId || "00000000-0000-0000-0000-000000000000",
    turnId: "11111111-1111-1111-1111-111111111111",
  });
  record(
    "turn/interrupt {threadId,turnId} accepted shape",
    !errText(interrupt).includes("Invalid request") && !errText(interrupt).includes("missing field"),
    errText(interrupt)
  );

  // 4. turn/start full payload shape (bogus thread -> not-found expected, not invalid request)
  const turnStart = await rpc("turn/start", {
    threadId: "11111111-1111-1111-1111-111111111111",
    cwd,
    input: [{ type: "text", text: "ping" }],
    model: "gpt-6.1-sol",
    effort: "high",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandboxPolicy: { type: "workspaceWrite", networkAccess: false },
    serviceTier: null,
  });
  record(
    "turn/start {sandboxPolicy,effort,approvalPolicy,approvalsReviewer,serviceTier} accepted shape",
    !errText(turnStart).includes("Invalid request") &&
      !errText(turnStart).includes("missing field") &&
      !errText(turnStart).includes("unknown field"),
    errText(turnStart)
  );

  // 5. thread/fork shape
  if (threadId) {
    const fork = await rpc("thread/fork", { threadId, cwd, lastTurnId: undefined });
    const forkOk = !fork.error || /no rollout found|not found/i.test(errText(fork));
    record("thread/fork {threadId,cwd} accepted shape", forkOk, errText(fork));
    const forkedId = fork?.result?.threadId || fork?.result?.thread?.id;
    if (forkedId) await rpc("thread/delete", { threadId: forkedId });
  }

  // 6. thread/revert & compact shapes (no valid turn -> not-found expected)
  const revert = await rpc("thread/revert", {
    threadId: threadId || "00000000-0000-0000-0000-000000000000",
    beforeTurnId: "11111111-1111-1111-1111-111111111111",
  });
  record(
    "thread/revert {threadId,beforeTurnId} accepted shape",
    !errText(revert).includes("Invalid request") && !errText(revert).includes("missing field"),
    errText(revert)
  );

  const compact = await rpc("thread/compact/start", {
    threadId: threadId || "00000000-0000-0000-0000-000000000000",
  });
  record(
    "thread/compact/start {threadId} accepted shape",
    !errText(compact).includes("Invalid request") && !errText(compact).includes("missing field"),
    errText(compact)
  );

  // cleanup
  if (threadId) {
    const del = await rpc("thread/delete", { threadId });
    record("thread/delete cleanup", !del.error || /no rollout found|not found/i.test(errText(del)), errText(del));
  }

  fs.writeFileSync(
    outDir + "/_verify-shapes.json",
    JSON.stringify({ generatedAt: new Date().toISOString(), isolatedRoot, results }, null, 2)
  );
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length ? 1 : 0;
} catch (e) {
  console.error("verification crashed:", e);
  process.exitCode = 2;
} finally {
  child.stdin.end();
  await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 3000))]);
  if (!childExited) child.kill();
  // Retain the private fixture alongside its recorded path for failure diagnosis,
  // as with the other isolated protocol probes; no real account data is used.
}
