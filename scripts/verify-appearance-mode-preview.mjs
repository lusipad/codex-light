import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const exports = {};
const source = readFileSync(new URL("../src/components/AppearanceModePreview.tsx", import.meta.url), "utf8");
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { require: name => name.endsWith(".css") ? {} : require(name), exports });
const { AppearanceModePreview } = exports;

// Normalize only scoped IDs, stand-alone SVG formatting, and numeric spelling.
const unscoped = id => id.replace(/^.*-(?=(?:clip|filter)\d+_)/, "");
const vectorFingerprint = svg => {
  const nodes = [...svg.matchAll(/<(\/?)([\w-]+)([^<>]*)>/g)].flatMap(([, close, tag, raw]) => {
    if (close) return [[tag, "close"]];
    const attrs = [...raw.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, input]) => {
      let value = input;
      if (key === "id") value = unscoped(value);
      else if (/^url\(#.+\)$/.test(value)) value = "url(#" + unscoped(value.slice(5, -1)) + ")";
      else if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value)) value = String(Number(value));
      return [key, value];
    }).sort(([a], [b]) => a.localeCompare(b));
    return raw.endsWith("/") ? [[tag, attrs], [tag, "close"]] : [[tag, attrs]];
  });
  return createHash("sha256").update(JSON.stringify(nodes)).digest("hex");
};

const expected = {
  "light": "18440a09ba578b76572ad10fb24dcfd3a3571cf271dc2eb296a9aa7036ce26f0",
  "dark": "d60b16d1801a68dff58553d14cb5e466612b4102d2688ee90ec98e9bdf87e1b6",
  "system-light": "5e57668d86cb04d90f798bf74d972b418f4a1d9661d9d9fdbae5b295f106d554",
  "system-dark": "b403fcaa11dd53d36c5be3eebbcc8ed99e6fc176533e6df087b1efb422609a6e"
};
const art = (mode, selected = false) => createElement(AppearanceModePreview, { mode, selected });
const markup = renderToStaticMarkup(createElement(Fragment, null, art("system", true), art("light"), art("dark"), art("light")));
const geometry = [...markup.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/g)].map(match => match[0]);
assert.equal(geometry.length, 5);
assert.deepEqual(geometry.map(vectorFingerprint), [expected["system-light"], expected["system-dark"], expected.light, expected.dark, expected.light]);
const ids = new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
const references = [...markup.matchAll(/url\(#([^)]+)\)/g)].map(match => match[1]);
assert.equal(ids.size, 15, "each of five drawings has three independent clip/filter IDs");
assert.equal(references.length, 15);
assert.ok(references.every(id => ids.has(id)));
assert.equal((markup.match(/data-selected="true"/g) ?? []).length, 1);
assert.equal((markup.match(/aria-hidden="true"/g) ?? []).length, 4);
assert.ok(markup.includes('class="appearance-mode-art-halves"'), "system mode preserves its independently authored halves");
console.log("PASS Appearance previews: four official vectors, system composition, selected state, and unique filter/clip IDs.");
