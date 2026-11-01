# 01B A11：服务端会话已读状态

日期：2026-10-31。范围为 local app-server 返回 durable read receipt 的侧栏会话。该增量自验完成，01B 仍开发中，未用户验收，不放行 01C。

## 修改前依据与合同

- 固定官方候选包 26.928.21956：`app-initial-fd3c4b862660.js` SHA-256 `577A50E29502F573E2FBCCF4940B9BD875339DB420D6D5A9798A0D201EE0AFF1`，offset 7,151,xxx 的 sidebar menu builder：有 unread 状态或允许 mark unread 时加入首组动作，先于 rename/pin/section。中文资源 `zh-CN-3ed9eb1db28a.js` 的键为 `sidebarElectron.markThreadRead` / `sidebarElectron.markThreadUnread`，文案为“标记为已读”/“标记为未读”。offset 均为 0-based UTF-16 字符偏移，非行号。
- 本次重导 CLI 0.165.0 实验 schema，发现 `thread/readState/update {threadId,expectedRevision,operation:{type:"read"|"unread"}}`、`thread/readState/changed` 和 `thread/list.readStates`。`firstUnread:null` 或省略表示已读；显式未读为 `{type:"threadStart"}`，也可为 `{type:"turn",turnId}`。revision 是不透明的乐观并发凭据，过期必须等待新操作，不能自动重试。
- 单独重新导出同一 CLI 的非实验 schema，确认会遗漏该 read-state 方法及 metadata-update 的 projectId 字段。先前用非实验快照否定能力的判断不再适用。完整本地路径、二进制哈希和请求/响应保存在 `.ref/parity/01/runs/20261031-codex-01b-project-membership-probe/`。
- 真实隔离 CLI 0.165.0 已验证 mark unread→read→旧 revision 冲突→再次 unread→进程重启保持 unread 和相同 revision。CLI 0.159.2 未返回 durable receipt，本轮仅验证其不支持该返回能力，没有向它伪造状态。两版项目 membership 探针均通过。

预期先于实现确定：

| 用例 | 操作与预期 | 证据 |
|---|---|---|
| RS01 | 有 read receipt 的侧栏会话菜单首项为“标记为未读”，有 unread receipt 时为“标记为已读” | L2 与新 Release 原生 |
| RS02 | 不支持/不可用/不适用 receipt 不显示动作；不写本地 unread 布尔值或通知级 read | L2；旧 CLI 返回无 receipt 的协议记录 |
| RS03 | 点击关闭菜单，以用户看到的 revision 单次写入；等待期间不假装改变状态 | L2 handler/组件执行 |
| RS04 | 同 thread 在途写入去重；请求失败、旧 revision 冲突或无效响应提示错误并重新读列表，不自动重发 | L2；真实冲突协议 |
| RS05 | 分页列表按 thread ID 投影 receipts，未提供的行不继承其他行的 receipt；全局通知触发刷新 | L2 handler 执行 |
| RS06 | 服务状态同时驱动行未读提示和 hoverCard 提示；读→未读往返后退出并冷启动保持 | 新 Release UIA/画面、独立服务读回、冷启动 UIA |
| RS07 | 菜单打开后外部状态变化仍提交打开时的动作和 revision，由服务端决定是否冲突，不悄悄改成相反动作 | L2 menu snapshot 回归 |
| RS08 | schema 允许省略 firstUnread 时当作 read；菜单操作方向正确，合法更新响应不报错 | L2 实际组件/validator/handler |

## 实现与复用

- `src/types.ts` / `src/protocol.ts`：增加 receipt 类型、有效性检查和通知常量；使用服务端 revision，不引入本地状态存储。
- `src/App.tsx`：复用已有完整分页刷新、代次防过期结果机制和错误 toast。把服务端 receipts 投影到摘要，处理通知，写入使用 single-flight；成功/失败均刷新权威列表。
- `src/components/CodexSidebar.tsx` / `SidebarThreadHoverCard.tsx`：复用现有菜单、关闭/焦点与未读提示样式，按真实 receipt 展示条件动作，不增加新的菜单样式或依赖。
- 新增 `scripts/verify-sidebar-read-state.mjs`（执行实际组件与生产 callback）和 `scripts/protocol-verify/verify-thread-project-membership.mjs`（真实隔离 app-server，附 read-state 能力检测）。前者已接入标准检查；后者单独以两版 binary 执行，其输出明确区分“不支持 read-state”和协议失败。

## 验证与构建

修改前 `node scripts/verify-sidebar-read-state.mjs` 退出 1，失败为缺少有真实 receipt 支持的菜单项；修复后退出 0。没有只检查源码字符串来代替动作测试。

聚焦复审又发现：打开菜单时 receipt 未固定，外部刷新可改变同一菜单的动作；validator 还会拒绝 schema 合法的省略 position。新增回归先失败，随后改为保存菜单打开时 receipt 快照，并让类型、validator 和动作方向一致支持 optional nullable position。专项和独立复审均通过后，重跑完整标准检查、重新构建，并在最终 EXE 上重做原生往返/读回/冷启动；下列证据绑定修复后构建，中间构建记录单独保留。

- 新专项、项目 membership 通知/分页回归、线程分页回归和 `npx tsc --noEmit` 均退出 0。
- 完整 `pwsh -NoProfile -File scripts/verify-all.ps1` 退出 0，日志在 `.ref/parity/01/runs/20261031-codex-01b-read-state/actual/verify-all-final.log`。Rust 单测为 17 项 automations 筛选测试，24 项被过滤，不宣称全量 Rust 测试。仓库没有独立 lint 命令。
- `npm run tauri build` 退出 0；日志为同目录 `tauri-build-final.log`。保留已有 SettingsView 动静态导入、大 chunk、Node DEP0190 等警告，不据构建成功宣称视觉或功能完全一致。
- 归档产物：`dist-artifacts/01B-durable-read-state-snapshot-20261031/CodexNative.exe`，13,308,416 bytes，SHA-256 `9C1FC625F3538ADD64A4CFB4398D61EBEA608C11CCFF515B15B340A2BECFF447`。HEAD 为 `380c32c7b6e3d1ce6cabcf49c7b5ca07b1b76ec7` 且工作树包含既有未提交改动；产品输入当前哈希见 `source-fingerprints-final.json`，不是干净 HEAD 的构建。
- Computer Use 唯一绑定上述归档 EXE：最终构建初次 PID 214700，隔离 `CODEX_HOME` 由本轮离线 fixture 复制，无登录凭证，不发起模型 turn。右键打开会话菜单→标记为已读→UIA 未读指示消失→重开菜单出现“标记为未读”→执行→未读指示恢复。应用关闭后独立 app-server `thread/read` 确认 receipt 已持久化，最终构建冷启动 PID 213992 的 UIA 再次出现未读指示。
- 持久证据：`native-launch-final.json`、`native-trees-final.json`、`native-service-readback-final.json`、`native-restart-final.json`。工具显示了 1442×914 原生截图，但本轮未持久保存该截图文件；UIA 原文与协议读回已保存。不能将内联观察说成已有无损 PNG。

## 未完成与下一步

- 本轮只验证真实本地 durable thread receipt；官方根会话与 side-conversation 的聚合已读、自动阅读时机、跨 host/账号 session store 和其他消息来源仍未闭环，不宣称完整 conversation-client 1:1。
- 顶栏既有 Activity/Inbox “mark unread”语义不在本增量中调整，仍须按其所属验收范围纠偏。
- 项目 membership RPC 已找到且真实读回通过，但完整“移至项目”仍需 workspace transition、目录访问确认、revision 回滚和后续 turn cwd/runtime roots/权限应用，详见[项目调研更正](20261031-codex-01b-menu-conditional-actions.md)。
- 同版本、同环境官方菜单配对图缺失；Windows/App 缩放、官方运行时和 IME 仍未完整验证。visual-verdict 输入不足，视觉为不可评分，不能生成虚构分数或认定像素通过。01B 待用户验收。
