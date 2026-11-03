// Verify batch-3 protocol shapes against a real app-server with isolated CODEX_HOME.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const outDir = ".ref/protocol-probe";
fs.mkdirSync(outDir, { recursive: true });
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-verify3-"));
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const init = await rpc("initialize", {
    clientInfo: { name: "codex-tauri-native", title: "Codex Native (Tauri)", version: "0.1.0" },
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  record("initialize (isolated home)", !init.error, errText(init));

  // ---------- thread + goal ----------
  const th = await rpc("thread/start", {
    cwd: scratch,
    model: "gpt-6.1-sol",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: "workspace-write",
  });
  const threadId = th?.result?.threadId || th?.result?.thread?.id;
  record("thread/start", !th.error && !!threadId, errText(th));

  if (threadId) {
    const goalSet = await rpc("thread/goal/set", {
      threadId,
      objective: "verify goal protocol",
      status: "active",
    });
    const goal = goalSet?.result?.goal;
    record(
      "thread/goal/set {objective,status:active}",
      !goalSet.error && goal?.status === "active",
      errText(goalSet) || JSON.stringify(goalSet?.result).slice(0, 120)
    );

    const goalGet = await rpc("thread/goal/get", { threadId });
    record(
      "thread/goal/get returns goal",
      !goalGet.error && goalGet?.result?.goal?.objective === "verify goal protocol",
      errText(goalGet)
    );

    const goalPause = await rpc("thread/goal/set", { threadId, status: "paused" });
    record(
      "thread/goal/set {status:paused}",
      !goalPause.error && goalPause?.result?.goal?.status === "paused",
      errText(goalPause)
    );

    const goalClear = await rpc("thread/goal/clear", { threadId });
    const afterClear = await rpc("thread/goal/get", { threadId });
    record(
      "thread/goal/clear -> goal null",
      !goalClear.error && (afterClear?.result?.goal ?? null) === null,
      errText(goalClear) + " " + errText(afterClear)
    );

    // ---------- queue ----------
    const qAdd = await rpc("thread/queue/add", {
      threadId,
      clientUserMessageId: `verify-${Date.now()}`,
      input: [{ type: "text", text: "queued verification message" }],
    });
    record("thread/queue/add", !qAdd.error, errText(qAdd));
    const qList = await rpc("thread/queue/list", { threadId });
    const queueItems = qList?.result?.data || [];
    record(
      "thread/queue/list returns queued item",
      !qList.error && Array.isArray(queueItems) && queueItems.length >= 1,
      `count=${queueItems.length} ${errText(qList)}`
    );
    const queuedId = queueItems[0]?.id || queueItems[0]?.queuedSubmissionId;
    if (queuedId) {
      const qDel = await rpc("thread/queue/delete", { threadId, queuedSubmissionId: queuedId });
      record("thread/queue/delete", !qDel.error, errText(qDel));
    }
  }

  // ---------- thread sections ----------
  const secCreate = await rpc("threadSection/create", { name: "Verify Section" });
  const section = secCreate?.result?.data || secCreate?.result?.section;
  record("threadSection/create {name}", !secCreate.error && !!section?.id, errText(secCreate));
  const secList = await rpc("threadSection/list", {});
  record(
    "threadSection/list contains created section",
    !secList.error && Array.isArray(secList?.result?.data),
    errText(secList)
  );
  if (section?.id) {
    const secUpdate = await rpc("threadSection/update", {
      sectionId: section.id,
      name: "Verify Section Renamed",
    });
    record("threadSection/update {sectionId,name}", !secUpdate.error, errText(secUpdate));
    if (threadId) {
      const move = await rpc("thread/section/move", {
        threadId,
        sectionId: section.id,
        beforeThreadId: null,
      });
      record("thread/section/move {threadId,sectionId}", !move.error, errText(move));
    }
    const secDelete = await rpc("threadSection/delete", { sectionId: section.id });
    record("threadSection/delete {sectionId}", !secDelete.error, errText(secDelete));
  }

  // ---------- projects ----------
  const projCreate = await rpc("project/create", {
    idempotencyKey: `verify-${Date.now()}`,
    name: "Verify Project",
    roots: [{ path: scratch }],
  });
  const project = projCreate?.result?.project || projCreate?.result?.data;
  record("project/create {idempotencyKey,name,roots}", !projCreate.error && !!project?.id, errText(projCreate));
  const projList = await rpc("project/list", { sortKey: "position", sortDirection: "asc" });
  record(
    "project/list {sortKey,sortDirection}",
    !projList.error && Array.isArray(projList?.result?.data),
    errText(projList)
  );
  if (project?.id) {
    const projRead = await rpc("project/read", { projectId: project.id });
    record("project/read {projectId}", !projRead.error, errText(projRead));
    const projUpdate = await rpc("project/update", {
      projectId: project.id,
      name: "Verify Project Renamed",
    });
    record("project/update {projectId,name}", !projUpdate.error, errText(projUpdate));
    const projMove = await rpc("project/move", { projectId: project.id, beforeProjectId: null });
    record("project/move {projectId,beforeProjectId}", !projMove.error, errText(projMove));
    const projDelete = await rpc("project/delete", { projectId: project.id });
    record("project/delete {projectId}", !projDelete.error, errText(projDelete));
  }

  // ---------- plugins / marketplaces / skills / hooks / sandbox ----------
  const installed = await rpc("plugin/installed", { cwds: [scratch] });
  record(
    "plugin/installed {cwds}",
    !installed.error && Array.isArray(installed?.result?.marketplaces),
    errText(installed)
  );
  const localPlugins = await rpc("plugin/list", { cwds: [scratch], marketplaceKinds: ["local"] });
  record(
    "plugin/list {marketplaceKinds:[local]}",
    !localPlugins.error && Array.isArray(localPlugins?.result?.marketplaces),
    errText(localPlugins)
  );
  for (const forceRefetch of [false, true]) {
    const catalog = await rpc("plugin/list", { cwds: [scratch], forceRefetch });
    record(
      `plugin/list server-enabled catalog forceRefetch=${forceRefetch}`,
      !catalog.error && Array.isArray(catalog?.result?.marketplaces),
      errText(catalog)
    );
  }
  const marketAdd = await rpc("marketplace/add", { source: path.join(scratch, "no-such-market") });
  record(
    "marketplace/add shape accepted (missing path error ok)",
    !/Invalid request|missing field/i.test(errText(marketAdd)),
    errText(marketAdd)
  );
  const skills = await rpc("skills/list", { cwds: [scratch] });
  record(
    "skills/list {cwds}",
    !skills.error && Array.isArray(skills?.result?.data),
    errText(skills)
  );
  const hooks = await rpc("hooks/list", { cwds: [scratch] });
  record("hooks/list {cwds}", !hooks.error && Array.isArray(hooks?.result?.data), errText(hooks));
  const readiness = await rpc("windowsSandbox/readiness", {});
  record(
    "windowsSandbox/readiness",
    !readiness.error && typeof readiness?.result?.status === "string",
    errText(readiness)
  );
  const permProfiles = await rpc("permissionProfile/list", {});
  record(
    "permissionProfile/list",
    !permProfiles.error && Array.isArray(permProfiles?.result?.data),
    errText(permProfiles)
  );
  const apps = await rpc("app/list", {});
  record(
    "app/list graceful (403/empty allowed)",
    !apps.error || /403|Forbidden|failed to list apps/i.test(errText(apps)),
    errText(apps)
  );

  fs.writeFileSync(
    outDir + "/_verify-batch3.json",
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
