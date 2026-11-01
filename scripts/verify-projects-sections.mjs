import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;

const load = async (file) =>
  import(
    `data:text/javascript;base64,${Buffer.from(
      compile(fs.readFileSync(new URL(file, import.meta.url), "utf8"))
    ).toString("base64")}`
  );

// 1. 协议常量检查：src/protocol.ts
const { NOTIFICATION } = await load("../src/protocol.ts");
assert.ok(
  NOTIFICATION.THREAD_PROJECT_UPDATED === "thread/project/updated",
  "protocol.ts NOTIFICATION must define THREAD_PROJECT_UPDATED: 'thread/project/updated'"
);
assert.ok(
  NOTIFICATION.PROJECT_CHANGED === "project/changed",
  "protocol.ts NOTIFICATION must define PROJECT_CHANGED: 'project/changed'"
);

// 2. App.tsx AST 检查
const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const appAst = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

let projectChangedBranch = null;
let threadProjectUpdatedBranch = null;
let hasProjectsRefreshTokenState = false;
let codexSidebarRefreshTokenPassed = false;
let projectsIndexViewRefreshTokenPassed = false;

function visitApp(node) {
  if (ts.isIfStatement(node)) {
    const condition = node.expression.getText(appAst);
    if (
      condition.includes("NOTIFICATION.PROJECT_CHANGED") ||
      condition.includes('"project/changed"')
    ) {
      projectChangedBranch = node.thenStatement.getText(appAst);
    }
    if (
      condition.includes("NOTIFICATION.THREAD_PROJECT_UPDATED") ||
      condition.includes('"thread/project/updated"')
    ) {
      threadProjectUpdatedBranch = node.thenStatement.getText(appAst);
    }
  }

  // 检查 useState<number>(0) 或类似动态 projectsRefreshToken 状态声明
  if (ts.isVariableDeclaration(node)) {
    const name = node.name.getText(appAst);
    if (name.includes("projectsRefreshToken") || name.includes("projectRefreshToken")) {
      hasProjectsRefreshTokenState = true;
    }
  }

  // 检查 JSX 中的 CodexSidebar 和 ProjectsIndexView 的 refreshToken 属性
  if (ts.isJsxOpeningLikeElement(node)) {
    const tag = node.tagName.getText(appAst);
    if (tag === "CodexSidebar") {
      for (const prop of node.attributes.properties) {
        if (ts.isJsxAttribute(prop) && prop.name.getText(appAst) === "refreshToken") {
          const val = prop.initializer?.getText(appAst);
          if (val && !val.includes("appServerStatus.connected ? 1 : 0") && (val.includes("projectsRefreshToken") || val.includes("projectRefreshToken"))) {
            codexSidebarRefreshTokenPassed = true;
          }
        }
      }
    }
    if (tag === "ProjectsIndexView") {
      for (const prop of node.attributes.properties) {
        if (ts.isJsxAttribute(prop) && prop.name.getText(appAst) === "refreshToken") {
          const val = prop.initializer?.getText(appAst);
          if (val && !val.includes("appServerStatus.connected ? 1 : 0") && (val.includes("projectsRefreshToken") || val.includes("projectRefreshToken"))) {
            projectsIndexViewRefreshTokenPassed = true;
          }
        }
      }
    }
  }

  ts.forEachChild(node, visitApp);
}
visitApp(appAst);

assert.ok(
  projectChangedBranch,
  "App.tsx handleNotification must handle NOTIFICATION.PROJECT_CHANGED"
);
assert.ok(
  threadProjectUpdatedBranch,
  "App.tsx handleNotification must handle NOTIFICATION.THREAD_PROJECT_UPDATED"
);
assert.ok(
  threadProjectUpdatedBranch.includes("projectId"),
  "threadProjectUpdatedBranch must update thread.projectId in state"
);
assert.ok(
  hasProjectsRefreshTokenState,
  "App.tsx must define a projectsRefreshToken state to coordinate live updates"
);
assert.ok(
  codexSidebarRefreshTokenPassed,
  "CodexSidebar must receive dynamic projectsRefreshToken instead of static connected boolean"
);
assert.ok(
  projectsIndexViewRefreshTokenPassed,
  "ProjectsIndexView must receive dynamic projectsRefreshToken instead of static connected boolean"
);

// 3. CodexSidebar.tsx AST 检查
const sidebarSource = fs.readFileSync(
  new URL("../src/components/CodexSidebar.tsx", import.meta.url),
  "utf8"
);
const sidebarAst = ts.createSourceFile(
  "CodexSidebar.tsx",
  sidebarSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

let importsEllipsisIcon = false;
let hasMoreActionButton = false;

function visitSidebar(node) {
  if (ts.isImportDeclaration(node)) {
    const text = node.getText(sidebarAst);
    if (text.includes("EllipsisIcon")) {
      importsEllipsisIcon = true;
    }
  }

  // 检查 button 且带有 openThreadMenu 调用或更多操作 title
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const text = node.getText(sidebarAst);
    if (
      text.includes("<button") &&
      (text.includes("更多操作") || text.includes("EllipsisIcon")) &&
      text.includes("openThreadMenu")
    ) {
      hasMoreActionButton = true;
    }
  }

  ts.forEachChild(node, visitSidebar);
}
visitSidebar(sidebarAst);

assert.ok(
  importsEllipsisIcon,
  "CodexSidebar.tsx must import EllipsisIcon from './Icons'"
);
assert.ok(
  hasMoreActionButton,
  "CodexSidebar.tsx renderThreadRow must include a '更多操作' button calling openThreadMenu"
);

console.log("ALL PROJECTS & SECTIONS VERIFICATIONS PASSED!");
