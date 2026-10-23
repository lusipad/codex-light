# CURRENT-AUDIT v2 —— HEAD `a193da2`（Round 6 结束）增量再审计

> 审计对象：`D:\Repos\codex-desktop-native`，HEAD `a193da289e16f018440fe2afbc4f75abba298656`（Round 1-6 完成）
> 对标基线：v1 审计 `docs/research/current-audit.md`（2026-10-23 ~06:50 快照 `fad9129`，32 模块矩阵 / §28 20 条断链）
> 审计方式：**只读**全量扫描 `src/**`（40 个 TS/TSX 文件 + 5 CSS）与 `src-tauri/src/**`（10 个 Rust 模块，含新增 `automations.rs`、`menu.rs`）；grep/脚本统计 + 源码逐段核对 + 与 `.ref/protocol` 0.159 协议目录对照；本机 `npx tsc --noEmit` 实测 **exit 0**。
> 原始数据与可复现脚本：`.ref/audit2/raw/`（README、stats.ps1、feature-matrix.csv、old-section28-recheck.md、settings-coverage.md）
> **审计快照**：HEAD `a193da2` + 工作树未提交增量（4 个 tracked 文件 +71 行：`src/App.tsx`、`src/components/CodexSidebar.tsx`、`src/components/NavigationRail.tsx`、`src/types.ts`；`src/components/ArchiveView.tsx/.css` 为 untracked，属 Archive 路由接入的并行改动，mtime 07:53-07:54）。本审计基于该工作树快照（~07:55）阅读与统计；`npx tsc --noEmit` 在该快照实测 exit 0。若收尾提交与此快照不一致，以提交后代码为准（行号可能轻微偏移）。
> 判定口径沿用 v1：**REAL / PARTIAL / MOCK / MISSING**（另保留 BROKEN 含义并入 MOCK/部分修复说明）。

---

## 0. 结论摘要（先看）

- **核心对话链路已从“必坏 4 点”变为“全链路真实”**：`turn/start`、`turn/steer`（expectedTurnId+input）、`turn/interrupt`（turnId）、审批 7/10 类 server request、服务端 turn.items 合并、流式 reasoning/plan/diff/文件变更全部按 0.159 协议实测形状接线（v1 §28 的 #1/#2/#3/#7 已修复）。
- **协议覆盖大幅提升**：前端实际引用 **71 个 client RPC 方法**（+ Rust 桥 3 个 = 实现引用 74；v1 Round 初始 17），**35 个通知**（初始 8），**7/10 类 server request**（初始 1，且当时应答错误）；Tauri 命令注册 68 / 有效使用 64。
- **新增了 6 个此前完全缺失的子系统**：服务端 Goal（`thread/goal/*`）、服务端队列（`thread/queue/*`）、自定义分区（`threadSection/*`）、项目实体（`project/*`）、插件/市场/Apps（`plugin/*`、`marketplace/*`、`app/*`）、Windows 沙箱（`windowsSandbox/*`）；另有 Rust 自动化调度执行器（1599 行 + 17 单测）、长会话 turns 分页、Code Review、fs/watch、原生菜单+托盘、快捷键注册表、Hooks 真实监控。
- **仍明显是“假/半真”的集中区**：Settings 22 个分区中 **8 个分区仍是只写 `desktopPreferences` 的假开关**（computer-use、appshots、browser-use、git、worktrees 设置、voice、plugins 设置、pets）；`@电脑` 仍只插入文本；附件仍未用协议 input；主题/偏好仍用自造键（不兼容官方 global state）。
- **仍缺的大块**（价值排序）：系统通知中心/免打扰、实时语音（`thread/realtime/*`）、附件持久化（`thread/attachment/*`）、computer-use/Appshots/Browser 真实执行、账号登录/登出、服务端 `command/exec` + `process/*`、`item/tool/call` 动态工具与 collab/subAgent 可视化、Markdown 富内容、多窗口/Quick Chat、可编辑 keymap、自动更新/窗口状态。
- 真实度统计（功能点级，127 点）：**REAL 74（58.3%）/ PARTIAL 10（7.9%）/ MOCK 11（8.7%）/ MISSING 32（25.2%）**；v1 同口径为 REAL ~33% / PARTIAL ~33% / MOCK/BROKEN ~26% / MISSING ~8%。模块级（36 模块）：**REAL 16 / PARTIAL 14 / MOCK 4 / MISSING 2**（v1：8/16/6/2）。

---

## 1. 模块矩阵（32+ 模块，更新判定）

| # | 模块 | v1 | v2 | 一句话证据（v2） |
|---|---|---|---|---|
| 1 | Home 首页 | PARTIAL | **PARTIAL** | 真实工作区/线程数据；4 张建议卡仍硬编码 `STARTER_PROMPTS`（App.tsx:86） |
| 2 | Composer 核心（发送/中断/steer） | PARTIAL/BROKEN | **REAL** | App.tsx:1894-1907 / 2189-2206 / 2208-2216，协议参数正确 |
| 3 | Composer 控件（模型/推理/权限/fast/plan/wt） | PARTIAL | **REAL** | App.tsx:1849-1862（合法 approvalPolicy/approvalsReviewer/sandboxPolicy）、1894-1904、1651-1689 |
| 4 | 附件（文件/图片/mention） | PARTIAL | **PARTIAL** | App.tsx:1798-1802 仍仅拼 `[附加文件: path]` 文本；未用 localImage/mention/skill input |
| 5 | 语音听写 | PARTIAL | **MOCK** | ComposerBox.tsx:192-249 仅 Web Speech；Settings voice 5 项无消费方 |
| 6 | `@电脑` / computer-use | MOCK | **MOCK** | ComposerAutocomplete.tsx:69-83 等 3 处仍插入文本；无执行路径 |
| 7 | 斜杠命令 | PARTIAL | **REAL**（少量 stub 动作） | slashCommands.ts 32 条 + `handleSlashAction` 21 动作（App.tsx:2756-2814）；open_side_chat/cloud 动作明确提示“后续版本” |
| 8 | 消息流/流式渲染 | PARTIAL | **PARTIAL** | 9 类 item 渲染真实（reasoning/command/fileChange/plan/mcp/webSearch/image/message，App.tsx:3800-4066）；协议 20 类 ThreadItem 中 collab/subAgent/dynamic/sleep/reviewMode/compaction 未渲染 |
| 9 | turn 完成合并权威 items | MISSING | **REAL** | App.tsx:769-808 按 id 合并 `turn.items` |
| 10 | 命令输出/工具调用展示 | PARTIAL | **REAL** | 命令卡+exit code（3903-3914）、MCP 卡（3975-4009）、WebSearch 卡（4011-4030）、图片卡（4032-4051） |
| 11 | 审批交互 | PARTIAL/BROKEN | **REAL**（tool/call 缺） | ApprovalCenter + protocol.ts：命令/文件/权限/提问/elicitation/legacy exec/patch 7 类；重连回填（App.tsx:629-636） |
| 12 | DiffDrawer（Git） | REAL | **REAL** | Git 全操作 + 行内评论→聊天 + PR（gh 依赖） |
| 13 | DiffDrawer 文件树（fs） | MOCK/PARTIAL | **REAL** | fsClient.ts 协议化 read/write/create/remove/rename/copy + fs/watch 300ms 防抖（DiffDrawer.tsx:549,819-880） |
| 14 | TurnDiffPanel / PlanPanel | MISSING | **REAL** | `turn/diff/updated`→TurnDiffPanel（App.tsx:1010-1012,4130）、`turn/plan/updated`→PlanPanel（1000-1009,4126） |
| 15 | 侧边栏与工作区 | REAL | **REAL** | workspace/线程/置顶/归档 + 自定义分区（CodexSidebar.tsx:127-600） |
| 16 | 线程列表/置顶/归档/删除 | REAL | **REAL** | App.tsx:2346-2455；ArchiveView + thread/list archived=true 服务端搜索 |
| 17 | 线程 fork/revert/compact | MISSING | **REAL** | App.tsx:1597-1644；ThreadActionsMenu 11 项操作 |
| 18 | 长会话分页 | MISSING | **REAL**（turns；items 不支持） | App.tsx:1522-1543,1565-1590 `thread/turns/list` cursor；items/list 0.159 不支持（记录） |
| 19 | ProjectsIndexView | PARTIAL | **REAL**（新建会话挂项目受限） | projects.ts + ProjectsIndexView.tsx:123-391（CRUD/排序/展开）；thread/start 无 projectId（实施日志已知限制） |
| 20 | InboxView | MOCK | **REAL**（本地持久化） | App.tsx:1252-1275 `desktop_state` 持久化；turn 完成（810-832）与 automation 事件（1277-1316）自动入箱 |
| 21 | AutomationsView | PARTIAL | **REAL** | Rust `automations.rs` 调度器 + 状态/历史/立即运行（AutomationsView.tsx:283-380,462-519） |
| 22 | WorktreesView | REAL | **REAL** | 未变（git.rs + UI） |
| 23 | SkillsMcpView（技能/MCP） | PARTIAL | **REAL** | skills/list+config/write、MCP config+reload+status |
| 24 | SkillsMcpView（插件/市场/Apps） | MOCK | **REAL**（Apps 部分） | plugin/*、marketplace/*、app/list→403 fallback app/installed（plugins.ts 25.7KB, SkillsMcpView.tsx:33-70） |
| 25 | SettingsView（22 分区汇总） | PARTIAL | **PARTIAL（9 真/5 部分/8 假）** | 详见 §4 与 `.ref/audit2/raw/settings-coverage.md` |
| 26 | QuickSearchModal | PARTIAL | **REAL** | fuzzyFileSearch + thread/search 协议实时搜索（QuickSearchModal.tsx:183-230,278-305） |
| 27 | ComposerAutocomplete | PARTIAL | **PARTIAL** | slash 注册表真实；`@电脑` 假、文件结果仍缓存非实时 |
| 28 | TerminalDock | REAL | **REAL** | 未变（PTY 全链路） |
| 29 | Goal runner | PARTIAL（自研） | **REAL**（服务端） | threadGoal.ts + App.tsx:1948-2176：set/get/clear + goal 通知 + 完成 Inbox |
| 30 | 服务端队列 | MISSING | **REAL** | App.tsx:2293-2337,4151-4193 `thread/queue/*`；steer 失败入服务端队列 |
| 31 | MiniPetWidget | MOCK | **MOCK** | 纯装饰 emoji + 快捷提问；无官方 Pets 插件生态集成 |
| 32 | NavigationRail / WorkspacePopover | REAL | **REAL** | + review/archive 路由（NavigationRail.tsx:113-122） |
| 33 | MarkdownView | PARTIAL | **PARTIAL** | 回调已接线（App.tsx:4053-4065）→ 死按钮修复；渲染器仍无表格/图片/语法高亮 |
| 34 | 通知 / 提示音 | PARTIAL | **PARTIAL** | 应用内 toast+chime+Inbox 真实；`warning/configWarning/error` 通知仍仅 console.warn（App.tsx:1162-1169）；无 OS 通知 |
| 35 | 用量面板 | MOCK | **REAL** | TokenUsageMeter（474 行）+ thread/tokenUsage/updated + account/read/rateLimits |
| 36 | 会话参数面板 | MOCK | **PARTIAL** | 改为只读真实参数并明示“协议不支持逐会话采样覆盖”（App.tsx:3241-3286） |
| 37 | 导出/复制/重置 | REAL | **REAL** | 未变 + ThreadActionsMenu 导出 JSON/复制 Markdown |
| 38 | 全局快捷键 | PARTIAL | **REAL**（设置不可改键） | shortcuts.ts 15 组 + 250ms 去重（App.tsx:1328-1375）；设置页只展示不可改 |
| 39 | 原生菜单 + 托盘 | MISSING | **REAL** | menu.rs + nativeShell.ts + App.tsx:2568-2638 全量 dispatch |
| 40 | Windows 沙箱 | MISSING | **REAL** | windowsSandbox/readiness + setupStart + 横幅（App.tsx:1052-1056,1232-1250,2177-2187） |
| 41 | Code Review | MISSING | **REAL** | review/start 四 target + CodeReviewView + 内联结果（App.tsx:1693-1757） |
| 42 | Hooks | MOCK | **PARTIAL** | hooks/list + warnings + hook/started|completed 实时记录（hooksClient.ts, SettingsView:3058-3470）；无编辑/trust 管理 |
| 43 | ArchiveView | MISSING | **REAL** | thread/list archived=true + 服务端 searchTerm + unarchive/delete |
| 44 | 主题/偏好官方兼容 | PARTIAL | **PARTIAL** | 仍 `colorTheme`/`desktopPreferences`（App.tsx:694,2554,2642），官方是 `theme`/`electron-persisted-atom-state` |
| 45 | 登录/账号 | MISSING | **PARTIAL** | account/read|rateLimits|usage 只读真实；无 login/logout/切换 |
| 46 | 系统通知中心/自动更新/窗口状态 | MISSING | **MISSING** | 无 tauri notification/updater/window-state 插件 |
| 47 | 实时语音 / command-exec / process / 附件持久化 / 多窗口 | MISSING | **MISSING** | grep 0 命中（thread/realtime、command/exec、process/*、thread/attachment、detached window） |

---

## 2. 关键升级详情（证据）

### 2.1 协议参数正确化（v1 三个必坏点 + 审批）
- `turn/interrupt`：`{ threadId, turnId: activeTurnIdRef.current }`，不再在 finally 强制结束 streaming（App.tsx:2189-2206）。
- `turn/steer`：两处入口均 `{ threadId, expectedTurnId, input:[{type:"text",text}] }`（1813-1817、2208-2216），失败回退 `thread/queue/add` 再回退本地队列（2231-2249）。
- 权限档：`approvalPolicy ∈ {on-request,never}` + `approvalsReviewer ∈ {user,auto_review}` + `sandboxPolicy` 对象（1854-1862）；全仓库已无 `on-failure`。
- `turn/start` 只发送协议合法字段：threadId/cwd/input/model/effort/approvalPolicy/approvalsReviewer/sandboxPolicy/serviceTier（1894-1904），不再发送 temperature/topP/maxTokens 等被忽略字段。
- 审批：protocol.ts 精确 response builder（command/fileChange/permissions/userInput/elicitation/legacy）；ApprovalCenter 按 `classifyServerRequest` 分 5 类 + legacy 判定；`item/tool/call` 仍缺（7/10 覆盖）。

### 2.2 新子系统（v1 完全缺失 → v2 真实）
| 能力 | 证据 |
|---|---|
| 服务端 Goal | `threadGoal.ts`；App.tsx:1986,2114,2142,2154,2167 调 goalGet/goalSet/goalClear；完成→Inbox+提示音（2053-2085） |
| 服务端队列 | App.tsx:2293-2337（list/start/delete/add）、4151-4193（Up next 栏）；`thread/queue/changed` 刷新（1062-1066） |
| 自定义分区 | `threadSections.ts`；CodexSidebar 新建/重命名/删除/移动到分区（127-600） |
| 项目实体 | `projects.ts`（list/read/create/update/delete/move）；ProjectsIndexView 全量 UI（123-391） |
| 插件/市场/Apps | `plugins.ts`（25.7KB）；SkillsMcpView 去硬编码（33-70,1283-1900） |
| 自动化调度器 | `src-tauri/src/automations.rs`（1599 行：RRULE 解析、jitter、状态持久化、30s 扫描、执行 ensure_connected→thread/start→turn/start）；`lib.rs:813-815` 启动；17 单测 |
| 长会话分页 | `thread/turns/list`（limit/desc/itemsView）首屏 + cursor 上翻（App.tsx:1522-1590） |
| Code Review | review/start 四 target（uncommitted/branch/commit/custom）+ 内联会话（1693-1757） |
| fs/* + fs/watch | fsClient.ts 协议封装；DiffDrawer 文件 CRUD + watch；全局工作区 watch（App.tsx:1215-1230） |
| 原生菜单/托盘 | menu.rs（File/Edit/View/Window/Help + tray）+ App 统一 runShortcutAction dispatch + 250ms 去重（App.tsx:2568-2638） |
| Hooks 真实化 | hooksClient.ts（list + 实时事件）；SettingsView hooks 分区（3058-3470） |
| Windows 沙箱 | readiness 检测/安装/完成通知（App.tsx:1052-1056,1232-1250,2177-2187） |

### 2.3 SettingsView 22 分区判定（汇总，明细见 raw/settings-coverage.md）
- ✅ 真实 9：agent、storage、archived-chats、local-environments、providers-models、connections、import、experimental、account
- ⚠️ 部分 5：general-settings（编辑器/防休眠无消费方）、appearance（字号不持久化）、keyboard-shortcuts（不可改键）、hooks-settings（只读监控）、personalization（仅 instructions 真实）
- 🟡 假 UI 8：plugins-settings（硬编码 installedPlugins）、computer-use、appshots、browser-use、git-settings、worktrees（设置分区）、voice、pets

---

## 3. 旧审计 §28 20 条复核（摘要）

- ✅ **已修复 14 条**：#1 中断、#2 Steer、#3 on-failure、#4 会话参数、#5 无效 config 键、#6 Markdown 回调、#7 审批应答、#8 Inbox、#9 自动化运行、#14 SkillsMcp 三 tab、#15 fileChange 卡、#16 用量、#17 Ctrl+Enter、#19 fork 入口。
- ⚠️ **部分修复 3 条**：#10 语音（仍 Web Speech、设置无消费方）、#12 Settings 假开关（hooks 已真实化，其余 8 分区仍在）、#20 未用命令（5→4）。
- ❌ **仍存在 3 条**：#11 `@电脑` 仅文本、#13 Settings 已安装插件硬编码、#18 主题/偏好与官方 global state 不兼容。
- 完整逐条证据：`.ref/audit2/raw/old-section28-recheck.md`

---

## 4. 断链清单 v2 —— 当前仍“看着有、实际不完整/无效”

| # | 入口 | 位置 | 现状 |
|---|---|---|---|
| B1 | app-server `warning/configWarning/deprecationNotice/guardianWarning/error` 通知 | App.tsx:1162-1169 | 仅 console，用户不可见（配置告警/错误应有 UI） |
| B2 | Composer 附件（图片/文件） | App.tsx:1798-1802；ComposerBox 拖拽 | 仍把本地路径拼进 prompt 文本，协议 input 支持 `localImage`/`mention`/`skill` 未用 |
| B3 | `@电脑` / computer-use | 3 处插入文本 + Settings 8 个开关 | 无任何桌面控制执行路径；官方为独立 computer-use 插件 |
| B4 | Appshots | SettingsView:2883-2962 | 仅开关，无截图/视觉捕获 |
| B5 | Browser-use | SettingsView:2963-3057 + DiffDrawer iframe | 仅配置项 + iframe 预览；无 Playwright/浏览器自动化 |
| B6 | Voice | SettingsView:3639-3712 + ComposerBox:192-249 | 设置无消费方；听写仅 WebView Web Speech（WebView2 通常不支持） |
| B7 | Git 设置 | SettingsView:3479-3574 | 6 项偏好无消费方（git 行为本身真实，但设置不生效） |
| B8 | Worktrees 设置 | SettingsView:3575-3638 | 3 项偏好无清理执行器 |
| B9 | Settings 插件分区 | SettingsView:285-300, 2661-2780 | 硬编码 4 插件；真实插件页在 SkillsMcpView，设置页未迁移 |
| B10 | Settings Pets | SettingsView:1944-1984 | 装饰性选择；无官方 pets 插件安装/自定义 |
| B11 | 主题/偏好官方兼容 | App.tsx:694/2554/2642 | 自造 `colorTheme`/`desktopPreferences`，官方 `theme`/`electron-persisted-atom-state` 不互通 |
| B12 | 项目归属 | App.tsx:1866-1872 | `thread/start` 无 projectId 参数（CLI 限制），新建会话无法挂到项目实体，项目列表只统计已有 projectId 线程 |
| B13 | MarkdownView 富内容 | MarkdownView.tsx 全文件 | 回调已接线；但仍不支持表格/图片/引用/语法高亮/嵌套列表 |
| B14 | `item/tool/call` 动态工具 | protocol.ts classify 无分支 | server request 未处理（会落到 generic 应答） |
| B15 | 其余 ThreadItem 渲染 | App.tsx:3800-3817 | collabAgentToolCall / subAgentActivity / dynamicToolCall / sleep / enteredReviewMode / contextCompaction 无 UI |
| B16 | 附件持久化 | 0 引用 `thread/attachment/*` | 附件不随会话保存，刷新即丢 |
| B17 | 静默失败面 | 39 处 `catch (e) {` + 3 处 `catch {}` + 60 处 `console.warn` | 多数已有 UI 回退/错误态（plugins/hooks/projects/archive），但 account/sandbox readiness/fs unwatch/queue 等仍只 warn |
| B18 | `thread/items/list` 分页 | 0 引用 | 当前 CLI 0.159 返回 not supported（已知限制，记录在案） |
| B19 | 系统通知/自动更新/窗口状态/多窗口 | — | 无 notification/updater/window-state/detached-window 插件或实现 |
| B20 | 登录/登出 | — | 只能读已登录状态，不能登录/切换/退出 |

---

## 5. 官方有但当前仍缺失的能力（按价值排序）

1. **系统通知中心**：OS 级通知、免打扰、通知分区（官方 Notifications 设置分区）；本项目只有应用内 toast/Inbox。
2. **实时语音**：`thread/realtime/*` 全套（start/appendAudio/appendText/listVoices/stop + SDP/transcript 事件），官方 realtime-voice chunk 可证；本项目 0 引用。
3. **附件持久化与富输入**：`thread/attachment/{add,list,remove}` + `localImage`/`mention`/`skill` input；当前附件仅文本。
4. **computer-use / Appshots / Browser 真实执行**：官方为独立插件生态；本项目仅有设置开关/iframe。
5. **账号生命周期**：`account/login/start|cancel`、`account/logout`、billing；当前只读 account/read。
6. **服务端命令与后台进程**：`command/exec`（可写 stdin/挂后台）+ `process/*`；当前只有本地 PTY。
7. **动态工具与协作 Agent 可视化**：`item/tool/call` 应答、`collabAgentToolCall`/`subAgentActivity` item 渲染。
8. **Markdown 富内容**：表格/图片/引用/语法高亮（官方 renderer 支持）。
9. **多窗口/Quick Chat**：官方 detached-window / quick-chat 独立窗口；本项目单窗口。
10. **可编辑 keymap**：官方 161 命令注册表 + 设置改键 + 菜单 accelerator 动态生成；本项目注册表只读展示。
11. **官方设置分区补齐**（约 20 个）：Notifications、Security、Profile、Ads/Parental/Trusted/Safety、Billing、Analytics、Debug、Agreements、Teams、File type handlers、Passwords、Computer history、Codex Micro、Cloud computer、Browser extension、Cloud preferences、Codex Cloud、Cloud environments。
12. **Hooks 写入/trust 管理**：目前只读 list + 实时事件。
13. **其他协议能力**：memory/status|reset、feedback/upload、userVerification/*、remoteControl/*、server/diagnostics、rollout/compress、permissionProfile/list、thread/loaded/list、unsubscribe、backgroundTerminals、timeline、approveGuardianDeniedAction。
14. **自动更新 / 开机自启 / 窗口位置持久化**。

> 注：官方 48 分区中约 20 个属于云账号/企业/计费/合规类（Cloud/Teams/Billing/Analytics/Ads/Parental 等），对一个 local-first 客户端可判为“范围外”；但这些至少应在文档/README 中标注。

---

## 6. 真实度统计（与 v1 对比）

### 6.1 功能点级（v2 重新清点 127 点；明细 `.ref/audit2/raw/feature-matrix.csv`）
| 结论 | v2 数量 | v2 占比 | v1 数量 | v1 占比 |
|---|---|---|---|---|
| REAL | **74** | **58.3%** | ~58 | ~33% |
| PARTIAL | **10** | **7.9%** | ~57 | ~33% |
| MOCK/BROKEN | **11** | **8.7%** | ~45 | ~26% |
| MISSING | **32** | **25.2%** | ~15 | ~8% |
| 合计 | 127 | 100% | ~175 | 100% |

口径说明：v2 将大量 v1 的 PARTIAL（审批、流式、队列、Goal、分区、项目、插件、菜单等）升级为 REAL，并把“只有设置开关”的功能统一归到 MOCK（11 个功能点，对应 8 个设置分区 + @电脑/语音/browser）；MISSING 上升是因为 v2 把此前未清点的官方能力（实时语音、附件、command/exec、process、collab、云/账号/系统集成等）全部纳入统计。两版分母不同（v1 拆得更细），**看比例趋势与模块级对比更可靠**。

### 6.2 模块级（对齐 v1 的 32 模块口径 + 新增模块，共 36 模块）
| 结论 | v1 模块数 | v1 占比 | v2 模块数 | v2 占比 |
|---|---|---|---|---|
| REAL | 8 | 25% | **16** | **44%** |
| PARTIAL | 16 | 50% | **14** | **39%** |
| MOCK | 6 | 19% | **4** | **11%** |
| MISSING | 2 | 6% | **2** | **6%** |

### 6.3 Settings 分区
- 本项目 SettingsView：22 分区 = 真实 9 / 部分 5 / 假 UI 8 / 缺失 0。
- 官方命名 45 分区（docs 称 48），按“该分区对应能力是否真实可用”映射：**真实 10（22%）/ 部分 11（24%）/ 仅假 UI 5（11%）/ 完全缺失 19（42%）**。

### 6.4 协议覆盖
| 指标 | Round 初始 | v2 现在 | 协议目录（0.159 稳定） | 覆盖率 |
|---|---|---|---|---|
| 前端引用的 client RPC 方法 | 17（含 Rust 桥） | **71**（+Rust 桥 3 = 74） | 104 | 68-71% |
| 其中 experimental-gated | — | 12（project/*、queue/*、thread/search、thread/settings/update） | — | 已在隔离 CODEX_HOME 实测可用 |
| 消费的 server 通知 | 8 | **35**（32 常量 + 3 raw） | 83 | 42% |
| handle 的 server request 类 | 1（且应答错误） | **7** | 10 | 70% |
| Tauri 命令（注册/使用） | 64 / 59 | **68 / 64** | — | 未用 4 |
| Tauri 事件监听 | 5 | **10** | Rust emit 11 | 未监听 stderr/server-request-resolved |
| SettingsView 分区 | 20 | **22** | 官方 45 | 真实 9 |

---

## 7. 新发现的剩余风险

1. **协议版本双源差异**：v2 使用的 12 个方法在 0.159 “稳定 schema”中标记 experimental（project/*、queue/*、thread/search、thread/settings/update），需 `--experimental` 或运行时支持；实施日志记录已在隔离 CODEX_HOME 实测 28/28 通过，但换更老 CLI 会降级不可用（UI 大多有 fallback）。
2. **并发改造后的回归面**：本轮改动极大（App.tsx 1.1k→4.3k 行；SettingsView 1.9k→4.4k 行），`npx tsc --noEmit` 通过，但 v2 审计未重跑 `npm run build`/`cargo check`（只读约束）；建议收尾前重跑一次。
3. **静默失败**：39 处 `catch (e)` 内只有 console.warn；协议失败时用户可能看不到任何提示（部分页面已加错误态）。
4. **本地状态与官方 global state 分叉**：`inboxItems`/`colorTheme`/`desktopPreferences` 均写 `.codex-global-state.json` 的自造键，与官方桌面端不同步；官方桌面端同时打开时可能覆盖/忽略。
5. **调度器仅前台**：应用退出后自动化不执行；重启会对过期 nextRunAt 补跑一次（已知限制）。
6. **Code Review/插件 Apps 依赖账号权限**：app/list 在本机账号 403（有 fallback）；review 依赖服务端能力。
7. **未使用命令/死代码**：4 个未用 Tauri 命令；`ComposerControlPills.tsx` 仍是未被引用的死组件（10.8KB）。

---

## 8. 建议的收尾优先级

**P0（功能真实性收口）**
1. Settings 剩余 8 个假分区二选一：接真实后端（computer-use/appshots/browser 需插件/执行器；git/worktrees/voice/plugins 可接对应协议或把开关隐藏）或明确标注“仅本地偏好/暂不可用”。
2. 附件改为协议 input（localImage/mention/skill），或明确提示“仅以路径文本附加”。
3. preview 富渲染（Markdown）与 app-server warning/error UI。
4. 重跑 `npm run build` + `cargo check` +（可选）`cargo test automations` 并更新基线。

**P1（补官方高价值缺口）**
5. 系统通知中心 + 通知设置分区。
6. 附件持久化（thread/attachment/*）。
7. `item/tool/call` 与 collab/subAgent 渲染。
8. 登录/登出（account/login|cancel|logout）。
9. 可编辑 keymap（官方 161 命令注册表）。

**P2（可选/范围外）**
10. 实时语音、computer-use、Appshots、Browser、command/exec+process、多窗口/Quick Chat、自动更新、窗口状态、云/团队/计费类设置分区（可标注为范围外）。

---

## 9. 复现方式

```powershell
cd D:\Repos\codex-desktop-native
git rev-parse HEAD                                    # a193da289e16f018440fe2afbc4f75abba298656
pwsh -NoProfile -File .ref/audit2/raw/stats.ps1       # 生成方法/通知/命令/事件/设置统计
npx tsc --noEmit                                      # 本次审计实测 exit 0
# 旧 §28 复核：.ref/audit2/raw/old-section28-recheck.md
# 设置覆盖：  .ref/audit2/raw/settings-coverage.md
# 功能矩阵：  .ref/audit2/raw/feature-matrix.csv
```



