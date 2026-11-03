// Real skill discovery only: isolated fixtures, no authentication or model turns.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-recommended-skills-"));
const home = path.join(directory, "home");
const workspace = path.join(directory, "workspace");
for (const location of [home, workspace]) fs.mkdirSync(location);
const binary = process.env.CODEX_CLI_PATH || (process.platform === "win32" ? "codex.cmd" : "codex");
const output = process.env.RECOMMENDED_SKILLS_PROBE_OUTPUT || ".ref/protocol-probe/recommended-skills.json";
const options = {
  shell: binary.endsWith(".cmd"), windowsHide: true,
  env: { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "", CODEX_API_KEY: "" },
};
const version = spawnSync(binary, ["--version"], { ...options, encoding: "utf8" });
assert.equal(version.status, 0, version.stderr);
const fixtures = [];
function fixture(root, id, scope) {
  const skillPath = path.join(root, id, "SKILL.md");
  const contents = {
    "SKILL.md": `---\nname: ${id}\ndescription: Offline ${scope} discovery fixture.\n---\n\nUse scripts/check.mjs and assets/sample.txt.\n`,
    "scripts/check.mjs": `export const scope = ${JSON.stringify(scope)};\n`,
    "assets/sample.txt": `UTF-8 fixture ${scope}: 中文\n`,
  };
  const files = [];
  for (const [relative, content] of Object.entries(contents)) {
    const target = path.join(root, id, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    files.push({ relative, sha256: createHash("sha256").update(content).digest("hex") });
  }
  fixtures.push({ id, scope, skillPath, files });
  return skillPath;
}
const userRoot = path.join(home, "skills");
const projectRoot = path.join(workspace, ".codex", "skills");
const userPath = fixture(userRoot, "parity-shared-skill", "user");
const projectPath = fixture(projectRoot, "parity-shared-skill", "project");
const projectUniquePath = fixture(projectRoot, "parity-project-only", "project");
let child, buffer = "", nextId = 0, stderr = "", failure = null, passed = false;
const pending = new Map(), transcript = [], notifications = [], checks = [];
const canonical = value => path.resolve(value).replaceAll("\\", "/").toLowerCase();
function request(method, params) {
  assert.ok(["initialize", "skills/list"].includes(method), "probe only allows initialize and skills/list");
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 20000);
    pending.set(id, response => {
      clearTimeout(timer); pending.delete(id);
      transcript.push({ method, params, response });
      if (response.error) reject(Error(`${method}: ${JSON.stringify(response.error)}`));
      else resolve(response.result);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
function check(name, value, detail = null) {
  checks.push({ name, passed: Boolean(value), detail });
  console.log(`${value ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
}
async function list() {
  const result = await request("skills/list", { cwds: [workspace], forceReload: true });
  assert.ok(Array.isArray(result.data), "skills/list data must be an array");
  const group = result.data.find(entry => canonical(entry.cwd) === canonical(workspace));
  assert.ok(group && Array.isArray(group.skills), "requested cwd must have a skill list");
  assert.deepEqual(group.errors || [], [], "fixtures must parse without errors");
  return group.skills;
}
try {
  child = spawn(binary, ["app-server", "--listen", "stdio://"], { ...options, cwd: workspace, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.on("data", data => { stderr = (stderr + data).slice(-8000); });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", data => {
    buffer += data;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.id != null) pending.get(message.id)?.(message);
      else if (message.method) notifications.push(message);
    }
  });
  await request("initialize", {
    clientInfo: { name: "codex-native-recommended-skills-probe", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }) + "\n");
  const first = await list();
  const paths = new Set(first.map(skill => canonical(skill.path)));
  check("user skill discovered by exact SKILL.md path", paths.has(canonical(userPath)));
  check("project .codex skill discovered by exact SKILL.md path", paths.has(canonical(projectUniquePath)));
  check("same-name user and project entries both preserved", paths.has(canonical(userPath)) && paths.has(canonical(projectPath)));
  for (const expected of fixtures) {
    const row = first.find(skill => canonical(skill.path) === canonical(expected.skillPath));
    check(`${expected.scope}/${expected.id} reports expected scope`, row?.scope?.toLowerCase() === (expected.scope === "project" ? "repo" : "user"), row?.scope || "missing");
  }
  const latePath = fixture(projectRoot, "parity-after-first-list", "project");
  const refreshed = await list();
  check("forceReload discovers project skill created after initial list", refreshed.some(skill => canonical(skill.path) === canonical(latePath)));
  for (const item of fixtures) for (const file of item.files) {
    const bytes = fs.readFileSync(path.join(path.dirname(item.skillPath), file.relative));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, "discovery must leave fixture bytes unchanged");
  }
  check("SKILL.md scripts and assets bytes remain unchanged", true);
  check("zero model turns", !notifications.some(event => event.method === "turn/started"));
  passed = checks.every(item => item.passed);
  if (!passed) process.exitCode = 1;
} catch (error) {
  failure = String(error?.stack || error);
  process.exitCode = 1;
  console.error(failure);
} finally {
  if (child && child.exitCode == null) {
    await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 5000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      child.stdin.end();
    });
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({
    capturedAt: new Date().toISOString(), binary, version: version.stdout.trim(),
    isolatedHome: home, workspace, fixtures, passed, failure, checks, transcript, notifications, stderr,
    scope: "Real isolated CLI skill discovery from full directory fixtures; not Rust installation, Tauri IPC, official UI, or pixel parity. Temporary fixtures retained for inspection.",
  }, null, 2));
  console.log(`Evidence: ${output}`);
}
