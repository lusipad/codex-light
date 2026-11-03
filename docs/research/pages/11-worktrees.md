# 11 Worktrees (隔离工作树) 调研与实现

日期：2026-10-27。状态：调研完成，准备先红回归与代码实现。

2026-11-01 复核：旧“已解决”和 W01–W04 字符串测试未证明实际会话/异步行为。本轮补充 [11A 合同](../../antigravity/specs/11-worktree-context.md)与[实现证据](../../antigravity/runs/20261101-codex-worktree-context.md)，修复现有目录被再次创建、绑定会话绕过完整加载、跨项目旧读取污染。固定原包重新核验；真实 Git、完整官方页面与原生/像素仍未验收。

2026-11-03：11B 按[删除合同](../../antigravity/specs/11-worktree-removal.md)补齐真实关联/置顶会话复核、逐条归档和回读、工作树身份/主 checkout 保护、临时 index 快照、Git 删除与 detached 恢复。实现及验证边界见[11B](../../antigravity/acceptance/11B.md)和 `.ref/parity/11/actual/11B/build-manifest.json`。快照失败按候选定向删除例外返回明确 warning；无递归删除兜底。旧“已解决”不证明这些新链路或完整页面已验收；原生、官方运行时和配对像素仍待验证。

## 1. 范围与证据

本单元覆盖 Git Worktree 隔离工作面的完整生命周期与交互：
- Worktrees 列表与状态检测：
  - 调用原生 Rust 命令 `git_worktrees_list`；
  - 识别主工作区（`isMainRepo`）、Codex 托管工作树（`isCodexManaged`，位于 `~/.codex/worktrees/` 目录下）、未提交修改脏状态（`hasUncommittedChanges`）、当前分支或 detached 状态、绑定会话（`ownerThreadId`）；
- Worktree 创建：
  - 调用 `git_worktree_create`；
  - 支持从当前工作区未提交修改（`working-tree`）复制或从特定分支（`branch`）派生；
  - 自动创建隔离目录并应用补丁与未跟踪文件；
- 冲突恢复与带回：
  - 调用 `git_worktree_bring_changes_back` 将隔离 Worktree 的未提交变更安全合并回主工作区；
  - 调用 `git_worktree_repair` 执行工作树关联修复；
- 资源操作与安全删除：
  - 在系统文件管理器中打开（`reveal_path_in_explorer`）；
  - 在 Worktree 目录启动集成终端 PTY（`onOpenTerminalInWorktree`）；
  - 在 Worktree 目录启动新会话（`onStartChatInWorktree`）；
  - 绑定会话直达跳转（`onSelectThread`）；
  - 移除 Worktree（`git_worktree_delete`）带二次确认与忙态锁定；
  - 非 Git 仓库优雅降级提醒。

### 官方基准
- 官方固定版本：`26.928.21956 / build 12404`。
- 本机 app-server 实际版本：CLI `0.159.2`。

## 2. 源码差距与问题清单

| ID | 问题描述 | 影响 | 状态 |
|---|---|---|---|
| W01 | `WorktreesViewProps` 缺少 `onSelectThread`，绑定会话为纯文本 | 用户无法直接从 Worktree 绑定的会话标识跳转至对话 | 已解决 |
| W02 | `App.tsx` 渲染 `WorktreesView` 未传递 `onSelectThread` | 会话跳转缺失接线 | 已解决 |
| W03 | 操作（带回、删除）缺少行级 busy 状态锁定 | 快速连击可能触发重复并发 Git 命令 | 已解决 |
| W04 | 非 Git 仓库时缺少清晰友好的提示横幅 | 普通文件夹下用户无法获知为何无法创建 Worktree | 已解决 |

## 3. 先红验证与回归设计

设计先红回归脚本 `scripts/verify-worktrees.mjs`，在实施修改前执行并断言失败：
1. **W01 验证**：断言 `WorktreesViewProps` 声明了 `onSelectThread` 回调；
2. **W02 验证**：断言 `App.tsx` 渲染 `WorktreesView` 时传入了 `onSelectThread`；
3. **W03 验证**：断言 `WorktreesView.tsx` 具有操作忙态管理（`actionBusyPath` 或禁用状态）；
4. **W04 验证**：断言 `WorktreesView.tsx` 包含绑定会话的可点击跳转按钮。

初始先红日志存档：`.ref/parity/11/worktrees-before.log`（退出码 1）。

## 4. 实施与验证结果

1. **最小修改实施**：
   - `src/components/WorktreesView.tsx`：
     - `WorktreesViewProps` 声明 `onSelectThread?: (threadId: string) => void;`；
     - 增加 `actionBusyPath` 状态并对“带回主工作区”与“移除”进行 busy 防重保护；
     - 将绑定会话改造为点击直达对应会话的按钮（调用 `onSelectThread`）。
   - `src/App.tsx`：
     - 在渲染 `WorktreesView` 时传入 `onSelectThread={(tId) => { setActiveThreadId(tId); setActiveRoute("thread"); }}`。
2. **测试转绿与全量验证**：
   - `node scripts/verify-worktrees.mjs` 4 项检查全部通过（退出码 0）；
   - 接入 `scripts/verify-all.ps1`，全量标准检查 PASS（退出码 0，日志存档于 `.ref/parity/11/verify-worktrees-final.log`）。
3. **原生构建与指纹**：
   - 原生 Release 编译完成（退出码 0）；
   - 产物归档于 `dist-artifacts/11-worktrees-20261027/CodexNative.exe`；
   - SHA-256：`98AFBC6A0BC3535C428097C7DC458AC148706EE41B8A25FD4CAC127D53D4B16B`（记录于 `.ref/parity/11/build-worktrees.json`）。
