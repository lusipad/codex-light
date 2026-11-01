# 06 变更与 Git 工作面 (Changes & Git Worksurface) 调研与实现

日期：2026-10-27。状态：调研、先红断言、最小代码实现、全量标准检查与 Release 构建完成；待原生操作体验与整页用户验收。

## 1. 范围与证据

本单元覆盖变更审查与 Git 工作面的核心能力：
- Diff 视图与模式：统一（Unified）与并排（Split）布局、代码自动换行切换（Word wrap）、文件级改动统计（+N / -N）、查看本轮对话改动（Last turn）、未提交改动（Working tree）、已暂存改动（Staged）、分支对比（Branch diff）与提交历史（Commit log diff）；
- 补丁与命令导出：复制 `git apply` 补丁命令、复制原始 Diff Patch 文本；
- 变更审查与交互：
  - 点击任意 Diff 行内联展开评审框，直接向 Codex 提问或提出修改意见；
  - 标记文件已审阅（Viewed checkbox / tag）；
- 暂存与撤销操作（Stage / Unstage / Discard）：
  - 单个文件暂存与取消暂存；
  - 全部文件一键全暂存与全取消；
  - 单个文件放弃更改（Discard with confirmation）；
  - 全部文件批量放弃更改（Discard all with confirmation），提供强风险防误触确认提示；
- 提交与推送（Commit & Push）：
  - 智能 Conventional Commits 提交说明生成；
  - 提交说明保留保护（提交失败时不丢失已输入的提交说明）；
  - 自动暂存联动：当暂存区为空但存在未暂存改动时，自动全暂存后再执行提交，确保功能闭环；
  - 一键“提交并推送”与带 `--force-with-lease` 选项的独立推送；
- GitHub Pull Request 入口：集成 GitHub CLI 创建 PR、填写标题与摘要、标记 Draft PR。

### 官方基准与后端能力依据
- 官方固定版本：`26.928.21956 / build 12404`。
- 本机 app-server 实际版本：CLI `0.159.2`。
- Rust 后端命令（`src-tauri/src/git.rs` 与 `src-tauri/src/lib.rs`）：
  - `git_status`: 查询工作区变更文件列表与增删行；
  - `git_diff`: 获取指定文件或全工作区 diff 补丁文本；
  - `git_stage`: 暂存指定文件或全暂存（`filePath: null` 对应 `git add -A`）；
  - `git_unstage`: 取消暂存；
  - `git_discard`: 还原丢弃指定文件的更改；
  - `git_commit_changes`: 创建 Git commit；
  - `git_push_changes`: 推送分支（支持 `--force-with-lease`）；
  - `git_create_pr`: 调用 `gh pr create` 创建 PR。

## 2. 源码差距与问题清单

| ID | 问题描述 | 影响 | 状态 |
|---|---|---|---|
| G01 | `DiffDrawer.tsx` 缺少批量“全放弃”（Discard All）更改功能 | 用户在有多项修改需要批量回退时，只能逐个点击并确认，缺少批量放弃能力 | 已修复 |
| G02 | `DiffDrawer.tsx` 提交时若暂存区为空则直接调用底层 `git commit` | 当工作区仅有未暂存修改时提交会直接报错，无法完成自动全暂存并提交的完整交互 | 已修复 |
| G03 | `DiffDrawer.tsx` 的 Diff 工具栏缺少手动刷新 Git 状态按钮 | 外部变动若未被即时捕获时，用户无法一键主动重检 Git 变更状态 | 已修复 |
| G04 | `DiffDrawer.tsx` 批量放弃操作必须具备防误触二次确认保护 | 批量放弃为不可逆破坏性操作，必须在确认后才执行还原 | 已修复 |

## 3. 先红验证与回归设计

设计先红回归脚本 `scripts/verify-git-worksurface.mjs`，包含：
1. **G01/G04 验证**：断言 `DiffDrawer.tsx` 包含 `handleDiscardAll` 方法，并在 `diff-file-bulk-actions` 中渲染“全放弃”按钮，且内部调用 `confirm(...)` 提示二次确认；
2. **G02 验证**：断言 `DiffDrawer.tsx` 在 `handleCommit` 与 `handleCommitAndPush` 中检测如果 `!hasStaged` 则先执行 `git_stage` 全暂存后再执行提交；
3. **G03 验证**：断言 `DiffDrawer.tsx` 在 `diff-layout-switch` 中渲染刷新按钮并调用 `onRefreshGit()`。

修改前运行结果：真实先红断言失败，保存日志至 `.ref/parity/06/git-worksurface-before.log`。

## 4. 实施与验证结果

- `src/components/DiffDrawer.tsx`：
  - 添加 `handleDiscardAll` 方法并在执行前使用 `confirm` 拦截二次确认；
  - 在 `diff-file-bulk-actions` 区域补充带有 danger 样式的“全放弃”按钮；
  - 在 `handleCommit` 与 `handleCommitAndPush` 中加入 `!hasStaged` 时的自动 `git_stage` 全暂存联动；
  - 在 `diff-layout-switch` 模式切换栏中增加带 `RefreshIcon` 的手动刷新按钮。
- `src/styles.css`：
  - 补充 `.mini-link-btn.danger` 红色文字与 hover 背景。
- `scripts/verify-all.ps1`：集成 `verify-git-worksurface.mjs`。

### 自动化测试与全量标准检查
- `node scripts/verify-git-worksurface.mjs`：5 项检查全部通过（PASS）；
- `npx tsc --noEmit`：0 错误通过；
- `pwsh -NoProfile -File scripts/verify-all.ps1`：**ALL CHECKS PASSED**，退出码 0，日志保存至 `.ref/parity/06/verify-git-worksurface-final.log`；
- Release 原生构建：退出码 0，日志保存至 `.ref/parity/06/release-git-worksurface.log`；
  - 可执行文件：`dist-artifacts/06-git-worksurface-20261027/CodexNative.exe`；
  - SHA-256 哈希：`31EEC01E10CBC5F68717B94D2A9EEC9FCE36BF4B2F1CD70EBC95CA9AFFAB296C`；
  - 指纹记录文件：`.ref/parity/06/build-git-worksurface.json`。

## 5. 限制与待用户验收说明

- **外部依赖与复杂冲突**：Git 三方合并冲突编辑与解决依赖外部合并工具；
- **视觉像素对齐**：原生窗口下的 Diff 并排双栏和行内评论气泡在各种高 DPI 缩放下的像素对比仍待进一步比对；
- **验收结论**：目前已通过先红自动化回归、全量协议探针验证及 Release 构建，处于“待用户验收”状态。未经验收前不标为“已验收”。
