# CURRENT-AUDIT — codex-desktop-native 前端功能真实度逐项审计

> 审计对象：`D:\Repos\codex-desktop-native`（Tauri v2 + React 19 原生 Codex 客户端）
> 审计时间：2026-10-23
> 审计范围：`src/**`（前端全部源码）+ `src-tauri/src/**`（Rust 后端全部源码）
> 判定依据：源码阅读 + grep 调用链 + 本机真实 Codex CLI 协议实测（见 §0.4）
> 只读审计：**未修改任何 `src/`、`src-tauri/`、`package.json` 等源码/配置文件**；仅新增 `.ref/audit/`。

---

## 0. 方法、基线与图例

### 0.1 功能判定图例

| 标记 | 含义 |
|---|---|
| **REAL** | UI 动作真的调用 Tauri command 或 app-server JSON-RPC（或监听了对应通知），数据来自真实文件 / Git / 进程 / app-server；行为可观察、可持久化 |
| **PARTIAL** | UI 与后端都存在，但只覆盖一部分场景；或数据半真半假；或存在会静默失败/参数不合法的路径 |
| **MOCK** | 只有 UI；数据硬编码、只改本地 React state、只写本地自定义 JSON / localStorage、按钮无实际效果 |
| **MISSING** | 官方（参考实现 / app-server 协议）有，本项目完全没有 |
| **BROKEN** | 接线存在，但按当前协议实测会稳定失败（点得动、结果报错或静默无效） |

### 0.2 环境与版本基线（决定协议结论的关键前提）

| 项 | 实测值 |
|---|---|
| 本机全局 `codex` CLI | **codex-cli 0.159.0**（`C:\Users\lus\AppData\Roaming\npm\codex.cmd`） |
| 官方离线包内置 CLI | `C:\Users\lus\AppData\Local\OpenAI\Codex\bin\896a0166b774037a\codex.exe`，握手返回 `userAgent: .../0.163.0-alpha.10.2` |
| 本项目 app-server 启动命令 | `codex app-server --listen stdio://`（`src-tauri/src/app_server.rs:167-173`） |
| 本项目二进制解析顺序 | 自定义路径 → 环境变量 `CODEX_CLI_PATH` → exe 同目录候选 → `%APPDATA%\npm\codex.cmd` → `"codex.cmd"`（`app_server.rs:88-130`）→ **默认实际启动的是 0.159.0** |
| 协议基准 | `codex app-server generate-json-schema --experimental`（0.159.0）：**167 个 client request / 83 个 notification / 11 个 server request**；非 experimental 为 104/83/11。生成物在 `.ref/audit/schema/` |
| 真实用户数据 | `~/.codex/`（`config.toml`、`automations/`、`skills/`、`.codex-global-state.json`、`sessions/`）全部存在，可用于对照 |

### 0.3 本次审计使用的实测手段（结论可复现）

1. `codex app-server generate-json-schema --experimental --out .ref\audit\schema` → 协议全量 schema。
2. 以重定向 stdio 方式启动 app-server，实测以下调用的真实返回（证据见 §0.4 与 `backend-surface.md` §6）：
   `initialize / thread/list / turn/interrupt / turn/steer / turn/start / thread/read / thread/name/set / model/list / skills/list / mcpServerStatus/list`。
3. `codex app-server --strict-config` + 临时 `CODEX_HOME`，逐个验证 `config.toml` 键是否被 codex 识别。
4. 对照官方桌面端真实数据：`~/.codex/.codex-global-state.json`（49 个顶层键）、`~/.codex/automations/*/automation.toml`。
5. 官方 renderer chunk 名单：`.ref/renderer-asset-filenames.txt`（用于确认官方存在哪些功能模块）。

### 0.4 协议实测硬证据（★后文多处引用）

| 实测请求 | app-server 真实返回 |
|---|---|
| `turn/interrupt` params `{threadId:"bogus"}` | `{"code":-32600,"message":"Invalid request: missing field \`turnId\`"}` |
| `turn/steer` params `{threadId,input}`（缺 expectedTurnId） | `Invalid request: missing field \`expectedTurnId\`` |
| `turn/steer` params `{threadId,text}`（本项目 `handleSteerTurn` 的写法） | `Invalid request: missing field \`input\`` |
| `thread/start` / `turn/start`，`approvalPolicy:"on-failure"`（本项目“自动”模式的映射值） | `Invalid request: unknown variant \`on-failure\`, expected one of \`untrusted\`, \`on-request\`, \`granular\`, \`never\`` |
| `turn/start` 携带 `temperature/topP/maxTokens/webSearch/allowNetwork/outputVerbosity` | 参数可反序列化（未知字段被忽略），随后因假 threadId 报 `thread not found` → **这些超参数根本不生效** |
| `config.toml` 写入 `temperature/top_p/max_output_tokens/context_window/web_search_mode/allow_network/max_parallel_tools/subagent_concurrency/output_verbosity` | `--strict-config` 报错：`unknown configuration field \`temperature\``（其余 9 个同）→ **Settings 里 10 个关键参数写进 config 也不会被 codex 读取** |
| `config.toml` 写入 `model/model_provider/model_reasoning_effort/approval_policy/sandbox_mode/model_catalog_json/instructions` | `--strict-config` 通过 → 这几个键才是真实有效的 |
| `model/list`（真实环境） | 返回 7 个真实模型：`gpt-6.1-sol, gpt-6-astra, gpt-6-sol, gpt-6-luna, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna`（`gpt-5.4`、`gpt-5.3-codex` **不存在**） |

### 0.5 全局结论（先看这里）

- **真正接通的“硬功能”集中在 5 块**：Git 全链路（status/diff/stage/commit/push/PR/worktree）、PTY 终端、文件系统浏览/预览/写入、线程列表+恢复+重命名+置顶/归档/删除（Rust 侧落盘）、app-server 流式回复渲染骨架。
- **最大面积的问题是“设置/开关类 UI 90% 只写自定义 JSON 不产生任何效果”**：`desktopPreferences` 一个键里塞了约 45 个开关，其中 computer-use / appshots / browser-use / hooks / git 策略 / worktree 策略 / plugins / voice / 个性化语气 全部**没有任何消费方**（写入后无人读取执行）。
- **第二大类是“协议参数写错但被 try/catch 吞掉”**：中断、Steer、审批策略、UserInput 应答、Hyperparameter 都是此类；UI 看起来正常、实际请求被拒。
- **第三大类是“纯前端伪造/一次性状态”**：Inbox（内存数组，重启即空）、用量 popover（本地计数）、@电脑/computer-use（只是插入一段文本）、plugins/apps/marketplaces（硬编码数组+写技能文件冒充安装）、MiniPet（纯装饰）。
- **缺失的大块**：登录/账号（account/*）、按 turn/items 分页、会话 fork/revert/compact、项目实体（project/*）、真实插件市场（plugin/marketplace/*）、线程分组 section、Token/上下文用量（thread/tokenUsage/updated）、真实 Goal（thread/goal/*）、自动化的**调度执行器**、桌面系统通知。
- **未发现**：源码内没有 `TODO/FIXME`、没有 `demo/mock` 字面量、**没有 `setTimeout` 假进度条**（唯一的倒计时是 Goal 真实 3 秒自动续跑）。本项目的“假”主要来自**硬编码数组 + 只落本地 JSON + 协议参数错误**，不是伪造进度。

---

### 0.6 审计快照与并行改动声明（★重要）

- **快照 S1**：本报告的源码阅读基于 `HEAD = fad9129`（工作树在 2026-10-23 ~06:50 时的内容）。文中所有 `文件:行号` 均为 S1 位置。
- **并行改动**：报告撰写期间（06:53-06:57）另一并行任务开始向工作树落改动，`git status` 已显示：
  - 新增 `src/protocol.ts`（app-server 类型 + 各 server request 的**正确 response builder**）、`src/components/ApprovalCenter.tsx`（按 method 分类型的审批/提问 UI）；
  - 修改 `src/App.tsx`、`src/styles.css`（未提交）。
- **已被并行改动覆盖/改善的审计项**（本报告对应位置已加注）：① `app_server_pending_requests` 已接入（重载后恢复挂起审批）；② 已监听 `serverRequest/resolved`、`thread/tokenUsage/updated`、`thread/name/updated`、`thread/archived|deleted|unarchived`、`warning/configWarning/error` 等通知；③ 审批 UI 改为 `ApprovalCenter`，command/fileChange/permissions/requestUserInput 四类应答已按协议实现（`protocol.ts` 内 `userInputResponse` 为 `{answers:{[qid]:{answers:[]}}}`）。
- **并行改动尚未覆盖（本报告结论仍有效）**：`turn/steer`/`turn/interrupt` 参数、`on-failure` 审批策略、`turn/start` 超参数、`MarkdownView` 回调、`fileChange` 渲染、Settings 大面积“只写 JSON”、Inbox 持久化、自动化调度器、登录/账号、插件/市场等。
- **建议**：待并行任务提交后，对本报告 §6 / §24 / §28 再核对一次（其余章节不受影响）。本报告不对未提交并行改动的质量做判定。

---
## 1. 总览矩阵

| # | 模块 | 结论 | 一句话证据 |
|---|---|---|---|
| 1 | Home 首页 | **PARTIAL** | 真实项目/线程数据 + 真 Composer；但 4 张建议卡是硬编码 `STARTER_PROMPTS`（App.tsx:61-82），"项目名"为空时回退硬编码 `"codex-app-offline"`（App.tsx:1609-1612） |
| 2 | Composer 输入框及全部控件 | **PARTIAL** | 发送/停止/模型/推理/权限/分支/WT/附件/听写均有后端；但“自动”权限模式映射非法值 `on-failure`→**BROKEN**（App.tsx:1013-1018），Plan 模式只是 prompt 前缀（960-962），附件只拼路径文本（956-963） |
| 3 | 消息流与 turn/item 渲染 | **PARTIAL** | 流式骨架真实（App.tsx:539-700）；但只渲染 5 类 item，`fileChange` 字段取错（2556-2578），`turn/completed` 丢弃 items，reasoning/plan/webSearch/mcp 等不渲染 |
| 4 | 工具调用 / 命令输出展示 | **PARTIAL** | `commandExecution` 输出卡真实（2517-2554）；但 MCP 工具调用、dynamicToolCall、webSearch、imageGeneration 等完全不渲染 |
| 5 | 审批交互 | **PARTIAL** | S1 快照：只对 command/fileChange 审批的 `{decision:"accept"}` 正确；UserInput/permissions/tool/elicitation 应答错误（App.tsx:1343-1376, 2622-2752）。**06:54 后并行改动**已新增 `ApprovalCenter`+`protocol.ts` 修复四类（见 §0.6/§6），legacy/tool-call/elicitation 仍缺 |
| 6 | Diff 审阅 DiffDrawer | **REAL**（局部受限） | 4 个 tab；git 操作全部走 `invoke(git_*)` 真实命令（DiffDrawer.tsx:236-346），文件浏览/编辑真实；browser tab 只是 `<iframe>`（1040-1047），PR 依赖外部 `gh` |
| 7 | 侧边栏与工作区 | **REAL** | workspace_list/add/remove/set_active + threads_meta_get 真实落盘 `~/.codex/.codex-global-state.json`（state.rs:100-403）；本地过滤搜索而非协议搜索 |
| 8 | 线程列表/置顶/归档/删除 | **REAL** | thread/list 真实；pin/archive/delete 由 Rust 调 app-server + 写 global state（lib.rs:210-288） |
| 9 | ProjectsIndexView | **PARTIAL** | 只是 workspace 根目录的表格视图；官方 project 实体（`project/*`、`local-projects`、`thread-project-assignments`）未使用，项目重命名/顺序/颜色均缺失 |
| 10 | InboxView | **MOCK** | 完全内存态（App.tsx:220, 706-718, 1203-1228）；仅“审批”“Goal 完成/超轮”会入箱；重启即空，无持久化，自动化运行通知从未产生 |
| 11 | AutomationsView | **PARTIAL** | `automation.toml` CRUD 真实（config_skills.rs:596-755）；但**没有调度器/执行器**、无运行历史、RRULE 不解析；`立即运行` 只是前端开一个会话（App.tsx:2211-2236），关闭应用即不跑 |
| 12 | WorktreesView | **REAL** | git worktree list/create/delete 真实（git.rs:393-657），`~/.codex/worktrees/<4位>/<repo>` 与官方一致的目录结构 |
| 13 | SkillsMcpView | **PARTIAL** | 技能库（`~/.codex/skills`）与 MCP 配置/状态真实（config_skills.rs:452-594; SkillsMcpView.tsx:160-344）；plugins/apps/marketplaces 三个 tab 是硬编码数组（25-130） |
| 14 | SettingsView（20 个 section） | **PARTIAL/MIXED** | 逐节见 §14；真实：app-server 重启、config.toml 读写、主题、存储统计、归档、本地环境、MCP、导入 Claude/Cursor；**纯写 JSON 无效果：computer-use/appshots/browser-use/hooks/git/worktree/plugins/voice/个性化语气** |
| 15 | QuickSearchModal | **PARTIAL** | Ctrl+K 真实弹窗；搜索源是已加载的前端数组（线程≤60、文件 hits≤80、技能），未接 `thread/search`、`fuzzyFileSearch` |
| 16 | ComposerAutocomplete | **PARTIAL** | @ 文件/@技能来自真实 workspace/skills；slash 命令多是提示词模板，`/review` `/compact` `/init` `/test` 未走协议，`@电脑` 只插入文本 |
| 17 | TerminalDock | **REAL** | xterm + portable-pty + 3 个 Tauri command + 2 个事件（terminal.rs:58-223; TerminalDock.tsx:53-198） |
| 18 | GoalProgressBanner / GoalSetupModal（goal runner） | **PARTIAL（自研替代）** | 前端状态机+prompt 注入+真实 shell 验证（App.tsx:1095-1290, 2105-2161）；未用官方 `thread/goal/*`；刷新/重启丢失状态与进度 |
| 19 | MiniPetWidget | **MOCK** | 纯装饰+快捷提问（MiniPetWidget.tsx 全文件）；官方是真实 Pets 插件生态 |
| 20 | NavigationRail | **REAL** | 9 个路由跳转 + app-server 连接状态点（NavigationRail.tsx:36-139） |
| 21 | WorkspacePopover | **REAL** | 真实工作区选择/移除/新建 + AGENTS.md 入口（WorkspacePopover.tsx:38-108） |
| 22 | MarkdownView | **PARTIAL** | 自研轻量渲染；主会话里 `onRunCommand/onOpenFile` **没有传入**（App.tsx:2580-2585），所以“运行代码块/点文件名打开”是死的；无表格/图片/语法高亮 |
| 23 | 通知 / 提示音 | **PARTIAL** | 应用内 toast + WebAudio 双音提示真实（App.tsx:134-164, 562, 1202）；无桌面系统通知、无通知设置、无未读持久化 |
| 24 | 用量 popover（📊） | **PARTIAL（并行改动中）** | S1 只显示本地 turns.length/模型名（App.tsx:1847-1879）；06:54 后已监听 `thread/tokenUsage/updated` 存入 state，但弹层尚未展示 token 数据；`account/usage/read` 仍未接 |
| 25 | 会话参数 popover（⚙️） | **MOCK** | 滑块只改前端 state（App.tsx:1895-2001），发送时塞进 turn/start 的非协议字段，服务端忽略（§0.4） |
| 26 | 会话导出/复制/清空 | **REAL**（本地） | Blob 下载 Markdown/JSON、剪贴板、重置（App.tsx:1481-1586）；无后端依赖，够用 |
| 27 | 全局快捷键 | **PARTIAL** | 仅 Ctrl+N/B/J/,/K 5 个真实（App.tsx:740-765）；Settings 里列的快捷键是静态文本，不可改；宣称的 `Ctrl+Enter 提交 Git` 未实现 |
| 28 | 语音输入（Mic） | **PARTIAL** | 浏览器 Web Speech API（ComposerBox.tsx:188-249），WebView2 大概率不支持→alert；Settings 的 voice 配置完全未被读取 |
| 29 | `@电脑` / computer-use | **MOCK** | 各处都只是往输入框插入文本 `@电脑 `（ComposerBox.tsx:722-734; ComposerAutocomplete.tsx:133-147; MiniPetWidget.tsx:116） |
| 30 | 浏览器使用 / Appshots / Hooks | **MOCK** | Settings 只有开关；DiffDrawer browser 是 iframe；项目内无截图、无浏览器自动化、无 hook 执行器 |
| 31 | 登录/账号/额度 | **MISSING** | 前端 0 处 `account/*`；不显示登录态/额度/重置时间；依赖用户已有 `~/.codex/auth.json` |
| 32 | 系统级能力（通知栏、托盘、自动更新） | **MISSING** | 无 tauri notification/autostart/updater 插件；capabilities 仅 core:default/event/window（src-tauri/capabilities/default.json） |

---

## 2. Home / 首页

文件：`src/App.tsx`

| 功能点 | 判定 | 证据 |
|---|---|---|
| 首页路由（activeRoute==="home" 或 turns 为空） | REAL | App.tsx:2282-2379 |
| 标题项目名（点击弹 WorkspacePopover 切换） | REAL | 2290-2317；项目名来自真实 `workspace_list`（321-324），空时回退硬编码 `"codex-app-offline"`（1609-1612） |
| 4 张任务建议卡 | **MOCK（硬编码）** | `STARTER_PROMPTS` 常量 App.tsx:61-82，纯静态文案，点击只填输入框（2364-2378） |
| 首页 Composer | PARTIAL | 复用 ComposerBox（2320-2361），见 §3 |
| Hero / 动效 / 布局 | REAL（纯 UI） | 2284-2318 |

## 3. Composer 及其所有控件

文件：`src/components/ComposerBox.tsx`（952 行）、`ComposerControlPills.tsx`、`ComposerAutocomplete.tsx`；状态与发送逻辑在 `App.tsx:911-1092`

| 控件 | 判定 | 证据 / 说明 |
|---|---|---|
| 输入/回车发送、流式中停止按钮 | REAL（发送）/ **BROKEN**（中断） | ComposerBox.tsx:401-405, 927-946；发送链路 App.tsx:911-1092 真实；停止按钮调 `handleInterruptTurn`→`turn/interrupt` 缺 `turnId`→服务端拒绝（App.tsx:1292-1304；实测 §0.4） |
| 项目切换 pill | REAL | ComposerBox.tsx:432-480 → `workspace_set_active` |
| 启动位置 pill（本地/新工作树） | REAL | 484-532；发送时 `git_worktree_create` 并把 cwd 指向新 worktree（App.tsx:994-1007） |
| Git 分支 pill：切换/新建 | REAL | 534-604 → `git_branch_checkout` / `git_branch_create`（App.tsx:822-854） |
| `+` 菜单：添加文件/图像 | PARTIAL | 追加到 `attachedFiles` 只是 chip；发送时只把 `[附加文件: path]` 拼进文本（App.tsx:956-963），**没有**用协议 `input:[{type:"localImage",path}]` / `mention` / `skill` |
| `+` 菜单：@电脑 | **MOCK** | 只插入字符串 `@电脑 `（ComposerBox.tsx:722-734） |
| `+` 菜单：计划模式 | **MOCK/PARTIAL** | 只切换 `planMode`，发送时加一行中文前缀（App.tsx:960-962）；未用 `collaborationMode`，也没有 plan item 渲染 |
| 权限 pill（请求批准/自动/完整） | **PARTIAL+BROKEN** | UI 与映射在 App.tsx:1009-1018；`ask→on-request`/`full→never` 合法，`auto→"on-failure"` **非法值**（实测必失败）。且 ComposerBox 文案“自动（工作区读写）”（113-118）与实际映射不符 |
| 模型+推理强度合并 pill | PARTIAL | 模型列表=`model/list` + 硬编码 `DEFAULT_MODELS` 合并（ComposerBox.tsx:72-97, 306-319）；`gpt-5.4`/`gpt-5.3-codex` 在真实 model/list 中不存在（§0.4），选中会失败。`effort` 字段本身是协议合法字段（turn/start `effort`），**推理强度是真实的** |
| 快速模式 Fast（serviceTier=priority） | PARTIAL | `serviceTier` 是协议字段（turn/start 合法），但“priority”是否被账户/模型支持未校验（App.tsx:1052） |
| 语音听写按钮 | PARTIAL | Web Speech API（ComposerBox.tsx:188-249），硬编码 `lang="zh-CN"`，不支持时 `alert`；Settings 的 5 个 voice 设置无人读取 |
| 拖拽文件到输入框 | PARTIAL | 拿到 `file.path`（WebView 下通常为空/E2E 受限），同“附件只拼文本”（ComposerBox.tsx:263-287） |
| @ 文件/技能自动补全 | PARTIAL | 真实数据源（fs_search_files / skills_list_local，App.tsx:384-417），但 `@电脑` 条目是假的；选中只插入文本 |
| / 斜杠命令 | PARTIAL | ComposerAutocomplete.tsx:30-107；`/goal /plan /fast /worktree /terminal /diff` 只是本地 UI 动作；`/review /init /test /compact` 只是提示词文本（官方分别对应 `review/start`、`compact/start` 等协议） |
| 流式中发送 → steer | **BROKEN** | `turn/steer` 缺 `expectedTurnId`（App.tsx:971-982）→ 请求被拒后 fallthrough 到普通发送流程（活动 turn 期间再 start 大概率报错）；`handleSteerTurn`（1306-1341）失败则落入 followup 队列。两个入口都不是真正的 steer |
| 附件 chips 删除/展示 | REAL（本地） | ComposerBox.tsx:660-676 |
| Enter 发送 / Shift+Enter 换行 | REAL | 401-405 |
| 占位文案“Alt+Enter 加入队列” | **MOCK** | handleKeyDown 根本没处理 Alt+Enter（383-405），队列无手动入队入口 |

## 4. 消息流、turn/item 渲染

文件：`src/App.tsx:539-700`（通知处理）、`2380-2754`（渲染）

| 功能点 | 判定 | 证据 |
|---|---|---|
| turn/started → 追加 running turn | REAL | 545-559 |
| turn/completed → 结束 streaming、时长、刷新 git/threads、提示音 | PARTIAL | 560-586；**不消费 `params.turn.items`**，若前面的 item 事件漏收，最终消息会缺失 |
| agentMessage 流式 delta | PARTIAL | 587-628；只追加到“最后一条 agentMessage”，不按 `itemId` 匹配，多个消息段会串在一起；兼容旧 `codex/event/agent_message_delta` |
| reasoning 流式 | PARTIAL | 629-652；只处理 `item/reasoning/delta`（协议中不存在）与 `summaryTextDelta`；漏 `item/reasoning/textDelta`、`summaryPartAdded` |
| commandExecution 输出 delta | REAL | 653-680；按 itemId 或“最后一条 commandExecution”追加 |
| item/started / item/completed 合并 | PARTIAL | 681-698；只合并到最后 turn 且按 id，字段不归一化 |
| 用户消息块（复制/编辑） | REAL（本地） | 2406-2444 |
| 思考折叠块 | PARTIAL | 2446-2515；思考内容仅 joined text |
| 命令输出卡（含 exit code） | REAL | 2517-2554 |
| 文件修改卡 | **PARTIAL（字段错误）** | 2556-2578：真实 `FileChangeThreadItem` 只有 `changes[]`（`path/diff/kind`），没有顶层 `path/insertions/deletions` → UI 永远显示“Modified file +0 -0”；点击后把 `undefined` 传给 preview |
| assistant Markdown 渲染 | PARTIAL | 2580-2585；未传 `onRunCommand/onOpenFile`（见 §22） |
| “复制回答/重新生成” | REAL（本地） | 2587-2616；重新生成=重发一条固定 prompt（非协议 regenerate） |
| 用户消息右侧跳转导航 | REAL（本地） | 2385-2403 |
| turn 时间显示 | PARTIAL | 2469-2479 只显示 durationMs；`startedAt/completedAt` 实际是秒（协议），被当毫秒存（normalizeTurnsFromThread 166-181） |
| 20+ 种 ThreadItem 类型覆盖 | **PARTIAL** | 只渲染 userMessage/agentMessage/reasoning/commandExecution/fileChange；`plan / mcpToolCall / dynamicToolCall / webSearch / imageView / imageGeneration / collabAgentToolCall / subAgentActivity / sleep / enteredReviewMode / contextCompaction` 全无 UI |

## 5. 工具调用 / 命令输出展示

| 功能点 | 判定 | 证据 |
|---|---|---|
| shell 命令卡（命令、输出、exit code、运行中状态） | REAL | App.tsx:2517-2554（`aggregatedOutput` 兼容） |
| MCP 工具调用卡 | MISSING | 无任何 `mcpToolCall` 渲染（grep `item/mcpToolCall` = 0） |
| 动态工具/协作 Agent 调用卡 | MISSING | — |
| Web 搜索卡 | MISSING | — |
| 图片生成/查看 | MISSING | — |
| 终端交互（terminalInteraction） | MISSING | 未监听 `item/commandExecution/terminalInteraction` |
| 行内文件链接/代码块点开 | DEAD（未接线） | MarkdownView 支持回调（MarkdownView.tsx:4-8, 60-98），但 App 调用处没传（App.tsx:2580-2585） |

## 6. 审批交互（★重点）

文件：`src/App.tsx:1343-1376`（应答）、`2622-2752`（UI）

| 场景 | 判定 | 证据 / 实测 |
|---|---|---|
| 收到 server-request → pendingRequests + Inbox | REAL | 702-720（`app-server:server-request`） |
| command 执行审批（`item/commandExecution/requestApproval`） | REAL | 应答 `{decision:"accept"/"acceptForSession"/"decline"}` 与 schema 一致（CommandExecutionRequestApprovalResponse：required decision） |
| 文件修改审批（`item/fileChange/requestApproval`） | REAL | 同上 |
| 用户提问 `item/tool/requestUserInput` | **BROKEN** | UI 用 `{answers:[optVal], selected:optVal}`（2658-2663, 2687-2690, 2701-2704），协议要求 `{answers:{<questionId>:{answers:[...]}}}`（answers 为 object，key=question id）→ 应答必被拒绝/请求悬挂 |
| 权限追加审批（`item/permissions/requestApproval`） | **BROKEN** | 走通用 `{decision}` 分支（2714-2751），协议要求 `{permissions:{...}}` |
| 旧版审批（`execCommandApproval` / `applyPatchApproval`） | **BROKEN** | 需要 `{decision:"approved"/"approved_for_session"/"denied":{...}/"abort"}`，本项目发 `"accept"` |
| 动态工具调用（`item/tool/call`） | **BROKEN** | 需要 `{success, contentItems}` |
| MCP elicitation（`mcpServer/elicitation/request`） | **BROKEN/MISSING** | 需要专属 response，本项目不展示专属 UI |
| 审批：允许一次/本会话允许/拒绝按钮 | REAL（仅上述 2 类） | 2725-2749 |
| 审批请求在刷新/重连后恢复 | PARTIAL（并行改动已接） | S1 快照：Rust 有 `app_server_pending_requests`（lib.rs:100-105）但前端从未调用；06:54 后并行改动已接入 `refreshPendingRequests()` |
| serverRequest/resolved 事件同步 | PARTIAL（并行改动已接） | Rust emit `app-server:server-request-resolved`（app_server.rs:403）；S1 未监听，06:54 后已监听 |

> **并行改动注（06:54 后工作区）**：新增 `src/components/ApprovalCenter.tsx` + `src/protocol.ts`，已按协议实现 command / fileChange / permissions / requestUserInput 四类应答（`protocol.ts:144-195` 与 schema 一致），旧通用卡片被替换。**仍缺**：legacy `execCommandApproval`/`applyPatchApproval` 的 `approved/approved_for_session/denied` 词表、`item/tool/call`（需 `{success,contentItems}`）、`mcpServer/elicitation/request` 的专属应答。

## 7. Diff 审阅（DiffDrawer）

文件：`src/components/DiffDrawer.tsx`（1073 行）

| 功能点 | 判定 | 证据 |
|---|---|---|
| 打开/关闭右侧抽屉、4 tab | REAL | App.tsx:2850-2861; DiffDrawer.tsx:102-104 |
| working/staged/branch 三态 diff | REAL | 177-207 → `git_diff`（git.rs:250-298） |
| commits 历史 + 单提交 diff | REAL | 179-195 → `git_log_commits` / `git_commit_diff` |
| 逐文件 stage/unstage/discard | REAL | 236-264 → `git_stage/unstage/discard` |
| commit（输入说明→提交） | REAL | 266-279 → `git_commit_changes` |
| push（含 force-with-lease 开关） | REAL | 281-292 → `git_push_changes` |
| 创建 PR（title/body/base/draft） | REAL（依赖 gh CLI） | 294-314 → `git_create_pr`（git.rs:745-780 调 `gh pr create`）；前端**未先检查 `gh_status`**，未安装 gh 时报错 toast |
| unified/split 布局、diff 行解析 | REAL（本地） | parseUnifiedDiff 43-89；split 只是 CSS 双栏 |
| 行内评论 → 发给 Codex | PARTIAL | 799-830 把评论作为聊天消息发送，非官方 diff comment 协议 |
| commits 列表/差异 | REAL | 181-192 |
| files tab：目录浏览/搜索/预览/编辑保存 | REAL | 209-229, 316-346 → fs_list_dir/fs_search_files/fs_read_preview/fs_write_file |
| summary tab：会话变更文件/工件/命令汇总 | PARTIAL | 350-1007 从本地 turns 推导，仅当前会话内存数据；“工件”用正则从 markdown 抽代码块 |
| browser tab：iframe 预览 localhost | PARTIAL | 1010-1070，`<iframe src>`；无浏览器自动化、无 console/截图/元素检查；“发送反馈”只是拼字符串发给聊天 |
| 变更文件点击可在文件预览打开 | PARTIAL | 2556-2563 fileChange 卡把 `fc.path`（不存在）传出 |
| git 状态徽标 +N/-N（顶栏） | REAL | App.tsx:2094-2099（来自 git_status） |

## 8. 侧边栏与工作区

| 功能点 | 判定 | 证据 |
|---|---|---|
| 顶栏 Codex 菜单（新聊天/项目/计划任务/插件/AGENTS/settings） | REAL（导航） | CodexSidebar.tsx:275-338 |
| 收件箱铃铛未读点 | PARTIAL | 未读数来自内存 inbox（App.tsx:1604-1607） |
| 搜索按钮 → Ctrl+K 弹窗 | REAL | CodexSidebar.tsx:259-272 |
| 新聊天 / 计划任务 / 插件与技能入口 | REAL（导航） | 356-390 |
| 置顶区 | REAL | 111-114, 394-402，pin 数据来自 `threads_meta_get` |
| 项目树（每个 workspace 展开子线程） | PARTIAL | 433-510；按 `thread.cwd`/`workspaceHints` 字符串包含匹配，非官方 project 实体；展开状态仅组件内存 |
| 最近区 + 独立会话过滤 | PARTIAL | 512-542；`recentFilterMode` 只影响本地过滤 |
| 线程行：重命名/归档/置顶/删除 | REAL | 165-234（App.tsx:1388-1461 全走 Rust） |
| 底部设置按钮 | REAL | 544-556 |
| 侧边栏折叠 | REAL（本地） | 88 `if (collapsed) return null`；Ctrl+B 切换 |

## 9. 线程列表 / 置顶 / 归档 / 删除

文件：App.tsx:430-441（list）、1388-1461（pin/rename/archive/delete）、Rust：lib.rs:210-288

| 功能点 | 判定 | 证据 |
|---|---|---|
| thread/list 拉列表（limit 60，无分页 cursor） | REAL | App.tsx:430-441；无 nextCursor 处理 → 超 60 条缺失 |
| 读取会话历史（thread/read includeTurns，失败回退 resume） | REAL | 888-908 |
| 重命名 | REAL | 1405-1417 → `thread/name/set`（协议合法） |
| 置顶/取消置顶 | REAL | 1388-1403 → Rust 写 `pinned-thread-ids`（state.rs:332-340），**纯本地**（官方也是本地） |
| 归档/取消归档 | REAL | 1419-1436, lib.rs:242-270：调 `thread/archive`/`thread/unarchive` + 写 `archivedThreads` |
| 彻底删除 | REAL | 1438-1461, lib.rs:272-288：`thread/delete` + `thread/archive` + 清本地记录 |
| 归档页恢复/彻底删除 | REAL | SettingsView.tsx:1399-1456 |
| 线程按项目分组（官方 project/section） | PARTIAL | 字符串路径匹配，非 projectId；官方 thread.list 返回 `projectId/section` 被忽略 |
| 线程搜索（官方 thread/search） | MISSING | 仅前端 include 过滤 |
| 线程已读状态（thread/list 返回 readStates） | MISSING | Rust 原样返回 `readStates`，前端未使用 |
| fork / revert / compact / unsubscribe | MISSING | grep 0 命中 |
| 长会话分页（thread/turns/list、thread/items/list） | MISSING | 一次 thread/read 拉全量（协议标注 deprecated full history） |

## 10. ProjectsIndexView（项目中心）

文件：`src/components/ProjectsIndexView.tsx`（253 行）+ App.tsx:2164-2178

| 功能点 | 判定 | 证据 |
|---|---|---|
| 项目表格（名称/路径/聊天数/操作） | PARTIAL | 数据=workspace 根目录（ProjectsIndexView.tsx:50-76）；不是官方 project 实体 |
| 新建项目（选文件夹） | REAL | 91-95 → `pick_folder_dialog` + `workspace_add` |
| 搜索名称/路径 | REAL（本地） | 50-57 |
| 展开项目内聊天 | PARTIAL | 59-76, 197-244（同样按 cwd 字符串匹配） |
| 打开目录 / 新建聊天 / 移除项目 | REAL | 165-193 |
| 项目重命名/顺序/图标/归档/云端项目 | MISSING | 无 UI；官方有 `project/update`、`project/move`、`project-order` |
| 拖拽排序、置顶项目（pinned-project-ids） | MISSING | 未读官方 global state 的这些键 |

## 11. InboxView（收件箱）

文件：`src/components/InboxView.tsx`（162 行）+ App.tsx:2179-2210

| 功能点 | 判定 | 证据 |
|---|---|---|
| 通知列表/未读/筛选/标已读/删除/清空 | **MOCK（纯内存）** | App.tsx:220 初始 `[]`；706-718 审批入箱；1203-1228 Goal 入箱；2182-2208 全部只 setState；无 `desktop_state_*`/后端持久化 |
| “计划任务运行报告 / 后台会话完成”通知 | **MOCK（永不产生）** | 无 automation 执行器，无 turn 完成入箱逻辑；InboxView.tsx:38 文案承诺的功能不存在 |
| 点击通知跳转线程 | PARTIAL | App.tsx:2200-2209（threadId 有则 selectThread） |
| 未读数在导航栏/侧边栏显示 | PARTIAL | 同一内存数组派生 |

## 12. AutomationsView（计划任务 / 长期目标）

文件：`src/components/AutomationsView.tsx`（441 行）；Rust：config_skills.rs:596-755

| 功能点 | 判定 | 证据 |
|---|---|---|
| 列表读取（扫描 `~/.codex/automations/*/automation.toml`） | REAL | config_skills.rs:597-617 |
| 新建/保存（写 automation.toml） | REAL（字段不全） | 708-747；只写 id/kind/name/prompt/status/rrule/execution_environment/cwds/model/reasoning_effort/updated_at；**漏官方 `version/target/created_at`**，`created_at/updated_at` 用 mtime 冒充 |
| 暂停/启用/完成/删除 | REAL | 111-130 → automation_save/delete |
| 预设模板 3 张 / 周期预设 4 个 | MOCK（硬编码模板） | AutomationsView.tsx:22-51（作为模板本身可接受，但不是后端数据） |
| 立即运行 | PARTIAL | 393-400 → App.tsx:2217-2233：goal 类走前端 GoalRunner，cron 类 startNewThread + 120ms 后发消息；**没有调度器，关掉应用不会按时运行** |
| RRULE 校验/下一次运行时间 | MISSING | 只存字符串，不解析 |
| 运行历史 / 运行日志 / 失败重试 | MISSING | 无 |
| 官方 automation 目标项目（target/project_id）/ 云端 automation | MISSING | 未解析 `target`；无 `cloud-automation-*` 对应 UI（官方 chunk 名单可证） |
| 后台调度执行器 | **MISSING（核心缺口）** | Rust 全库无 cron/timer 调度（grep 无命中）；官方 `~/.codex/automations/.run-jitter-salt` 表明有调度器 |

## 13. WorktreesView

文件：`src/components/WorktreesView.tsx`（252 行）；Rust：git.rs:393-657

| 功能点 | 判定 | 证据 |
|---|---|---|
| 列出 worktree（含 ~/.codex/worktrees 扫描） | REAL | WorktreesView.tsx:39-55；git.rs:393-521 |
| 创建（working-tree 含未提交改动/未跟踪文件，或指定分支） | REAL | 61-77；git.rs:524-643（apply diff + 复制 untracked） |
| 删除 | REAL | 79-91 |
| 打开目录 / 在 worktree 开终端 / 启动会话 | REAL | 202-233 |
| 绑定 owner thread | PARTIAL | 创建时传 ownerThreadId（App.tsx:997-1002），`git_worktree_set_owner` 命令未被前端使用（死代码） |
| worktree 保留期清理/归档 | MISSING | Settings 有策略开关但无执行器 |

## 14. SkillsMcpView

文件：`src/components/SkillsMcpView.tsx`（810 行）；Rust：config_skills.rs:452-594

| 功能点 | 判定 | 证据 |
|---|---|---|
| 技能列表（已安装 `~/.codex/skills` + 离线种子目录） | REAL | 160-172；config_skills.rs:496-546 |
| 技能编辑/保存 SKILL.md | REAL | 198-216 → skill_save_or_install（548-571） |
| 技能安装（从种子目录复制） | REAL | 218-234 |
| 技能卸载 | REAL | 236-246 → skill_delete（574-579） |
| 保存后刷新 app-server 技能缓存 | REAL | 206-209 → `skills/list {forceReload:true}` |
| 新建空白技能 | REAL（前端默认模板） | 485-494 |
| MCP 服务器配置读取（config.toml） | REAL | 174-177；config_skills.rs:147-280 |
| MCP 添加/启停/删除（写 config.toml） | REAL（未 reload） | 248-319 → config_update；**未调用 `config/mcpServer/reload`**，改动要重启 app-server 才生效 |
| MCP 实时状态（mcpServerStatus/list） | REAL | 179-191；但只用 `<pre>{JSON.stringify}</pre>` 原样展示（714-721） |
| 插件 tab（3 个"精选插件"） | **MOCK** | CURATED_PLUGINS 硬编码 25-56；“安装”= 写一个 SKILL.md（453-467），不是插件 |
| 应用连接器 tab（GitHub/Linear/Postgres/Playwright） | **MOCK** | APP_CONNECTORS 硬编码 58-95；“一键连接”= 往 config 写 MCP（751-759） |
| 市场 tab（4 个 MCP） | **MOCK** | MARKETPLACE_ITEMS 硬编码 97-130 |
| 真实插件系统（plugin/*、marketplace/*） | MISSING | `~/.codex/plugins`、`marketplaces` 真实存在；协议 plugin/list、plugin/install、marketplace/* 全部未用 |

## 15. SettingsView（20 个 section，逐个判定）

文件：`src/components/SettingsView.tsx`（2935 行）。持久化模型：一个巨型 `desktopPreferences` JSON + `config.toml`。
**关键事实**：`desktopPreferences` 是本项目自造键（`~/.codex/.codex-global-state.json` 中官方并无此键，官方是 `electron-persisted-atom-state`），且其中约 45 个开关**没有任何运行时消费方**（只写不读，见 §20 STUBS）。保存逻辑在 SettingsView.tsx:462-548。

| Section（行号） | 判定 | 说明/证据 |
|---|---|---|
| general-settings（780-895） | **PARTIAL** | ✅ app-server 连接状态真实（786-800）；✅ 自定义 CLI 路径 → `app_server_restart`（811-819）；❌ 默认编辑器（827-837）/防休眠（839-848）只写 prefs 无执行器；“恢复出厂”清 JSON（861-882） |
| import（2699-2868） | **PARTIAL** | ✅ Claude MCP 真正导入 config.toml（2759-2790）；✅ Cursor/Windsurf 规则读入 `customPersonaPrompt`（2719-2744/2832-2861，但**直接覆盖整个 desktopPreferences 对象**，会清掉其他偏好——bug）；❌ VS Code 快捷键只显示 count，宣称“兼容生效”是假的（2800-2822） |
| appearance（898-968） | **PARTIAL** | ✅ 25 个主题实时改 CSS 变量并持久化 `colorTheme`（34-60, 176-185, 903-943）；⚠️ 字号滑块只改当前 documentElement，不加载/不持久化（946-964）；主题键名与官方 `theme` 不兼容 |
| archived-chats（1399-1457） | **REAL** | 真实归档列表（threads_meta_get）+ 取消归档/彻底删除（1421-1449） |
| voice（2625-2698） | **MOCK** | 5 个语音设置只写 prefs（582-541 里），ComposerBox 听写完全不读它们 |
| storage（1321-1398） | **REAL** | storage_stats_get/clean_cache（440-442, 1355-1378）；统计真实扫描 `~/.codex`（config_skills.rs:844-877） |
| agent（971-1279） | **PARTIAL/MOCK（重灾区）** | ✅ model/model_provider/model_reasoning_effort/approval_policy/sandbox_mode/model_catalog_json/instructions 会写进 config.toml 且被 codex 识别（实测）；❌ temperature/top_p/max_output_tokens/context_window/web_search_mode/allow_network/max_parallel_tools/subagent_concurrency/output_verbosity **是 codex 不认识的配置键**（`--strict-config` 实测报 unknown field），保存只是往 config.toml 写噪声；3 个“预设卡”只是改前端 state（979-1039） |
| personalization（2871-2931） | **PARTIAL** | ✅ `customPersonaPrompt` → config `instructions`（真实生效）；❌ toneStyle/codeStylePref/userRoleTitle 只写 prefs，无人读取 |
| pets（1280-1320） | **PARTIAL** | ✅ 选择宠物/显示开关传到 MiniPetWidget 并持久化（App.tsx:504-505）；但宠物本身是装饰（§19） |
| keyboard-shortcuts（1497-1525） | **MOCK** | 7 条硬编码文本（1502-1509），不可编辑；其中“Ctrl+Enter 提交 Git”未实现 |
| providers-models（1528-1691） | **REAL** | ✅ 自定义 model_providers 增删 → config.toml（367-402）；✅ 生成 models-api.json 模板（`config_generate_models_api`，757-806，内含硬编码示例模型）；✅ raw TOML 编辑/校验/保存（638-652） |
| connections（1692-1980） | **REAL（+弱检测）** | ✅ MCP 增删改查 + 预设一键填入；⚠️ “测试”按钮对远程 URL 直接写“已响应”（553-554，假检测），stdio 用 `command --help` 粗测（556-565） |
| plugins-settings（1981-2100） | **MOCK** | 市场 URL/自动更新/信任/沙箱只写 prefs；已安装插件是硬编码 4 个（285-290），启停只改本地数组，无 plugin 后端 |
| computer-use（2101-2202） | **MOCK** | 6 个开关只写 prefs（518-523）；项目内无任何 computer-use 执行路径（官方为真实插件生态） |
| appshots（2203-2282） | **MOCK** | 5 个开关只写 prefs（524-528）；无截图能力 |
| browser-use（2283-2377） | **MOCK** | 6 个开关只写 prefs（529-534）；DiffDrawer 的 browser 只是 iframe |
| hooks-settings（2378-2464） | **MOCK** | 4 个 hook 命令只写 prefs（535-539）；Rust 无 hook 执行器，未读 `~/.codex/hooks.json`，未用协议 `hooks/list` |
| git-settings（2465-2560） | **MOCK** | 分支前缀/默认分支/签名/空白/Conventional/自动暂存只写 prefs；DiffDrawer/git.rs 均不读取 |
| worktrees（2561-2624） | **MOCK** | 保留天数/共享缓存/自动提交只写 prefs；Rust 无清理任务 |
| appearance 之外的 20 个 nav 项 | — | 见上；另有 `voice`/`pets` 等 |

**Settings 额外问题**：
- 保存横幅文案宣称“已保存至 `~/.codex/config.toml` 及 `desktop-state.json`”（543），实际写的是 `.codex-global-state.json` 里的自定义键，且大量字段无消费方 → 文案具误导性。
- 主题键 `colorTheme`、偏好键 `desktopPreferences` 与官方 global state 的 `theme`、`electron-persisted-atom-state` 不兼容（见 backend-surface.md §7）。

## 16. QuickSearchModal（Ctrl+K）

文件：`src/components/QuickSearchModal.tsx`（392 行）

| 功能点 | 判定 | 证据 |
|---|---|---|
| 全局快捷键 Ctrl+K 打开/关闭 | REAL | App.tsx:758-761, 2886-2914 |
| 键盘上下/回车/Esc | REAL | QuickSearchModal.tsx:308-326 |
| 快捷动作：新聊天/运行/测试/构建/项目/设置 | REAL | 76-143（终端动作为真实 PTY） |
| 线程搜索 | PARTIAL | 155-177，只搜已加载的 ≤60 条 |
| 文件搜索 | PARTIAL | 180-200，只搜启动时缓存的 ≤80 个 fs_search_files 结果，非实时 |
| 技能搜索 | REAL（本地） | 203-225 |
| 设置项跳转 | REAL | 227-287 |
| 官方 fuzzyFileSearch / thread/search | MISSING | 协议有服务端模糊搜索，未用 |

## 17. ComposerAutocomplete

见 §3 表格（文件 ComposerAutocomplete.tsx:30-107）。要点：`@` 数据真实、`@电脑` 假、10 个 slash 命令中 4 个（`/review /init /compact /test`）只是提示词模板，其余为本地 UI 动作或二者混合（`/plan`）；选中后仅替换输入框文本。

## 18. TerminalDock（内置终端）

文件：`src/components/TerminalDock.tsx`（328 行）；Rust `terminal.rs`（223 行，portable-pty）

| 功能点 | 判定 | 证据 |
|---|---|---|
| PTY 创建/复用、真实 shell 进程 | REAL | terminal.rs:58-188；TerminalDock.tsx:157-165 |
| 输出 streaming（terminal:data）与退出（terminal:exit） | REAL | terminal.rs:127-165；TerminalDock.tsx:53-79 |
| 键盘输入 → PTY | REAL | TerminalDock.tsx:148-152 → terminal_write |
| resize/窗口自适应 | REAL | 170-198；terminal.rs:203-214 |
| 多 tab / shell 选择 / 字号 / 清屏 / 关闭 | REAL | 200-247, 275-322 |
| 由顶栏“运行/测试/构建/QuickSearch 动作”注入命令 | REAL | App.tsx:1791-1835, 2910-2913 + TerminalDock.tsx:93-107（180ms 后写入 `cmd\r`；若终端会话尚未创建会静默丢失一次，属于竞态小瑕疵） |
| 会话回放（attach 时 replay_log） | PARTIAL | Rust 支持（terminal.rs:69-83）；前端从不 attach 已存在 session（映射表只在新 Term 创建时建） |
| 终端会话跨重启/持久化 | MISSING | 关闭即杀进程 |

## 19. GoalProgressBanner / GoalSetupModal（自研 goal runner）

文件：App.tsx:1095-1290（引擎）、2105-2161（banner 接线）、2917-2924；组件 GoalSetupModal.tsx / GoalProgressBanner.tsx

| 功能点 | 判定 | 证据 |
|---|---|---|
| `/goal` 弹配置框（目标/验证命令/最大轮次/自动续跑/工作树） | REAL（前端） | ComposerAutocomplete.tsx:30-38；App.tsx:916-920；GoalSetupModal 全文件 |
| 启动目标：拼 prompt 注入 → 发第一条消息 | REAL（前端） | App.tsx:1253-1290, 943-953 |
| 轮次自动推进（turn/completed → 3 秒倒计时 → 下一轮） | REAL（前端） | App.tsx:580-586, 1233-1243, 1142-1172 |
| 检查清单提取/进度条/手动勾选/加步骤 | REAL（前端解析 Markdown） | 106-132, 1185-1192；GoalProgressBanner.tsx:43-54, 221-262 |
| 验证命令真实执行（powershell） | REAL | App.tsx:1095-1140 → exec_shell_command（lib.rs:627-654） |
| 完成/失败判定 | PARTIAL | 依赖模型输出 `[GOAL_COMPLETED]` 或 checklist 全勾（1190-1200），无服务端权威状态 |
| 暂停/继续/终止 | REAL（前端） | 2110-2129 |
| 状态持久化 | **MISSING** | 全部 `useState`（303-307），刷新/重启丢失；未用官方 `thread/goal/set\|get\|clear` 与 `thread/goal/updated` 通知（协议真实存在） |
| 与官方 Goal 行为一致 | **PARTIAL（自研替代）** | 官方 goal 是服务端线程级能力；本项目是 frontend prompt-loop 模拟 |

## 20. MiniPetWidget（虚拟宠物）

文件：`src/components/MiniPetWidget.tsx`（145 行）

| 功能点 | 判定 | 证据 |
|---|---|---|
| 悬浮宠物、变换物种、流式时脉冲 | MOCK（装饰，真实 DOM 动效） | 27-46, 134-142；物种列表硬编码 SettingsView.tsx:62-77 |
| 快捷提问 | REAL（复用发送链路） | 76-102 |
| “摸摸头”计数 | MOCK（内存） | 25, 104-111 |
| “@电脑 桌面协助” | MOCK（插文本） | 112-121 |
| 官方 Pets 插件（安装/自定义/九态动画） | MISSING | 官方 chunk：`pet-install-*`、`pets-settings-route` 等；本项目仅 emoji |

## 21. NavigationRail / WorkspacePopover

| 组件 | 判定 | 证据 |
|---|---|---|
| NavigationRail（聊天/项目/收件箱/计划/插件/工作树/设置/宠物/app-server 状态点/折叠侧栏） | REAL | NavigationRail.tsx:36-139；全部接真实路由 state 或连接状态 |
| WorkspacePopover（首页项目下拉：切换/移除/新建/AGENTS.md） | REAL | WorkspacePopover.tsx:38-108；数据来自真实 workspace_list |

## 22. MarkdownView

文件：`src/components/MarkdownView.tsx`（248 行）

| 功能点 | 判定 | 证据 |
|---|---|---|
| 段落/标题/列表/粗体/行内代码/链接渲染 | REAL（自研） | 16-176 |
| fenced code block + 复制 | REAL | 16-46, 194-237 |
| shell 代码块“运行”按钮 | **MOCK（未接线）** | 203-213 依赖 `onRunCommand`，App.tsx:2580-2585 未传 |
| 文件路径点击预览 | **MOCK（未接线）** | 60-98 依赖 `onOpenFile`，未传 |
| 表格/图片/引用块/语法高亮/嵌套列表 | MISSING | 渲染器不支持 |

## 23. 通知 / 提示音

| 功能点 | 判定 | 证据 |
|---|---|---|
| 应用内 toast（成功/错误/info） | REAL（本地） | App.tsx:291-300, 2927-2931 |
| 回合完成 + Goal 完成 WebAudio 提示音 | REAL | App.tsx:134-164（双音合成）, 562, 1202 |
| 收件箱未读红点 | PARTIAL | 内存派生（1604-1607） |
| 桌面系统通知（通知栏/托盘） | MISSING | 无 tauri notification 插件；capabilities 未授权 |
| 通知设置（开关/声音选择/免打扰） | MISSING | Settings 中无对应 UI |
| 审批提醒 | PARTIAL | 仅入内存 Inbox + 页面内卡片；无系统通知 |

## 24. 顶栏与全局弹层

| 功能点 | 判定 | 证据 |
|---|---|---|
| 会话标题重命名（点击标题） | REAL | App.tsx:1660-1700 |
| 分支 pill + Git 快捷菜单（查看变更/推送/新建分支） | REAL | 1701-1759（push/commit 真实；新建分支用 `window.prompt`） |
| 工作树隔离徽标 | REAL（状态显示） | 1761-1772 |
| 返回聊天 pill | REAL | 1774-1784 |
| 运行/测试/构建 3 按钮 | REAL（PTY 注入） | 1791-1835；项目命令来自 `detect_project_scripts`（lib.rs:338-438） |
| 用量 popover | **PARTIAL（并行改动中）** | S1：1847-1879 模型/推理级别/轮数/沙盒全部是前端 state；06:54 后已监听 `thread/tokenUsage/updated`（tokenUsage state）但 UI 未渲染，`account/usage/read` 仍未接 |
| 会话参数 popover | **MOCK** | 1895-2001：改的是前端 state，发送时字段被服务端忽略（§0.4） |
| 导出 popover（Markdown/JSON/复制/清空） | REAL（本地） | 2018-2072, 1481-1586 |
| 底部终端开关 / 右侧 Diff 开关 + 变更统计 badge | REAL | 2076-2101 |
| 全局 toast | REAL | 2927-2931 |

## 25. 语音输入（Composer Mic）与 Settings Voice

| 功能点 | 判定 | 证据 |
|---|---|---|
| Web Speech 听写（若 WebView2 支持） | PARTIAL | ComposerBox.tsx:188-249；Tauri WebView2 通常无 `SpeechRecognition` → 弹 alert |
| 语音引擎/语言/热键/自动发送设置 | MOCK | SettingsView 只写 prefs（508-512），无读取方 |
| 官方 realtime voice（thread/realtime/*） | MISSING | 协议有整套实时语音；前端 0 处引用 |

## 26. @电脑 / Appshots / Browser-use / Hooks / Git 策略 / Worktree 策略 / Plugins 设置

| 能力 | 判定 | 证据 |
|---|---|---|
| @电脑（桌面操控） | **MOCK** | 3 处插入文本（ComposerBox.tsx:722-734; ComposerAutocomplete.tsx:133-147; MiniPetWidget.tsx:116） |
| Appshots 截图 | **MOCK** | 仅 Settings 开关（SettingsView.tsx:2203-2282） |
| Browser-use 自动化 | **MOCK**（iframe 预览≠自动化） | Settings 开关（2283-2377）；DiffDrawer iframe（1010-1070） |
| Hooks 生命周期 | **MOCK** | 仅 Settings 表单（2378-2464） |
| Git 偏好（前缀/签名/自动 stage…） | **MOCK** | 仅 Settings 表单（2465-2560） |
| Worktree 策略（保留/缓存/自动提交） | **MOCK** | 仅 Settings 表单（2561-2624） |
| 插件设置 | **MOCK** | 硬编码 4 插件 + 纯 prefs（SettingsView.tsx:285-290, 1981-2100） |

## 27. 官方有、本项目完全缺失的能力（按用户价值排序）

1. **登录/账号/额度**：`account/login/start`、`account/read`、`account/rateLimits/read`、`account/usage/read`；无登录 UI、无额度/重置时间、无退出登录。
2. **自动化调度器**：官方 electron 主进程定时执行 `~/.codex/automations`；本项目只有 CRUD，不执行。
3. **真实 Goal**：`thread/goal/set\|get\|clear` + `thread/goal/updated` 服务端目标；本项目自研前端 loop，无持久化。
4. **线程 fork / revert / compact / 分页 / 附件持久化 / shellCommand**：协议齐全，前端 0 接线。
5. **项目实体与线程分组**：`project/*`、`threadSection/*`、`thread/section/move`、sidebar 自定义分组；本项目用 workspace 路径近似。
6. **插件系统与市场**：`plugin/list|install|installed|search|read`、`marketplace/*`；官方 `~/.codex/plugins`、`marketplaces` 已存在。
7. **Token/上下文用量**：`thread/tokenUsage/updated` + `account/usage/read`；当前“用量”是假的。
8. **MCP 工具调用可视化 / plan 流 / web search 卡 / 图片生成**：20+ ThreadItem 类型只渲染 5 种。
9. **实时语音**：`thread/realtime/*` 全套（官方 realtime-voice chunk 可证）。
10. **系统通知与设置**：桌面通知、提示音选择、免打扰。
11. **Hooks 执行器**：官方 `hooks/list` + `~/.codex/hooks.json`；本项目只有表单。
12. **Computer-use / Appshots / Browser-use 真实现**：官方各有独立插件/chunk；本项目只有 UI。
13. **主题/偏好与官方 global state 兼容**：官方 `theme`、`electron-persisted-atom-state`；本项目自造 `colorTheme`、`desktopPreferences`。
14. **会话搜索**：`thread/search`、`fuzzyFileSearch`。
15. **命令服务端执行**：`command/exec`（可挂后台/可写 stdin），本项目自己用 powershell/PTY 实现。

## 28. “看起来能点、实际没接后端 / 无效”清单（★交付重点）

| # | 具体入口 | 位置 | 实际行为 |
|---|---|---|---|
| 1 | 停止生成按钮（Stop） | App.tsx:1292-1304 | `turn/interrupt` 缺 `turnId`，服务端必拒；UI 因 finally 置 isStreaming=false，**看起来停了其实没停** |
| 2 | 流式中继续输入（Steer/立即引导） | App.tsx:971-982, 1306-1341 | `turn/steer` 分别缺 `expectedTurnId`/错用 `text`，均被服务端拒绝；一个入口 fallthrough 成普通发送、一个入口降级成本地队列，都不是真 steer |
| 3 | Composer 权限选择“自动” | App.tsx:1013-1018 | 映射 `on-failure`（非法枚举），此后每次发消息 thread/start 或 turn/start 都报 invalid request |
| 4 | ⚙️ 会话参数面板（T/P/Tokens/联网/verbosity） | App.tsx:1895-2001, 1040-1053 | 字段不在 TurnStartParams 中，服务端忽略 → 调了等于没调 |
| 5 | Settings“智能体与模型参数”中 10 个超参数 | SettingsView.tsx:1044-1203 + config_skills.rs:356-365 | 写进 config.toml 的键 codex 不认识（strict 实测），不生效且产生配置噪声 |
| 6 | 回答里的“运行”代码块 / 文件路径点击 | MarkdownView.tsx:203-213, 60-98 | 回调没传入，按钮存在但没有反应 |
| 7 | 审批里的“Codex 提问询问” | App.tsx:2622-2712 | S1 应答 JSON 结构错误；06:54 后并行改动已用 `ApprovalCenter`+`protocol.ts` 修复四类审批/提问；legacy/tool-call/elicitation 仍缺 |
| 8 | 收件箱所有操作 | App.tsx:2180-2210 | 只改内存，重启清空；“计划任务完成通知”永远不会出现 |
| 9 | “立即运行”计划任务 | App.tsx:2217-2233 | 只是开一个会话；无定时执行，关应用即停止 |
| 10 | 语音听写（WebView2 下） | ComposerBox.tsx:188-196 | 无 SpeechRecognition 时 alert，功能不可用 |
| 11 | @电脑 / 桌面协助 | 3 处 | 仅插入文本 `@电脑 `，无任何桌面控制 |
| 12 | Settings 中 computer-use / appshots / browser-use / hooks / git / worktree / plugins / voice / 语气偏好 | SettingsView.tsx 各 section | 只写 `desktopPreferences`，无人读取执行 |
| 13 | Settings 插件“已安装扩展”启停 | SettingsView.tsx:285-290, 2059+ | 硬编码数组本地启停，无插件后端 |
| 14 | SkillsMcpView 的 plugins/apps/marketplaces 三个 tab | SkillsMcpView.tsx:25-130, 423-474, 726-807 | 硬编码目录；“安装/连接”= 写 SKILL.md 或 config MCP |
| 15 | 文件修改卡（turn 内） | App.tsx:2556-2578 | 取不存在的 `fc.path/insertions/deletions` → 显示 "Modified file +0 -0"，点击无有效预览 |
| 16 | 导出文件/JSON 之外的“会话参数/用量” | App.tsx:1847-2001 | 纯本地 state，与真实用量无关 |
| 17 | 快捷键说明里的 Ctrl+Enter 提交 | SettingsView.tsx:1509 | 未实现 |
| 18 | 主题/偏好自定义键 | SettingsView.tsx:422, 490 | 与官方 `theme`/`electron-persisted-atom-state` 不互通，官方桌面端读不到 |
| 19 | `thread/fork` 等“协议有/Rust 通用代理能透传” | — | 前端没有入口，不能算已实现 |
| 20 | 未使用的 Tauri command | app_server_status / thread_record_workspace / git_worktree_set_owner / gh_status | 注册了但前端无调用（`app_server_pending_requests` 已被并行改动接入；详见 backend-surface.md §2） |

## 29. 真实度统计（按用户可见功能点粗算）

| 结论 | 数量（本审计列出的功能点） | 占比 |
|---|---|---|
| REAL | ~58 | ~33% |
| PARTIAL | ~57 | ~33% |
| MOCK / BROKEN | ~45 | ~26% |
| MISSING（官方有） | ~15 大类 | ~8% |

> 注：REAL 高度集中在 Git/终端/文件/线程 CRUD/config 读写；MOCK 高度集中在“设置开关 + 通知 + 市场/插件 + 宠物 + 电脑操控”。

## 30. 修复优先级建议（给后续补齐功能用）

**P0（会导致核心对话链路失败，先修）**
1. `turn/interrupt` 补 `turnId`（需前端保存当前 turnId）。
2. `turn/steer` 补 `expectedTurnId` + 统一用 `input:[{type:"text"}]`。
3. `approvalPolicy` 合法枚举修正（`auto` → `on-request` 或 `untrusted`；不要用 `on-failure`）。
4. UserInput 应答改为 `{answers:{[questionId]:{answers:[text]}}}`；按 method 分派 permissions/tool/elicitation 专属应答。
5. 从 `turn/completed` 合并 `turn.items`，并把 `fileChange.changes[]` 渲染改正。

**P1（把已有 UI 接到真实后端）**
6. 监听 `thread/tokenUsage/updated` 替换假“用量”；监听 `turn/plan/updated`、`item/plan/delta`。
7. Inbox 持久化 + 接入 automation 运行结果/线程完成事件。
8. Goal 改用 `thread/goal/*`，或在本地持久化。
9. MCP 变更后 `config/mcpServer/reload`；PR 前 `gh_status` 检查。
10. MarkdownView 回调接线；补全 20+ item 类型渲染。

**P2（补官方缺失模块）**
11. 自动化调度器（Rust 定时器或 app-server automation 能力）。
12. account 登录/额度。
13. project/section/plugin/marketplace/thread fork/compact/realtime voice。
14. 把 Settings 中的“只写 JSON”开关逐项接上真实执行器（否则应在 UI 上标注“仅本地偏好”）。





