# 01B A11：会话菜单未读与项目移动条件动作调研

日期：2026-10-31。初始记录为修改前调研；随后依照调研结论完成分区子菜单结构修正，详见文末“调研后的实施续记”。01B 仍开发中，不放行 01C。

## 范围与基准

仅追踪官方 local sidebar 会话菜单中的“标为已读/未读”和“移至项目/从项目移除”动作，以及当前实现可否承载等价的真实状态变更。

候选官方基准沿用 26.928.21956。使用的初始 JS 为 `.ref/scratch/files/app-initial-fd3c4b862660.js`，11,160,829 bytes，SHA-256 `577a50e29502f573e2fbccf4940b9bd875339db420d6d5a9798a0d201ee0aff1`。中文资源为 `.ref/parity/01/runs/20261031-codex-01b-rename/reference/zh-CN-3ed9eb1db28a.js`，2,397,171 bytes，SHA-256 `c6ac10a9fb407a393ea002d9aa818a4c7ed0e215e9c8bf0cfe2b798a98e3756f`。协议 schema 为 `.ref/protocol/codex_app_server_protocol.v2.schemas.json`，611,560 bytes，SHA-256 `81a88c04ae4984b16d73080f4109d0477682bc76c8adbe483e371175ce54c054`。

本记录是静态实现和本项目源码的交叉研究，不是官方运行时验证，也不证明当前账号/远程能力可用。`.ref/protocol/` 是本地 app-server 协议快照（当前 CLI 0.165.0）；没有证据证明它与候选 GUI 的配套服务端版本相同。

## 复核更正：项目归属写入能力存在（2026-10-31）

初稿中“当前 schema 没有既有会话项目归属写请求”的判断有误：当时 `.ref/protocol/codex_app_server_protocol.v2.schemas.json` 是不含实验字段的 schema bundle，却用于推断官方本地项目 membership 写入能力。本节保留原始调研经过，但以下更正替代“没有 assignment 写 RPC”的结论。

- 固定候选包的 `main-DkWgQSQe.js`（SHA-256 `D33ED281DC58766CBBCCB8E92A7149268A528901DE8858C2D69750D12C6C205B`）offset 2,570,875 附近，线程项目 assignment writer 按 thread 串行处理变更；在 local-project gate 允许且服务端需要更新时调用 `thread/metadata/update { threadId, projectId }`。清除项目时传空字符串；只有请求成功后才提交本地 membership。`syncAssignment` 也调用同一 RPC。`app-initial-fd3c4b862660.js` offset 7,136,033 的 `mSo` 将 sidebar thread 身份转换为 session id，再写入 `threadProjectAssignments` store。
- 重新以 `app-server generate-json-schema --experimental` 导出两份隔离 schema：CLI 0.159.2 和 CLI 0.165.0 的 `ThreadMetadataUpdateParams` 都声明 `projectId` 为 `string|null`，说明文字为省略则不变、空字符串清除、既有 project id 写入。本轮旧 schema bundle 的定义只列了 `gitInfo`，漏掉的字段是由缺少 `--experimental` 生成，而不是 CLI 不支持。
- 新增 [`verify-thread-project-membership.mjs`](../../../scripts/protocol-verify/verify-thread-project-membership.mjs) 对真实 app-server 在隔离 `CODEX_HOME` 运行。两版 CLI 均通过：创建两个测试项目、启动并写入离线 fixture thread、读取初始归属、移动至目标项目并 `thread/read` 读回、非法 project id 失败且原归属不变、进程重启后归属仍在、空字符串清除并经重启读回、重新加入项目。`thread/list` 投影也与读回归属一致；未认证、未发起 model turn。逐 RPC transcript 与隔离路径记录在 `.ref/parity/01/runs/20261031-codex-01b-project-membership-probe/actual/cli-0.159.2.json` 和 `cli-0.165.0.json`。这些数据是 app-server 的离线协议证据，不是官方 GUI 运行时或整个移动流程通过。

**仍不可将 RPC 单独当成完整项目移动。** 官方把 membership 与执行工作区状态分开：

- `app-initial-fd3c4b862660.js` offset 7,137,032 的 `_So` 检查 thread、来源和目标项目的 kind/host/workspace 兼容性；local thread 若不在目标项目 sources 下，先要求将缺失 source 加入目标项目。这会扩大该项目其他会话可用目录，因此是权限确认，不是分组显示选项。
- `mSo` 只写 membership；local workspace transition 由另一条 `qwe`（shared bundle 内对应 `VRn`，offset 3,656,635）本地保存 `{project,pending,applied,revision}`。membership 保存失败时 `She`（对应 `WRn`，offset 3,657,125）只有在 revision 仍匹配时才回滚 transition。项目 membership 成功后 sidebar 排序保存失败只记警告，不倒回已成功的 membership。
- shared offset 2,933,043 附近的 turn 准备流程读取 pending workspace，再构造 cwd、runtime workspace roots、sandbox writable roots 和 pending-workspace 元数据；transition 会影响后续真实 turn，而不只是项目标题。仓库当前 `handleSendMessage` 对既有会话仍以当前 `activeWorkspace.path` 作 turn cwd，调用 `turn/start` 时没有按会话 membership 解析 pending workspace；因此直接调用 `thread/metadata/update` 虽有真实读回，仍不足以兑现官方本地会话移动语义。

当前 A11 决定：**不再以“缺少既有 thread assignment 写 RPC”阻塞；在本项目补齐会话级 workspace transition、目录权限边界、失败回滚以及后续 turn 的 cwd/runtimeWorkspaceRoots 应用与往返验证前，仍不显示或执行会伪装成完整移动的菜单动作。**

同轮已读能力复核又确认：CLI 0.165.0 实验协议提供 durable `thread/readState/update` 及列表/通知 receipt。已按真实 revision 接入侧栏条件动作，L2、完整标准检查、新 Release 原生往返、独立服务读回和冷启动恢复通过，详见[已读状态增量](20261031-codex-01b-read-state.md)。CLI 0.159.2 无 receipt，保持隐藏。官方跨 host/账号 conversation client、根与 side-conversation 聚合状态仍缺证据；下面保留的初稿“不显示读状态动作”现已被本增量替代。

## 官方静态实现证据

### 标记已读/未读

- `app-initial-fd3c4b862660.js` offset 7,151,912 附近的 `LSo` 组装 local sidebar 菜单动作。仅当 `surface === "sidebar"`、不是外部托管的条目，且有未读状态，或 `canMarkUnread` 允许时才加入读状态动作。菜单 ID 为 `mark-thread-read` / `mark-thread-unread`；显示文案分别来自 `sidebarElectron.markThreadRead` / `sidebarElectron.markThreadUnread`。
- offset 6,919,307 附近的 `omo` 根据未读状态生成动作；offset 6,952,629 附近的 `sho` 将用户选项分发到 `markThreadAsRead` / `markThreadAsUnread`。会话行本身并不直接写一个任意 `unread` 布尔值。
- offset 5,660,148 附近的 `vba` 把回调连接到官方 conversation client：未读动作调用 `markConversationAsUnread`；已读动作调用 `n5n`。
- offset 2,811,839 附近的 `n5n` / `t5n` 显示已读操作会依据 unread state 处理根会话和未读 side conversations，并最终调用相应 conversation client 的 `markConversationAsRead`；其中部分根状态还要先执行 `markRootAsRead`。这是覆盖范围说明，不据此断言其底层服务实现细节。
- offset 1,943,402 附近的 unread projection 区分 `app-server` 与 `messages` 两种根来源，并收集 side conversation IDs；offset 1,942,899 附近从独立消息状态存储订阅 unread snapshot 和 thread 变更。

初稿结论（已被上方实验 schema 和真实协议复核补正）：此菜单动作依赖官方消息/会话状态与 conversation-client 能力，已读还可能影响同一根会话的未读子会话。它不能由 Inbox 单条通知的 `read` 字段、Activity 的 thread ID 集合或侧栏临时布尔字段替代。原非实验 app-server 快照仅见 `thread/read`；这不能用于否定实验 `thread/readState/update` 的能力。

### 移至项目/从项目移除

- offset 7,148,500 附近的项目动作 builder 按可移动的 project group 构造目标项。移除项目则目标容器为 `chats`；项目来源与目标容器、目标 project origin 会参与后续执行。
- offset 7,137,032 的 `_So` 是统一移动执行入口：
  - 项目移动前检查 thread 身份、来源与目标 project kind、host 和 workspace 兼容性；
  - 目标目录缺失时可要求用户确认添加 workspace sources；
  - local project membership 变化会调用 `mSo` 持久化，并和 sidebar 排序/项目列表更新组合执行；
  - local conversation 需要时另执行 workspace move，失败时执行回滚并报告错误；
  - 移到 `chats` 会更新 projectless 状态，并在符合条件时恢复原工作区 membership。
- offset 7,142,690 的 `mSo` 通过 `qc.threadProjectAssignments.setMembership(...)` 保存成员关系；若当前 host 不支持该能力会抛错。此数据属官方客户端的本地成员关系能力，不是当前 schema 中的 app-server 项目移动 RPC。
- 原非实验 app-server 快照中有 `thread/project/updated` 通知，但未列出 `thread/metadata/update.projectId`。本条仅为初稿遗漏经过；上方已补齐实验 schema 和真实写后读证据。通知自身仍不能当成发起移动的 API。

结论：项目移动不是简单改 `ThreadSummary.projectId` 或本地渲染分组。等价实现至少需要真实、持久的成员关系写入，项目兼容性检查、目标目录缺失确认和适用的 workspace move/rollback。当前 app-server 请求列表有 `thread/section/move`，没有 thread-project assignment 写请求；Tauri `threads_meta_get` 只读取 `threadProjectAssignments`、`projectlessThreadIds` 和 workspace assignments，前端也没有对应的 assignment 写命令。现有 `thread/start` 的 `projectId` 仅设置新会话项目，不能证明可迁移既有会话。

## 与当前实现的差距

| 动作 | 官方状态/副作用 | 当前仓库 | 结论 |
|---|---|---|---|
| 标为未读 | conversation client 写入会话/消息 unread 状态 | Activity/Inbox 有通知级 `read`；侧栏过滤还使用 Activity thread ID；没有会话级已验证写接口 | 不显示、不模拟 |
| 标为已读 | 根据 unread projection 清除根会话及适用的 side conversation 状态 | 没有官方等价 conversation client，也没有会话 unread 投影 | 不显示、不模拟 |
| 移至项目 | 写本地 thread-project membership，校验 host/kind/workspace，按情况迁移工作区并协调侧栏顺序 | `threads_meta_get` 只读取 assignment；缺失既有会话 assignment 写入命令与完整迁移事务 | 不显示、不模拟 |
| 从项目移除 | 将会话移至 Chats/projectless，并在部分 local 场景恢复工作区 membership | app-server 通知及新聊天 project 参数不能执行该迁移 | 不显示、不模拟 |

## 实施决定与解除阻塞条件

本轮不改产品代码、不新增菜单占位、不把通知级已读误报为会话已读，也不把改变分组视图冒充项目迁移。解除阻塞前需先补齐：

1. 项目移动：定义并测试当前产品用于既有 thread assignment 的持久化接口；读取官方 membership/workspace move 的适用边界；建立移动成功、取消、部分失败/回滚、重启读回和服务端通知刷新用例。
2. 已读/未读：确认当前产品是否有获支持的真实 conversation read-state 来源及写接口，并能覆盖根会话/side conversations；建立菜单可见条件、失败提示、读回与重启用例。
3. 在等价真实状态源接入后，再按固定 asar/locale 证据实现菜单条件、文案与顺序，并进行官方运行时对照。没有同条件官方截图时仍不作像素通过声明。

## 调研时验证与状态

- 只读核验初始 JS、中文 locale、协议 schema 的文件哈希与长度；本记录保存定位 offset 与调用链片段描述。
- 阅读本项目 `src/App.tsx`、`src/sidebarProjects.ts`、`src/types.ts`、`src-tauri/src/state.rs`、`src/components/CodexSidebar.tsx` 以及 Activity/Inbox 实现。
- 调研阶段只读核验，未运行构建或测试；后续 UI 结构修改及其验证另见下节。
- 当前结论：A11 两个条件动作仍属实现阻塞，不视为通过；A11 其余新建分区焦点续验仍以[上一轮记录](20261031-codex-01b-section-create.md)为准。01B 等待其他范围和官方配对/用户验收，不放行 01C。

## 调研后的实施续记

- 根据本文件确认的官方 `submenu` 结构，将“移至分区”从主菜单内联展开改为独立侧向子菜单浮层；支持鼠标悬停/点击、键盘左右方向进入/返回、Escape 返回父菜单，并避免触屏设备仅因 hover 打开。此次修正只覆盖分区子菜单呈现与导航，不解除未读/项目移动两个条件动作的能力阻塞。
- 专项回归 `node scripts/verify-sidebar-section-create.mjs`、`node scripts/verify-sidebar-section-toggle.mjs` 和 `node scripts/verify-sidebar-thread-menu.mjs` 均退出 0。先前专项曾捕获内联结构与目标结构不符；修正后相关子菜单结构及分区动作回归通过。`git diff --check` 退出 0；Git 输出已有 CRLF 转换提示，没有空白错误。
- 最新 Release 是 `dist-artifacts/01B-section-submenu-keyboard-close-20261031/CodexNative.exe`，13,308,416 bytes，SHA-256 `CCFD415EB7764495ABD812BBB3F8AB27618CD08AA611F655F45D9EF2A10D125F`。除鼠标移到其他主项关闭子菜单外，又补了键盘在主菜单移动焦点离开触发项时关闭子菜单；回归先失败后通过。完整 `verify-all.ps1`、三个 A11 专项、TypeScript、Tauri Release 构建与 `git diff --check` 均退出码 0。日志中的 SettingsView 动静态导入、大 chunk 和 Node DEP0190 警告仍存在；详细检查范围、哈希和原生证据边界见[结构化验证 JSON](../../../.ref/parity/01/runs/20261031-codex-01b-section-create/actual/submenu-structure-followup.json)。
- 隔离原生观察已在前一构建 `5B4BF51D…A98BFDD` 上确认菜单层级及分区浮层条目；不是当前最终 Release 的证据。最终构建在输入动作时 Computer Use 报告指针位于另一个 WebView 窗口，因此没有发送后续菜单输入。当前 SHA 的原生键盘关闭路径仍未验证。
- 视觉判断：缺少同条件官方截图配对，分数为 `null`/不可评分；这不是相似度分数或通过结论。当前没有调用原生桌面自动化工具，因此最新 Release 的原生鼠标/键盘菜单验证仍待补。
- 后续官方共享 `ThreadActionsMenu` 静态合同比对发现：指针从已展开的子菜单触发项移到同层其他根动作时，应关闭子菜单。原组件未处理该路径；新增实际组件回归先失败，再在同层普通动作上清除子菜单状态，修复后通过。随后重建 Release 并重跑完整标准检查，最新证据与哈希更新见[结构化验证记录](../../../.ref/parity/01/runs/20261031-codex-01b-section-create/actual/submenu-structure-followup.json)。
- 已用无凭证隔离 `CODEX_HOME` 启动新 Release。Computer Use 枚举返回目标 EXE 的窗口，但同一 helper 的 `get_window_state` 返回另一进程（旧 `01B-attachment-drafts` 构建，窗口 ID 115610186）的截图；未向该错配窗口发送任何输入。最新构建原生验收因此记为工具窗口绑定阻塞，不能据其截图宣称通过。
- A11 条件动作现状不变：会话级已读/未读与既有会话项目迁移仍不显示、不模拟；官方运行时、IME、App 缩放、同条件像素和用户验收仍未完成。01B 未验收，不放行 01C。
