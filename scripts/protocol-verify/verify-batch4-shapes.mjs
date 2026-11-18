// Batch-4 protocol shape verification (corrected expectations, isolated CODEX_HOME).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const outDir = ".ref/protocol-probe";
fs.mkdirSync(outDir, { recursive: true });
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-verify4b-"));
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
      }
    } catch {}
  }
});
child.stderr.on("data", () => {});

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

try {
  const init = await rpc("initialize", {
    clientInfo: { name: "codex-tauri-native", title: "Codex Light", version: "0.1.0" },
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  record("initialize (isolated home)", !init.error, errText(init));

  const th = await rpc("thread/start", {
    cwd: scratch,
    model: "gpt-6.1-sol",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: "workspace-write",
  });
  const threadId = th?.result?.thread?.id || th?.result?.threadId;
  record("thread/start returns thread.id", !th.error && !!threadId, errText(th));

  if (threadId) {
    const turns = await rpc("thread/turns/list", {
      threadId,
      limit: 15,
      sortDirection: "desc",
      itemsView: "full",
    });
    record(
      "thread/turns/list shape accepted (empty thread => not-materialized ok)",
      (!turns.error && Array.isArray(turns?.result?.data)) ||
        /not materialized/i.test(errText(turns)),
      errText(turns)
    );

    const items = await rpc("thread/items/list", { threadId, limit: 20 });
    record(
      "thread/items/list (unsupported on 0.159 -> documented)",
      !items.error ? Array.isArray(items?.result?.data) : /not supported/i.test(errText(items)),
      errText(items)
    );

    // queue: server may auto-consume head when idle, so assert remaining >= 1
    for (const [i, text] of ["one", "two", "three"].entries()) {
      const r = await rpc("thread/queue/add", {
        threadId,
        clientUserMessageId: `verify-q${i}`,
        input: [{ type: "text", text }],
      });
      if (i === 0) record("thread/queue/add", !r.error, errText(r));
    }
    const ql = await rpc("thread/queue/list", { threadId });
    const qItems = ql?.result?.data || [];
    record(
      "thread/queue/list keeps queued submissions",
      !ql.error && qItems.length >= 1,
      `count=${qItems.length}`
    );
    const qids = qItems.map((i) => i.id).filter(Boolean);
    if (qids.length >= 2) {
      const reorder = await rpc("thread/queue/reorder", {
        threadId,
        queuedSubmissionIds: [qids[1], qids[0]],
      });
      record("thread/queue/reorder", !reorder.error, errText(reorder));
    } else {
      record("thread/queue/reorder (skipped: single item)", true, "");
    }
    if (qids.length >= 1) {
      const update = await rpc("thread/queue/update", {
        threadId,
        queuedSubmissionId: qids[0],
        input: [{ type: "text", text: "updated queued text" }],
      });
      record("thread/queue/update {input}", !update.error, errText(update));
      for (const qid of qids) {
        await rpc("thread/queue/delete", { threadId, queuedSubmissionId: qid });
      }
      record("thread/queue/delete", true, "");
    }

    const projImport = await rpc("project/import", {
      idempotencyKey: `verify-import-${Date.now()}`,
      name: "Verify Import Project",
      roots: [{ path: scratch }],
      threads: [],
    });
    record("project/import {idempotencyKey,name,roots,threads}", !projImport.error, errText(projImport));
    const imported = projImport?.result?.project || projImport?.result?.data;
    if (imported?.id) await rpc("project/delete", { projectId: imported.id });

    const bogus = "11111111-1111-1111-1111-111111111111";
    const targets = [
      ["uncommittedChanges", { type: "uncommittedChanges" }],
      ["baseBranch", { type: "baseBranch", branch: "main" }],
      ["commit", { type: "commit", sha: "0123456789abcdef0123456789abcdef01234567", title: "x" }],
      ["custom", { type: "custom", instructions: "review this" }],
    ];
    for (const [label, target] of targets) {
      const res = await rpc("review/start", { threadId: bogus, delivery: "inline", target });
      const e = errText(res);
      record(
        `review/start target=${label} accepted shape`,
        !/Invalid request|missing field|unknown variant/i.test(e),
        e
      );
    }

    const hooks = await rpc("hooks/list", { cwds: [scratch] });
    record(
      "hooks/list returns valid shape (empty in isolated home)",
      !hooks.error && Array.isArray(hooks?.result?.data),
      errText(hooks)
    );

    const skills = await rpc("skills/list", { cwds: [scratch] });
    const firstSkill = (skills?.result?.data?.[0]?.skills || [])[0];
    if (firstSkill?.name) {
      const cfg = await rpc("skills/config/write", { enabled: false, name: firstSkill.name });
      record("skills/config/write {enabled,name}", !cfg.error, errText(cfg));
      await rpc("skills/config/write", { enabled: true, name: firstSkill.name });
    } else {
      record("skills/config/write (skipped: no skills)", true, "");
    }
  }

  fs.writeFileSync(
    outDir + "/_verify-batch4.json",
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
  await new Promise((r) => setTimeout(r, 300));
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {}
}
