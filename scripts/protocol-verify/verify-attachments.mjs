import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-attachment-verify-"));
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

let buffer = "";
let nextId = 1;
const waiters = new Map();
const attachmentEvents = [];
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    try {
      const message = JSON.parse(line);
      if (message.method === "thread/attachment/updated") {
        attachmentEvents.push(message.params);
      }
      if (message.id != null && (message.result !== undefined || message.error !== undefined)) {
        const waiter = waiters.get(String(message.id));
        if (waiter) {
          waiters.delete(String(message.id));
          waiter(message);
        }
      }
    } catch {}
  }
});

function rpc(method, params, timeoutMs = 30000) {
  const id = nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ error: { message: "timeout" } }), timeoutMs);
    waiters.set(String(id), (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${detail}`}`);
}
const errorText = (message) =>
  message?.error
    ? typeof message.error === "string"
      ? message.error
      : JSON.stringify(message.error)
    : "";

try {
  const init = await rpc("initialize", {
    clientInfo: { name: "codex-tauri-native", title: "Codex Native (Tauri)", version: "0.1.0" },
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  record("initialize (isolated home)", !init.error, errorText(init));

  const started = await rpc("thread/start", {
    cwd: process.cwd(),
    model: "gpt-6.1-sol",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: "workspace-write",
  });
  const threadId = started?.result?.thread?.id || started?.result?.threadId;
  record("thread/start returns thread.id", !started.error && !!threadId, errorText(started));

  if (threadId) {
    const injected = await rpc("thread/inject_items", {
      threadId,
      items: [{ type: "message", role: "user", content: [{ type: "input_text", text: "attachment probe" }] }],
    });
    record("thread/inject_items materializes thread", !injected.error, errorText(injected));

    const filePath = path.join(process.cwd(), "package.json");
    const fileAdd = await rpc("thread/attachment/add", {
      threadId,
      attachmentType: "file",
      identityKey: "verify-file",
      payload: { path: filePath, name: "package.json" },
    });
    record(
      "thread/attachment/add file returns created",
      fileAdd?.result?.outcome === "created" &&
        fileAdd?.result?.attachment?.payload?.path === filePath,
      errorText(fileAdd)
    );

    const duplicate = await rpc("thread/attachment/add", {
      threadId,
      attachmentType: "file",
      identityKey: "verify-file",
      payload: { path: filePath, name: "package.json" },
    });
    record("thread/attachment/add is idempotent", duplicate?.result?.outcome === "existing", errorText(duplicate));

    const imagePath = path.join(process.cwd(), "src-tauri", "icons", "icon.png");
    const imageAdd = await rpc("thread/attachment/add", {
      threadId,
      attachmentType: "image",
      identityKey: "verify-image",
      payload: { path: imagePath, name: "icon.png" },
    });
    record("thread/attachment/add image returns created", imageAdd?.result?.outcome === "created", errorText(imageAdd));

    const listed = await rpc("thread/attachment/list", { threadId, limit: 20 });
    const listItems = listed?.result?.data ?? [];
    record(
      "thread/attachment/list returns file and image payloads",
      !listed.error && listItems.length === 2 &&
        listItems.some((item) => item.attachmentType === "file" && item.payload?.name === "package.json") &&
        listItems.some((item) => item.attachmentType === "image" && item.payload?.name === "icon.png"),
      errorText(listed)
    );

    const removedFile = await rpc("thread/attachment/remove", {
      threadId,
      attachmentType: "file",
      identityKey: "verify-file",
    });
    record("thread/attachment/remove file", !removedFile.error, errorText(removedFile));

    const afterRemove = await rpc("thread/attachment/list", { threadId, limit: 20 });
    record(
      "thread/attachment/list reflects removal",
      !afterRemove.error && (afterRemove.result?.data ?? []).length === 1 &&
        afterRemove.result.data[0].attachmentType === "image",
      errorText(afterRemove)
    );

    const removedImage = await rpc("thread/attachment/remove", {
      threadId,
      attachmentType: "image",
      identityKey: "verify-image",
    });
    record("thread/attachment/remove image", !removedImage.error, errorText(removedImage));
    await new Promise((resolve) => setTimeout(resolve, 100));
    record(
      "thread/attachment/updated emits create and delete",
      attachmentEvents.some((event) => event.operation === "created") &&
        attachmentEvents.some((event) => event.operation === "deleted")
    );

    const deleted = await rpc("thread/delete", { threadId });
    record("thread/delete cleanup", !deleted.error, errorText(deleted));
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length ? 1 : 0;
} catch (error) {
  console.error("verification crashed:", error);
  process.exitCode = 2;
} finally {
  child.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
}
