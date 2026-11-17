import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const exports = {};
const source = readFileSync(new URL("../src/components/SettingsNavIcon.tsx", import.meta.url), "utf8");
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { require, exports });
const { SettingsNavIcon } = exports;

// Fixed vector fingerprints verified against the 26.1111.2228.0 asar.
// Keep the verified baseline independent of the render implementation and ignored .ref.
const vectors = {
  "general-settings": "12e34a888e8e4f45139a8d14833ab95099b6dc43dc990e235f84a7188e75df09",
  "notifications": "c3c1a576424e7035610a6137de0543347c16bfc7053e59940f51947b3cf9ec30",
  "import": "4e4d9f41fddd5a38a59ac315c118443a8093aa43db03f0c7b910135a4cc53ce5",
  "profile": "3ad2eea79aca392de9dc321d4087ddad2411836b67428e5d550899e3cf1554a7",
  "account": "3ad2eea79aca392de9dc321d4087ddad2411836b67428e5d550899e3cf1554a7",
  "appearance": "b5d221f10ea741d93ddc6df4e10a68341dd5cb13a98de4e21a55c511b3c24408",
  "archived-chats": "90a91e55d8f1bd859af733b2741d5fb1cf449d8a6e2abca4d06bd6aede3b708f",
  "voice": "c485dea2230985f56c66874792f8c83502c5e01f4e87a24d573760ae8a64d295",
  "storage": "015a86fc54c0edfbe034fc2e14cfc52fe3fe4abc58cd337b3635ddc064c5898d",
  "agent": "30a8dc2baeb27e2ccf3dbd3fcbd3eb827afa41f6d5705b27d735af2c112d7480",
  "personalization": "ba2358500208bd78b2015fdeb1fbdd7fd954faccaaa13f0ac9e9977c14076535",
  "pets": "e387aac1a9477b911ff44d0b0502dbcb78d2165617929818513fca9f4b756080",
  "keyboard-shortcuts": "7583792fe3751638a8fb48166b0380dc407ce8413d079038fbcc0187272f31aa",
  "usage": "8b83fd001042ce14e4e3b6187455d419f8fd20a76509173975ea6b0134094e0e",
  "plugins-settings": "3e1a9a7d4a0ff931a8a3acf1e1e0dcc5eaf16f2c2a2e5fca359a7988e6d8c237",
  "computer-use": "606d4d7149a9ddc45242c7afa0265263740f2afcfb3febda496298177f66a2ad",
  "appshots": "d3b4b719b9894b74af2a8479fee74f510520e1202b56a606491d038b7ebe80dd",
  "browser-use": "a67c0e3611d3c5bdd559039cc5338d294094689f7b4029cd0293f89b76bfcb41",
  "hooks-settings": "04a1842177bc6c1e6c415b7849231254c7901fb0971f03c3bca328e77df1aa15",
  "connections": "3a574b15f199ae9836c69e3df56d6974c755965e7d6ce77a3cae7bded0aacf91",
  "cloud-settings": "49bbf0684029666bc0563ab43a3f74c083eb33d61ead6fb432f8bc0a46a85430",
  "codex-cloud": "49bbf0684029666bc0563ab43a3f74c083eb33d61ead6fb432f8bc0a46a85430",
  "code-review": "c6c860caa08a684e68ea690af7156ab6e665dedc2d056b172cb273ca924787b4",
  "git-settings": "3b99df0166e46891e43a8f577fbefe35b6afd89e0a1fde50349c1853c0c4eacb",
  "local-environments": "e5b96871376eecb917ba58893ef1d4792c59d9d609efd1b5cfbe0582acdf6870",
  "worktrees": "f4fa0a90c5c73d5f5c45044a89ea9296eaa7c365ad5a8a60593667b8ba16a79c",
  "pets-active": "cfbe43750b9948b628e2be4e8ba1d2dd1ee73791ec9fc2b578c8044d6999795b"
};
const jsxName = {
  "fill-rule": "fillRule", "clip-rule": "clipRule", "stroke-width": "strokeWidth",
  "stroke-linejoin": "strokeLinejoin", "stroke-linecap": "strokeLinecap",
  "stroke-opacity": "strokeOpacity", "fill-opacity": "fillOpacity",
};
const attributes = text => Object.fromEntries([...text.matchAll(/([\w-]+)="([^"]*)"/g)]
  .map(([, name, value]) => [jsxName[name] ?? name, value]));
const Fallback = props => createElement("i", { "data-fallback": props.size, className: props.className, "aria-hidden": props["aria-hidden"] });
const render = (slug, active = false) => renderToStaticMarkup(createElement(SettingsNavIcon, {
  slug, active, fallback: Fallback, className: "test-slot",
}));

for (const [key, expected] of Object.entries(vectors)) {
  const active = key === "pets-active";
  const markup = render(active ? "pets" : key, active);
  const [mark, svg] = markup.match(/^<svg ([^>]*)>/) ?? [];
  assert.ok(mark, `missing SVG for ${key}`);
  const attrs = attributes(svg);
  assert.equal(attrs.width, "16", key);
  assert.equal(attrs.height, "16", key);
  assert.equal(attrs.focusable, "false", key);
  assert.equal(attrs["aria-hidden"], "true", key);
  assert.equal(attrs.class, "test-slot", key);
  const paths = [...markup.matchAll(/<path ([^>]*?)(?:\/>|><\/path>)/g)].map(([, path]) => attributes(path));
  const vector = { viewBox: attrs.viewBox, ...(attrs.fill === undefined ? {} : { fill: attrs.fill }), paths };
  const digest = createHash("sha256").update(JSON.stringify(vector)).digest("hex");
  assert.equal(digest, expected, `source vector changed for ${key}`);
}
assert.notEqual(render("pets"), render("pets", true));
assert.equal(render("appshots"), render("appshots", true));
assert.equal(render("unknown"), '<i data-fallback="16" class="test-slot" aria-hidden="true"></i>');
assert.equal(render("toString"), render("unknown"), "prototype key must use the fallback");
console.log("PASS Settings navigation: 26 source glyphs plus active Pets, 16px slot, decorative SVG, and unknown fallback.");
