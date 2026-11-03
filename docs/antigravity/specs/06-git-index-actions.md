# 06B 文件暂存与取消暂存合同

日期：2026-11-03。调研后已进入[06B实施](../acceptance/06B.md)，未用户验收。本单元定位为Git索引真实往返，不含discard删除或完整Git界面重建。下文问题为修改前快照，当前状态以验收单为准。

## 官方证据

重新校验候选asar SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`，仍带offline补丁。提取和包内integrity核验见[参考清单](../../../.ref/parity/06/actual/06B-research/manifest.json)。

- `webview/assets/code-diff-e4a1b1663a6c.js`，SHA-256 `cd424093695d47925a945f7f7671f0aa001a1d4626476a3200b21f752feb99d4`。UTF-16偏移约6700起`function It`接收`action/scope/disabled/onClick`；存在file、hunk、section级stage/unstage/revert控件，disabled传给实际按钮。消息ID包括`diff.actionButton.stageFile/unstageFile/stageSection/unstageSection`。这些证明动作入口，不证明所有服务策略或实际中文。
- `local-conversation-git-actions-b16ff036766e.js`，SHA-256 `10512b8ca73f4afe52cc776cfb5f8e9d776ffeb66233ed2205729121029450f6`。约3558附近`G=he!=null||ve.isPending`及cwd/hostConfig范围，与[06A合同](06-git-lifecycle.md)合读。不能仅据此断言官方所有Git写操作共用一个全局锁。

以上定位数字为0-based UTF-16字符偏移。没有官方原生运行时/像素证据，包内hunk入口存在不表示本轮已实现hunk。

## 当前问题

- `DiffDrawer.tsx` `handleStage/handleUnstage`未接现有`gitWritePendingRef`；可与提交/推送重叠，旧仓库结果会刷新或提示到新上下文。
- `git.rs` `git_unstage_file`丢弃`run_git(reset HEAD...)`错误，无条件返回Ok；index锁定、无HEAD等情况不能当成功。
- 现有Git生命周期回归只执行commit/commitAndPush/push，不能覆盖独立暂存入口。
- 同一文件同时有index和工作区变化时，当前单一`entry.staged`按钮不能代表两个阶段。完整阶段拆分需继续核对官方数据模型；不通过隐藏工作区变化来解决。

## 开发与验收范围

复用现有invoke、上下文身份、共享Git写锁与刷新回调，修复单文件/全部暂存和取消暂存；不引入通用操作框架或新依赖。取消暂存应保留工作区文件，准确传播失败。尚无HEAD的仓库需确定正确索引操作并用真实Git测试，不靠吞异常降级。

| ID | 操作与证据 |
|---|---|
| GI01 | 已跟踪文件修改→暂存→取消；核对cached/worktree diff及文件字节。 |
| GI02 | 新文件→暂存→取消；保留文件并恢复untracked。 |
| GI03 | 文件暂存后继续修改；往返不丢工作区新内容，分别核对index与文件。 |
| GI04 | 全暂存/全取消；索引正确，不修改工作区字节。 |
| GI05 | 连点暂存/取消并同时提交；生产回调同一时刻仅一条写链。 |
| GI06 | A命令在途切B再完成或失败；不刷新、清选择或提示污染B。已派发A命令不声称能撤回。 |
| GI07 | 隔离仓库index.lock；Rust返回真实失败，解锁后可重试。 |
| GI08 | 初始无提交仓库取消暂存；正确恢复untracked或明确失败，不假成功。 |

Rust测试在隔离临时仓库直接调用生产函数；前端测试执行生产回调并控制异步身份。完整标准、相关Rust测试和源码对应原生构建分别留证，真实原生按钮与官方视觉待配对。discard删除、hunk、双阶段完整布局另列后续，不把本单元当06整页完成。
