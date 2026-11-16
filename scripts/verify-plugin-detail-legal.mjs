import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const react = { createElement: (type, props, ...children) => typeof type === "function"
  ? type({ ...props, children: children.flat(Infinity) }) : { type, props: props || {}, children: children.flat(Infinity) } };
const output = ts.transpileModule(fs.readFileSync("src/components/PluginDirectoryLegal.tsx", "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const exports = {};
vm.runInNewContext(output, { exports, URL, require(name) {
  if (name === "react") return react;
  throw new Error(`Unexpected legal import ${name}`);
} });
const render = (patch = {}, apps) => exports.PluginDirectoryLegal({ detail: { summary: { name: "Actual plugin", interface: {} }, apps: [], ...patch }, apps });
const nodes = node => !node || typeof node !== "object" ? [] : [node, ...(node.children || []).flatMap(nodes)];
const text = node => node == null || node === false ? "" : typeof node !== "object" ? String(node) : (node.children || []).map(text).join("");
const paragraphs = tree => nodes(tree).filter(node => node.type === "p");
const links = tree => nodes(tree).filter(node => node.type === "a");
const one = { apps: [{ id: "plain", name: "Not the plugin name" }] };
assert.equal(render(), null);
assert.equal(render({ appTemplates: [{ unknown: true }] }), null, "unknown template is not assumed unconfigured");
let tree = render(one);
assert.equal(paragraphs(tree).length, 1);
assert.ok(text(tree).startsWith("连接到 Actual plugin 后"));
assert.ok(!text(tree).includes("Not the plugin name"));
assert.equal(links(tree).length, 3, "missing terms/privacy remain plain text");
assert.deepEqual(links(tree).map(node => node.props.href), [
  "https://help.openai.com/en/articles/8590148-memory-faq",
  "https://help.openai.com/en/articles/20001062-elevated-risk-labels",
  "https://help.openai.com/en/articles/11487775-apps-in-chatgpt",
]);
tree = render({ ...one, summary: { name: "internal", interface: { displayName: "Display", termsOfServiceUrl: "https://example.test/terms", privacyPolicyUrl: "https://example.test/privacy" } } });
assert.equal(links(tree)[0].props.href, "https://example.test/terms");
assert.equal(links(tree)[1].props.href, "https://example.test/privacy");
assert.ok(text(tree).startsWith("连接到 Display 后"));
tree = render({ ...one, summary: { name: "Plugin", interface: { termsOfServiceUrl: "javascript:alert(1)", privacyPolicyUrl: "" } } });
assert.equal(links(tree).length, 3, "unsafe or empty URLs are not emitted as working legal links");
tree = render({ apps: [{ id: "a" }, { id: "b" }], summary: { name: "Never interpolate", interface: { termsOfServiceUrl: "https://unused.test" } } });
assert.equal(paragraphs(tree).length, 1); assert.ok(text(tree).startsWith("此插件可能包含"));
assert.ok(!text(tree).includes("Never interpolate")); assert.equal(links(tree).length, 3);
for (const id of ["connector_gmail", "connector_google_bigquery", "connector_google_calendar", "connector_google_contacts", "connector_google_docs", "connector_google_drive", "connector_google_sheets", "connector_google_slides"]) {
  tree = render({ apps: [{ id }] }); assert.equal(paragraphs(tree).length, 2, id);
  assert.equal(links(tree).at(-1).props.href, "https://help.openai.com/en/articles/10408842-google-app-for-chatgpt-data-controls-faq");
}
for (const id of ["gmail", "CONNECTOR_GMAIL", "connector_gmail_suffix", " connector_gmail", "unknown"]) {
  assert.equal(paragraphs(render({ apps: [{ id, name: "Google Gmail" }], summary: { name: "Google", interface: { developerName: "Google" } } })).length, 1, id);
}
assert.equal(paragraphs(render(one, [{ id: "plain", branding: { developer: " Google " } }])).length, 2);
assert.equal(paragraphs(render(one, [{ id: "plain", appMetadata: { developer: "Google" } }])).length, 1);
assert.equal(paragraphs(render(one, [{ id: "another", branding: { developer: "Google" } }])).length, 1, "unrelated catalog app cannot trigger legal");
assert.equal(render({ appTemplates: [{ materializedAppIds: ["configured"], canonicalConnectorId: "connector_google_drive" }] }), null);
tree = render({ appTemplates: [{ materializedAppIds: [], canonicalConnectorId: "connector_google_drive" }] });
assert.equal(paragraphs(tree).length, 2); assert.ok(text(tree).startsWith("连接到 Actual plugin 后"));
tree = render({ ...one, appTemplates: [{ materializedAppIds: [] }] });
assert.ok(text(tree).startsWith("此插件可能包含"));
for (const template of [{}, { materialized_app_ids: [] }, { materializedAppIds: null }, { materializedAppIds: [1] }]) {
  assert.equal(render({ appTemplates: [template] }), null);
}
// Fixed 26.1103.4239.0 zh-CN strings; CI does not need ignored reference files.
const reference = {"singleApp":"连接到 {pluginName} 后，ChatGPT 可能会与此应用分享相关聊天和记忆，以便为你的请求提供上下文。{pluginName} 对这些数据的使用受其 <termsLink>条款</termsLink> 和 <privacyPolicyLink>隐私政策</privacyPolicyLink> 约束。如果你已启用 <memoryLink>记忆</memoryLink>，来自该应用的数据可能会用于主动提供有用信息或建议。ChatGPT 始终遵守你的训练数据偏好设置，包括来自已连接应用的数据。使用应用可能会带来 <elevatedRiskLink>较高风险</elevatedRiskLink>。你可以随时在设置中管理偏好设置或断开与应用的连接。<learnMoreLink>了解更多</learnMoreLink>","googleApps":"关于 Google 应用的说明：此插件可能包含上文列出的一个或多个 Google 应用。从这些应用同步的任何数据都可能用于向你提供相关且个性化的信息。我们不会使用这些数据或其衍生内容训练通用模型，但你在反馈中提交的内容或 ChatGPT 回复中包含的内容除外。你可以删除对话，这也会删除这些对话中使用的任何应用数据。<learnMoreLink>了解更多</learnMoreLink>","multipleApps":"此插件可能包含上方列出的一个或多个应用。连接到应用后，ChatGPT 可能会与该应用分享相关聊天和记忆，以帮助为你的请求提供上下文。应用对此类数据的使用受其条款和隐私政策约束，相关条款和隐私政策可在应用页面找到。如果你已启用 <memoryLink>记忆</memoryLink>，来自该应用的数据可能会用于主动提供有用信息或建议。ChatGPT 始终尊重你的训练数据偏好设置，包括来自已连接应用的数据。使用应用可能存在<elevatedRiskLink>较高风险</elevatedRiskLink>。你可随时在设置中管理偏好设置，或断开与应用的连接。<learnMoreLink>了解更多</learnMoreLink>"};
const strip = value => value.replace(/<[^>]+>/g, "").replaceAll("{pluginName}", "Actual plugin");
assert.equal(text(paragraphs(render(one))[0]), strip(reference.singleApp));
assert.equal(text(paragraphs(render({ apps: [{ id: "a" }, { id: "b" }] }))[0]), strip(reference.multipleApps));
assert.equal(text(paragraphs(render({ apps: [{ id: "connector_gmail" }] }))[1]), strip(reference.googleApps));
console.log("PASS plugin legal exact Chinese, app/template counts, strict Google identities/publisher and genuine help/metadata links");
