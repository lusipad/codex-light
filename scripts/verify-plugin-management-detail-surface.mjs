import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(fs.readFileSync("src/components/PluginManagementDetail.tsx", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const nodes = node => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = node => typeof node === "string" ? node : node?.props ? [node.props.children].flat(Infinity).map(text).join("") : "";
const base = () => ({ marketplaceName: "", summary: { id: "internal-id", name: "Fallback", source: { type: "remote" } }, skills: [], apps: [], hooks: [], mcpServers: [] });
function fixture(detail = base()) {
  let cursor = 0, dirty = true, effects = [], tree, toggles = 0;
  const slots = [], calls = [], expansionCalls = [];
  const expansion = { ref: { current: null }, expanded: false, overflowing: false, maxHeight: 48, fullHeight: 96, toggle() { toggles++; } };
  let props = { detail, identity: "host/market/id", onBack() { calls.push("back"); } };
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { const next = typeof value === "function" ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useId() { return `surface-${cursor++}`; },
    useEffect(run, deps) { const i = cursor++, previous = slots[i]; if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: run() }; }); },
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, URL, require(name) {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === "../bridge") return { tauriInvoke(command, args) { return new Promise((resolve, reject) => calls.push({ command, args, resolve, reject })); } };
    if (name === "./PluginLogo") return { PluginLogo: "PluginLogo" };
    if (name === "./PluginDirectoryDetail") return { usePluginDetailExpansion(identity, lines) { expansionCalls.push({ identity, lines }); return expansion; } };
    return {};
  } });
  function render() {
    for (let count = 0; dirty; count++) { assert.ok(count < 20); dirty = false; cursor = 0; tree = exports.PluginManagementDetail(props); const pending = effects; effects = []; pending.forEach(run => run()); }
    return tree;
  }
  return { model: exports.pluginManagementDetailPresentation, calls, expansion, expansionCalls, get toggles() { return toggles; }, get tree() { return render(); },
    update(patch) { props = { ...props, ...patch }; dirty = true; return render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
const normalized = value => JSON.parse(JSON.stringify(value));
{
  const f = fixture(), d = base();
  assert.deepEqual(normalized(f.model(d)), { title: "Fallback", description: "", rows: [] }, "absent values never create placeholder About rows");
  d.marketplaceName = "Market"; d.summary.version = "remote-version"; d.summary.localVersion = "local-version";
  d.summary.interface = { displayName: "Name", shortDescription: "Short", longDescription: "Not header", category: "  Tools  ", developerName: "Developer" };
  d.description = "Fallback description";
  assert.deepEqual(normalized(f.model(d)), { title: "Name", description: "Short", rows: [
    { label: "类别", value: "Tools" }, { label: "开发者", value: "Developer" }, { label: "版本", value: "local-version" },
  ] });
  d.summary.localVersion = null; assert.equal(f.model(d).rows.find(row => row.label === "版本").value, "remote-version");
  d.summary.localVersion = ""; assert.equal(f.model(d).rows.some(row => row.label === "版本"), false, "nullish version fallback does not substitute for explicitly empty local version");
  d.summary.interface.shortDescription = ""; assert.equal(f.model(d).description, "");
  d.summary.interface.shortDescription = null; assert.equal(f.model(d).description, "Fallback description");
  for (const [source, expected] of [
    [{ type: "local", path: "C:/private/plugin" }, "C:/private/plugin"],
    [{ type: "git", url: "https://example.com/repo", path: "plugins/a", refName: "main", sha: "123" }, "https://example.com/repo · plugins/a · main · 123"],
    [{ type: "git", url: "https://example.com/repo", path: null, refName: "", sha: null }, "https://example.com/repo"],
    [{ type: "npm", package: "@scope/package", version: "1", registry: "https://registry.example" }, "@scope/package@1 · https://registry.example"],
    [{ type: "npm", package: "package", version: null }, "package"],
  ]) {
    d.summary.source = source; const rows = f.model(d).rows;
    assert.equal(rows.find(row => row.label === "来源").value, expected); assert.equal(rows.find(row => row.label === "市场").value, "Market");
  }
  d.summary.source = { type: "remote" }; assert.equal(f.model(d).rows.some(row => ["市场", "来源"].includes(row.label)), false);
  for (const unsafe of ["javascript:alert(1)", "data:text/html,test", "file:///c:/secret", "https://user:pass@example.com", "https://example.com/\npath", "http://example.com", "/local"]) {
    d.summary.interface.websiteUrl = unsafe; assert.equal(f.model(d).rows.some(row => row.href), false, unsafe);
  }
  d.summary.interface.websiteUrl = "https://example.com/path"; d.summary.interface.privacyPolicyUrl = "https://example.com/privacy"; d.summary.interface.termsOfServiceUrl = "https://example.com/terms";
  assert.deepEqual(normalized(f.model(d).rows.filter(row => row.href)), [
    { label: "网站", value: "https://example.com/path", href: "https://example.com/path" },
    { label: "隐私政策", value: "查看隐私政策", href: "https://example.com/privacy" },
    { label: "服务条款", value: "查看条款", href: "https://example.com/terms" },
  ]);
}
{
  const d = base(); d.summary.interface = { shortDescription: "Long description", websiteUrl: "https://example.com" };
  const f = fixture(d), included = { type: "section", props: { children: "Real included items" } }, action = { type: "button", props: { children: "Real action" } };
  f.update({ children: included, actions: action, onViewDetails: () => f.calls.push("view") });
  assert.equal(nodes(f.tree).filter(node => node.type === "h1").length, 1);
  assert.equal(nodes(f.tree).find(node => node.type === "PluginLogo").props.plugin, d.summary);
  assert.equal(nodes(f.tree).find(node => node.type === "nav").props["aria-label"], "面包屑");
  nodes(f.tree).find(node => node.type === "button" && text(node) === "插件设置").props.onClick();
  nodes(f.tree).find(node => node.type === "button" && text(node) === "查看详情").props.onClick();
  assert.deepEqual(f.calls, ["back", "view"]);
  assert.equal(nodes(f.tree).some(node => node.type === "button" && text(node) === "展开"), false);
  assert.ok(f.expansionCalls.every(call => call.lines === 3 && call.identity.includes("Long description")), "reuse production measured expansion hook with exactly three lines");
  f.expansion.overflowing = true; f.update({ identity: "next" });
  const expand = nodes(f.tree).find(node => node.type === "button" && text(node) === "展开");
  const description = nodes(f.tree).find(node => node.props.id === expand.props["aria-controls"]);
  assert.equal(description.props.style.maxHeight, 48); assert.equal(expand.props["aria-expanded"], false); expand.props.onClick(); assert.equal(f.toggles, 1);
  f.expansion.expanded = true; f.expansion.overflowing = false; f.update({ identity: "next-again" });
  assert.equal(nodes(f.tree).find(node => node.type === "button" && text(node) === "收起").props["aria-expanded"], true);
  const children = f.tree.props.children; assert.ok(children.indexOf(included) < children.findIndex(node => node?.props?.className === "pmd-about"), "About follows real included content");
  assert.ok(!text(f.tree).includes("internal-id"));
  f.update({ onViewDetails: undefined, actions: undefined }); assert.equal(nodes(f.tree).some(node => node.props.className === "pmd-actions"), false);
  const link = nodes(f.tree).find(node => node.type === "a"); let prevented = 0;
  link.props.onClick({ preventDefault() { prevented++; } });
  assert.equal(prevented, 1); assert.equal(f.calls.at(-1).command, "review_link_open"); assert.equal(f.calls.at(-1).args.url, "https://example.com/");
  f.calls.at(-1).reject(new Error("Denied")); await new Promise(resolve => setImmediate(resolve));
  assert.match(text(nodes(f.tree).find(node => node.props.role === "alert")), /Denied/);
  link.props.onClick({ preventDefault() {} }); const old = f.calls.at(-1);
  f.update({ identity: "another-plugin" }); old.reject(new Error("Late")); await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes(f.tree).some(node => node.props.role === "alert"), false, "late failure cannot pollute another identity");
  nodes(f.tree).find(node => node.type === "a").props.onClick({ preventDefault() {} }); const unmounted = f.calls.at(-1);
  f.unmount(); unmounted.reject(new Error("Unmounted")); await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes(f.tree).some(node => node.props.role === "alert"), false);
}
console.log("Plugin management detail surface: real component, metadata provenance, omitted fields, source variants, three-line hook reuse, actions, safe bridge links and stale failures passed. Native layout and paired pixels remain unverified.");
