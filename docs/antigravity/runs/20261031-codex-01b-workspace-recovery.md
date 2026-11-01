# 01B A11：既有会话发送前恢复

状态：本轮恢复依赖已自验，完整项目移动仍开发中。下文先记录修改前合同，再列实际证据。01B 未用户验收，不放行 01C。

## 修改前依据与取舍

固定官方候选包 26.928.21956。`app-shared.js` SHA-256
`89601A70E2C369695B147F7EB24A8AE054CA01AB62425E7B1ED5D8BF22844D17`；
`app-initial-fd3c4b862660.js` SHA-256
`577A50E29502F573E2FBCCF4940B9BD875339DB420D6D5A9798A0D201EE0AFF1`。
以下数字为 0-based UTF-16 字符偏移。

- shared 2964597：needsResume 与 runtime 状态相关，读取历史不等于恢复。
- shared 2831277、2831574：恢复优先使用 applied cwd/roots，不提前消费 pending。
- shared 2838342、2840498：实际等待 thread/resume；回包用于更新环境与权限。
- shared 2935473、2937551：普通 turn 为显式 cwd > conversation cwd > applied；
  local 环境首项接收已解析 cwd，remote 保留自己的上下文。
- initial 4951407、shared 3015642：普通及队列发送前均检查恢复。
- shared 2824458：仅 workspaceWrite 合入 writable roots，不提升 sandbox 类型。

真实 CLI 0.165.0 的无凭证隔离探针已证明：冷重启后 read 与历史分页均成功，
状态仍为 notLoaded、environments 为 null；plain resume 后才恢复 local 环境。
已加载时再次 resume 的目录覆盖没有生效；冷 resume 覆盖则生效并持久化。
记录位于 `.ref/parity/01/runs/20261031-codex-01b-workspace-recovery/actual/resume-probe-0.165.0.json`。
探针仅使用离线 inject_items，零模型 turn。

实现取舍：共享 turn 网关先读取 runtime 状态；冷会话 plain resume，确认实际环境后，
local 才采用 applied 恢复及 pending 覆盖，remote 不消费 local 状态。
这避免将未知 sticky remote 强制覆盖成本地，属于 Tauri 的等价实现方案，
不声称逐请求与官方一致。没有证明普通点击会话时的官方恢复时机，本轮聚焦发送前。

## 修改前验收合同

1. WR01：read 成功但 notLoaded 时，必须 await resume 后才发 turn；已加载不重复 resume。
2. WR02：read/resume 失败、恢复后环境未知或仍未加载，保留输入和 pending，不发 turn。
3. WR03：恢复期间 owner 被更新，旧请求不得继续 resume 或派发 turn。
4. WR04：冷 local 先采用 applied 上下文，pending 再覆盖；显式 cwd 保持明确调用意图。
5. WR05：已加载 local 使用服务端当前 cwd，不能被旧环境 cwd、旧 applied 或侧栏项目覆盖。
6. WR06：remote 透传，不消费 local pending/applied；不将空环境数组强套入 unknown remote。
7. WR07：workspaceWrite 合入有效 roots/retained，保持额外授权及其他选项；
   readOnly/full/profile 不被转成其他权限类型。
8. WR08：新聊天首次 turn 传递所选项目多根；既有聊天不传侧栏 cwd、不重复创建 worktree。
9. WR09：失败/accepted/revision/owner 的既有迁移回归仍通过；保持零自动重发。

验证顺序：先失败回归，再产品修改；专项、完整 Rust lib、完整标准脚本、
Release 构建和适用原生验证。官方同条件视觉仍缺，不评分、不标整页通过。

## 实现与回归结果

- `src-tauri/src/state.rs`：共享 turn/start 网关先 thread/read，未加载或有效环境未知时
  plain resume；read 后、resume 后和派发前检查 owner。失败保留原状态，不自动重发。
- `src-tauri/src/thread_workspace.rs`：确认 local 后才恢复 applied，随后 pending 优先。
  已加载会话使用当前服务端 thread.cwd，不被旧环境 cwd 或旧 applied 覆盖。
  remote 保持原请求，不消费本地状态；显式目录意图仍有效。
- 复用快照应用函数处理恢复和迁移的路径验证及权限替换；没有新增依赖、第二套持久状态
  或独立恢复缓存。workspaceWrite 只调整 roots，其余 sandbox 类型/profile 保留。
- `src/App.tsx`：既有发送不再注入侧栏 cwd，也不重复建 worktree；
  新聊天首 turn 带上与 thread/start 相同的多根。
- `scripts/verify-new-thread-project-context.mjs`：完善实际 callback harness 的附件作用域依赖，
  使新聊天真正走到 turn/start；新增首 turn 多根和既有 worktree 隔离断言。
- `scripts/protocol-verify/verify-thread-workspace-resume.mjs`：真实无凭证恢复探针；
  已接入完整 `scripts/verify-all.ps1`，Fast 模式仍不运行协议探针。

修改前，首 turn 多根断言与冷会话恢复断言均失败。独立复审还发现：
首次迁移缺少 applied 时，规范化后的顶层 cwd 为 null，导致旧 roots 未被识别。
新增生产函数回归复现 `[old, extra, new]` 权限泄漏后，改为同时读取首 local 环境与顶层
cwd/roots；现在只保留额外授权和新 roots。修复后只读复核无本轮明确阻断项。

| 合同 | 本轮证据 |
|---|---|
| WR01–WR03 | Rust 网关 cold resume、resume failure/unknown、superseded read/resume；已加载路径断言不 resume |
| WR04–WR07 | Rust production prepare_runtime_turn：applied→pending、显式 cwd、live cwd、remote、projectless、权限类型/profile、首次迁移 roots |
| WR08 | 实际前端 send/goal callback：首 turn 多根、worktree 多根、既有不建 worktree/不传侧栏 cwd |
| WR09 | 既有 accepted、revision、owner、保存失败和拒绝/未知结果回归全部继续通过 |

`cargo test --manifest-path src-tauri/Cargo.toml --lib` **67/67**，其中 workspace/identity
筛选 **35/35**。完整标准脚本退出 **0**，含类型检查、前端构建、Rust 检查与真实协议探针；
Tauri Release 构建退出 **0**。CLI 0.159.2、0.165.0 的最终恢复探针均通过，
明确断言冷覆盖和重启后 cwd/roots 一致；两者零模型 turn。
日志在本轮 [verification.md](../../../.ref/parity/01/runs/20261031-codex-01b-workspace-recovery/verification.md)
及其 `actual/`。既有 SettingsView 动静态导入、大 chunk、DEP0190 警告仍存在；
没有独立 lint 命令。

## 构建与原生验证

构建：[CodexNative.exe](../../../dist-artifacts/01B-workspace-recovery-20261101/CodexNative.exe)，
13,565,440 bytes，SHA-256
`0BCAEF325EF3E70F58C598639E9DE614874EE6AA9460DCACEF0C8F88DD3C0D2E`。
基于 HEAD `380c32c7b6e3d1ce6cabcf49c7b5ca07b1b76ec7` 的未提交工作树，
包含此前改动；本轮无提交、无推送。

使用 Computer Use 绑定该 EXE，在无 auth.json、无 API key 的隔离 home 实测：

1. **恢复失败**：旧离线样本的末条分页记录缺 ordinal，read 可读但 resume 被真实服务拒绝。
   UI 显示恢复错误，保留输入，发送按钮恢复；pending/revision 未变。该路径没有进入目录校验。
2. **恢复后无效目标阻断**：换用已通过恢复协议探针的样本，以 SQLite backup 导出包含 WAL 的完整
   数据，校正 rollout_path，并追加有合法连续 ordinal 的明确离线 user_message 事件，
   用于 thread/list 可见性。打开会话、填写测试文字、点击发送，实际显示
   “会话的工作区快照无效，请先检查项目目录；本次没有发送。”，
   说明已通过 runtime 恢复与环境检查并进入快照校验。输入保留，发送按钮可用，
   退出后 pending/revision 保留，回放无测试文字、无 task/turn started。

最终有效样本实例 PID 227976、窗口 13504078，已退出。
初次样本复制还出现旧临时索引路径无效；修正记录单独保留，
没有将样本准备失败记为产品通过。有效样本标题/用户事件均为测试数据，
不能作为真实模型输出或正式会话成功迁移的证据。

截图 `native-resume-failure.jpg` 与 `native-workspace-guard.jpg` 为 JPEG 1442×914；
主题深色、语言中文，App 缩放与官方同条件配对仍未知。本轮无视觉几何修改，
未做像素比较，分数 null。

## 剩余范围

目标目录/worktree 构造、sources 扩展确认、membership 与 workspace transaction/rollback、
菜单接入、跨进程同步和真实模型 accepted 后后续发送/重启集成仍需开发与验证。
本轮恢复后成功派发的参数由 Rust 替身 RPC 回归验证，不能冒充真实模型迁移通过。
普通点击会话的官方恢复时机、当前原生成功模型路径、物理 IME、官方运行时和像素及用户验收
均未完成。01B 不放行 01C。
