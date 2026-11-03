# 06A Git 异步身份与提交保护

日期：2026-11-01。状态：本批自动检查和原生打包完成；06 整页未验收。

## 依据与改动

修改前建立 [GL01–GL06 合同](../specs/06-git-lifecycle.md)。固定官方包 SHA-256 为 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`，本轮四项资源与 integrity 见 [manifest](../../../.ref/parity/06/runs/20261101-codex-git-lifecycle/reference/manifest.json)。`local-conversation-git-actions` 约 UTF-16 偏移 3558 的 `G=he!=null||ve.isPending` 证明在途保护；cwd/hostConfig 与 review-state 证明操作范围有身份区分。commit chunk 实为图标，不作提交策略依据。以上均为静态证据，未替代官方运行时。

- `DiffDrawer.tsx`：diff effect 清理后旧成功、失败和 finally 均不能写当前视图，迟到提交列表不再启动下一级 diff。
- 提交、提交并推送、独立推送复用一个同步 ref 锁；仓库上下文以对象身份区分，A→B→A 也使旧流程失效。
- stage/commit/push 各 await 后校验上下文；只能停止尚未派发的下一步，不能撤销已发出的 Git 命令。
- 成功只清除提交时仍未改变的说明，保留在途新输入。提交成功而推送失败可独立推送重试；组合输入不触发提交快捷键。

复用现有 invoke、Git 命令、反馈和状态，没有新增依赖、权限、视觉样式或协议。

## 验证与构建

- `node scripts/verify-git-lifecycle.mjs`：GL01–GL06 通过；执行生产 effect、提交/推送及按键回调，用可控 Promise 验证逆序响应和写链。
- `node scripts/verify-git-worksurface.mjs`、`node scripts/verify-file-editor-lifecycle.mjs`、`npx tsc --noEmit`、`git diff --check`：退出 0。
- `pwsh -NoProfile -File scripts/verify-all.ps1`：退出 0，包含隔离协议探针；[完整日志](../../../.ref/parity/06/runs/20261101-codex-git-lifecycle/actual/verify-all.log)。
- `npm run tauri build`：Release/MSI/NSIS 退出 0；原有大 chunk 警告保留。[构建日志](../../../.ref/parity/06/runs/20261101-codex-git-lifecycle/actual/build.log)。
- 三项绑定输入构建前后哈希一致；HEAD、dirty 清单、EXE 大小和 SHA-256 见 [构建身份](../../../.ref/parity/06/runs/20261101-codex-git-lifecycle/actual/build-manifest.json)。
- [本轮 EXE](../../../dist-artifacts/06-git-lifecycle-20261101/CodexNative.exe) 未执行原生 UI 验收。测试未在用户仓库创建提交、推送或 PR。

## 剩余边界

stage/unstage/discard/PR 其他入口的晚到响应和重复操作仍需复核；准确官方提交界面、提交策略、生成说明、真实隔离 Git 往返、原生交互和配对像素未验证。本轮不修改这些项目的状态，不声称 06 完成。

下一开发单元为 07 终端与布局。无提交或推送。
