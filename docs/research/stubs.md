# STUBS — 全部占位/硬编码/无效实现精确位置（按文件分组）

> 生成方式：全量阅读 `src/**` + `src-tauri/src/**`；grep `TODO|FIXME|HACK|mock|demo|stub|placeholder|localStorage|setTimeout|setInterval|alert|console.log` 并人工复核。
> 修复难度：**易** = 单文件内接线/换常量（≤半天）；**中** = 需要跨文件接线或补协议参数（1-2 天）；**难** = 需要新增子系统/进程/Rust 能力（≥3 天）。
> 重要否定结论：**源码中不存在 `TODO` / `FIXME` / `demo` / `mock` 字面量，也不存在 `setTimeout` 假进度条**（唯一定时器是 Goal 3 秒自动续跑，属真实行为）。本项目的占位主要是**硬编码数据 + 只写本地 JSON + 协议参数错误**。
> **并行改动声明（重要）**：本清单基于 2026-10-23 ~06:50 的工作树快照（HEAD `fad9129`）。06:53 后另一并行任务新增 `src/protocol.ts`、`src/components/ApprovalCenter.tsx` 并修改 `src/App.tsx`/`src/styles.css`（未提交），已修复 A19/A20（审批/提问应答）与 `app_server_pending_requests` 接线；本清单对应行已加注。其余条目仍以 S1 为准。

---

## 1. `src/App.tsx`

| # | 行号 | 代码片段（节选） | 性质 | 修复难度 |
|---|---|---|---|---|
| A1 | 61-82 | `const STARTER_PROMPTS = [{title:"审阅未提交代码 (/review)",...},{...架构梳理},{.../plan},{.../test}]` | 首页 4 张建议卡硬编码（纯静态，可接受但不可配置） | 易 |
| A2 | 224 | `useState<string>("gpt-6.1-sol")` | 默认模型名硬编码；若 `model/list` 失败/模型下线，发送即失败 | 易 |
| A3 | 932-934 | `maxTurns: 10, autoVerifyCommand: "npm test"` | `/goal ` 快捷启动硬编码轮次与验证命令 | 易 |
| A4 | 933/946 | `autoVerifyCommand: "npm test"`、prompt 中固定 `验证机制：模型自主...` | 同上；验证命令硬编码 | 易 |
| A5 | 173-180 | `startedAt: t.startedAt \|\| t.firstTurnWorkItemStartedAtMs` | 协议 `startedAt/completedAt` 是**秒**，这里当毫秒 | 易 |
| A6 | 220 | `useState<InboxNotificationItem[]>([])` | Inbox 纯内存；无任何后端/持久化 | 中 |
| A7 | 706-718 | `setInboxItems(prev => [{title:"需要批准安全操作",...}, ...])` | 只有审批会入箱；通知文案固定 | 中 |
| A8 | 1203-1228 | `title: "🎯 目标已成功达成！" / "目标已达最大轮次限制"` | Goal 通知只在本会话内产生 | 中 |
| A9 | 1028-1032 | `startRes?.threadId \|\| ... \|\| \`thread-${Date.now()}\`` | thread/start 失败时伪造本地线程 id（非 UUID），后续 turn/start 必报 `invalid thread id` | 中 |
| A10 | 1009-1018 | `permissionMode === "full" ? "danger-full-access" : "workspace-write"` / `"ask"? "on-request" : "full"? "never" : "on-failure"` | **BROKEN**：`on-failure` 不是合法枚举（已实测） | 易 |
| A11 | 1040-1053 | `temperature: sessionTemperature, topP, maxTokens, webSearch, allowNetwork, outputVerbosity` | 塞给 `turn/start` 的非协议字段，服务端忽略 | 易（删除/改走协议）|
| A12 | 1044 | `effort: reasoningEffort === "extra_high" ? "xhigh" : reasoningEffort` | effort 合法，但选项只到 xhigh，漏 `max/ultra` | 易 |
| A13 | 1052 | `serviceTier: fastMode ? "priority" : undefined` | 未校验模型/账户是否支持 priority | 中 |
| A14 | 956-963 | `attachedFiles.map(f => \`[附加文件: ${f.path}]\`)` | 附件只是文本；未用 `localImage/mention/skill` input | 中 |
| A15 | 960-962 | `planMode ? "[Plan Mode: ...]\n" : ""` | Plan 模式只是提示词前缀 | 中 |
| A16 | 971-982 | `await callAppServer("turn/steer", { threadId, input })` | **BROKEN**：缺 `expectedTurnId` | 易 |
| A17 | 1292-1304 | `await callAppServer("turn/interrupt", { threadId })` | **BROKEN**：缺 `turnId`；且 finally 强制 `setIsStreaming(false)` 造成“假装已停止” | 易 |
| A18 | 1306-1341 | `callAppServer("turn/steer", { threadId, text })` | **BROKEN**：缺 `expectedTurnId`，且 `text` 应为 `input` | 易 |
| A19 | 1343-1357 | `app_server_respond({ id, result: responseValue })` | S1：UserInput 传 `{answers:[...], selected}` 结构错误；**06:54 后并行改动已由 `protocol.ts userInputResponse` 修复** | 已修（并行） |
| A20 | 1359-1376 | `app_server_respond({ id, result: { decision } })` | S1：所有 server request 都回 `{decision}`，仅 2/11 类正确；**06:54 后并行改动已由 `ApprovalCenter`+`protocol.ts` 修复 4 类**；legacy execCommandApproval/applyPatchApproval、`item/tool/call`、`mcpServer/elicitation/request` 仍缺 | 中 |
| A21 | 1379-1385 | `useEffect(() => { if (!isStreaming && followupQueue.length>0) ... })` | 队列自动 drain 存在，但**无任何入口写队列**（steer 失败才入队，而 steer 必失败） | 中 |
| A22 | 1847-1879 | 用量 popover：`<code>{selectedModelId}</code>`、`{turns.length} 轮` | 假“会话用量与上下文”，无 token/费用数据 | 中 |
| A23 | 1895-2001 | 会话参数滑块（Temperature/Top-P/Tokens/WebSearch/网络/verbosity） | 纯前端 state + 非法协议字段（同 A11） | 中 |
| A24 | 2229-2231 | `setTimeout(() => { handleSendMessage(...) }, 120)` | 计划任务“立即运行”用定时器等新会话就绪（竞态 hack） | 中 |
| A25 | 2580-2585 | `<MarkdownView key content={extractTextFromItem(msg)} />` | 未传 `onRunCommand/onOpenFile` → 代码块“运行”、文件路径点击都是**死按钮** | 易 |
| A26 | 2556-2578 | `if (fc.path) setSelectedPreviewFile(fc.path)` + `+{fc.insertions}` | `fileChange` item 无 `path/insertions/deletions`（真实只有 `changes[]`）→ 永远 “Modified file +0 -0” | 易 |
| A27 | 2469-2479 | `{(turn.durationMs / 1000).toFixed(1)}s` | 仅时长；startedAt/completedAt 秒/毫秒混用 | 易 |
| A28 | 2623-2639 | `req.method === "item/tool/requestUserInput" \|\| ... \|\| req.params?.question` | 用启发式判断请求类型，缺 `item/permissions/requestApproval`、`item/tool/call` 等分支 | 中 |
| A29 | 2864-2872 | `<AgentsMdModal cwd initialContent .../>` | 只传 AGENTS.md 内容；若实际是 CLAUDE.md 保存会新建 AGENTS.md（见 §14） | 易 |
| A30 | 1748 | `const bName = prompt("请输入新分支名称:")` | 用 `window.prompt` 做输入（体验/可测试性差） | 易 |
| A31 | 740-765 | 全局快捷键仅 Ctrl+N/B/J/,/K | Settings 宣称的快捷键并未全部实现（如 Ctrl+Enter 提交） | 易 |

## 2. `src/components/ComposerBox.tsx`

| # | 行号 | 片段 | 性质 | 难度 |
|---|---|---|---|---|
| B1 | 72-97 | `const DEFAULT_MODELS = [{id:"gpt-6.1-sol",...},{id:"gpt-6-astra"},{id:"gpt-5.4"},{id:"gpt-5.3-codex"}]` | 硬编码模型 + 假描述；`gpt-5.4/gpt-5.3-codex` 在真实 model/list 不存在 | 易 |
| B2 | 99-104 | `EFFORT_OPTIONS`（low/medium/high/extra_high） | 写死；未按 `model.supportedReasoningEfforts` 过滤 | 中 |
| B3 | 106-130 | `PERMISSION_OPTIONS` 文案 | “自动（工作区读写）”与实际映射 `on-failure` 不符 | 易 |
| B4 | 188-249 | `toggleDictation` → `new SpeechRec()`；不支持时 `alert(...)` | 依赖 WebView2 是否支持 Web Speech；Tauri 下通常不支持 | 中（需接系统 ASR 或 realtime voice） |
| B5 | 722-734 | `onPromptInputChange(promptInput + "@电脑 ")` | @电脑 只插文本 | 难（需 computer-use 能力） |
| B6 | 737-748 | 计划模式 toggle → `planMode` | 仅本地状态 | 中 |
| B7 | 263-287 | 拖拽文件 → 只有 name/path，发给 Codex 时也只是文本 | 附件未使用协议 input | 中 |
| B8 | 683-688 | placeholder 写 “Alt+Enter 加入队列” | 未实现 Alt+Enter（`handleKeyDown` 383-405 无分支） | 易 |
| B9 | 917-924 | 麦克风按钮 | 同 B4 | 中 |

## 3. `src/components/ComposerControlPills.tsx`（当前未被 App 引用）

| # | 行号 | 片段 | 性质 | 难度 |
|---|---|---|---|---|
| C1 | 25-54 | `DEFAULT_MODELS`（gpt-6-astra / gpt-6.1-sol / gpt-5.4 / gpt-5.3-codex） | 与 ComposerBox 重复的硬编码模型清单 | 易 |
| C2 | 56-77 / 79-99 | `REASONING_OPTIONS` / `PERMISSION_OPTIONS` | 硬编码选项；与真实能力无关 | 易 |
| C3 | 全文件 | 该组件在 App.tsx 中**未被使用**（无 import） | 死代码（可删） | 易 |

## 4. `src/components/ComposerAutocomplete.tsx`

| # | 行号 | 片段 | 性质 | 难度 |
|---|---|---|---|---|
| D1 | 30-107 | `SLASH_COMMANDS` 10 条硬编码 | `/review /init /test /compact` 只插入提示词；`/goal /plan /fast /worktree /terminal /diff` 本地动作 | 中（接 review/start、compact/start 等） |
| D2 | 133-147 | `{ id:"__computer_use__", title:"电脑", subtitle:"Control Windows apps", insertText:"@电脑 " }` | **假 computer-use**：只是插入文本 | 难 |
| D3 | 149-184 | 文件列表来自 `files`/`fileHits` props | 数据真实（fs_list_dir/fs_search_files），但只缓存启动时 ≤80 条，非实时 | 中 |

## 5. `src/components/SettingsView.tsx`（2935 行，占位最集中）

| # | 行号 | 片段 | 性质 | 难度 |
|---|---|---|---|---|
| E1 | 34-60 | `OFFICIAL_COLOR_THEMES` 25 套主题色 | **不是 stub**：真实改 CSS 变量并持久化（`colorTheme` 键与官方不兼容，见 E5） | 易（改键名） |
| E2 | 62-77 | `PET_SPECIES_LIST` 9 种宠物（emoji+文案） | 装饰性硬编码；官方是插件宠物资产 | 难 |
| E3 | 79-126 | `MCP_PRESETS` 6 个预设 | 预填模板（可接受） | 易 |
| E4 | 285-290 | `installedPlugins` 初始硬编码 4 个（git-review/tailwind-helper/diagram-viewer/docker-mcp） | **MOCK 插件已安装列表**；启停仅本地 state | 难（需 plugin/* 后端） |
| E5 | 462-548 | `handleSaveVisual` → `config_update` + `desktop_state_set("desktopPreferences", {...45 个字段})` | 45 个偏好全部塞入一个自造键；其中约 40 个无运行时消费方 | 中（逐项接线） |
| E6 | 543 | `flashSaved("✓ 配置与偏好已保存至 ~/.codex/config.toml 及 desktop-state.json")` | 文案错误：实际写 `.codex-global-state.json`，且部分字段无效果 | 易 |
| E7 | 550-570 | `handleTestMcpServer`：远程 URL 直接显示“✓ 远程端点已响应” | **假检测**（未发任何请求） | 易 |
| E8 | 556-557 | `exec_shell_command(\`${srv.command} --help\`)` 作为 MCP 健康检查 | 只能验证命令存在，非 MCP 握手 | 中 |
| E9 | 947-964 | 字号滑块 `document.documentElement.style.fontSize` | 不加载、不持久化（刷新丢失） | 易 |
| E10 | 971-1039 | 3 张“超参数预设卡”只 setState | 与 E11 一起属于无效 UI | 易 |
| E11 | 1044-1203 | 10 个超参数输入 → 写 config.toml | **codex 不识别这些键**（strict 实测）：temperature/top_p/max_output_tokens/context_window/web_search_mode/allow_network/max_parallel_tools/subagent_concurrency/output_verbosity | 易（删）或中（改走协议支持项） |
| E12 | 1212 | `placeholder="gpt-5.4"` | 建议值 `gpt-5.4` 在真实环境不存在 | 易 |
| E13 | 1502-1509 | 7 条快捷键说明数组 | 静态文本，不可编辑；其中 Ctrl+Enter 提交未实现 | 易 |
| E14 | 1981-2100 | plugins-settings：市场 URL/自动更新/信任/沙箱 + 4 个假插件 | 全部只写 prefs / 本地 state | 难 |
| E15 | 2101-2202 | computer-use 6 个开关 | 只写 prefs，无执行路径 | 难 |
| E16 | 2203-2282 | appshots 5 个开关 | 只写 prefs，无截图能力 | 难 |
| E17 | 2283-2377 | browser-use 6 个开关 | 只写 prefs，无浏览器自动化 | 难 |
| E18 | 2378-2464 | hooks 4 个脚本输入 | 只写 prefs，无 hook 执行器/未读 hooks.json | 难 |
| E19 | 2465-2560 | git-settings 6 项 | 只写 prefs，git.rs/DiffDrawer 不读 | 中 |
| E20 | 2561-2624 | worktrees 策略 3 项 | 只写 prefs，无清理任务 | 中 |
| E21 | 2625-2698 | voice 5 项 | 只写 prefs，ComposerBox 不读 | 中 |
| E22 | 2726-2733 / 2843-2849 | 导入 Cursor/Windsurf：`desktop_state_set({customPersonaPrompt: merged})` | **BUG**：整体覆盖 desktopPreferences，清空其它偏好；且 rules 只在“保存更改”后才写入 config instructions | 易 |
| E23 | 2810-2811 | VS Code 快捷键导入：只 flashSaved 文案“兼容生效” | **MOCK**：仅读取文件统计条数 | 易（删文案）或难（真做映射） |
| E24 | 2874-2908 | 语气/代码风格/角色定位 | 只写 prefs，无人读取（persona 只用 customPersonaPrompt→instructions） | 中 |
| E25 | 709-710 | “放弃未保存修改”按钮 → `loadConfig` | 会重新拉配置，但不会重置非 config 的本地 state（会残留未保存偏好） | 易 |

## 6. `src/components/SkillsMcpView.tsx`

| # | 行号 | 片段 | 性质 | 难度 |
|---|---|---|---|---|
| F1 | 25-56 | `CURATED_PLUGINS` 3 个假插件（Full-Stack QA / Rust Tauri Pro / Git Release，含虚构作者） | **MOCK**；“安装”= 写一个 SKILL.md（453-467） | 难（接 plugin/*） |
| F2 | 58-95 | `APP_CONNECTORS` 4 个（GitHub/Linear/Postgres/Playwright） | **MOCK** 硬编码；“一键连接”= 写 config MCP（751-759） | 中 |
| F3 | 97-130 | `MARKETPLACE_ITEMS` 4 个 MCP | **MOCK** 硬编码目录；“安装”= 写 config（791-800） | 中（接 marketplace/*） |
| F4 | 714-721 | `<pre><code>{JSON.stringify(mcpLiveStatus, null, 2)}</code></pre>` | 真实状态但原始 JSON 展示，未做 UI | 中 |
| F5 | 248-319 | MCP 增删改后不 reload | 需调 `config/mcpServer/reload` 才能生效（协议有） | 易 |

## 7. `src/components/InboxView.tsx` / `MiniPetWidget.tsx` / `DiffDrawer.tsx`

| # | 文件:行 | 片段 | 性质 | 难度 |
|---|---|---|---|---|
| G1 | InboxView.tsx:22-29 | `useState filter` + 本地 `items` prop | 纯展示；数据来自 App 内存（§A6） | 中 |
| G2 | InboxView.tsx:38 | 文案“查看计划任务运行报告、后台完成的会话” | 承诺的功能不存在（无 automation 执行/入箱） | — |
| G3 | MiniPetWidget.tsx:25,104-111 | `pokedCount` 本地计数 | 装饰 | 易 |
| G4 | MiniPetWidget.tsx:112-121 | `onQuickPrompt("@电脑 请检查当前桌面窗口状态...")` | 假 @电脑 | 难 |
| G5 | DiffDrawer.tsx:1040-1047 | `<iframe src={browserUrl} title="Codex In-App Browser Preview" />` | 只是网页预览，非 browser-use（无自动化/无 console/无元素选择） | 难 |
| G6 | DiffDrawer.tsx:350-1007 | summary 从本地 `turns` 推导 | 仅本会话内存数据；代码工件用正则抽 ``` 块 | 中 |
| G7 | DiffDrawer.tsx:799-830 | diff 行评论 → 作为聊天消息发送 | 非官方 diff comment 协议，但行为有效 | 中 |
| G8 | DiffDrawer.tsx:294-314 | create PR 未先调用 `gh_status` | 环境缺 gh 才报错，错误信息不友好 | 易 |

## 8. `src/components/AutomationsView.tsx`

| # | 行号 | 片段 | 性质 | 难度 |
|---|---|---|---|---|
| H1 | 22-44 | `PRESET_TEMPLATES` 3 条 | 硬编码模板（可接受） | 易 |
| H2 | 46-51 | `SCHEDULE_PRESETS` 4 条 RRULE | 硬编码预设（可接受），但输入不校验 RRULE 语法 | 易 |
| H3 | 393-400 | “立即运行” → 上层回调 | 无调度器；“运行”不是后台执行 | 难 |
| H4 | 全文件 | 无运行历史/日志/下次运行时间 | 官方 automation 有 detail panel/run 记录 | 难 |

## 9. Goal 组件（GoalSetupModal / GoalProgressBanner）

| # | 文件:行 | 片段 | 性质 | 难度 |
|---|---|---|---|---|
| I1 | GoalSetupModal.tsx:22-37 | `OBJECTIVE_PRESETS` / `VERIFY_COMMAND_PRESETS` / `MAX_TURNS_OPTIONS` | 硬编码选项（可接受） | 易 |
| I2 | GoalProgressBanner.tsx:全文件 | 纯展示组件，数据全来自 App 自研 goal state | 官方应由 `thread/goal/*` 驱动 | 中 |
| I3 | App.tsx:1190-1200 | `lastText.includes("[GOAL_COMPLETED]")` + checklist 全勾 | 完成判定靠模型自觉输出 token，无服务端权威状态 | 中 |

## 10. `src/components/QuickSearchModal.tsx`

| # | 行号 | 片段 | 性质 | 难度 |
|---|---|---|---|---|
| J1 | 76-143 | 6 条默认动作硬编码 | 动作本身真实（调 PTY/路由） | 易 |
| J2 | 228-264 | 5 条设置项搜索结果硬编码 | 只覆盖 5/20 个设置 section | 易 |
| J3 | 155-200 | 线程/文件只为已加载缓存 | 非实时全量搜索（协议 fuzzyFileSearch/thread/search 未用） | 中 |

## 11. `src/components/MarkdownView.tsx`

| # | 行号 | 片段 | 性质 | 难度 |
|---|---|---|---|---|
| K1 | 4-8, 203-213 | `onRunCommand?: (cmd) => void`，App 未传 | 运行时按钮不出现（死能力） | 易（接线） |
| K2 | 4-8, 60-98 | `onOpenFile?: (path) => void`，App 未传 | 文件路径点击无反应 | 易（接线） |
| K3 | 全文件 | 无表格/图片/引用块/语法高亮/嵌套列表 | 渲染能力弱于官方 | 中（换 react-markdown/shiki） |

## 12. `src/components/TerminalDock.tsx` / `ProjectsIndexView.tsx` / `CodexSidebar.tsx`

| # | 文件:行 | 片段 | 性质 | 难度 |
|---|---|---|---|---|
| L1 | TerminalDock.tsx:36 | `useState("powershell.exe")` | 默认 shell 硬编码（未按平台/用户 SHELL） | 易 |
| L2 | TerminalDock.tsx:95-107 | `setTimeout(..., 180)` 写 pendingCommand | 若终端会话未创建完成则命令丢失（竞态） | 易 |
| L3 | ProjectsIndexView.tsx:217 | `const next = prompt("请输入新聊天标题:", ...)` | 用 `window.prompt` 重命名 | 易 |
| L4 | ProjectsIndexView.tsx:50-76 | 用 workspace 根目录冒充“项目” | 官方 project 实体缺失 | 中/难 |
| L5 | CodexSidebar.tsx:103-109 | 侧边栏搜索只过滤已加载 threads | 非服务端搜索 | 中 |

## 13. `src/components/AgentsMdModal.tsx`

| # | 行号 | 片段 | 性质 | 难度 |
|---|---|---|---|---|
| M1 | 25-26 | `const filePath = \`${cwd}/AGENTS.md\`` | 即使打开的是 CLAUDE.md，保存也写 AGENTS.md（可能出现两份规则文件） | 易 |

## 14. `src/bridge.ts`

| # | 行号 | 片段 | 性质 | 难度 |
|---|---|---|---|---|
| N1 | 12-14 | `throw new Error("Tauri runtime required for command: ...")` | 浏览器里跑 Vite dev 时所有数据功能报错、页面空白（无 mock fallback）；对 dev 体验是坑 | 易（加演示模式） |

---

## 15. Rust 侧占位 / 硬编码

| # | 文件:行 | 片段 | 性质 | 难度 |
|---|---|---|---|---|
| R1 | `app_server.rs:602-636` | `create_astra_model()` 返回硬编码完整模型对象（id/displayName/reasoning efforts/serviceTiers/multiAgentVersion） | 兼容补丁；旧 CLI 下会**凭空注入**一个模型 | 易（改为只在缺失时告警） |
| R2 | `app_server.rs:565-600` | `patch_model_list_result` 强制隐藏/显隐 gpt-6-astra、gpt-6.1-sol | 同上；硬编码模型名 | 易 |
| R3 | `config_skills.rs:757-806` | `generate_sample_models_api_catalog()` 写死 4 个示例模型（gpt-5.4/gpt-6-astra/deepseek-reasoner/claude-sonnet-4-5） | 生成的 `models-api.json` 是示例而非真实目录，容易被当作可用模型选择 | 中（提示用户/改为探测 provider） |
| R4 | `config_skills.rs:930` | `default_template`（local environment）硬编码 `name/setup_script/actions.run/test/build` | 首次打开显示的是模板而非文件真实内容 | 易 |
| R5 | `config_skills.rs:652` | `unwrap_or("FREQ=DAILY;BYHOUR=9;BYMINUTE=0")` | automation 缺 rrule 时用默认值展示（不落盘） | 易 |
| R6 | `config_skills.rs:684-689` | `created_at/updated_at = mtime` | 官方 automation.toml 有独立时间戳字段；本项目用文件 mtime 冒充 | 中 |
| R7 | `config_skills.rs:708-747` | `save_automation` 不写 `version` / `target` / `created_at` | 与官方格式不完全兼容（见 backend-surface §8） | 中 |
| R8 | `lib.rs:338-438` | `detect_project_scripts` 各语言 fallback 硬编码命令（`npm run dev`、`cargo run`…） | 兜底策略，合理但项目类型识别有限（仅 6 种） | 易 |
| R9 | `lib.rs:432-437` | 非识别项目 → 固定返回 `npm run dev/npm test/npm run build` | 完全未知项目会给出错误命令 | 易 |
| R10 | `terminal.rs:42-56` | `default_shell()`：Windows 固定 `powershell.exe`，其他固定 `/bin/zsh` | 未探测用户默认 shell | 易 |
| R11 | `app_server.rs:124` | `"codex.cmd".to_string()` 兜底 | 找不到 CLI 时仍尝试启动，错误只在 status.lastError 里 | 易 |
| R12 | `state.rs:154-158` | 工作区为空时用 `current_dir()` 兜底 | 首次启动会把“exe 运行目录”当项目（可能不是用户想要） | 易 |
| R13 | `config_skills.rs:597-617` | `list_automations` 只读 `automation.toml`，不扫描官方新增字段 | 数据半兼容 | 中 |
| R14 | `app_server.rs:369-373` | 只做 `mcpServer/list` → `mcpServerStatus/list` 别名，无其它兼容层 | 前端若写错方法名只能靠 alias | 易 |

---

## 16. 死代码 / 未接线清单

| 对象 | 位置 | 状态 |
|---|---|---|
| `ComposerControlPills` 组件（314 行） | src/components/ComposerControlPills.tsx | **未被任何文件 import**（App/ComposerBox 均未用） |
| `app_server_status` command | lib.rs:31-34 | 前端未调用 |
| `app_server_pending_requests` command | lib.rs:100-105 | S1 前端未调用；06:54 后并行改动已接入（App.tsx:465） |
| `thread_record_workspace` command | lib.rs:210-218 | 前端未调用（内部自动记录） |
| `git_worktree_set_owner` command | lib.rs:519-522 | 前端未调用 |
| `gh_status` command + `GhCliStatus` | lib.rs:524-527 | 前端未调用 |
| `app-server:stderr` 事件 | app_server.rs:239 | 前端未监听（app-server 日志不可见） |
| `app-server:server-request-resolved` 事件 | app_server.rs:403 | 前端未监听 |
| `bridge.ts` 的 `isTauriRuntime` / `tauriListen` | bridge.ts | App 用了 tauriListen；DiffDrawer/TerminalDock 绕过封装直接 import `@tauri-apps/api` |
| `SkillsMcpView` 的搜索框 | SkillsMcpView.tsx:356-362 | `searchQuery` 只过滤 plugins tab 的 3 条，skills/mcp 未使用 |
| `SettingsView` 的 `mode`（visual/raw） | 215, 765, 1533-1549 | visual/raw 切换按钮只在 `providers-models` section 内；但它影响**全局顶栏保存按钮**（765）——在 providers-models 里切到 raw 后再去其它 section，顶栏“保存更改”仍会走 `handleSaveRaw`（保存的是整份 rawToml），行为不易察觉 |

---


## 16.1 并行新增文件（06:54 后）中的遗留缺口

| # | 文件:行 | 内容 | 性质 | 难度 |
|---|---|---|---|---|
| P1 | `src/protocol.ts:243-254` | `normalizeApprovalDecision` 对 legacy `execCommandApproval`/`applyPatchApproval` 仍返回 `{decision:"accept"}` | 与 legacy `ReviewDecision` 词表（approved/approved_for_session/denied/abort）不匹配；注释与实现不符 | 易 |
| P2 | `src/protocol.ts:208-227` | `classifyServerRequest` 未覆盖 `item/tool/call`、`mcpServer/elicitation/request` | 这两类会落到 `generic`，应答仍不正确 | 中 |
| P3 | `src/App.tsx`（新 222 行 `tokenUsage`） | 已监听 `thread/tokenUsage/updated` 并 merge 进 state，但用量 popover（新 1905-1936）仍显示旧的 4 项本地信息 | 数据已到手但未展示 | 易 |
| P4 | `src/App.tsx`（新 721-736 附近） | `warning/configWarning/deprecationNotice/guardianWarning/error` 仅 `console.warn/error` | 用户不可见 | 易（接 toast） |
| P5 | `src/App.tsx`（新 2680-2683） | `ApprovalCenter` 替换旧卡后，旧的内联审批 CSS/逻辑可能残留 | 需在合并时清理 | 易 |
---

## 17. 建议修复顺序（与 CURRENT-AUDIT §30 对齐）

1. **易且影响核心链路**：A10（approvalPolicy）、A16/A18（steer）、A17（interrupt）、A19（UserInput 应答）、A25（MarkdownView 接线）、A26（fileChange 渲染）、E22（prefs 覆盖 bug）。
2. **易且消除误导**：E6（保存文案）、E23（VS Code 导入假文案）、E7（MCP 假检测）、R1/R2/R3（硬编码模型）、A24（120ms hack 改事件驱动）。
3. **中**：A11/A23（超参数要么删要么走真实协议）、A20（按 method 分派审批应答）、A6（Inbox 持久化）、E5（逐项接 Settings 开关）、F5（MCP reload）、G5（browser tab 明示仅预览）。
4. **难**：自动化调度器、computer-use、appshots、browser-use、hooks 执行器、插件市场、真实 Goal、realtime voice、系统通知/登录。


