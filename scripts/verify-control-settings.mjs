import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const source = fs.readFileSync("src/components/SettingsView.tsx", "utf8");
for (const prefix of ["computerUseEnabled", "computerUseScope", "computerUseAllowlist", "computerUseRequireConfirm",
  "computerUsePlaySound", "appshotsEnabled", "appshotsRouteMode", "appshotsIncludeOffscreen", "appshotsHotkey",
  "browserUseEnabled", "browserUseHeadless", "browserUseCdpPort", "browserUseAutoDownload", "browserUseWebMcp"]) {
  assert.ok(!source.includes(prefix), `remove ineffective ${prefix}`);
}
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/components/ControlCapabilitySettings.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText, { exports, require: name => {
  assert.equal(name, "react");
  return { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }) };
} });
const nodes = node => node && typeof node === "object" ? [node, ...node.children.flatMap(nodes)] : [];
let opened = 0;
const computer = exports.ComputerUseSettings({ onManagePlugins: () => opened++ });
const button = nodes(computer).find(node => node.type === "button");
button.props.onClick(); assert.equal(opened, 1);
for (const tree of [computer, exports.AppshotsSettings(), exports.BrowserUseSettings()]) {
  assert.ok(nodes(tree).some(node => node.props.role === "status"));
  assert.ok(!nodes(tree).some(node => ["input", "select"].includes(node.type)));
}
assert.ok(source.includes('onManagePlugins={() => setActiveSection("plugins-settings")}'));
for (const slug of ["computer-use", "appshots", "browser-use"]) {
  assert.ok(source.includes(`activeSection === "${slug}" &&`));
  assert.ok(!source.includes("handleSaveVisual"));
}
const native = fs.readFileSync("src-tauri/src/lib.rs", "utf8");
assert.ok(native.includes('.env("CODEX_APPSHOT_OUTPUT", &out_path)'));
assert.ok(!native.includes('out_path_str.replace'));
assert.ok(native.includes('uuid::Uuid::new_v4()'));
assert.ok(native.includes('tauri::image::Image::from_bytes'));
console.log("PASS CS01-CS03: actual capability JSX, plugin callback and no ineffective preference controls; screenshot path is passed as environment data, output uniquely named and decoded before attachment");
if (process.platform === "win32") {
  // Exercise the production shell script with a 1x1 fixture, never reading the screen.
  const literal = native.match(/let ps_script\s*=\s*"([\s\S]*?)";/)[1];
  const script = literal.replace(/\\\r?\n\s*/g, "")
    .replace("$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;", "$screen = New-Object System.Drawing.Rectangle 0, 0, 1, 1;")
    .replace("$graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size);", "");
  assert.ok(!script.includes("PrimaryScreen") && !script.includes("CopyFromScreen"));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-appshot-fixture-"));
  const output = path.join(directory, "quote ' 中文 $() ` ;.png");
  try {
    const run = value => spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", value], {
      env: { ...process.env, CODEX_APPSHOT_OUTPUT: output }, encoding: "utf8", windowsHide: true,
    });
    const success = run(script);
    assert.equal(success.status, 0, success.stderr);
    const image = fs.readFileSync(output);
    assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(image.readUInt32BE(16), 1);
    assert.equal(image.readUInt32BE(20), 1);
    fs.unlinkSync(output);
    const failure = run(script.replace("$bitmap.Save($env:CODEX_APPSHOT_OUTPUT, [System.Drawing.Imaging.ImageFormat]::Png);", "throw 'fixture capture failure';"));
    assert.notEqual(failure.status, 0);
    assert.ok(!fs.existsSync(output));
    console.log("PASS CS04 production PowerShell fixture: special-character output path produces a valid 1x1 PNG; capture errors exit nonzero, no stale output; no desktop capture");
  } finally {
    if (fs.existsSync(output)) fs.unlinkSync(output);
    fs.rmdirSync(directory);
  }
}
