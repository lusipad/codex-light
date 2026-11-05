import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import path from "node:path";
import { createHash } from "node:crypto";

const source = fs.readFileSync("src/appearanceTheme.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
const context = { exports: {}, require(file) { return JSON.parse(fs.readFileSync(path.resolve("src", file), "utf8")); } };
vm.runInNewContext(js, context);
const api = context.exports, plain = value => JSON.parse(JSON.stringify(value));
const light = api.defaultChromeTheme("light"), dark = api.defaultChromeTheme("dark");
assert.equal(light.surface, "#ffffff"); assert.equal(dark.surface, "#181818");
assert.equal(light.contrast, 45); assert.equal(dark.contrast, 60);
for (const variant of ["light", "dark"]) {
  const defaults = api.defaultChromeTheme(variant);
  assert.equal(api.validChromeTheme(defaults), true);
  const invalid = [null, {}, { ...defaults, contrast: 1.1 }, { ...defaults, ink: "red" }, { ...defaults, fonts: { code: 12, ui: null } }, { ...defaults, accentSource: "account" }];
  for (const value of invalid) assert.equal(api.validChromeTheme(value), false);
  const normalized = api.normalizeChromeTheme({ ...defaults, contrast: 200.5, fonts: { ui: " Test UI ", code: " ", codeFace: { family: "X", fullName: "X", postscriptName: "X" } } }, variant);
  assert.equal(normalized.contrast, 100); assert.equal(normalized.fonts.ui, "Test UI"); assert.equal(normalized.fonts.code, null); assert.equal(normalized.fonts.codeFace, undefined);
  const custom = { ...defaults, accent: "#ff7700", surface: "#123456", opaqueWindows: true, contrast: 20, fonts: { ui: "Keep", code: "Clear", content: "Clear", uiFace: { family: "Keep", fullName: "Keep Bold", postscriptName: "Keep-Bold" } } };
  const reset = api.resetAdvancedTheme(custom, variant);
  assert.equal(reset.accent, custom.accent); assert.equal(reset.surface, custom.surface); assert.equal(reset.fonts.ui, "Keep"); assert.equal(reset.fonts.code, null); assert.equal(reset.fonts.uiFace, undefined); assert.equal(reset.contrast, defaults.contrast);
  assert.equal(api.resetAdvancedTheme(custom, variant, false).opaqueWindows, true);
  const shared = { variant, theme: custom, codeThemeId: "github" };
  const text = api.serializeTheme(shared);
  const parsed = api.parseTheme(text, variant, ["codex", "github"]);
  assert.deepEqual(plain(parsed.theme), plain(api.normalizeChromeTheme(custom, variant)));
  assert.deepEqual(plain(api.parseTheme(`codex-theme-v1:${encodeURIComponent(JSON.stringify(shared))}`, variant, ["github"])), plain(parsed));
  assert.throws(() => api.parseTheme(text, variant === "light" ? "dark" : "light", ["github"]));
  assert.throws(() => api.parseTheme(text, variant, ["codex"]));
  assert.throws(() => api.parseTheme("", variant));
  const variables = api.themeVariables(custom, variant);
  assert.equal(variables["--bg-main"], custom.surface); assert.equal(variables["--bg-sidebar"], variables["--app-color-background-surface-under"]);
  assert.equal(variables["--accent-green"], custom.semanticColors.diffAdded);
  assert.equal(variables["--font-sans"], '"Codex selected Keep-Bold", Keep, sans-serif');
  assert.equal(variables["--app-color-text-on-accent"], "rgb(0, 0, 0)");
  for (const { id } of api.themePresets(variant)) {
    const theme = await api.loadThemePreset(id, variant), code = api.codeThemeVariables(id, variant);
    assert.equal(api.validChromeTheme(theme), true, `${id}/${variant} valid seed`);
    for (const category of ["background", "foreground", "comment", "string", "number", "boolean", "keyword", "function", "type", "variable", "regexp"]) assert.match(code[`--code-${category}`], /^#[\da-f]{6}$/i, `${id}/${variant}/${category}`);
  }
}
assert.equal(api.themePresets("light").some(p => p.id === "dracula"), false);
await assert.rejects(api.loadThemePreset("dracula", "light"));
await assert.rejects(api.loadThemePreset("invented", "dark"));
assert.equal((await api.loadThemePreset("github", "dark")).surface, "#0d1117");
assert.equal((await api.loadThemePreset("codex", "dark")).surface, "#111111");
assert.equal(api.codeThemeVariables("codex", "dark")["--code-keyword"], "#f67576");
assert.notEqual(api.codeThemeVariables("dracula", "dark")["--code-string"], api.codeThemeVariables("github", "dark")["--code-string"]);
const seeds = JSON.parse(fs.readFileSync("scripts/fixtures/appearance-theme-official-seeds.json", "utf8"));
assert.equal(seeds.samples.length, 23);
for (const sample of seeds.samples) {
  const actual = await api.loadThemePreset(sample.id, sample.variant);
  for (const [key, value] of Object.entries(sample.expected)) assert.deepEqual(plain(actual[key]), value, `${sample.id}/${sample.variant}/${key} official seed`);
}

// Optional local fixed-version oracle: never replaces the deterministic checks above.
const reference = ".ref/parity/16.02/actual/16-02B-research/raw/app-theme-c850e3c1c24c.js";
if (fs.existsSync(reference)) {
  assert.equal(createHash("sha256").update(fs.readFileSync(reference)).digest("hex"), "cbc719a3fbbc0952efc34502dbbea844bd5deca9461ca89687374555c504c46f", "fixed Store oracle hash");
  const text = fs.readFileSync(reference, "utf8");
  const oracle = { a: { light: plain(light), dark: plain(dark) }, i() {}, e: fn => () => fn() };
  vm.runInNewContext(`${text.slice(text.indexOf("function p("), text.indexOf("function W("))}U();result=p;`, oracle);
  let comparisons = 0;
  for (const variant of ["light", "dark"]) {
    for (const contrast of [0, 20, 45, 60, 75, 100]) {
      for (const accent of ["#339cff", "#ff7700", "#0071ea", "#00ff88"]) {
        const theme = { ...api.defaultChromeTheme(variant), contrast, accent, surface: contrast === 75 ? "#273445" : api.defaultChromeTheme(variant).surface };
        const actual = api.themeVariables(theme, variant), expected = oracle.result(theme, variant).variables;
        for (const [key, value] of Object.entries(expected)) {
          if (!(key in actual) || key === "--color-background-text-selection" || key === "--color-background-attribution-highlight") continue;
          assert.equal(actual[key], value, `${variant}/${contrast}/${accent}/${key}`); comparisons++;
        }
      }
    }
  }
  console.log(`Official fixed-version semantic comparisons: ${comparisons}`);
}
console.log("Appearance theme model, preset, schema, share and semantic checks passed");
