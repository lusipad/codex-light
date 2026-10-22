# Codex App-Server 协议能力 vs 当前实现（协议级差距）

> 生成依据：`codex app-server generate-json-schema`（本机 codex-cli **0.159.0**，官方 App 内置 **0.159.2**，协议同代）。
> 原始 schema：`.ref/protocol/`（300+ JSON 文件）；方法清单：`.ref/protocol-surface.txt`；机器可读映射：`.ref/protocol-feature-map.json`、`.ref/protocol-usage.json`。

## 0. 总览：协议覆盖度

| 类别 | 协议总数 | 本项目已引用 | 覆盖率 |
|---|---|---|---|
| Client → Server 请求（功能入口） | 105 | 17 | **16%** |
| Server → Client 请求（必须 UI 响应） | 11 | 1 | **9%** |
| Server → Client 通知（实时状态/流式） | 84 | 8 | **10%** |

已引用的 17 个 client 方法：`initialize, model/list, mcpServerStatus/list, skills/list, thread/{start,resume,read,list,archive,unarchive,delete,fork,name/set,turns/list}, turn/{start,steer,interrupt}`。
已引用的 1 个 server 请求：`item/tool/requestUserInput`。
已引用的 8 个通知：`turn/started, turn/completed, item/started, item/completed, item/agentMessage/delta, item/reasoning/summaryTextDelta, item/commandExecution/outputDelta, error`。

> 说明：Rust 桥（`src-tauri/src/app_server.rs`）本身是**通用管道**——所有 server→client 请求统一 emit `app-server:server-request`、所有通知统一 emit `app-server:notification`、前端可用 `app_server_call` 透传任意方法。因此协议层"补齐"主要是**前端接线**，无需改 Rust（个别需要 Rust 侧状态/文件的能力除外）。

## 1. 功能域对照表（按官方 App 用户可见功能分组）

图例：✅ 已接协议 部分按真实度见 `.ref/audit/CURRENT-AUDIT.md`；⚠️ 有自研替代实现但未走协议；❌ 完全缺失；— 不适用/超出范围。

### 1.1 线程生命周期与会话管理

| 官方能力（协议方法） | 用户可见功能 | 现状 |
|---|---|---|
| `thread/start` / `thread/resume` / `thread/read` | 新会话、切换/恢复会话、读取完整历史 | ✅ |
| `thread/list` + `thread/loaded/list` | 侧边栏历史列表、已加载会话 | ✅（list）/ ❌（loaded/list） |
| `thread/turns/list` / `thread/items/list` | turn 分页、条目分页（长会话性能） | ✅（turns）/ ❌（items/list 分页） |
| `thread/archive` / `thread/unarchive` / `thread/delete` | 归档/取消归档/删除会话 | ✅ |
| `thread/name/set` / `thread/metadata/update` | 重命名；置顶/项目归属/元数据更新 | ✅ / ❌ |
| `thread/fork` | 从任意 turn 派生新会话（分发/试错） | ✅（后端在 Rust，前端调用待核） |
| `thread/revert` | 回退到某个 turn 之前（撤销改动） | ❌ |
| `thread/compact/start` | 手动压缩上下文（compact） | ❌ |
| `thread/unsubscribe` | 释放会话订阅（省内存/多窗口） | ❌ |
| `thread/attachment/{add,list,remove}` | 会话附件持久化（文件/图片随会话保存） | ❌（当前附件只在前端内存） |
| `thread/inject_items` | 注入原始条目（高级/fork 场景） | ❌ |
| `thread/shellCommand` | 会话内执行 shell 命令（结果进入会话流） | ❌ |
| `thread/goal/{set,get,clear}` | **线程级目标/自主任务**（与官方 Goal 模式一致） | ⚠️ 自研 GoalRunner（本地 state + 自造流程） |
| `thread/section/{create,update,delete,move}` + `threadSection/{list,create,update,delete}` | 侧边栏**分组/分区**（自定义分组、拖拽排序） | ❌ |
| `thread/approveGuardianDeniedAction` | 追认被 guardian 拒绝的操作 | ❌ |
| `thread/{status/changed,closed,reverted,queue/changed,goal/updated,settings/updated,tokenUsage/updated,environment/connected,environment/disconnected,project/updated,compacted}` 通知 | 会话状态条、队列、目标进度、上下文用量、环境连接状态 | 仅 turn/started、turn/completed |

### 1.2 Turn 与流式渲染

| 官方能力 | 用户可见功能 | 现状 |
|---|---|---|
| `turn/start` / `turn/steer` / `turn/interrupt` | 发送、追加引导(steer)、中断 | ✅ |
| `turn/started` / `turn/completed` | turn 生命周期、时长、耗时统计 | ✅ |
| `item/started` / `item/completed` | 条目完整渲染（含 tool call、command、fileChange、mcpToolCall、plan、reasoning、web search、image 等 20+ 类型） | ✅ 基础（类型覆盖待核） |
| `item/agentMessage/delta` | 回复逐字流式 | ✅ |
| `item/reasoning/{textDelta,summaryTextDelta,summaryPartAdded}` | 思考过程分块流式 | ⚠️ 仅 summaryTextDelta |
| `item/commandExecution/outputDelta` + `terminalInteraction` | 命令实时输出、交互式终端 | ⚠️ 仅 outputDelta |
| `item/fileChange/{outputDelta,patchUpdated}` | 文件变更实时 diff 流 | ❌ |
| `item/mcpToolCall/progress` | MCP 工具调用进度 | ❌ |
| `item/plan/delta` | 计划(plan)流式渲染 | ❌ |
| `turn/diff/updated` | 本轮统一 diff 实时更新（diff 面板核心） | ❌（当前靠 git status 轮询） |
| `turn/plan/updated` | 计划步骤状态更新 | ❌（自研 goal 步骤解析） |
| `thread/tokenUsage/updated` | Token/上下文用量环 | ❌ |
| `rawResponseItem/completed` / `rawResponse/completed` | 原始 Responses 条目（调试/兼容） | ❌ |

### 1.3 审批与安全（官方"底线"体验核心）

| 官方能力 | 用户可见功能 | 现状 |
|---|---|---|
| `item/commandExecution/requestApproval` | 命令执行审批卡片（含具体命令、原因、cwd、沙箱上下文） | ❌ **未处理**（仅 inbox 文案兜底） |
| `item/fileChange/requestApproval` | 文件变更审批（含 diff 预览、按文件范围批准） | ❌ **未处理** |
| `item/permissions/requestApproval` | 权限提升审批 | ❌ **未处理** |
| `execCommandApproval` / `applyPatchApproval`（旧协议兼容） | 旧版审批请求 | ❌ |
| `item/tool/requestUserInput` | 工具反问（AskUserInput 表单） | ✅ |
| `item/autoApprovalReview/{started,completed}` + `autoApprovalReview/strictReviewRequired` | 自动审批审查状态（Auto-review 模型预审） | ❌ |
| `guardianWarning` / `warning` / `configWarning` / `deprecationNotice` | 各类警告条 | ⚠️ error 有，其余无 |
| `serverRequest/resolved` | 审批请求被他处解决时同步关闭卡片 | ❌ |
| `attestation/generate` | 设备证明（部分企业环境） | ❌（超出范围） |

### 1.4 配置 / 模型 / 权限档

| 官方能力 | 用户可见功能 | 现状 |
|---|---|---|
| `config/read` | 读取**全部**有效配置（含 profile、feature flags、provider、MCP、插件…） | ⚠️ 自研解析 config.toml（`config_read`） |
| `config/value/write` / `config/batchWrite` | 原子写配置（带类型校验与 schema 约束） | ⚠️ 自研 toml_edit 写入 |
| `configRequirements/read` | 企业/托管配置约束（哪些项被锁死） | ❌ |
| `config/mcpServer/reload` | 热重载 MCP 服务器 | ❌ |
| `model/list` | 模型清单（含 reasoning effort、speed tier、isDefault） | ✅ |
| `modelProvider/capabilities/read` | Provider 能力（是否支持 reasoning/speed/图片…） | ❌ |
| `permissionProfile/list` | 权限档（本地/托管 permission profiles） | ❌ |
| `experimentalFeature/list` / `experimentalFeature/enablement/set` | 实验特性开关页 | ❌ |
| `model/rerouted` / `model/verification` / `model/safetyBuffering/updated` / `modelProvider/authRecovery*` | 模型切换提示、安全缓冲、认证恢复 | ❌ |

### 1.5 文件系统 / 工作区

| 官方能力 | 用户可见功能 | 现状 |
|---|---|---|
| `fs/readDirectory` / `fs/readFile` / `fs/getMetadata` | 官方工作区文件树（带沙箱语义） | ⚠️ 自研 fs_list_dir / fs_read_preview |
| `fs/writeFile` / `fs/createDirectory` / `fs/remove` / `fs/copy` | 资源管理器内新建/保存/重命名/删除/复制 | ⚠️ 仅写文件；无新建目录/删除/复制/重命名 |
| `fs/watch` / `fs/unwatch` + `fs/changed` | 文件系统实时监听（AI 改文件后树自动刷新） | ❌ 轮询 |
| `fuzzyFileSearch` + `fuzzyFileSearch/sessionUpdated` 通知 | **命令面板/快速搜索**（官方 Cmd+P 文件跳转、@ 引用） | ⚠️ 自研 fs_search_files（非增量、无模糊排序） |
| `project/changed` 通知 | 项目列表变化实时同步 | ❌ |

### 1.6 Skills / Plugins / MCP / Marketplace（插件生态）

| 官方能力 | 用户可见功能 | 现状 |
|---|---|---|
| `skills/list` / `skills/config/write` / `skills/extraRoots/set` / `skills/changed` | 技能列表、启用禁用、额外根目录、变更监听 | ⚠️ 自研 skills_list_local（读目录） |
| `plugin/list` / `plugin/read` / `plugin/installed` / `plugin/reconcile` / `plugin/install` / `plugin/uninstall` / `plugin/skill/read` | 插件中心：已装插件、详情、安装/卸载、插件内技能 | ⚠️ 自研 UI（可能是静态/半假） |
| `marketplace/{add,remove,upgrade}` | 市场源管理（本地 marketplace、升级） | ❌ |
| `plugin/share/{save,list,checkout,delete,updateTargets}` | 插件分享/团队分发 | ❌（可标 P2/超范围） |
| `mcpServerStatus/list` / `mcpServer/resource/read` / `mcpServer/tool/call` / `mcpServer/oauth/login` / `mcpServer/startupStatus/updated` / `mcpServer/oauthLogin/completed` / `mcpServer/event/stream/notification` / `mcpServer/elicitation/request` | MCP 服务器状态、资源浏览、工具直调、OAuth 登录、elicitation 表单 | ⚠️ 仅 status/list |
| `hooks/list` / `hook/started` / `hook/completed` / `hook/stats` | Hooks 设置页与运行可视化 | ⚠️ 自研读取 |
| `app/list` / `app/read` / `app/installed` + `app/list/updated` | Apps/Connectors（连接器）页 | ❌（可标 P2） |

### 1.7 账号 / 用量 / 提示

| 官方能力 | 用户可见功能 | 现状 |
|---|---|---|
| `account/read` / `account/updated` | 当前账号、套餐、登录状态 | ❌ |
| `account/rateLimits/read` / `account/rateLimits/updated` / `account/rateLimitResetCredit/consume` | 速率限制与额度重置 | ❌ |
| `account/usage/read` | 用量明细 | ❌ |
| `account/login/{start,cancel,completed}` / `account/logout` | 登录/登出流程 | ❌ |
| `account/workspaceMessages/read` | 工作区公告横幅 | ❌ |
| `account/gatewayOAuth/{read,login,cancel,changed}` | 网关 OAuth（Web Gateway 模式） | — 超出范围 |
| `feedback/upload` | 反馈提交 | ❌ |
| `sendAddCreditsNudgeEmail` | 额度提醒邮件 | — 超范围 |

### 1.8 代码审阅 / 命令执行

| 官方能力 | 用户可见功能 | 现状 |
|---|---|---|
| `review/start` + `ReviewStartResponse`（含 findings/severity/文件定位） | **Code Review**（官方内置审查，含 staged/unstaged/base branch 三种范围） | ❌ |
| `command/exec` / `/write` / `/terminate` / `/resize` + `command/exec/outputDelta` | 官方终端/进程执行（PTY、stdin 写入、resize） | ⚠️ 自研 portable-pty 终端（能力等价，未走协议） |
| `process/outputDelta` / `process/exited`（process/spawn） | 后台进程管理 | ❌ |

### 1.9 Windows 沙箱 / 环境

| 官方能力 | 用户可见功能 | 现状 |
|---|---|---|
| `windowsSandbox/readiness` / `windowsSandbox/setupStart` / `setupCompleted` / `windows/worldWritableWarning` | Windows 沙箱就绪检测与一键安装（官方底线版重点） | ❌ |
| `externalAgentConfig/detect` / `/import` / `/readHistories` / `/recordHistory` + 进度通知 | 从 Claude/Cursor/Windsurf/VSCode 等**导入配置**（官方 Import 设置页） | ⚠️ 自研 import_external_tool_config |
| `thread/environment/*` / `EnvironmentConnectionNotification` | 远程环境连接状态 | ❌ |

## 2. 优先级建议（用于实施排期）

**P0（核心链路/安全兜底，不补齐就不算"能用"）**
1. 审批全链路：`item/commandExecution|fileChange|permissions/requestApproval` + `execCommandApproval`/`applyPatchApproval` 兼容 + `serverRequest/resolved`。
2. 流式渲染补全：`turn/diff/updated`、`item/fileChange/*`、`item/reasoning/textDelta`、`item/plan/delta`、`turn/plan/updated`、`thread/tokenUsage/updated`。
3. 线程生命周期：`thread/metadata/update`、`thread/revert`、`thread/compact/start`、`thread/attachment/*`、`thread/items/list`（分页）、`thread/loaded/list`。
4. 配置真实化：`config/read` + `config/value/write`/`batchWrite` + `configRequirements/read`（设置页所有开关直接落协议，不再自研写文件）。

**P1（官方主界面已存在的能力面）**
5. 侧边栏分区：`threadSection/*` + `thread/section/move`（自定义分组/拖拽）。
6. 文件系统服务：`fs/*` + `fs/watch` 实时刷新 + `fuzzyFileSearch`（命令面板/Cmd+P/@ 引用）。
7. Skills/Plugins/MCP 走协议：`skills/*`、`plugin/*`、`marketplace/*`、`mcpServer/*`。
8. Code Review：`review/start` 全套（范围选择、findings 列表、跳转）。
9. 线程目标：`thread/goal/*` 替换自研 GoalRunner 的本地状态。
10. 账号/用量：`account/read`、`rateLimits`、`usage`（无登录则优雅降级为"未登录"）。
11. Windows 沙箱：`windowsSandbox/*` 就绪检测 + 一键安装。
12. 实验特性：`experimentalFeature/list|set`。

**P2（增强/边缘）**
13. `thread/inject_items`、`thread/shellCommand`、`thread/approveGuardianDeniedAction`、`autoApprovalReview/*` 可视化。
14. `hooks/list` + hook 运行可视化；`app/list|read|installed`。
15. `externalAgentConfig/*` 完整导入向导；`feedback/upload`；`workspaceMessages/read`；`plugin/share/*`。
16. 实时语音 `thread/realtime/*`（远超基线，明确排除）。

## 3. 兼容性备忘

- 本机全局 CLI `codex-cli 0.159.0`（`%APPDATA%\npm\codex.cmd`），官方 App 自带 `0.159.2`；本项目默认解析顺序：自定义路径 → `CODEX_CLI_PATH` → 同目录/`resources`/`_internal/app/resources` → npm 全局。协议同代，0.159.x 内方法集合一致。
- `initialize` 需要 `clientInfo` 与 `capabilities`（当前 Rust 侧已实现 `experimentalApi: true`）。部分新方法（如 `item/plan/delta`、`thread/realtime/*`）标 EXPERIMENTAL，需要 `experimentalApi` 能力位。
- 通知是"增量 + 快照"混合：`thread/tokenUsage/updated`、`account/rateLimits/updated` 为**稀疏合并**语义，前端必须 merge 而非覆盖。
