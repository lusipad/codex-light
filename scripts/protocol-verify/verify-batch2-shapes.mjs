// Verify Batch-2 protocol shapes against a REAL app-server with an isolated CODEX_HOME
// (so config writes never touch the user's ~/.codex).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const outDir = ".ref/protocol-probe";
fs.mkdirSync(outDir, { recursive: true });
const cwd = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-verify-"));
const codexHome = path.join(tmpRoot, "home");
const scratch = path.join(tmpRoot, "scratch");
fs.mkdirSync(codexHome, { recursive: true });
fs.mkdirSync(scratch, { recursive: true });
console.log("isolated CODEX_HOME:", codexHome);

const child = spawn(process.platform === "win32" ? "codex.cmd" : "codex", [
  "app-server",
  "--listen",
  "stdio://",
], {
  shell: process.platform === "win32",
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, CODEX_HOME: codexHome },
});

let buf = "";
const waiters = new Map();
const notifications = [];
let nextId = 1;
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
      } else if (msg.method) notifications.push(msg);
    } catch {}
  }
});
child.stderr.on("data", (d) => {
  const s = String(d);
  if (/ERROR/.test(s)) fs.appendFileSync(outDir + "/_verify-batch2-stderr.log", s);
});

function rpc(method, params, timeoutMs = 30000) {
  const id = nextId++;
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ error: { message: "timeout" } }), timeoutMs);
    waiters.set(String(id), (msg) => {
      clearTimeout(t);
      resolve(msg);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
}
const errText = (msg) =>
  msg?.error ? (typeof msg.error === "string" ? msg.error : JSON.stringify(msg.error)) : "";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const init = await rpc("initialize", {
    clientInfo: { name: "codex-tauri-native", title: "Codex Light", version: "0.1.0" },
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  record("initialize (isolated home)", !init.error, errText(init));

  // --- config/*
  const read1 = await rpc("config/read", { cwd: scratch, includeLayers: true });
  const cfg = read1?.result?.config;
  record(
    "config/read {cwd,includeLayers}",
    !read1.error && cfg && typeof cfg === "object",
    errText(read1)
  );

  const batch = await rpc("config/batchWrite", {
    edits: [
      { keyPath: "model", value: "gpt-6.1-sol", mergeStrategy: "replace" },
      { keyPath: "model_reasoning_effort", value: "high", mergeStrategy: "replace" },
    ],
    reloadUserConfig: false,
  });
  record("config/batchWrite {edits[]}", !batch.error, errText(batch));

  const valueWrite = await rpc("config/value/write", {
    keyPath: "approval_policy",
    value: "on-request",
    mergeStrategy: "replace",
  });
  record("config/value/write {keyPath,value,mergeStrategy}", !valueWrite.error, errText(valueWrite));

  const read2 = await rpc("config/read", { cwd: scratch });
  const cfg2 = read2?.result?.config || {};
  record(
    "config/read reflects writes (model/effort/approval)",
    cfg2.model === "gpt-6.1-sol" &&
      cfg2.model_reasoning_effort === "high" &&
      cfg2.approval_policy === "on-request",
    JSON.stringify({
      model: cfg2.model,
      effort: cfg2.model_reasoning_effort,
      approval: cfg2.approval_policy,
    })
  );

  const reqs = await rpc("configRequirements/read", {});
  record("configRequirements/read", !reqs.error, errText(reqs));

  const mcpReload = await rpc("config/mcpServer/reload", {});
  record("config/mcpServer/reload", !mcpReload.error, errText(mcpReload));

  // --- experimental features
  const feats = await rpc("experimentalFeature/list", { limit: 500 });
  const featData = feats?.result?.data || [];
  record(
    "experimentalFeature/list returns items",
    !feats.error && Array.isArray(featData) && featData.length > 0,
    `count=${featData.length} ${errText(feats)}`
  );
  const sample = featData[0];
  if (sample?.name) {
    const setFeat = await rpc("experimentalFeature/enablement/set", {
      enablement: { [sample.name]: !sample.enabled },
    });
    record(
      `experimentalFeature/enablement/set {${sample.name}}`,
      !setFeat.error,
      errText(setFeat)
    );
    // restore
    await rpc("experimentalFeature/enablement/set", {
      enablement: { [sample.name]: !!sample.enabled },
    });
  }

  // --- fs/* roundtrip in isolated scratch dir
  const dir = path.join(scratch, "fs-test");
  const mk = await rpc("fs/createDirectory", { path: dir, recursive: true });
  record("fs/createDirectory", !mk.error, errText(mk));

  const file = path.join(dir, "hello.txt");
  const wf = await rpc("fs/writeFile", {
    path: file,
    dataBase64: Buffer.from("hello codex", "utf8").toString("base64"),
  });
  record("fs/writeFile {path,dataBase64}", !wf.error, errText(wf));

  const rf = await rpc("fs/readFile", { path: file });
  const rfResult = rf?.result || {};
  const rfB64 =
    rfResult.dataBase64 ?? rfResult.data_base64 ?? rfResult.contentBase64 ?? null;
  const decodedRaw = rfB64 ? Buffer.from(rfB64, "base64").toString("utf8") : "";
  const decoded =
    decodedRaw ||
    (typeof rfResult.content === "string" ? rfResult.content : "") ||
    JSON.stringify(rfResult).slice(0, 80);
  record(
    "fs/readFile roundtrip (base64)",
    !rf.error && decoded.includes("hello codex"),
    `decoded=${decoded.slice(0, 60)} ${errText(rf)}`
  );

  const cpDest = path.join(dir, "hello-copy.txt");
  const cp = await rpc("fs/copy", { sourcePath: file, destinationPath: cpDest });
  record("fs/copy {sourcePath,destinationPath}", !cp.error, errText(cp));

  const md = await rpc("fs/getMetadata", { path: file });
  record("fs/getMetadata", !md.error && md?.result?.isFile === true, errText(md));

  const rm = await rpc("fs/remove", { path: dir, recursive: true, force: true });
  record("fs/remove {path,recursive,force}", !rm.error, errText(rm));

  // --- fs/watch + fs/changed
  const watchId = "verify-watch";
  const w = await rpc("fs/watch", { path: scratch, watchId });
  record("fs/watch {path,watchId}", !w.error, errText(w));
  // trigger a change
  fs.writeFileSync(path.join(scratch, "trigger.txt"), "x", { encoding: "utf8" });
  await wait(1500);
  const changed = notifications.find(
    (n) => n.method === "fs/changed" && n.params?.watchId === watchId
  );
  record(
    "fs/changed notification received",
    !!changed,
    `notifications=${notifications.length}`
  );
  const uw = await rpc("fs/unwatch", { watchId });
  record("fs/unwatch {watchId}", !uw.error, errText(uw));

  // --- thread/settings/update collaborationMode (plan/default)
  const threadRes = await rpc("thread/start", {
    cwd: scratch,
    model: "gpt-6.1-sol",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: "workspace-write",
  });
  const threadId = threadRes?.result?.threadId || threadRes?.result?.thread?.id;
  record("thread/start for settings test", !threadRes.error && !!threadId, errText(threadRes));
  if (threadId) {
    const plan = await rpc("thread/settings/update", {
      threadId,
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-6.1-sol",
          reasoning_effort: "medium",
          developer_instructions: null,
        },
      },
    });
    record("thread/settings/update {collaborationMode:plan}", !plan.error, errText(plan));
    const def = await rpc("thread/settings/update", {
      threadId,
      collaborationMode: {
        mode: "default",
        settings: { model: "gpt-6.1-sol", reasoning_effort: null, developer_instructions: null },
      },
    });
    record("thread/settings/update {collaborationMode:default}", !def.error, errText(def));
    await rpc("thread/delete", { threadId });
  }

  // --- review/start shape (bogus thread -> not-found expected, not invalid request)
  const review = await rpc("review/start", {
    threadId: "11111111-1111-1111-1111-111111111111",
    delivery: "inline",
    target: { type: "uncommittedChanges" },
  });
  record(
    "review/start {delivery,target:uncommittedChanges} accepted shape",
    !errText(review).includes("Invalid request") && !errText(review).includes("missing field"),
    errText(review)
  );

  fs.writeFileSync(    outDir + "/_verify-batch2.json",
    JSON.stringify({ generatedAt: new Date().toISOString(), codexHome, results }, null, 2)
  );
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length ? 1 : 0;
} catch (e) {
  console.error("verification crashed:", e);
  process.exitCode = 2;
} finally {
  child.kill();
  await wait(300);
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {}
}
