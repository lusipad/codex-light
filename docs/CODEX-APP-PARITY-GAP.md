# 对标官方 Codex App：完整差距分析（界面 + 功能 + 协议）

> 生成时间：2026-10-23
> 分析对象：`codex-desktop-native`（Tauri v2 + React 19 + Rust）↔ 本机已安装的官方 **Codex App（Electron）26.928.x**
> 结论一句话：**界面骨架已对齐约 6~7 成，但"功能真实度"只有约 1/3；协议（app-server）只接了 16%，设置页约一半开关是"只写 JSON 不生效"。核心对话链路还有 4 个必坏点，本轮已修 3 类。**

详细取证资料（本次从官方 `app.asar` 与真实 app-server 提取，全部可复现）：

| 文件 | 内容 |
|---|---|
| [reference-inventory.md](research/reference-inventory.md) | 官方 App 17 章功能面清单（109KB，约千行表格） |
| [feature-index.json](research/feature-index.json) | 43 模块 / 212 功能点（in-scope / out-of-scope），可机器比对 |
| [current-audit.md](research/current-audit.md) | 本项目 32 模块真实度审计（REAL/PARTIAL/MOCK/MISSING + 证据行号） |
| [stubs.md](research/stubs.md) | 全部占位/硬编码/无效实现精确位置（按文件 + 修复难度） |
| [backend-surface.md](research/backend-surface.md) | 64 个 Tauri command ↔ 前端调用点 ↔ 协议方法/通知矩阵 |
| [protocol-features.md](research/protocol-features.md) / [protocol-runtime-methods.txt](research/protocol-runtime-methods.txt) | app-server 运行时 170 个方法 / 84 通知 / 11 个服务端请求的完整能力图 |
| [protocol-probe-summary.md](research/protocol-probe-summary.md) | 真实环境协议探针实测返回（已登录 Plus 账号、真实 threads/projects/plugins） |

> 逐轮实施进度与已完成项见 [IMPLEMENTATION-LOG.md](IMPLEMENTATION-LOG.md)：**Round 1** 差距分析 + 审批协议正确化；**Round 2** 核心链路补全（流式 diff/plan/用量、fork/revert/compact、快速搜索、真实用量/额度）；**Round 3** 批次 2（设置 config 协议化 + 实验特性/账号额度、fs/* + fs/watch + 资源管理器、真实 plan 模式、线程状态条、Inbox 持久化、Code Review）；**Round 4** 批次 3（服务端驱动 Goal、thread/queue、自定义分区、项目实体、插件市场/Apps/Skills 协议化、Windows 沙箱就绪检测）。

---

## 0. 结论摘要（TL;DR）

### 0.1 对齐度评分（主观量化，便于定目标）

| 维度 | 官方基线 | 本项目现状 | 对齐度 |
|---|---|---|---|
| 视觉/布局骨架（侧栏、线程页、Composer、Diff 抽屉、设置页） | — | 已有像素级近似实现 | **~70%** |
| 核心对话链路（发送/流式/中断/steer/审批/恢复） | 完整 | 骨架可用，**4 个必坏点**（本轮修 3 类） | **~45%**（修复后 ~65%） |
| 线程能力面（fork/revert/compact/附件/分页/分组/目标/队列） | 12 项 | 2 项（列表/删除/归档） | **~17%** |
| Composer 控件深度（模型/推理/speed/权限/计划/环境/@/斜杠命令） | 6 组 40+ 项 | 6 组但多处映射错误/硬编码 | **~50%** |
| 设置页（约 48 分区 / 4,246 条文案） | 全真实、直接影响行为 | 20 分区，**约 46 个开关只写自定义 JSON 无消费方** | **~25%** |
| 协议接入（app-server 170 个方法 / 84 通知 / 11 服务端请求） | 100% | **17 方法 / 8 通知 / 1 类请求** | **~10~16%** |
| 官方特色模块（账号额度、插件市场、Code Review、Projects 实体、Scheduled 调度、Hooks、沙箱安装） | 有 | 基本缺失或用自研近似 | **~15%** |
| 用户可见功能点真实度（audit 口径 175 项粗算） | — | REAL 33% / PARTIAL 33% / MOCK·BROKEN 26% / MISSING 8% | **~33% REAL** |

### 0.2 三句话总结

1. **"看起来都点了，实际一半没接到后端"**：设置开关、Inbox、会话参数、用量、@电脑、插件市场、宠物、电脑操控/浏览器/Hooks 开关属于此类；源码里没有 `TODO/demo/mock`，但存在**约 45 个 MOCK/BROKEN 点**（清单见 [current-audit.md §28](research/current-audit.md)）。
2. **协议能力被严重浪费**：官方 app-server 在本机有 **170 个方法**（账号、项目、线程分组/队列/目标/附件/revert/compact、文件监听、模糊搜索、插件市场、Code Review、实验特性、Hooks、Apps、Windows 沙箱安装……），我们只接了 17 个。Rust 桥本身是通用透传（`app_server_call`），**补齐主要是前端接线，不需要改 Rust**。
3. **真正的"硬功能"集中在 5 块**：Git 全链路、PTY 终端、文件浏览/预览/写入、线程 CRUD（Rust 落盘）、流式回复骨架。其余大面积是 UI 壳。

### 0.3 建议的"底线版"验收标准（我按这个口径做后续）

一个**可以日常替代官方桌面端的 Codex 客户端**，即：

- ✅ 会话：新建/恢复/流式/中断/steer/审批/归档/删除/重命名/fork/回滚/压缩/附件持久化
- ✅ 交互：审批 4 类（命令/文件/权限/提问）全部正确应答，审批结果可追溯
- ✅ 模型与权限：模型/推理档/speed/权限档/计划模式**全部走协议且真实生效**
- ✅ 设置：官方 20+ 核心分区**每一项都有真实消费方**（config 协议读写或明确标注"仅本地偏好"）
- ✅ 工作区：文件树实时刷新（fs/watch）、模糊搜索（fuzzyFileSearch）、命令面板（Cmd+K）
- ✅ 生态：Skills/Plugins/MCP 走协议，Code Review（review/start），Projects 实体，线程分组
- ✅ 账号：登录态/额度/重置时间展示（只读展示即可，不做登录流程）
- ⛔️ 不含：ChatGPT 云端 Artifacts/Canvas/云浏览器/语音通话/计费钱包/团队合规/云环境/实时语音

---

## 1. 界面差距（逐模块）

### 1.1 应用骨架 / 信息架构 / 侧边栏

| 官方能力 | 官方细节 | 本项目现状 | 差距 |
|---|---|---|---|
| 产品模式切换 | ChatGPT / ChatGPT Work / Codex / Home 四态 | 无（只做 Codex） | 可接受（超出范围） |
| 侧栏结构 | Search、New chat、Pinned、Activity（未读/等待视图）、Chats、Projects、导航链接（Home/Scheduled/Projects/Skills/Plugins/Code Review/Pull requests/Archive/Connections/Debug）、Profile/Settings | 有 Search、New chat、置顶、会话列表、9 个导航入口；**无 Activity 视图、无 Archive/Connections/Debug 页、无 Profile 菜单** | 中 |
| 会话排序 | Created / Last updated / Manual order（拖拽） | 无排序菜单，仅默认顺序 | 中 |
| 自定义分区 | New section / Edit / Remove / 拖入 chat 或 project | **完全没有**（官方后端有 `threadSection/*`） | 大 |
| 分组方式 | By connection / By project / In one list | 无 | 中 |
| 侧栏批量操作 | 多选归档/置顶/标记已读 | 无 | 小 |
| 会话行 hover card | 标题、emoji、项目名、未读、等待数 | 部分（标题/预览/时间） | 小 |
| 窗口/标题栏 | 自绘标题栏 + Windows titleBarOverlay、托盘、Deep link、多窗口/Popout/Mini、退出确认、自动更新入口 | 原生标题栏、无托盘/多窗口/深链/更新检查 | 中 |

### 1.2 Home 首页

| 官方 | 现状 | 差距 |
|---|---|---|
| 问候语随模式/项目变化（"What should we build in {project}?"） | 有近似文案 | 小 |
| 完整 Composer | 有 | 见 1.4 |
| Starter prompts 卡片（任务建议、可刷新/关闭、连接器建议、ambient 建议） | **4 张硬编码卡片**（`STARTER_PROMPTS`） | 中 |
| 账户不可用/任务启动等状态态 | 无 | 小 |

### 1.3 线程视图（差距最大的一块）

| 官方能力 | 现状 | 差距 |
|---|---|---|
| item 类型渲染：userMessage / agentMessage / reasoning / commandExecution / **fileChange** / **mcpToolCall** / **webSearch** / **plan(todo)** / **contextCompaction** | 只渲染 5 种；fileChange 取错字段（永远 "+0 -0"）；mcp/webSearch/plan/compaction 不渲染 | **大** |
| turn 状态文案（Working/Worked for/Paused/出错重试/用量超限） | 只有基础流式状态 | 中 |
| **Changes(diff) 面板**：来源 Last turn/Branch/Commits/Branch comparison、Staged/Unstaged、Auto/Split/Unified、mark viewed、word wrap、word diffs、Copy `git apply`、Revert file/hunk、大 diff 单文件模式、未跟踪文件提示、rich preview | DiffDrawer 已有 4 tab + Unified/Split + stage/unstage/commit/discard，但**无 turn 级 diff、无 mark viewed、无 hunk 级 revert、无 branch comparison 提交选择** | 中 |
| 审批卡片：Allow once / Allow this conversation / Always allow(execpolicy) / Deny + auto-review nudge + Enter/Esc 快捷键 | **本轮已重写**为协议正确版（命令/文件/权限/提问 4 类 + 记忆规则 + scope）；仍缺：auto-review 提示、Enter/Esc、legacy 两类审批、`item/tool/call`、MCP elicitation | 中 |
| 终端：底部/右侧面板、多标签、后台终端、环境 setup 脚本展示 | PTY 多标签终端已真实可用；**无后台终端列表、无 setup 脚本集成、无"停止全部后台终端"** | 小~中 |
| 侧面板/标签页：Files/Changes/Terminal/Browser/Desktop/Side chat、拖拽分屏、Pin tab | 只有右侧 Diff 抽屉 + 底部终端，**无多 tab 体系** | 中 |
| 线程操作菜单：Rename/Pin/Archive/Mark unread/Open in new window/Side chat/Copy 子菜单/**Fork 子菜单**/Continue in/删除 | 有重命名/置顶/归档/删除；**无 fork 入口、无 copy 子菜单、无 side chat、无 mark unread** | 中 |
| 消息级：复制、举报、从某条消息 fork、编辑最后一条消息、find bar、引用/批注 | 有复制/重新生成；其余无 | 中 |
| 上下文用量 / 速率限制 / `/status` | **假数据**（本地 turns.length） | 中（P1 可接 `thread/tokenUsage/updated`） |
| 空态/恢复态（归档提示、目录失效、重连、重试历史） | 基本无 | 中 |

### 1.4 Composer

| 官方 | 现状 | 差距 |
|---|---|---|
| 模型选择：Default/Custom/recent/locked/Daybreak | 下拉可用（真实 `model/list`）；但有硬编码假模型 `gpt-5.4`/`gpt-5.3-codex` | 小 |
| 推理档：None/Minimal/Light/Medium/High/xHigh/Max/Ultra/Persistent | 4 档（low/medium/high/extra_high），**本轮已改为 low/medium/high/xhigh/max/ultra**；未按模型能力过滤 | 中 |
| Speed：Standard / Fast(1.5x) / Ultrafast | 有 Fast 开关，映射 `priority` 未校验账户能力 | 小 |
| Approval policy 4 档 + sandbox 3 档 + permissions 菜单 | 3 档（请求批准/自动/完全访问），**自动档此前映射非法枚举（本轮已修）**；无 permissions 子菜单 | 中 |
| Plan 模式（真实 collaborationMode/plan 协议） | **只是提示词前缀** | 中 |
| Work in：This computer / Worktree / Remote / Cloud + environment 选择 | 有 useWorktree 开关（真实创建 worktree）；无 remote/cloud/environment 选择器 | 中 |
| 附件：文件/图片/@mention/skills/引用/批注 | 附件只拼路径文本进 prompt；@ 文件/@ 技能真实；无图片输入、无协议 input 类型 | **大** |
| 斜杠命令 30+（/plan /goal /review /fork /side /new /compact /init /mcp /status /model /reasoning /speed /project /local /worktree /cloud /ide /memories /rename /archive /pin /feedback /pet …） | 10 条，且 /review /compact /init /test 只插提示词 | 中 |
| Queue / Steer（排队、立即引导、Up next 条） | 有 UI（Up next 条 + Steer），**但 steer 协议参数错误导致必失败降级为本地队列（本轮已修）** | 小（修复后） |
| 发送/停止 | 有；**停止此前缺 turnId 必失败（本轮已修）** | 小（修复后） |
| 语音输入/听写 | Web Speech API（WebView2 多半不支持） | 中 |

### 1.5 设置页（官方约 48 分区 / 5 组 vs 本项目 20 分区）

| 分组 | 官方分区（节选） | 本项目 | 差距 |
|---|---|---|---|
| Personal | General、Appearance、Notifications、Import、Personalization、Keyboard shortcuts、Voice、Storage、Pets、Codex Micro、Appshots、Usage | 有 General/Import/Appearance/Voice/Storage/Pets/Keyboard shortcuts/Personalization；**缺 Notifications/Codex Micro/Appshots/Usage** | 中 |
| Coding | Configuration(Agent)、Git、Worktrees、Environments、Code Review、Hooks、Computer use、Browser、Computer history | 有 agent/git/worktrees/local-environments/hooks/computer-use/browser-use/appshots（**多数无执行器**）；缺 Code Review/Computer history | **大（真实度）** |
| Integrations | Plugins、Skills、MCP servers、Connections(SSH/WSL/Devices)、Apps | Plugins/Skills/MCP 有页面但**目录数据硬编码**；Connections/Apps 无 | 大 |
| Archived | Archived chats | 有 | 小 |
| 账号 | Account/Teams/Billing/Safety 等 | **完全没有**（无登录态/额度展示） | 中（可只做只读） |

> 关键：官方这 48 个分区**每一项都连接真实 config/协议**。本项目约 46 个开关只写 `desktopPreferences` 自定义 JSON，**写入后无人读取执行**——这是"看起来能用其实没用"的最大来源。[current-audit.md §15](research/current-audit.md)

### 1.6 其他页面与全局能力

| 模块 | 官方 | 本项目 | 差距 |
|---|---|---|---|
| Projects | 真实 project 实体（`project/*`：创建/编辑/移除/排序/信任/多 source folder） | 工作区目录的表格视图，无 project 实体 | 中 |
| Scheduled（旧 Automations/Inbox） | 定时执行器 + 运行历史 + 心跳 + 通知 | automation.toml CRUD，**无调度器/执行器/历史**；Inbox 纯内存 | **大** |
| Skills | `/skills` 页面 + `skills/list` 协议 + 变更监听 | 有真实技能库（读 `~/.codex/skills`）；未接协议、无变更监听 | 小 |
| Plugins | 插件市场（`plugin/list` 17MB 真实目录、安装/卸载/分享、marketplace 管理） | **硬编码假目录** | **大** |
| MCP | 状态/资源/工具直调/OAuth/elicitation | 状态与配置真实；无资源浏览/工具直调/OAuth | 中 |
| Code Review / Pull requests | `review/start` + PR 页 + 修复建议 | **完全没有** | **大** |
| 搜索 | Cmd+K 命令菜单 + `fuzzyFileSearch` 实时增量 + `thread/search` + 命令面板 161 条命令 | Ctrl+K 弹窗但搜索源是已加载前端数组 | 中 |
| 快捷键 | 161 条命令注册表 + 可在设置改键 + 菜单 accelerator 动态生成 | 5 个硬编码快捷键 | 中 |
| 原生菜单 | File/Edit/View/Window/Help + 托盘 + 21 个 preload channel | 无（Tauri 默认菜单） | 中 |
| 通知 | 桌面系统通知 + 未读持久化 + 免打扰 + 音效选择 | 应用内 toast + 双音提示；无系统通知/持久化 | 中 |
| 多窗口 | New Window / Open in New Window / 标签拖出 / Popout / Mini | 无 | 中（可 P2） |
| Hooks | 11 类生命周期事件 + 执行器 + 可视化 | 只有表单 | 中 |

---

## 2. 功能差距（协议视角，最可执行的清单）

### 2.1 协议覆盖度实测

| 类别 | app-server 提供（0.159.0 运行时） | 本项目已引用 | 覆盖率 |
|---|---|---|---|
| Client → Server 方法 | **170**（`generate-json-schema` 非实验 105、实验 167） | 17 | **10~16%** |
| Server → Client 通知 | 84 | 9（本轮 +1 resolved） | **~11%** |
| Server → Client 请求（必须 UI 应答） | 11 类 | 4 类（本轮补齐；legacy 2 类/elicitation/dynamicTool 仍缺） | **~36%** |

已接的方法：`initialize`、`model/list`、`mcpServerStatus/list`、`skills/list`、`thread/{start,resume,read,list,archive,unarchive,delete,fork,name/set,turns/list}`、`turn/{start,steer,interrupt}`。

### 2.2 未接的能力域（按用户价值排序）

| # | 能力域 | 协议方法 | 用户可见价值 | 优先级 |
|---|---|---|---|---|
| 1 | 线程目标（真 Goal 模式） | `thread/goal/set|get|clear` + `thread/goal/updated` | 自主任务持久化、跨重启；替换自研假 loop | **P0** |
| 2 | 线程生命周期 | `thread/metadata/update`、`thread/revert`、`thread/compact/start`、`thread/attachment/*`、`thread/items/list`、`thread/loaded/list`、`thread/unsubscribe` | 回滚、手动压缩上下文、附件随会话持久化、长会话分页 | **P0** |
| 3 | 文件系统实时 | `fs/watch`/`unwatch` + `fs/changed`、`fs/{createDirectory,remove,copy,writeFile,getMetadata}` | AI 改文件后文件树自动刷新；资源管理器新建/重命名/删除 | **P0** |
| 4 | 模糊搜索/命令面板 | `fuzzyFileSearch` + `fuzzyFileSearch/session{Start,Update,Stop}` 通知 | Cmd+K / Cmd+P / @ 引用真实文件（带 score/indices 高亮） | **P0** |
| 5 | 配置真实化 | `config/read`、`config/value/write`、`config/batchWrite`、`configRequirements/read`、`config/mcpServer/reload` | 设置页所有开关真实生效 + 热重载 MCP | **P0** |
| 6 | 流式事件补全 | `turn/diff/updated`、`turn/plan/updated`、`item/plan/delta`、`item/fileChange/*`、`item/mcpToolCall/progress`、`thread/tokenUsage/updated`、`thread/settings/updated` | 本轮 diff 实时、计划步骤、token 用量环 | **P0** |
| 7 | 线程分组 | `threadSection/*`、`thread/section/move` | 侧栏自定义分组/拖拽排序（官方核心 IA） | P1 |
| 8 | 项目实体 | `project/{list,read,create,import,update,move,delete}` + `project/changed` | Projects 页真实化 | P1 |
| 9 | 插件与市场 | `plugin/{list,installed,read,install,uninstall,reconcile,search,skill/read}`、`marketplace/{add,remove,upgrade}`、`plugin/share/*` | 插件中心真实数据（本机 `plugin/list` 返回 17MB 真实目录） | P1 |
| 10 | Code Review | `review/start`（staged/unstaged/base branch + findings 列表） | 一键代码审查 | P1 |
| 11 | 账号与用量 | `account/read`、`account/rateLimits/read`、`account/usage/read`、`account/workspaceMessages/read`、`account/{login,logout}` | 登录态、额度、重置时间、用量统计（本机已登录 Plus，可真实展示） | P1 |
| 12 | Windows 沙箱 | `windowsSandbox/readiness`、`windowsSandbox/setupStart` + 通知 | 沙箱就绪检测与一键安装（官方"底线"体验） | P1 |
| 13 | 实验特性 | `experimentalFeature/list`（本机 152 项带描述）、`experimentalFeature/enablement/set` | 设置页实验特性开关 | P1 |
| 14 | 线程队列 | `thread/queue/{add,list,update,delete,reorder,start}` | 官方排队消息（不只是前端 Up next 条） | P1 |
| 15 | 命令执行/进程 | `command/exec(+write/resize/terminate)`、`process/{spawn,writeStdin,kill,resizePty}`、`thread/backgroundTerminals/*` | 协议级终端/后台进程（现自研 PTY 等价，可后置） | P2 |
| 16 | Hooks / Apps / 导入 | `hooks/list` + `hook/*`、`app/{list,read,installed}`、`externalAgentConfig/*` | Hooks 可视化、连接器、从其他工具导入配置 | P2 |
| 17 | 其他 | `thread/search`、`thread/searchOccurrences`、`thread/timeline/list`、`collaborationMode/list`、`permissionProfile/list`、`modelProvider/capabilities/read`、`feedback/upload`、`memory/*`、`remoteControl/*`、`environment/*`、`userVerification/*`、`rollout/compress` | 逐项增强 | P2/P3 |

---

## 3. "看起来能用、实际不行"清单（本轮已修 6 条，剩余按优先级）

> Round 2 更新：#7（Markdown 运行/打开文件）、#8（fileChange 渲染）、#15（用量假数据）、#18（fork 入口）已修复；#19（通知）已新增 12 类；#16 主题键仍未处理。详见 [IMPLEMENTATION-LOG.md](IMPLEMENTATION-LOG.md)。

| # | 入口 | 原问题 | 状态 |
|---|---|---|---|
| 1 | 停止生成 | `turn/interrupt` 缺 `turnId` → 服务端必拒，UI 假装停止 | ✅ **本轮已修**（保存当前 turnId；状态交给 `turn/completed`） |
| 2 | Steer/立即引导（2 处） | 缺 `expectedTurnId`、错用 `text` 字段 | ✅ **本轮已修**（统一 `{threadId, expectedTurnId, input:[{type:"text"}]}`） |
| 3 | 权限"自动" | 映射非法枚举 `on-failure` → 之后每次发消息必报错 | ✅ **本轮已修**（`on-request` + `approvalsReviewer: auto_review`；full→`never`） |
| 4 | 审批/提问应答 | 所有请求都回 `{decision}`；UserInput 结构错 | ✅ **本轮已修 4 类**（command/fileChange/permissions/userInput，按官方 wire shape）；剩 legacy 2 类、`item/tool/call`、MCP elicitation |
| 5 | 超参数面板（T/P/Tokens/联网/verbosity）与 Settings 10 个参数 | 字段不在协议里且 config.toml 键被 codex 判 unknown | ✅ 部分：turn/start 已改为真实 `sandboxPolicy/effort/serviceTier`；配置键仍需删除或改协议 |
| 6 | 模型/推理档硬编码 | 假模型 `gpt-5.4`/`gpt-5.3-codex`；漏 max/ultra | ✅ 部分：推理档已补 `xhigh/max/ultra`；模型清单仍硬编码回退 |
| 7 | 回答代码块"运行"/文件路径点击 | MarkdownView 回调未传入 | ⬜ 下一批（易） |
| 8 | turn 内文件修改卡 | 取不存在的 `path/insertions/deletions` → 永远 +0 -0 | ⬜ 下一批（易） |
| 9 | Inbox | 纯内存、重启清空、通知永不产生 | ⬜ P1 |
| 10 | "立即运行"计划任务 | 只是新开会话，无定时执行 | ⬜ P1（需调度器） |
| 11 | 语音听写 | WebView2 无 Web Speech → alert | ⬜ P1（接 realtime voice 或系统 ASR） |
| 12 | @电脑 / computer-use、appshots、browser-use、hooks、git 策略、worktree 策略、voice、语气 | 只写 JSON 无消费方 | ⬜ P1/P2 |
| 13 | Settings 插件"已安装扩展"启停 | 硬编码目录 | ⬜ P1（接 plugin/*） |
| 14 | SkillsMcpView plugins/apps/marketplaces tab | 硬编码假目录 | ⬜ P1 |
| 15 | 用量 popover / 会话参数 panel | 纯本地假数据 | ⬜ P0（接 tokenUsage/account.usage） |
| 16 | 主题/偏好键与官方不互通 | 自造 `colorTheme`/`desktopPreferences` | ⬜ P2 |
| 17 | 5 个 Tauri command 未被前端使用 | app_server_status / thread_record_workspace / git_worktree_set_owner / gh_status 等 | ⬜ 低优先（清理或接入） |
| 18 | `thread/fork` 等"能透传但无 UI" | 后端支持、前端无入口 | ⬜ P0（fork 入口） |
| 19 | 未监听 75+ 通知 | 线程状态、队列、用量、MCP 状态等全部不可见 | ⬜ P0/P1 |
| 20 | 桌面通知/托盘/自动更新 | 完全缺失 | ⬜ P2 |

---

## 4. 本轮已完成的代码改动（未提交，`npm run build` ✅）

| 文件 | 改动 |
|---|---|
| `src/protocol.ts`（新增，~330 行） | app-server 协议类型 + 精确应答构造器（command/fileChange/permissions/userInput/optionPicker）、请求分类、通知常量表、tokenUsage/rateLimits 稀疏合并工具 |
| `src/components/ApprovalCenter.tsx`（新增，~560 行） | 协议正确的审批中心：命令审批（命令/cwd/network/reason/execpolicy 记忆/5 种决策）、文件变更审批、权限审批（文件系统条目/网络/scope/严格审查）、多问题提问卡（header/options/description/isOther/isSecret）、选项选择器与通用兜底 |
| `src/App.tsx` | ①审批渲染替换为 `<ApprovalCenter>`；②`serverRequest/resolved` 自动关闭审批卡；③连接后回填未决请求（`app_server_pending_requests`）；④`turn/interrupt` 补 `turnId`；⑤`turn/steer` 补 `expectedTurnId`+`input`；⑥approvalPolicy/approvalsReviewer 合法化；⑦`turn/start` 改真实 `sandboxPolicy/effort/serviceTier`；⑧新增 `activeTurnId` 跟踪；⑨`thread/tokenUsage/updated` 状态接入；⑩`thread/name|archive|delete|unarchive` 通知同步；⑪警告类通知落日志 |
| `src/components/ComposerBox.tsx` | 推理档补 `xhigh / max / ultra`，移除无效 `extra_high` |
| `src/styles.css` | 新增审批中心整套样式（~380 行） |
| `docs/` | 本次研究资料 + 本报告（官方清单、审计、占位清单、协议图） |

---

## 5. 建议路线图（按批次推进，每批可独立验收）

### 批次 1：核心链路修复（P0，预计 1 轮）
- [x] 停止/steer/审批策略/审批应答 4 类（本轮）
- [ ] MarkdownView 回调接线（代码块运行、文件路径打开）
- [ ] turn 内 `fileChange.changes[]` 渲染 + `turn/completed` 合并 items
- [ ] `item/reasoning/textDelta`、`item/plan/delta`、`turn/plan/updated`、`turn/diff/updated`、`thread/tokenUsage/updated` 全部驱动 UI
- [ ] 用量 popover 换成真实 tokenUsage；删除会话参数假面板或改为协议不支持的提示
- [ ] fork 入口（`thread/fork`）、`thread/revert`、`thread/compact/start`
- **验收**：一条会触发审批的任务（改文件+跑命令）全程可批准/拒绝/中断；流式 reasoning/plan/diff 实时可见；停止后 turn 状态正确。

### 批次 2：设置真实化 + 工作区（P0）
- [ ] `config/read` 全量接入设置页（model/approval/sandbox/tools/features/mcp_servers/model_providers/permissions/personality…）
- [ ] 删除 10 个 codex 不认识的 config 键；改成协议字段或标注"仅展示"
- [ ] `fs/watch` 文件树实时刷新；资源管理器新建目录/删除/复制/重命名
- [ ] `fuzzyFileSearch` 接 Cmd+K/Cmd+P/@ 引用（带高亮）
- [ ] `config/mcpServer/reload`；MCP 状态通知
- **验收**：设置任意开关后 `codex --strict-config` 通过且行为变化可观测；AI 改文件 1s 内文件树刷新；Cmd+P 搜索真实文件。

### 批次 3：官方特色面（P1）
- [ ] `thread/goal/*` 替换自研 GoalRunner（持久化、跨重启）
- [ ] `threadSection/*` 侧栏分组 + 拖拽
- [ ] `project/*` Projects 页实体化
- [ ] `plugin/*` + `marketplace/*` 插件中心真实化；`skills/*` 协议化
- [ ] `review/start` Code Review 页面
- [ ] `account/read|rateLimits|usage` 只读账号/额度/用量
- [ ] `experimentalFeature/list|set` 实验特性页
- [ ] `windowsSandbox/readiness|setupStart` 沙箱安装引导
- [ ] 线程队列 `thread/queue/*`
- **验收**：上述页面全部数据来自协议；无硬编码数组。

### 批次 4：桌面体验（P1/P2）
- [ ] 原生菜单（Tauri Menu）+ 命令注册表 + 可改键快捷键
- [ ] 桌面系统通知 + 未读持久化 + 免打扰
- [ ] 自动化调度器（Rust 定时执行 automation.toml，参考官方心跳行为）
- [ ] 托盘、多窗口/Popout、Deep link、退出确认、更新检查
- [ ] Inbox 持久化并接入真实事件

### 批次 5：收尾与差异（P2）
- [ ] hooks 执行器与可视化；apps/connectors；externalAgentConfig 导入向导
- [ ] MCP 资源/工具直调/OAuth；apps `app/*`
- [ ] 与官方 global state 键兼容（theme / electron-persisted-atom-state）
- [ ] 逐页文案/像素对齐（官方 4,246 条 label 已导出，见 `.ref/reference/settings-labels.txt`）

---

## 6. 需要你确认的三件事

1. **范围**：是否同意"底线版 = Codex 模式基线（不含 ChatGPT 云端/语音/浏览器/计费）"？如果要包含账号登录流程或实时语音，工作量会翻倍。
2. **优先级**：是否按上面批次 1→4 顺序推进？若你更在意"看起来像官方"（视觉/文案/菜单），可以先做批次 4 的界面项。
3. **Settings 的"仅本地偏好"开关**：官方有些能力（computer-use/appshots/browser-use/hooks/电脑历史）依赖官方插件，本项目短期无法真实实现——**保留 UI 并明确标注"需要官方插件，当前不可用"**，还是直接隐藏？我建议前者（保留占位 + 灰态提示），避免"点了没反应"。

---

## 附录：证据与方法

- 官方 UI 来源：`C:\Users\lus\Codex\_internal\app\resources\app.asar`（555MB；`webview/assets` 19,087 个资源；868 个 i18n chunk 共 13,980 条文案；161 条命令注册表；4,246 条设置 label；48 个设置分区）。抽取方法：`@electron/asar extract-file` + 主进程 bundle 字符串分析。
- 协议来源：`codex app-server generate-json-schema`（0.159.0）+ 运行时枚举（170 方法）+ 真实环境探针（登录态、threads、projects、plugins、skills、rateLimits、experimentalFeatures 等 24 个真实返回，见 [protocol-probe-summary.md](research/protocol-probe-summary.md)）。
- 本项目现状：全量源码审计（`src/**` 22 文件 + `src-tauri/src/**` 6 模块；64 个 Tauri command；实跑 `npm run build` / `cargo check`）。
- 复现脚本在 `.ref/scripts/`（asar 抽取、bundle 字符串上下文、协议探针、方法枚举）。
