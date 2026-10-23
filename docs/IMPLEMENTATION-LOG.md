# 实施日志（按轮次）

> 对标对象：本机官方 Codex App 26.928.x（Electron）。差距清单见 [CODEX-APP-PARITY-GAP.md](CODEX-APP-PARITY-GAP.md)。

## Round 1 — 差距分析 + 审批协议正确化（commit `0ac8331`）

| 项 | 内容 |
|---|---|
| 分析 | 从安装包 `app.asar`（555MB）抽取官方 UI 功能面；用 `codex app-server generate-json-schema` + 运行时方法枚举 + 真实环境探针拿到 170 个 RPC / 84 通知 / 11 类服务端请求；全量审计本项目 22 个前端文件与 6 个 Rust 模块 |
| 交付 | `docs/CODEX-APP-PARITY-GAP.md`、`docs/research/*`（官方清单 109KB、当前审计、占位清单、协议图） |
| 修复 | `turn/interrupt` 缺 `turnId`；`turn/steer` 缺 `expectedTurnId`/错用 `text`；权限"自动"档映射非法枚举 `on-failure`；审批/提问应答结构错误 |
| 新增 | `src/protocol.ts`（协议类型与精确应答构造）、`src/components/ApprovalCenter.tsx`（命令/文件/权限/提问 4 类审批 UI）；`serverRequest/resolved`、`thread/tokenUsage/updated`、线程改名/归档/删除通知；连接后回填未决审批 |
| 验证 | `npm run build` ✅；`cargo check` ✅（审计时基线） |

## Round 2 — 核心链路补全（本轮）

### 新增/改造的 UI
| 文件 | 内容 |
|---|---|
| `src/components/TurnDiffPanel.tsx/.css` | 本轮统一 diff 面板：解析 `diff --git`/`@@`/`+`/`-`，文件级折叠、+N/-N、kind 徽标、空态/刷新 |
| `src/components/PlanPanel.tsx/.css` | 执行计划清单：待处理/进行中/已完成/失败四态、完成数进度、折叠 |
| `src/components/TokenUsageMeter.tsx/.css` | 用量表：compact 圆环（percentRemaining 优先）+ popover 明细（输入/缓存/输出/推理/总计/上下文窗口/剩余）+ 速率限制（usedPercent/重置时间/credits） |
| `src/components/ThreadActionsMenu.tsx/.css` | 线程操作菜单：portal 下拉、方向键导航、danger/disabled/hint/分隔线 |
| `src/slashCommands.ts` | 官方风格斜杠命令注册表 32 条（insert/action 两类）+ 过滤助手 |
| `ApprovalCenter.tsx` | 增加 legacy `execCommandApproval`/`applyPatchApproval`（approved/approved_for_session/denied/abort + execpolicy 修正）与 `mcpServer/elicitation/request` 卡片 |

### App.tsx 接线（核心链路）
- 流式：`item/reasoning/textDelta` 与 summary 分离累积、`item/reasoning/summaryPartAdded` 分段、`item/plan/delta` 计划流、`turn/plan/updated` → PlanPanel、`turn/diff/updated` → TurnDiffPanel、`item/fileChange/patchUpdated` 实时更新文件变更卡、`thread/tokenUsage/updated` → TokenUsageMeter
- turn 完成：合并服务端权威 `turn.items`（按 id 去重合并，修复流式缺条目的问题）
- item 渲染：`fileChange.changes[]`（path/kind/diff + 真实增删行统计）、`mcpToolCall`、`webSearch`、`imageView`/`imageGeneration`、turn 内 `plan` 卡片
- Markdown：代码块「运行」→ 终端、文件路径点击 → 右侧预览（此前回调用未接线）
- 线程生命周期：`thread/fork`（含"从当前轮次派生"）、`thread/revert`（每轮"回滚到此"）、`thread/compact/start`；新建的 ThreadActionsMenu 集成 11 项操作（Fork/压缩/回滚/复制 Markdown/导出 JSON/重命名/置顶/新建/归档/删除）
- 用量与账号：连接后 `account/read` + `account/rateLimits/read`，顶栏 compact 用量环 + 真实额度 popover；移除伪造的采样参数滑块，改为只读运行参数 + 明确提示"协议不支持逐会话覆盖"
- 通知：`thread/reverted` 重新加载、`thread/compacted` 插入压缩提示、`item/autoApprovalReview/started|completed` → 自动审批横幅、`account/updated`、`account/rateLimits/updated`、`skills/changed`、`thread/status/changed`
- 快速搜索：`QuickSearchModal` 接入 `fuzzyFileSearch` + `thread/search`（`workspacePath` prop 已接线），斜杠命令 21 个 action 接入 `handleSlashAction`（fork/新会话/重命名/归档/置顶/宠物/用量/项目/MCP 等）
- 清理假 UI：`⚙️ 参数` 面板改为只读真实参数；`📊 用量` 换成真实 token/额度

### 验证
- `npm run build` ✅（1,622 modules，CSS 96.5KB / JS 846KB）
- 真实 app-server 请求形状校验：**9/9 通过**（`thread/start` 的 approvalPolicy/approvalsReviewer/sandbox、`turn/steer` 的 expectedTurnId+input、`turn/interrupt` 的 turnId、`turn/start` 的 sandboxPolicy/effort/serviceTier、`thread/fork`、`thread/revert`、`thread/compact/start`、`thread/delete`）。脚本：`.ref/scripts/verify-appserver-shapes.mjs`（结果 `.ref/protocol-probe/_verify-shapes.json`）
- 组件层 SSR 冒烟（由组件作者执行）：16 组渲染，diff 分类/数字格式化/状态归一化/空态正确

### 仍未完成（进入后续批次）
- 批次 2：设置页全面走 `config/*` 协议、`fs/watch` 实时文件树、资源管理器增删改、`config/mcpServer/reload`
- 批次 3：`thread/goal/*` 真 Goal、`threadSection/*` 分组、`project/*` 项目实体、插件市场、Code Review、`experimentalFeature/*`、Windows 沙箱安装、线程队列
- 批次 4：原生菜单 + 可改键快捷键、系统通知/托盘/多窗口、自动化调度器、Inbox 持久化

## Round 3 — 批次 2：设置/文件系统协议化 + Code Review

### 设置页（`src/config.ts` + `SettingsView` + `types.ts`）
- 新增 `src/config.ts`（511 行）：`config/read|value/write|batchWrite`、`configRequirements/read`、`config/mcpServer/reload`、`experimentalFeature/list|enablement/set`、`account/read|rateLimits|usage` 的协议封装 + 有效/无效 config 键白名单 + 枚举常量。
- 读取：优先 `config/read(activeWorkspaceRoot)` 映射真实配置，失败回退 Tauri `config_read`。
- 保存：`config/batchWrite` + `reloadUserConfig:true`，只提交白名单键；providers/MCP 仅 dirty 时才走既有 Rust 写入；协议失败整体回退。
- 删除 7 个无效键控件（temperature/top_p/max_output_tokens/context_window/max_parallel_tools/subagent_concurrency/allow_network）+ 3 张假预设卡；改正 2 个错误键（`web_search_mode`→`web_search`、`output_verbosity`→`model_verbosity`）；新增 model_provider、approvals_reviewer、instructions、真实模型候选、托管约束提示。
- 新增「实验特性」分区：`experimentalFeature/list` 全量 152 项，stage 分组 + 搜索 + 开关（乐观回写/失败回滚）。
- 新增「账号与额度」分区（只读）：email/planType、主/次窗口 usedPercent + 重置时间 + credits、usage summary + 最近 14 天柱状图。
- MCP 增删改/导入/raw TOML 保存后追加 `config/mcpServer/reload`。

### 文件系统（`src/fsClient.ts` + `DiffDrawer` + `FileExplorer.css`）
- 新增 `src/fsClient.ts`：`fs/readDirectory|readFile|writeFile|createDirectory|remove|copy|getMetadata|watch|unwatch` 封装（base64 编解码、二进制检测、路径工具、`renamePath`=copy+remove、`watchPath` 唯一 watchId + 先订阅后 watch + 幂等 teardown）。
- DiffDrawer Files tab：目录读取/预览/保存协议优先（保留 Tauri 回退）；新增新建文件、新建文件夹、重命名、删除（二次确认）、复制路径；`fs/watch` 300ms 防抖刷新、切 tab/目录/卸载清理、app-server 重连自动重建 watch；图片/大二进制回退本地预览。

### 主界面（App.tsx / NavigationRail / CodexSidebar）
- 全局工作区 `fs/watch`：文件变化 400ms 防抖刷新 Git 状态与文件列表。
- **计划模式走真实协议**：`thread/settings/update` 的 `collaborationMode: {mode:"plan"|"default", settings:{model,reasoning_effort}}`，移除原「prompt 前缀」伪装；新会话在首个 turn 前应用。
- 线程状态条：监听 `thread/status/changed`，头部显示 空闲/运行中/等待批准/等待输入/出错 状态徽标。
- Inbox 持久化（`desktop_state` 读写）+ turn 完成自动入箱（去重）。
- **Code Review 页面（新增）**：`review/start` 内联审查，支持 4 种目标（未提交改动 / 对比分支 / 指定提交 / 自定义指令）、分支与提交选择器、审查结果在会话中流式展示；导航栏与侧边栏新增「代码审查」入口。

### 验证
- `npm run build` ✅（1,6xx modules，CSS 104KB / JS 888KB）
- 协议 shape 校验 **22/22 通过**（`.ref/scripts/verify-batch2-shapes.mjs`，隔离 `CODEX_HOME`）：config/read|batchWrite|value/write 实测生效、configRequirements、mcpServer/reload、experimentalFeature list/set（152 项）、fs 全操作（含 base64 读写、copy、remove、metadata）、**fs/watch→fs/changed 真实通知**、thread/settings/update collaborationMode plan/default、review/start 形状。
- 组件层：队友对设置页做了隔离 CODEX_HOME 的真实 app-server 枚举矩阵测试（6 档 effort / 3 档 sandbox / 4 档 web_search / 3 档 verbosity 写读通过）。

### 后续（批次 3）
- `thread/goal/*` 真 Goal、`threadSection/*` 侧栏分组、`project/*` 项目实体、`plugin/*`+`marketplace/*` 插件市场、`thread/queue/*`、`windowsSandbox/*`、`hooks/list`、Apps、原生菜单/快捷键、自动化调度器。

## Round 4 — 批次 3：真 Goal / 服务端队列 / 侧栏分区 / 项目实体 / 插件市场 / 沙箱

### 目标（Goal）改为官方服务端驱动
- 新增 `src/threadGoal.ts`：`thread/goal/get|set|clear` 封装、`/goal <objective>` 提示词约定、状态/用量格式化。
- App：启动目标 = `thread/goal/set {objective,status:active}` + 首轮发送 `/goal <objective>`（服务端负责自主续跑）；暂停/恢复/清除全部走协议；`thread/goal/updated|cleared` 同步状态；切换会话时 `thread/goal/get` 回填。
- 移除客户端自造的"轮次续跑/倒计时/伪造进度"逻辑；本地验证命令作为可选工具保留；目标完成触发提示音 + Inbox。

### 服务端消息队列（thread/queue/*）
- 新增队列同步：`thread/queue/list` 回填、`thread/queue/changed` 通知刷新、`thread/queue/start` 在 turn 结束后自动推进、`thread/queue/delete` 取消、steer 失败时 `thread/queue/add` 入服务端队列（本地队列仅兜底）。
- Up next 栏改为「立即发送 / 引导到当前轮 / 取消」，均对应服务端队列操作。

### 侧边栏自定义分区（threadSection/*）
- 新增 `src/threadSections.ts`；CodexSidebar 新增「自定义分区」区：新建/重命名/删除分区（删除前把线程移出）、会话「移动到分区 / 移出分区」子菜单；协议不可用时整区隐藏不回归。

### 项目实体（project/*）
- 新增 `src/projects.ts`；ProjectsIndexView 改为真实项目列表：新建（名称 + 多根目录）/重命名/删除/上移下移/项目内新建聊天/展开项目会话；协议失败回退旧 workspace 视图。

### 插件 / 市场 / Apps（plugin/*、marketplace/*、app/*、skills/*）
- 新增 `src/plugins.ts`（25.7KB 协议层，含错误分类 forbidden/auth/network/timeout）。
- SkillsMcpView 去硬编码：插件页用 `plugin/installed`（分组/详情/卸载）、浏览页 `plugin/list{marketplaceKinds:["local"]}`（139KB，一次缓存）、市场页 add/remove/upgrade、Apps 页 `app/list`（403 时降级 + `app/installed` 回退）、技能页 `skills/list` + `skills/config/write` 启停（本地读取兜底）。

### Windows 沙箱（windowsSandbox/*）
- 连接后 `windowsSandbox/readiness` 检测；未就绪显示可关闭横幅 +「安装沙箱」（`windowsSandbox/setupStart`），`windowsSandbox/setupCompleted` 后自动复检。

### 验证
- `npm run build` ✅（1,632 modules，CSS 114KB / JS 950KB）
- 协议 shape 校验 **28/28 通过**（`.ref/scripts/verify-batch3-shapes.mjs`，隔离 CODEX_HOME）：goal set/get/pause/clear、queue add/list/delete、threadSection CRUD + move、project create/list/read/update/move/delete、plugin installed/list(local)、marketplace add 形状、skills/list、hooks/list、windowsSandbox/readiness、permissionProfile/list、app/list 403 优雅降级。
- 队友额外验证：插件页对真实 app-server 的只读集成（installed 3 市场/18 插件、browse 77 项、skills 70 项、app/installed 9 项回退）+ 20 项纯函数单测 + SSR 冒烟。

### 已知限制（记录）
- 官方 `thread/start` 无 `projectId` 参数，`thread/metadata/update` 也不含项目字段 → 新建会话暂不能挂到项目实体（项目聊天数只统计已有的 `projectId`）。
- 已分区会话同时仍出现在「最近」列表（官方行为差异），后续可加过滤开关。
- `app/list` 在当前账号必 403（ChatGPT 连接器接口），已降级为提示 + 本地快照。

## Round 5 — 批次 4：原生菜单 / 托盘 / 快捷键 / Hooks 真实化

### 原生菜单 + 系统托盘（Rust）
- 新增 `src-tauri/src/menu.rs`（281 行）与 `src/nativeShell.ts`（92 行）：
  - File（new-chat Ctrl+N / open-workspace Ctrl+O / settings Ctrl+, / quit Ctrl+Q）、Edit（系统原生 undo/redo/cut/copy/paste/select-all）、View（toggle-sidebar Ctrl+B、toggle-terminal Ctrl+J、toggle-changes Ctrl+Alt+B、command-palette Ctrl+K、file-search Ctrl+P、toggle-theme、reload Ctrl+R、toggle-devtools F12、zoom-in/out/reset、toggle-fullscreen F11）、Window、Help（about / open-config-toml）
  - 菜单点击 → `native-menu {id,payload?}` 事件；`open-config-toml` 附带 config.toml 绝对路径
  - 系统托盘：左键唤起主窗口，右键菜单 Open / New Chat / Quit（复用 `icons/icon.png`，Quit 由 Rust 直接退出）；`native-tray {id}` 事件
  - 新增并注册 Rust 命令 `open_path_external(path)`（explorer/notepad/open/xdg-open）
  - `Cargo.toml` 增加 `tray-icon`、`image-png` features；capabilities 显式加 `core:menu:default`、`core:tray:default`
- 前端 App 接线：菜单/托盘事件 → 统一 `runShortcutAction` 分发（**250ms 去重**，解决菜单 accelerator 与 webview keydown 双触发导致 toggle 互相抵消）；zoom 用 `getCurrentWebview().setZoom`；全屏/退出用 window API；`toggle-theme` 循环官方主题并持久化；启动时应用已保存主题。

### 快捷键注册表
- 新增 `src/shortcuts.ts`：13 组快捷键（新建会话、侧栏、终端、变更面板、设置、命令面板 ×2、文件搜索、重命名、置顶、归档、复制最后代码块、派生会话、代码审查、Esc），`matchShortcut` / `matchRecentThreadIndex`（Alt+1..9 跳转最近会话）。
- App 用稳定的 keydown 监听 + 动作 ref 分发，避免闭包/声明顺序问题。

### Hooks 设置页真实化
- 新增 `src/hooksClient.ts`（445 行）：`hooks/list` 归一化（HookInfo/HookGroup/warnings/errors）、`subscribeHookEvents`（hook/started + hook/completed → HookLiveEvent 含耗时/状态/输出摘要）。
- SettingsView hooks-settings 分区：真实按 cwd 分组列表（事件/命令/启用/source/trust 状态/是否托管）、warnings/errors 提示条、刷新+loading、空态与「打开配置位置」（reveal_path_in_explorer 回退 config.toml）、**实时运行记录**（最近 20 条、运行中标记、started→completed 原地合并、可清空）；删除 4 个只写本地 prefs 的假命令输入框，保留本地开关并标注。

### 验证
- `npm run build` ✅（index 972KB + 动态拆分 window.js；CSS 114KB）
- `cargo check --manifest-path src-tauri/Cargo.toml` ✅（新依赖 tray-icon/image 编译通过，0 error；复跑 1.72s）
- `npx tsc --noEmit` ✅
- 队友验证：菜单/托盘 API 编译通过并给出事件协议；hooks 用隔离 CODEX_HOME 实测 hooks/list 字段与 hook/started|completed 归一化单测通过。

### 已知限制
- 快捷键与菜单 accelerator 采用 250ms 去重；极快的重复按同一 toggle 会被合并一次。
- `toggle-devtools` 仅在 debug 构建由 Rust 直接生效（release 无 devtools feature 时仅发事件）。
- Hooks 运行记录仅存在于设置页打开期间（未做跨路由持久化）；未信任 hook 会被 codex 上游跳过（UI 已标注 trustStatus）。

## Round 6 — 批次 5：自动化调度执行器 / 长会话分页 / 快捷键设置真实化

### 自动化调度执行器（Rust，新增 `src-tauri/src/automations.rs` 1599 行）
- `automations::start(app)`：幂等后台循环（首轮 5s、之后每 30s），读取 `~/.codex/automations/<id>/automation.toml`（复用 config_skills::list_automations）。
- 自研 RRULE 解析 + chrono 本地墙钟计算：HOURLY/DAILY/WEEKLY/MONTHLY/YEARLY + INTERVAL/BYHOUR/BYMINUTE/BYDAY/BYMONTHDAY/WKST；不支持规则 warning 跳过不崩溃。`.run-jitter-salt` FNV-1a 稳定 jitter ≤60s；PAUSED/非 local 跳过；首次发现只排未来（以 created/updated 为锚）。
- 执行链：`ensure_connected` → `thread/start {cwd, model, approvalPolicy:"never", sandbox:"workspace-write"}` → `turn/start {input:[{text:prompt}], model, effort}`；失败写状态发事件，不 panic。
- 状态持久化：`~/.codex/.codex-native/scheduler-state.json`（原子写，用户 automation.toml 只读）；事件 `automation:run-started|run-finished`；命令 `automations_scheduler_status|refresh_schedule|run_now` 注册。
- **17 个单测**（RRULE 解析/下一次运行/jitter/首轮只排未来/PAUSED 跳过/月内 31 日跳过等）全部通过。

### Automations 页（前端）
- 新增 `src/automationsClient.ts`（调度器 RPC + 事件订阅 + 错误分类 unavailable/command_failed）。
- AutomationsView：顶部调度器状态条（运行中、当前时间、配置数、下次运行摘要、刷新调度）、每行「下次运行/上次运行状态色/运行次数/错误/线程」、**立即运行**、实时事件标记、运行历史最近 20 条（可清空）；CRUD 全保留；后端未就绪时显示「调度器不可用」黄条且 CRUD 不受影响。

### 其他收尾
- **长会话分页**：`thread/turns/list {limit:15, sortDirection:"desc", itemsView:"full"}` 首屏 + 「↑ 加载更早的轮次」（cursor 翻页、去重前置、失败回退 full read）；`thread/read` 改 metadata-only。
- **设置页「键盘快捷键」**：改为从 `src/shortcuts.ts` 导入真实注册表分组渲染（15 项）。
- 修正 `review/start` 自定义目标：官方枚举是 `{type:"custom", instructions}`（原先误用 `instructions`）。
- 修正服务端队列语义：空闲时服务端会自动消费队首，移除客户端 auto-start 循环；「立即发送」改为 `thread/queue/start {queuedSubmissionId}`。

### 验证
- `npm run build` ✅ / `npx tsc --noEmit` ✅
- `cargo check --manifest-path src-tauri/Cargo.toml` ✅（0 error / 0 warning）
- `cargo test --manifest-path src-tauri/Cargo.toml automations` ✅ **17 passed / 0 failed**
- 协议 shape 校验 batch4 **16/16 通过**（隔离 CODEX_HOME：turns 分页、queue update/reorder/delete、project/import、review 四种 target、hooks/list、skills/config/write；items/list 在 0.159 不支持已记录）

### 已知限制
- 调度器仅在应用运行时工作（无 OS 服务）；重启会对已过期 nextRunAt 补跑一次；`run-finished` 表示成功发起 turn，不等待模型跑完。
- `thread/items/list` 在当前 CLI 版本返回 not supported（已降级记录）。

## Round 7 — 归档页 / 一键验证 / 增量再审计

### 已归档会话页（官方 Archive IA）
- `types.ts` 新增 `archive` 路由；新增 `src/components/ArchiveView.tsx/.css`。
- 能力：`thread/list {archived:true, sortKey:"updated_at", searchTerm}` 真实读取 + 300ms 防抖标题搜索；行内显示标题/更新时间/cwd；「恢复」= `thread/unarchive`、「删除」= 二次确认 + `thread_delete`、点击行 = 自动恢复并打开会话；空态/错误重试/刷新/计数。
- 导航接入：左侧图标栏 + 侧边栏「已归档会话」入口；归档/恢复/删除后通过 refreshToken 与通知刷新。

### 一键验证脚本
- 新增 `scripts/verify-all.ps1`：依次执行 `tsc --noEmit`、`npm run build`、`cargo check`、`cargo test automations`、4 个协议探测脚本（`-Fast` 可跳过探测）；任一失败即非零退出并汇总失败步骤。
- 协议探测脚本移入 tracked 目录 `scripts/protocol-verify/`（原在 `.ref/scripts`，gitignore）：全部使用隔离 `CODEX_HOME`，不触碰用户真实 `~/.codex`。
- 本轮实测：**ALL CHECKS PASSED**（协议探测 9/9、22/22、28/28、16/16）。

### 增量再审计（只读，HEAD + 归档页增量）
- 新增 `docs/research/current-audit-v2.md`（47 模块矩阵、旧 §28 复核、断链清单 v2、缺失能力、四组真实度统计）与 `docs/research/parity-summary-v2.md`（一页纸对标：71 方法清单/35 通知/7-10 server request/官方 45 设置分区映射/核心链路 ✅ 表）。
- 关键数字（Round 初始 → 现在）：
  - 前端引用 client RPC 方法 17 → **71**（+Rust 桥 3 = 74，稳定目录 104 → 68%）；通知 8 → **35**；server request 1（错误）→ **7/10**
  - 功能点级真实度：REAL 33% → **58.3%**，MOCK/BROKEN 26% → **8.7%**
  - 模块级：REAL 8 → **16** / 36 模块
  - 官方 45 设置分区：真实可用 10（22%）、真实+部分 21（47%）
- 仍缺 Top：系统通知中心/免打扰设置、实时语音、附件持久化、computer-use/Appshots/Browser、账号登录、command/exec+process、item/tool/call、Markdown 富渲染、多窗口/可编辑 keymap、19 个官方云端/团队/计费类分区（多数范围外）。

### README
- 重写为当前能力清单（9 大块）+ 一键验证命令 + 已知限制，并链接差距报告/实施日志/审计 v2。

### 验证
- `pwsh -NoProfile -File ./scripts/verify-all.ps1` → **ALL CHECKS PASSED**

## Round 8 — 系统原生通知 / 通知设置分区 / 假分区标注

### 系统原生通知（tauri-plugin-notification）
- Rust：`Cargo.toml` 增加 `tauri-plugin-notification = "2"`；`lib.rs` 注册插件 + 新命令 `show_desktop_notification(title, body)`（Windows Toast / macOS / Linux）。
- 前端：App 新增通知偏好（桌面通知/提示音/审批提醒）与 `applyNotifyPrefs`；偏好从 `desktopPreferences` 读取，并监听 `codex-prefs-changed` 同源事件即时生效。
- 触发点（仅窗口在后台时弹系统通知，避免打扰）：
  - `turn/completed` → 「Codex 回复已完成」
  - `app-server:server-request`（审批请求）→ 「Codex 需要你的批准」+ 命令摘要（受审批提醒开关控制）
  - `automation:run-finished` → 自动化完成/失败
  - 提示音改为受「完成提示音」开关控制（`notifyChime`）

### 设置页「通知与免打扰」分区
- 新增 slug `notifications`（个人组）：桌面系统通知 / 完成提示音 / 审批提醒 三个开关 + 「发送测试通知」按钮 + 系统通知权限提示。
- `saveDesktopPreferences` 写入 `desktopNotifications`、`notificationSound`、`notifyOnApproval`，并 dispatch `codex-prefs-changed` → App 即时应用。

### 假分区标注
- 对仅写本地偏好的 8 个分区（Computer use / Appshots / Browser / Git / Worktrees / Voice / Plugins / Pets）在设置页顶部显示「本地偏好分区：尚未接入实际执行器」提示条，避免"点了没反应"的误解。

### 验证
- `pwsh -NoProfile -File ./scripts/verify-all.ps1` → **ALL CHECKS PASSED**（tsc / vite build / cargo check / cargo test 17 / 协议探测 9+22+28+16 全通过）

## 收尾（Round 8 / 最终提交）

- 最终全量验证（`scripts/verify-all.ps1`）**ALL CHECKS PASSED**：tsc / vite build / cargo check（0 error 0 warning）/ cargo test automations（17 passed）/ 协议探测 9+22+28+16 全通过。
- 新增 `docs/FINAL-REPORT.md`：最终交付报告（结论、能力清单、验证证据、交付物索引、范围声明/未实现项、下一步建议）。
- 目标评估：官方 Codex 桌面端核心链路（对话/审批/diff/终端/文件/设置/Goal/队列/分区/项目/插件/Codex Review/Hooks/自动化/原生菜单通知/归档/分页）已全部真实接线并通过验证；剩余项均为范围声明内（云端/实时语音/官方插件类/多窗口/附件持久化等），目标判定完成。
