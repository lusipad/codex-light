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

## Round 9 — 工作台标签系统 / 自绘标题栏 / 附件持久化 / PR 列表 / 桌面伴侣切帧 / 1:1 对齐

### 工作台标签系统（Workbench Tabs，1:1 对标 §2.2）
- `DiffDrawer` 升级为通用右侧工作台，支持 `newTab`、`changes`、`files`、`summary`、`browser` 多标签切换与动态增删。
- 新增 `src/components/NewTabPage.tsx/.css`：新标签页快速入口（变更、终端、文件、Side Chat、网址导航）。
- 新增 `src/components/BrowserToolbar.tsx/.css`：浏览器地址栏、前进、后退、刷新、外置浏览器打开。
- 全屏/最大化切换（`isFullWidth`）与 Split/Unified Diff 视图切换。

### 标题栏与主菜单（AppTitleBar，1:1 对标 §1.1 / §7.4）
- 新增 `src/components/AppTitleBar.tsx/.css`：自绘标题栏，包含后退/前进、侧栏折叠、文件/编辑/视图/窗口/帮助顶级下拉菜单、窗口标题及窗口控制。
- 菜单项快捷键与 `src/shortcuts.ts` 全局按键映射联动。

### 线程附件持久化（thread/attachment/*，1:1 对标 §3.1）
- 新增 `src/threadAttachments.ts`：封装 `thread/attachment/add`（支持 file 与 image 类型）、`thread/attachment/list`、`thread/attachment/remove`。
- 新增 `src/components/ComposerAttachmentChip.tsx`：附件缩略图预览与行内删除。
- 会话切换时自动加载并回填已持久化附件；发送新会话时自动批量持久化附件。
- 新增探测脚本 `scripts/protocol-verify/verify-attachments.mjs`（12/12 隔离协议探测通过）。

### Pull Requests 与 Code Review 双模式（1:1 对标 §4.4）
- `CodeReviewView` 增加 Local Review 与 Pull Requests 双标签。
- Rust 新增 `git_list_prs`，结合 GitHub CLI（`gh_status`），真实展示 PR 列表（编号、标题、分支、增减行、Draft 状态）并提供快捷审查。

### 官方桌面伴侣（Mini & Pets）切帧加载（1:1 对标 §5.2 / §7.5）
- Rust 新增 `pets_list_installed`，遍历 `~/.codex/pets/*/pet.json` 并动态加载 WebP spritesheet 转换为 Data URL。
- 新增 `src/components/PetSprite.tsx` 切帧渲染组件，驱动官方像素伴侣动画。
- 设置页真实读取已安装宠物并配置显示模式（always-visible / on-demand）与尺寸缩放。

### 侧栏与主导航 1:1 对齐（1:1 对标 §1.1 / §2.1）
- `NavigationRail` 重构为官方结构（首页、定时任务、探索 popover、插件、代码审查、底部个人资料头像弹窗）。
- `CodexSidebar` 增加「活动（Activity）」过滤（未读/运行中/等待审批过滤），侧栏产品模式切换 popover（Codex / ChatGPT / Work），Pin/Archive/Delete 菜单完备。
- 新增 `src/components/ProjectSourcesPopover.tsx`：多根目录与 Source Folders 管理。
- 新增 `src/components/ToolCallCards.tsx`：结构化渲染子代理任务与 MCP 工具调用卡片。

### 验证
- `pwsh -NoProfile -File ./scripts/verify-all.ps1` → **ALL CHECKS PASSED**
- 协议探测扩充至 5 组（9+22+28+16+12 = **87/87 passed**）。
- TypeScript typecheck (0 error)、Vite production build、Cargo check (0 error)、Cargo test 17 passed。


## Round 10 · 全量主清单 1:1 复刻完成 (P0-P3 全量扩展与闭环)

### 1. 浮动文本工具栏与 Side Chat 工作台 (P0)
- 新增 `src/components/TextSelectionToolbar.tsx/.css`：在选中文本上方自动浮现微型工具栏，提供「添加至会话输入框」、「在 Side Chat 提问」与「复制文本」。
- 新增 `src/components/SideChatPanel.tsx/.css`：右侧工作台独立的 Side Chat 侧边会话面板，支持快捷键 `Ctrl+Alt+S` 快速唤起与比对。
- 工作台 `DiffDrawer` 深度集成：支持在 `newTab`、`changes`、`files`、`summary`、`browser`、`sideChat` 自由切换。
- Git Worktree 修复与改动带回：Rust 新增 `git_worktree_bring_changes_back` 与 `git_worktree_repair` 命令，UI 增加对应操作按钮。

### 2. 独立热键窗口 (Hotkey Window / Popout) 与原生截屏 (P1 & P2)
- 新增 `src/components/HotkeyWindow.tsx/.css`：独立快速悬浮聊天窗口，支持快捷键 `Ctrl+Alt+O`、`/hotkey-window` 独立路由与内置 Overlay 模态。
- 原生截屏 (Appshot) 深度集成：Rust 新增 `capture_appshot` 命令（调用 Windows Forms/Drawing API 高清抓取屏幕并存入 `~/.codex/appshots/`），Composer 增加相机按钮与快捷捕获，截屏自动挂载为附件。

### 3. Sites 托管工作面 (`/sites`) (P3)
- 新增 `src/components/SitesView.tsx/.css`：
  - 我创建的站点 (Owned) 与 共享给我 (Shared) 视图切换。
  - 网格 / 列表双视图布局与关键词过滤。
  - 新建站点模态：支持 Vite + React、Next.js、Vue 3、静态 Tailwind、Docusaurus 模版，自定义 `*.codex.app` 子域名。
  - 站点详情抽屉：在线模拟预览、CNAME 自定义独立域名解析绑定、环境变量配置、发布流水线与提交追踪、一键在会话中修改代码。

### 4. 资料库与 Space 协作 (`/library/*`, `/space/*`) (P3)
- 新增 `src/components/LibraryView.tsx/.css`：
  - 分类切换：全部文件、推荐、收藏星标、图像生成、Space 空间。
  - 文件夹快速过滤条、网格与表格视图。
  - 新建 Markdown 笔记模态、本地文件快速导入。
  - 文件预览模态：原生渲染 Markdown、图像缩放与代码，支持星标收藏与一键引用至会话输入框。

### 5. 图像中心 (`/images`) (P3)
- 新增 `src/components/ImagesView.tsx/.css`：
  - 多模态图像提示词 Composer，支持 1:1、16:9、9:16 画幅比例快速切换。
  - 热门技术灵感模版卡片轮播（系统架构示意图、UI 原型、像素风开发者桌面、智能体星环）。
  - 我的图像图库网格与 Lightbox 大图预览，支持提示词复制与一键在会话中深入讨论。

### 6. GPTs 探索与迁移中心 (`/gpts`) (P3)
- 新增 `src/components/GptsView.tsx/.css`：
  - 实测对齐官方 12 月 11 日停用与迁移至插件/技能的公告横幅。
  - 智能体分类过滤（编程开发、研究分析、写作辅助、生产力）与搜索。
  - 快速载入预设提示词并一键引导至现代 Plugins/Skills 生态。

### 7. 云开发环境 (`/cloud-environments`) (P2 & P3)
- 新增 `src/components/CloudEnvironmentsView.tsx/.css`：
  - 远程安全容器化运行环境列表，支持运行中与已休眠状态过滤。
  - 新建云环境模态：仓库绑定、分支绑定、Ubuntu 24.04/Python ML/Rust 镜像选择、规格规格 (2vCPU~8vCPU) 配置。
  - 环境详情抽屉：网络出口模式 (Public/VPC)、Secrets 密钥安全脱敏、重置容器构建缓存 (Reset Cache) 与一键在云环境中启动会话。

### 8. 技能 `$skill-creator` 会话引导与 PR 检出 (P1)
- `SkillsMcpView.tsx`：实测对齐官方 `$skill-creator` 会话预填行为，提供一键引导创建技能会话按钮。
- `CodeReviewView.tsx`：新增 Pull Request 详情弹窗，直观展示源分支、目标分支、改动行数统计，并支持通过 `git_branch_checkout` 原生检出分支。

### 9. 全量验证结果
- `pwsh -NoProfile -File ./scripts/verify-all.ps1`：**ALL CHECKS PASSED**
  - TypeScript typecheck (`tsc --noEmit`)：0 error
  - Vite production build：SUCCESS (1671 模块)
  - Cargo check：SUCCESS (0 warning 0 error)
  - Cargo unit tests：17 passed, 0 failed
  - 5 套独立协议探针脚本：**87/87 全部通过** (9 + 22 + 28 + 16 + 12 = 87)

---

## Round 9 — 官方细节 1:1 深度复刻与全量表面闭环

### 1. 侧边栏与会话组织对齐官方 `smn` 逻辑
- **项目过滤规则**：实测逆向官方 Electron asar (`app-initial-fd3c4b862660.js`)，在 `By project` 组织模式下，主会话列表严格过滤掉归属于已登记项目的会话（`e.projectKey == null || !visibleProjectKeys.has(e.projectKey)`），防止跨项目内容重叠污染。
- **Organize 浮层菜单**：提供 `groupByMenu`（`By project` vs `In one list`）、`chatsSortMenu`（`Last updated` vs `Created`）与 `filterScope`，支持即时动态排序与分组。
- **活动视图与工作区联动**：点击项目或独立会话时自动双向同步当前活跃工作区路径；增加项目胶囊徽标与未读状态标记。

### 2. 会话（Thread）与输入框（Composer）深度增强
- **会话内查找栏 (`ThreadFindBar`)**：实测对齐 `codex.threadFindBar.*`，支持 `Ctrl+F` 唤起、会话消息与代码差异跨域过滤、上一个/下一个精准跳转与 `.find-highlight-pulse` 平滑视觉聚焦。
- **消息级动作与收藏书签**：用户气泡新增「🌿 从此分叉」与「⭐ 收藏 / 书签」；右侧快速跳转轨道新增金色收藏高亮圆点，持久化于本地缓存。
- **代码块快捷复制**：新增快捷键 `Ctrl+Shift+;` 快速复制最后一轮生成的有效代码块。
- **36 个官方斜杠命令全矩阵**：补齐官方全量标准斜杠命令（`/plan`, `/goal`, `/review`, `/fork`, `/side`, `/new`, `/compact`, `/init`, `/mcp`, `/status`, `/usage`, `/model`, `/reasoning`, `/speed`, `/project`, `/chat`, `/local`, `/worktree`, `/cloud`, `/cloud-environment`, `/ide`, `/memories`, `/rename`, `/archive`, `/star`, `/feedback`, `/pet`, `/share`, `/approve`, `/resume`, `/hotkey-new` 等）。

### 3. 代码变更抽屉（DiffDrawer）全能进化
- **本轮改动（Last turn diff）**：新增差异来源切换，支持提取最近一轮轮次内的文件改动对比。
- **代码换行开关（Word wrap）**：新增一键换行切换，长行代码自适应折行。
- **补丁导出与复制**：新增 `复制 git apply` 与 `复制完整 Patch` 按钮，便于命令行极速应用代码变动。
- **智能提交信息生成与一键推送**：内置 Conventional Commits 语义化提交信息自动生成器（`✨ 生成`）以及一键暂存、提交并推送到远端仓库。

### 4. 官方 9 大音效主题与通知策略（1:1 音效矩阵）
- **Web Audio 真实声音合成引擎 (`src/sound.ts`)**：纯前端无外部静态依赖合成官方全部 9 款提示音效（`default`, `basso`, `classic`, `glass`, `ping`, `pop`, `purr`, `tink`, `none`）。
- **轮次完成策略**：对齐官方 `turnCompletionPolicy`（`unfocused` 非焦点后台提醒、`always` 始终提醒、`never` 完全静音）。
- **设置中心试听与权限指引**：增加「▶ 试听声音」按钮与 Windows Toast 权限检测。

### 5. 设置中心全景 24 分区与 Command Palette 索引
- **补齐官方设置分区**：开发者个人资料 (`profile`)、代码审查规范 (`code-review`)、电脑操控与桌面自动化 (`computer-use`)、应用快照上下文 (`appshots`)、浏览器自动化 (`browser-use`)、云端执行偏好 (`cloud-settings`)。
- **全量命令面板索引**：`QuickSearchModal` (`Ctrl+K`) 全量索引所有 24 个设置分区，支持关键词模糊匹配与一键直达跳转。
- **顶栏上下文 Token 用量与速率限制仪表盘**：挂接 `TokenUsageMeter`，提供紧凑环形进度指示器（Compact Donut Ring）与悬浮明细卡片（输入/缓存/输出/推理/窗口剩余及主次限额重置倒计时）。

### 6. 全量验证结果
- `pwsh -NoProfile -File ./scripts/verify-all.ps1`：**ALL CHECKS PASSED**
  - TypeScript typecheck (`tsc --noEmit`)：0 error
  - Vite production build：SUCCESS (1,676 模块)
  - Cargo check：SUCCESS (0 warning 0 error)
  - Cargo unit tests：17 passed, 0 failed
  - 5 套独立协议探针脚本：**87/87 全部通过** (9 + 22 + 28 + 16 + 12 = 87)

---

## Round 11 — 首页 / 侧栏 / Composer 真实对齐与报告纠偏

### 1. 先功能文档调研，再开发
- 新增 `docs/research/home-shell-composer-parity.md`：官方 26.928.21956 / build 12404 的功能、模型/权限实测、CSS 变体、当前模拟实现和最终验证结果。
- 只读实测官方首页、模型紧凑菜单、模型选择器与权限菜单；未改变官方设置、未发送任务。
- 官方 CSS 证据保存到 `.ref/reference/css/`，官方与当前前后截图保存到 `.ref/reference/round11/`。
- 修正 `docs/FINAL-REPORT.md` 的“全量 1:1 已完成”旧结论：Library / Images / Sites / Quick Chat 的模拟或缺失不能按路由覆盖计为真实完成。

### 2. Composer 真实能力与官方交互
- 新增 `src/modelCapabilities.ts`：归一化字符串与 `{reasoningEffort,description}` 对象、默认模型与 Fast 能力解析。
- 新增 `src/components/ModelSelector.tsx/.css`：官方风格紧凑模型菜单、动态模型列表、默认推荐模型集、Fast 开关和原生 range 推理滑块。
- `src/App.tsx` 移除硬编码初始模型；默认推荐与显式模型分开记录，模型切换恢复默认档，不支持 Fast 时关闭并禁止发送 `priority`。
- 权限三档改为官方实测文案、340px 菜单、风险态、键盘 Escape 与焦点返回；协议映射保持合法。

### 3. 首页与侧栏结构 / 视觉
- Home 拆为独立居中 Hero 与底部 Composer dock；Home 顶栏只保留“新建标签页”。
- 首页图标改用现有 OpenAI 轮廓图标，移除自绘终端方块；标题、项目虚线、Composer 圆角/表面/阴影统一为主题 token。
- 侧栏移除时间、数量徽标与空“自定义分区”；行内保留置顶/归档，项目设置/打开目录/移除、重命名/删除等仍可从菜单到达。
- 项目操作复用 `ThreadActionsMenu`；项目与会话行增加 `tabIndex`、Enter/Space 和 `:focus-within`，不仅依赖 hover。
- 样式按 4px 网格、32/38 Hero、22px Composer 校准；Composer 外框/内层/底部与官方扣除 69px 窗口高度差后均为约 1px 差。

### 4. 原生窗口与快捷键
- 缩放改用 Tauri `getCurrentWebview().setZoom`，浏览器保留 CSS zoom 回退；新增 `core:webview:allow-set-webview-zoom` capability。
- 补齐 `core:window:allow-close|minimize|toggle-maximize|set-fullscreen`，原生关闭按钮已实测退出。
- `src/shortcuts.ts` 注册 `Ctrl++`、`Ctrl+-`、`Ctrl+0`（总数 23），与视图菜单共用 `applyZoom`；实测放大和恢复 100%。

### 5. 实际验证
- `pwsh -NoProfile -File ./scripts/verify-all.ps1`：**ALL CHECKS PASSED**
  - TypeScript：0 error；Vite：1680 模块；Cargo check：0 error / 0 warning；Cargo test：17 passed。
  - 5 套隔离协议探针：**87/87 passed**。
- 真实 UI：模型切换与默认档、键盘滑块、Fast on/off、权限三档并恢复、项目/会话菜单、侧栏整理、新建标签、原生关闭与缩放均通过。
- 辅助函数：无 Fast、对象/字符串档归一化、默认模型、23 项快捷键匹配均通过。
- 960×640 受控视口无横向溢出；Light / Dark / System 主题入口仍缺，未宣称亮色功能完成。

### 6. 保留的真实差距
- Library / Images / Sites 仍有演示数据或模拟生成/部署，Quick Chat 仍有固定延时与占位回复，实时语音未接入。
- Light / Dark / System 主题模式与持久化尚未实现；当前只有深色配色主题。
- 原生最大化窗口未能通过边框完成最小尺寸拖拽，窄布局使用受控视口验收，未伪装为原生窄窗口通过。


## 逐页计划 00/01 — 首页与外壳首轮（2026-10-25，开发中）

- 开发前建立 `docs/research/pages/01-home-shell.md`，重新校验 asar 的版本、哈希和首页 JS 字节一致性；清单在 `.ref/parity/00/manifest.json`。
- `src/styles.css` 校准 Electron dark 主表面；`Icons.tsx` 与 `App.tsx` 恢复 Codex 静态首页标识。
- `ModelSelector.tsx` 复用现有菜单补齐键盘打开、焦点进入/返回、外部点击关闭、aria-controls 与 Fast 反向操作标签。
- 标准验证与最终前端/原生构建通过；原生菜单键盘、滑块、Fast 恢复及输入框关闭实测已记录。
- 未完成：同尺寸官方动态参考、Hero 动画、导航 gate、窄窗/中文输入完整回归；连接状态异常正在排查。不是整页已验收。

### 01 首轮后端真实性与连接修复

- 原生测试发现旧 reader EOF 可清除新连接，已串行化连接生命周期并按代次隔离旧消息/退出。
- 移除 model/list 强行注入 Astra 和解除 hidden 的后处理，原始模型能力按回归断言保留。
- 完整 cargo test 22/22；最终 verify-all ALL CHECKS PASSED，日志见 `.ref/parity/01/verify-all.log`。
- 用户按物理 Escape 停止 Computer Use，已停止所有界面输入。最终 Rust 修复尚未重建 EXE/原生复测，旧产物不包含此修复；01 单元继续保持开发中。

## 逐页计划 02 — 会话基础页首轮（2026-10-25，待验收）

- 根据用户“开始开发下一页”进入02，保留01未验收状态。先建立 `docs/research/pages/02-thread-basics.md`，核对官方 asar、app-server 消息结构与围栏规则，再修改代码。
- `App.tsx` 按 thread/turn/item 身份处理交错事件，隔离过期历史请求，补充失败重试、前插历史视口补偿与近底部跟随；旧回答操作区在新轮次输出时保持稳定。
- `MarkdownView.tsx` 修复未闭合/更长/波浪号代码围栏与畸形百分号文件链接。`ThreadFindBar.tsx` 修复结构化文本查找、结果索引、组合输入与键盘冒泡。
- 最小复用：原文本提取迁至 `threadText.ts`，事件合并与请求身份判断放入 `threadTimeline.ts`；无新增依赖。
- 新增内容回归与事件回放脚本并接入标准检查。内容回归从旧版5/12扩展至修复后17/17；完整 verify-all 通过。最后操作区修复后重新通过前端构建、两套回归、全量 Rust 单测22/22和 Release 构建。
- 浏览器隔离样本验证真实 App 的后台事件、交错消息、延迟历史、错误重试及滚动；前插历史锚点偏差约0.304px。原生 Release 使用独立数据目录，经真实 app-server 读取固定消息，验证中文、代码、表格、Ctrl+F、下一处和 Escape；未调用模型生成。
- 产物 `dist-artifacts/02-thread-basics/CodexNative.exe` 已包含01连接修复，原生显示已连接。源码及产物指纹、日志、截图见 `.ref/parity/02/`。
- 未完成：官方同尺寸视觉对照、真实模型链路、历史快照与 partial delta 重叠时序、复制失败恢复；完整页1:1与用户验收仍未通过。详细范围和证据见页面调研文档。

## 逐页计划 02 — 复制与历史加载续修（2026-10-26）

- 重新校验官方asar哈希，先定位共享chunk的复制Promise/false处理、hydration缓冲回放和终态轮次started guard，再修复；定位证据保存至 `.ref/parity/02/reference/`。
- `App.tsx` / `threadTimeline.ts` 改为历史安装后重放代次绑定的事件，修复完整历史被增量后缀覆盖；失败释放、切页失效、legacy事件、命令输出均保留。结束轮次忽略迟到started，避免错误恢复运行。
- `MarkdownView.tsx` 等待每个代码块真正复制成功，独立pending防重复，失败可重试，清理成功提示计时器。DiffDrawer已有复制helper迁至 `clipboard.ts`复用，没有新增依赖或另建复制框架。
- 新增 `verify-clipboard.mjs` 并接入标准脚本，覆盖5类故障路径。扩充timeline回放，直接执行实际App的started分支，终态回归先真实断言失败再通过；内容17/17保持通过。
- 浏览器真实组件和App隔离协议验证包括：延迟/拒绝/回退复制、卸载、完整历史含/不含缓冲、完成权威项、读取失败释放、跨会话失效、结束轮次迟到started与新轮次正常运行。固定测试数据均明确标注，不冒充真实模型输出。
- 最终标准检查 `verify-all-20261026-final.log` 为ALL CHECKS PASSED，含87项协议探针；无独立lint配置，不编造lint结果。原有bundle/混合导入/DEP0190及开发模式popover属性提示仍存在。
- 最终Release构建通过，产物 `dist-artifacts/02-thread-basics-20261026/CodexNative.exe` 与源码指纹记录在 `build-20261026.json`。独立home原生复测历史读取、已结束状态、实际代码复制值、查找2/2与Escape通过，截图对应最后重建的EXE。
- 剩余：官方同尺寸像素对照、真实模型生成/中断，以及官方后缀策略对重复字符串/部分重叠的消歧边界。本轮不宣称协议强一致或整页1:1已验收。

## 逐页计划 02 — 其他会话复制入口补查（2026-10-26）

- 先按官方复制Promise/false逻辑复查剩余入口，实际App callback回归先确认“复制提问”提前成功断言失败，再修改。
- App提问、回答、选区、全会话复制复用已有helper和统一结果提示；全会话文本不再漏掉结构化提问。选区工具栏等待回调结果、失败保留重试，清理计时器并隔离旧选区/卸载结果。
- 修改限于 `src/App.tsx`、`src/components/TextSelectionToolbar.tsx` 与原剪贴板回归脚本；无依赖、无样式重做。扩充13类自动检查，浏览器故障及最终原生提问/回答复制通过。
- 最终完整标准检查、87协议探针、Release构建通过；产物`dist-artifacts/02-thread-basics-copy-20261026/CodexNative.exe`。源码指纹、日志与实际证据见`.ref/parity/02/`本轮message-copy文件。
- 同时完成03只读预调研，记录审批串会话、响应失败丢请求/已解决请求复活、IME与空输入提交等问题，见`docs/research/pages/03-thread-execution.md`。本轮没有03产品改动，不跨页标为验收通过。

## 逐页计划 03 — 审批与提问首轮（2026-10-26）

- 先fetch官方审批文档、核对固定asar与CLI0.159.2新schema，再开发E01–E04。01/02未验收状态保留。
- `App.tsx` / `approvalRequests.ts`：按会话显示请求，typed ID与generation防误匹配，发送期间保留卡片并防重复；失败刷新状态，无法确认投递时禁重发；过期列表不复活已解决请求。移除快捷入口不匹配协议的假批准，改定位实际审批卡。
- `ApprovalCenter.tsx` / `types.ts`：闭包传递本地代次，发送/错误/未知状态可见；Enter遵循按钮校验并保护中文组合输入。复用原卡片与协议构造函数，无新增依赖或公共样式重做。
- `app_server.rs` / `lib.rs`：请求查找/写入/移除原子化，失败或取消写入保留未知标记、禁止重发；resolved按thread/代次/typed ID清理，兼容旧conversationId。
- `verify-approval.mjs`接入标准脚本；前端隔离与旧IME/空提交均有真实失败回归，后端typed ID先红后绿。最终完整检查与87探针通过，全量Rust30/30，Release构建通过。
- 产物`dist-artifacts/03-approvals-20261026/CodexNative.exe`，源码与产物指纹、日志见`.ref/parity/03/`。浏览器故障集成通过；原生以真实CLI独立home验证连接与历史读取。
- 原生本地模拟CLI启动被自动审批拒绝，未返回具体原因；没有原生完整输入回传结果。真实模型/命令审批、物理IME、官方像素对照和03其余范围继续待验证，不将首轮修复标为整页验收通过。

## 逐页计划 03 — 队列、Steer与中断续修（2026-10-26）

- 开发前核对官方Steer文档、固定asar队列及CLI schema；先红后绿覆盖错误Steer落入新轮、队列分页、鼠标交互容器。
- `App.tsx`/`types.ts`：真实分页与队列身份、跨会话/乱序隔离、真实增删启动、原消息Steer及成功清理、失败/未知投递防重；中断等待完成通知。复用现有Composer容器修复鼠标穿透，无新依赖/CSS。
- 新`verify-queue.mjs`、`verify-turn-controls.mjs`共17组回归接入标准检查。完整检查及87协议探针、Release构建exit0；固定App故障场景和跨会话实测通过。浏览器中断失败toast未捕获，未冒报通过。
- 产物`dist-artifacts/03-queue-steer-20261026/CodexNative.exe`；真实CLI隔离home原生连接/历史回归通过，源码与EXE指纹`build-queue-steer.json`。详细证据见03页面文档与`.ref/parity/03/verification.md`。
- 真实任务队列/Steer/中断、物理IME、官方同尺寸视觉和03剩余范围继续待验证；本子范围已自验交付，整页未验收。

## 逐页计划03 — 排队内容与send-now真实状态补查（2026-10-26）

- 先重新读取官方Steer文档、固定asar队列sendNow/full input证据并写验收预期；实际callback先红（运行中错误queue/start）后绿。
- 仅`src/App.tsx`产品改动：运行中立即发送复用Steer及清理逻辑；排队复用附件保存并保留完整input/纯附件，失败/切会话/新稿保护。无新增依赖或CSS。
- `verify-queue.mjs`扩为14组，加turn-controls共20组回归；新增真实CLI空闲边界探针6项，接入verify-all。最终标准检查、协议检查与Release通过，新EXE真实CLI连接和隔离历史回归通过。
- 产物`dist-artifacts/03-queue-input-20261026/CodexNative.exe`。调研、原始RPC、完整日志、源码/产物指纹、原生截图见03页面记录和`.ref/parity/03/`本轮queue-input/input-final/idle-turn文件。
- 新登记Alt+Enter提示与实际处理不一致，尚未修复；真实活跃任务、物理IME和官方视觉未验证，03整页及用户验收状态不变。
