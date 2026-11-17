import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const exports = {};
const source = readFileSync(new URL("../src/components/AppearanceThemeActionIcon.tsx", import.meta.url), "utf8");
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { require: createRequire(import.meta.url), exports });
const { AppearanceThemeActionIcon } = exports;

// Fingerprints from the two original asar SVG bodies, independent of this component.
const expected = {
  "import": {
    "pathCount": 2,
    "fingerprint": "f2aa78412b79ad5c416655834d18eb96f77d1456b704ba4262872f92893907c2"
  },
  "copy": {
    "pathCount": 1,
    "fingerprint": "42100168fe1a12a004aa83e4465dca963c131b57502cf12550f3b06ac43e59e3"
  }
};
for (const [action, vector] of Object.entries(expected)) {
  const svg = renderToStaticMarkup(createElement(AppearanceThemeActionIcon, { action }));
  const root = svg.match(/^<svg ([^>]+)>/)?.[1] ?? "";
  for (const attr of ['width="20"', 'height="20"', 'viewBox="0 0 20 20"', 'aria-hidden="true"', 'focusable="false"']) {
    assert.ok(root.includes(attr), action + ": missing " + attr);
  }
  const paths = [...svg.matchAll(/<path ([^>]*?)(?:\/>|><\/path>)/g)].map(([, attrs]) =>
    Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]+)"/g)].map(([, k, v]) => [k, v]).sort()));
  assert.equal(paths.length, vector.pathCount, action);
  assert.ok(paths.every(path => path.fill === "currentColor" && path.stroke === undefined), action);
  assert.equal(createHash("sha256").update(JSON.stringify(paths)).digest("hex"), vector.fingerprint, action);
}
console.log("PASS Appearance theme actions: original Import and Copy paths, 20px viewport, decorative SVG.");
