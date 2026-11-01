import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText;
const source = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const React = {
  createElement: (type, props, ...children) => ({ type, props, children: children.flat() })
};

let webSearchMapBody, imageViewsMapBody, systemEventsMapBody;

function visit(node) {
  if (ts.isCallExpression(node)) {
    const expr = node.expression.getText(ast);
    if (expr === "webSearches.map" && node.arguments.length > 0) {
      webSearchMapBody = node.arguments[0].getText(ast);
    }
    if (expr === "imageViews.map" && node.arguments.length > 0) {
      imageViewsMapBody = node.arguments[0].getText(ast);
    }
    if (expr === "systemEvents.map" && node.arguments.length > 0) {
      systemEventsMapBody = node.arguments[0].getText(ast);
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);

assert.ok(webSearchMapBody, "App.tsx must contain webSearches.map");
assert.ok(imageViewsMapBody, "App.tsx must contain imageViews.map");
assert.ok(systemEventsMapBody, "App.tsx must contain systemEvents.map");

// 1. ImageGeneration: 检查 status === "failed" 或 failure 存在时的错误状态展示
{
  const fakeContext = vm.createContext({
    React,
    setSelectedPreviewFile: () => {},
    setShowRightDrawer: () => {},
  });
  const renderImg = vm.runInContext(compile(`(${imageViewsMapBody})`), fakeContext);

  // 失败样本
  const failedImg = {
    id: "img-fail",
    type: "imageGeneration",
    status: "failed",
    failure: { message: "Prompt rejected by safety filter" }
  };
  const resFailed = renderImg(failedImg, 0);
  const strFailed = JSON.stringify(resFailed);
  assert.ok(strFailed.includes("失败") || strFailed.includes("Prompt rejected"), "ImageGeneration must display failure status or message");

  // 生成中样本
  const inProgressImg = {
    id: "img-progress",
    type: "imageGeneration",
    status: "inProgress"
  };
  const resProgress = renderImg(inProgressImg, 0);
  const strProgress = JSON.stringify(resProgress);
  assert.ok(strProgress.includes("生成中") || strProgress.includes("inProgress"), "ImageGeneration must display inProgress status");
}

// 2. Sleep: 检查 durationMs 呈现
{
  const fakeContext = vm.createContext({ React });
  const renderSys = vm.runInContext(compile(`(${systemEventsMapBody})`), fakeContext);
  const sleepEvt = {
    id: "sleep-1",
    type: "sleep",
    durationMs: 5000
  };
  const resSleep = renderSys(sleepEvt, 0);
  const strSleep = JSON.stringify(resSleep);
  assert.ok(strSleep.includes("5000") || strSleep.includes("5s"), "Sleep event must display duration");
}

console.log("PASS verify-misc-tools expectations");
