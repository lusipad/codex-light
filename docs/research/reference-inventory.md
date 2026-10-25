# 官方 Codex App（Electron）参考清单 / REFERENCE-INVENTORY

> 目标：对标官方 Codex 桌面端（Tauri 项目的差距分析基线）。本文只覆盖 **Codex 桌面端基线能力**；ChatGPT 云端专属功能集中列在文末「超出范围」。
>
> **2026-10-25 更新：全 App 页面总表、Computer Use 实测和路由／可见性纠错见 [codex-app-full-surface.md](codex-app-full-surface.md)。本文保留为 Codex 专项历史明细，不再单独作为“完整 App 清单”；文中“全量”“100%”及“未运行官方 App”等旧表述以新文档为准。**
>
> 所有中文为叙述，引号内为官方英文原文（renderer i18n `defaultMessage`，从 app.asar 提取），证据给出 `message-id` 与所在 chunk 文件名。

---

## 0. 样本、版本与证据链

| 项 | 值 | 证据 |
|---|---|---|
| 应用 | Codex（ChatGPT Desktop 同体，`productName: "Codex"`） | `.ref/asar-files/app-package.json` |
| 版本 | `26.928.21956`，build number `12404`，build flavor `prod` | 同上（`version` / `codexBuildNumber`） |
| 壳 | Electron `42.3.0` + electron-forge + Vite（`@electron-forge/plugin-vite`） | app-package.json devDependencies |
| 安装位置 | `C:\Users\lus\Codex\_internal\app\resources\app.asar`（555 MB） | 任务给定 |
| Renderer | React 单页应用，`webview/index.html` 引 `./assets/index-6f645554f9dd.js` + `app-shared-a906948d8868.js`（7.7 MB） | `.ref/asar-files/webview-index.html` |
| 资源规模 | `webview/assets` 下 **19,087** 个 renderer 资源 | `.ref/renderer-asset-filenames.txt` |
| 主进程 | `.vite/build/main-DkWgQSQe.js`（3.7 MB）——菜单/窗口/托盘/更新/协议 | `.ref/scratch/main-DkWgQSQe.js` |
| preload | `.vite/build/preload.js`（6.9 KB）——`contextBridge` + IPC channel | `.ref/scratch/preload.js` |
| 核心命令注册表 | `.vite/build/bootstrap-DvSEn4qy.js`（2.2 MB）——161 条命令定义（含默认快捷键） | `.ref/scratch/files/bootstrap-DvSEn4qy.js`、`.ref/scratch/commands.tsv` |
| 设置注册表 | `app-initial-fd3c4b862660.js`——设置分区有序数组 + 导航分组 + 标题 i18n | `.ref/scratch/files/app-initial-...js`（`HDa`/`RDa`/`mi` 数组） |
| 文案目录 | 从 868 个 chunk 提取 **13,980** 条 i18n `id + defaultMessage + source` | `.ref/scratch/catalog-full.tsv` |
| 设置文案 | 4,246 条 `settings.* / settingsModal.* / settings-search.* / keyboardShortcutsDialog.*` | `.ref/reference/settings-labels.txt` |

**抽取复现**（不会覆盖仓库文件，必须在 `.ref/scratch` 下执行）：

```powershell
cd D:\Repos\codex-desktop-native\.ref\scratch
npx --yes @electron/asar extract-file "C:\Users\lus\Codex\_internal\app\resources\app.asar" .vite/build/main-DkWgQSQe.js
# 或批量（本任务用 @electron/asar 的 Node API，见 scratch/extract-many.cjs）
```

> 引用约定：证据列中的 message-id 有时省略了模块前缀（如 `composer.plainTextMode` 即 `settings.general.composer.plainTextMode`），完整对照以 `.ref/reference/settings-labels.txt` 与 `.ref/scratch/catalog-full.tsv` 为准；命令给出 `commands.tsv` 中的 command id。
>
> 说明：官方几乎全部 UI 文案都走 react-intl：`{id:`xxx.yyy`,defaultMessage:`English`}`。因此「可见文案」可以 100% 精确还原；本报告中的 message-id 均可回查 `catalog-full.tsv` / `settings-labels.txt`。

---

## 1. 应用整体 IA（信息架构）

### 1.1 产品模式（一个 App 三套工作面）

官方桌面端把 ChatGPT 与 Codex 合并为一个 App，用「产品模式」切换（`sidebarElectron.productMode.*`）：

| 模式 | 文案 | 描述文案 | 证据 |
|---|---|---|---|
| ChatGPT | `ChatGPT` | — | `sidebarElectron.productMode.chatGpt` |
| ChatGPT Work | `ChatGPT Work`（不可用时 `ChatGPT Work` 置灰） | `Create, learn, and explore` | `productMode.work.description.recommended` |
| Codex | `Codex` | `Build, debug, and ship` | `productMode.codex.description.developer` |
| Home | `Home` | — | `productMode.home` |
| 触发器 aria | `Switch mode, current mode: {mode}` | — | `productMode.trigger` |

本项目对标的是 **Codex 模式**（以及 Codex 模式下的 Home/Popout/Mini）。

### 1.2 页面骨架

```
┌───────────────────────── 主窗口（自绘标题栏，窗口控制融合） ─────────────────────────┐
│ 左侧栏 Sidebar（可折叠） │ 主内容区（Home / Chat / Projects / Scheduled / Skills /    │
│  - 产品模式切换           │   Plugins / Code Review / Settings …）                     │
│  - Search / New chat      │  ├─ 线程标签条（Chat + 多个 tab）                          │
│  - Pinned / Chats         │  ├─ 对话流（turns/items）                                  │
│  - Scheduled / Projects   │  └─ Composer（输入区，可能悬浮/停靠）                       │
│  - 导航链接（Skills…）     │ 右侧/底部面板：Changes、Terminal、Browser、Files、Side chat │
│  - Profile / Settings     │                                                             │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

- 顶部有更新入口：`Update available`（`appHeader.updateAndRestart`）、`Downloading {percent}%`、`Restart to update`（`sidebarElectron.internalAlphaUpdateBanner.*`）。
- 主线程区有自绘标题栏 `Chat toolbar`（`threadWorkspace.chatTitlebar.label`），无边框窗口 + 自绘拖拽区（`webview-index.html` `.startup-loader{-webkit-app-region:drag}`、`appShell.header.bottomPanel`）。
- **窗口控制**：主窗口按平台用自绘标题栏——macOS `titleBarStyle: "hiddenInset"` + `trafficLightPosition`；Windows/Linux `titleBarStyle: "hidden"` + `titleBarOverlay`（右上角原生 min/max/close 覆盖层）。独立窗口（detached）同样 `hidden` + overlay；Quick Chat 在 macOS 为透明浮窗。证据：`main-DkWgQSQe.js` 窗口选项工厂（搜索 `titleBarOverlay` / `trafficLightPosition`）。
- 支持「浮动导航轨」布局变体：`floating-navigation-rail-layout-*.js/.css`；`sidebarElectron.rail.*` 提供 `Chats / Home / Plugins / Settings` 目的入口与拖拽排序（`rail.reorder.pickedUp/moved/released/instructions`）。

### 1.3 左侧栏（Sidebar）结构

来源：`sidebarElectron.*`（317 条）、`codex.sidebarBulkContextMenu.*`、`sidebarCustomization.*`。

| 区块 | 官方文案 | 行为要点 | 证据 |
|---|---|---|---|
| 模式切换 | `ChatGPT` / `ChatGPT Work` / `Codex` | 顶部模式切换器；Codex 模式显示 Codex 导航 | `sidebarElectron.productMode.*` |
| 搜索 | `Search` | 打开命令菜单/会话搜索（见 §11） | `sidebarElectron.search` |
| 新建 | `New chat`；`Start new task in {connection}`；`Start new chat in {folder}` | 顶部新建按钮；在连接/分组内新建 | `sidebarElectron.newThread` / `newThreadInConnection` / `newThreadInGroup` |
| 置顶 | `Pinned`（`Pinned options`） | 置顶会话可拖拽排序；失败提示 `Couldn't save pinned order` | `sidebarElectron.pinnedThreads(.v2)` / `pinnedOrder.saveError` |
| 活动视图 | `Activity`；`View activity`；`Nothing needs attention` | 显示 unread/active/awaiting 的会话；可过滤 `Chat / Work / Cloud / Codex`；`Mark all as read`；`Clear read chats`；`Turn off activity view`；选项菜单 `Priority section / Pinned / Scheduled` | `sidebarElectron.activityNavigation` / `priorityThreads.*` |
| 会话列表 | `Chats` | 行内：标题、emoji、项目名、未读数、等待数；会话 hover card | `sidebarElectron.recentChats` / `threadHoverCard*` |
| 排序 | `Sort chats by`：`Created` / `Last updated` / `Manual order` | 手动排序（`Manual order`） | `sidebarElectron.chatsSortMenu.title` / `sortMenu.*` |
| 已排期任务 | `Scheduled`（导航链接） | 进入 Scheduled tasks 页（见 §7） | `sidebarElectron.inboxRouteNavLink` |
| 项目 | `Projects`；项目 hover card：`{count} active` / `{count} task(s)` / `{count} unread` / `{count} waiting`；`Pin project` / `Edit project` / `Open {source}` / `Remove project` | 项目行按连接分组；缺失目录 `This project folder was deleted or moved`；`Open in Finder/Explorer/File Manager` | `sidebarElectron.projectsNavLink` / `projectHoverCard.*` / `removeProject.*` |
| 分组方式 | `By connection` / `By project` / `In one list`；`Organize sidebar` | 侧栏分组切换 | `sidebarElectron.groupByMenu.*` / `flatProjectSidebar.*` |
| 自定义分区 | `Custom sections`：`New section`（`Group chats and projects however you like`）/ `Edit section` / `Remove section` / `Mark all as read` / `Archive chats` | 用户自定义侧栏分区，可把 chat/project 拖入 | `sidebarElectron.customSections.*` |
| 连接 | `Local` / `Remote` / `Cloud (Legacy)`；`Connection failed` / `Reconnecting…` | 远程连接（SSH/WSL/已登录设备）作为一侧栏分组 | `sidebarElectron.connectionGroup.*` / `connectionStatus.*` |
| 导航链接 | `Home`、`Scheduled`、`Projects`、`Skills`、`Plugins`、`Code Review`、`Pull requests`、`Archive`、`Connections`、`Debug` | 见 §1.4 | `sidebarElectron.homeNavigation` / `skillsRouteNavLink` / `skillsAppsRouteNavLink` / `codeReviewRouteNavLink` / `pullRequestsRouteNavLink` / `archiveNavLink` / `connectionsNavLink` / `debugNavLink` |
| 归档 | `Archive` | 归档页（Archive view） | `sidebarElectron.archiveNavLink` / `archivedTasks.*` |
| 底部 | Profile 菜单 / `Settings` | 设置入口；账户菜单 `Profile` / `Open config.toml` / `Log Out` | `codex.profileDropdown.*` / `sidebarElectron.rail.settings` |

会话行/批量操作（context menu）：

- `Rename chat`（标题 + emoji；对话框副标题 `Keep it short and recognizable`，占位 `Add a title…`）
- `Pin chat` / `Unpin chat`
- `Mark as read` / `Mark as unread`
- `Archive chat`（若在运行：`Stop and archive`；若挂了计划任务：`Archive chat and remove scheduled task?`）
- `Permanently delete`（`Delete task?` / `This permanently deletes the task and its subagent tasks. This cannot be undone.`）
- 批量：`Archive chats` / `Pin chats` / `Unpin chats`

证据：`sidebarElectron.renameThread*`、`pinThread*`、`markThreadUnread`、`archiveThread*`、`deleteThreadDialog.*`、`codex.sidebarBulkContextMenu.*`。

### 1.4 导航入口与路由

从 bundle 中提取到的实际路由字面量（`app-initial-fd3c4b862660.js` 等，均为 SPA 内部 path）：

```
/                        （Home）
/projects                （Projects）
/scheduled  /automations /inbox   （Scheduled tasks；旧名 Automations/Inbox）
/skills                  （Skills）
/plugins  /plugins/:pluginId      （Plugins）
/pull-requests           （Pull requests）
/archive                 （Archived chats / Archive）
/settings  /settings/:section/*
/onboarding  /login  /profile  /debug
（ChatGPT 侧：/library /space /sites /work /workspace）
```

设置子路由（实际提取）：`/settings/account`、`/settings/general-settings`、`/settings/appearance`、`/settings/notifications`、`/settings/import`、`/settings/personalization`、`/settings/keyboard-shortcuts`、`/settings/codex-micro`、`/settings/appshots`、`/settings/voice`、`/settings/storage`、`/settings/pets`、`/settings/agent`、`/settings/git-settings`、`/settings/worktrees?tab=environments`、`/settings/local-environments`、`/settings/code-review`、`/settings/mcp-settings`、`/settings/hooks-settings`、`/settings/connections/ssh`、`/settings/connections/wsl`、`/settings/connections/devices`、`/settings/computer-use`、`/settings/computer-use/messages`、`/settings/browser-use`、`/settings/data-controls`、`/settings/usage`、`/settings/teams`、`/settings/cloud-environments?tab=preferences`、`/settings/safety`、`/settings/trusted-contact`、`/settings/security?view=account-pin` 等。

### 1.5 全局能力（跨页面）

| 能力 | 行为/文案 | 证据 |
|---|---|---|
| 命令菜单 | `CmdOrCtrl+K` / `CmdOrCtrl+Shift+P`；见 §11 | `commands.tsv: openCommandMenu` / `codex.commandMenuTitle.openCommandMenu` |
| 全局搜索会话/文件 | `Search Chats…`、`Search Files…` | `codex.commandMenuTitle.searchChats/searchFiles` |
| 更新 | 应用顶栏 + Help 菜单 `Check for Updates…`；安装进度与重启提示 | `appUpdate.*` / `main-DkWgQSQe.js` |
| 关于 | `About {appName}`、`Version {version} • Released {releaseDate}`、`Build information`（Windows 自绘 HTML 弹窗） | `main-DkWgQSQe.js`（`codex.aboutDialog.*`） |
| 退出确认 | 存在进行中的本地会话 / 启用的计划任务 / 待处理的 worktree 会话时弹确认 | `main-DkWgQSQe.js`（`desktop.quitConfirmation.*`） |
| 托盘 | Windows/Linux/macOS 托盘：打开主窗口、新建会话、最近会话、发送反馈 | `main-DkWgQSQe.js`（Tray 构建 `cQe()`） |
| Deep link | `codex://…`（例：`codex://settings/connections`）；Debug 菜单 `Open Deeplink from Clipboard` | `main-DkWgQSQe.js` |
| 多窗口 | `New Window`、`Open in New Window`、标签拖出为独立窗口、Popout Window | 见 §12/§13 |
| 窗口状态 | 关闭确认（`Confirm before closing a window`：`Never` / `Close shortcut only` / `Always`）；全屏 `F11` / `⌃⌘F` | `settings.general.confirmBeforeClose.*` |

---

## 2. Home 首页

来源：`home.*`（152 条，`app-primary-84ad97f06929.js`）、`home-composer-route-*.js`、`lighthouseHome.*`。

| 元素 | 官方文案 | 行为 | 证据 |
|---|---|---|---|
| 主标题/问候 | `Let's build` / `What should we build?` / `What should we work on?` / `What should we build in {projectName}?` / `What should we work on in {projectName}?` | 依据 Codex/Work 模式、是否选中项目切换 | `home.hero.letsBuild` / `noProjectWhatShouldWeBuild` / `workModeWhatShouldWeWorkOn` / `whatShouldWeBuildInSelectedProject` / `whatShouldWeWorkOnInProject` |
| Composer | 完整 composer（模型/权限/项目/附件…见 §5） | 首页即新会话入口 | `home-composer-route-e1c5f7c975ae.js` |
| 快捷建议（starter prompts） | 卡片式建议：`Automate routine and recurring work`、`Automate my morning prep`、`Automate a recurring report`、`Automate triage`、`Figure out next steps…`、`Create a new document/presentation/spreadsheet`、`Create a new website`（含 business/event/portfolio/product 变体） | 点击即填入 prompt 并发送；`Dismiss suggestion` / `Refresh suggestions`；加载/失败态 | `home.newChatPageSuggestions.*`（约 120 条）、`home.starterPrompts.*` |
| 环境感知建议 | `home.ambientSuggestions.*`（`Learn my writing style` 等） | 依据项目文件/连接应用生成建议 | `home.ambientSuggestions.*` |
| 连接器建议 | `Allow ChatGPT to use {app}?` / `Connect` / `Not now` | 建议依赖连接器时弹出 | `home.taskSuggestions.connector.*` |
| 任务启动反馈 | `Task started` / `Open chat` | 后台启动后通知 | `home.taskSuggestions.taskStarted` |
| 出错态 | `We couldn't load your account`（`Reload` / `Sign out`） | 账户不可用兜底 | `home.accountAccessError.*` |

> 注：官方 Home 与「新会话页」是同一路由的两种形态；`/` 即 Home。侧边栏有独立 `Home` 导航链接与 `Chats` 入口（`sidebarElectron.rail.home=Chats`、`rail.homeDestination=Home`）。

---

## 3. Projects 项目页 / 项目创建

来源：`projectsIndex.*`（47）、`projectSetup.*`（58）、`chatgptProjectHome.*`（ChatGPT 侧）、`sidebarElectron.projectHoverCard.*`。

### 3.1 项目列表页

| 元素 | 官方文案 | 证据 |
|---|---|---|
| 标题 | `Projects` | `projectsIndex.title` |
| 列表列 | `Name` / `Updated`（从未更新显示 `-`） | `projectsIndex.column.name/modified` / `modified.never` |
| 空态 | `No projects` / `Create a project to organize chats and give ChatGPT access to folders on your computer.` / `New project` | `projectsIndex.empty*` |
| 搜索 | `Search projects` | `projectsIndex.search.placeholder` |
| 行内区块 | `No chats` / `Show more` / `Start new chat in project` / `Pin project` / `Unpin project` / `Edit project` / `Archive chats` / `Couldn't load chats` | `projectsIndex.*`、`projectsIndex.chatGpt.*` |
| 项目动作菜单 | `Project actions` | `projectsIndex.projectActions` |
| 项目类型标识 | `Local project`（tooltip：`ChatGPT works locally on your computer and can read and edit this project's contents`） | `projectsIndex.localProject.*` |

### 3.2 创建/编辑项目

| 元素 | 官方文案/选项 | 证据 |
|---|---|---|
| 类型选择 | `Create project` → `Local`（`Edit, run, and test files on your computer`）/ `Remote`（`Choose a folder on a connected machine`）/ `Cloud`（`Work through ideas and tasks without setup`） | `projectSetup.createProject.*` |
| Source folders | `Source folders`、`Add folder`、`Make primary`（`Primary`）；tooltip：`Codex looks in the primary folder for AGENTS.md, config.toml, and skill files` | `projectSetup.createLocalProject.*` |
| 设备 | `This computer` / 远程设备列表；`Choose a device` | `projectSetup.device.*` |
| 信任 | `Trust this folder?`（`ChatGPT can read, edit, and execute files here. Folder settings can also run code automatically, even without a model request. Continue only if you trust these files.`）；`Open restricted`；untrusted 来自 `config.toml` | `projectSetup.consent.*` |
| 编辑 | `Edit project` / `Edit remote project`（host/source folder 不可改时禁用） | `projectSetup.editLocalProject.*` / `editRemoteProject.*` |
| 移除 | `Remove {projectLabel}?`；`This only removes the project from the app. Files on your computer and existing chats won't be deleted.` | `sidebarElectron.removeProject.*` |
| 项目内操作 | 新建会话、Pin、Edit、`Archive chats`（含运行中提示 `Stop and archive`） | `sidebarElectron.archiveProjectThreads.*` |


---

## 4. 线程视图（Chat / Thread）

来源：`localConversation.*`（1574 条，`local-conversation-thread-3c15e330d968.js` 等）、`codex.localConversation.*`、`thread.*`、`threadHeader.*`、`threadPage.*`、`threadWorkspace.*`、`codex.review.*`、`review.*`、`approvalRequestCard.*`、`requestInputPanel.*`。

### 4.1 线程页面结构

从上到下 / 从外到内：

1. **线程标题栏/工具栏**（`threadWorkspace.chatTitlebar.label`）：标题、项目名（`Project: {projectName}`）、连接状态徽标、收藏/Pin、更多操作（见 4.8）。
2. **标签条**（unified tab strip，可开/关）：`Chat` + 多个内容 tab（`New tab` 下拉：`Files`、`Changes`、`Terminal`、`Browser`、`Side chat`、`Desktop`、`Suggested`、`Recents`、`Plugins and MCPs`、`Tools`）。
3. **对话流**：按 turn 分组，每个 turn 内是 items（见 4.2）。
4. **Composer**（见 §5，可能悬浮/停靠）；滚到底部按钮 `Scroll to bottom`。
5. **底部面板**（`Bottom panel`，`CmdOrCtrl+J`）：终端 / 浏览器 / 其他 tab。
6. **右侧面板**：`Changes`（diff）、`Files`、`Terminal`、`Browser`、`Side chat`；可 `Enter full screen` / `Exit full screen`（`codex.rightPanel.*`）。

### 4.2 Turn 与 item 类型

协议/渲染层可直接确认的 item 类型（在 `app-shared-a906948d8868.js` 中出现频次）：`userMessage`、`agentMessage`、`reasoning`、`commandExecution`、`fileChange`、`mcpToolCall`、`webSearch`、`plan`（todo-list）、`contextCompaction`。

| 类型 | 渲染形态（推断自 chunk 与文案） | 证据 |
|---|---|---|
| `userMessage` | 用户消息气泡；支持折叠长文本（`collapsible-user-message-content-*.js`）、编辑最后一条（`localConversation.editLastMessageFailed`）、历史定位（`bookmarked-thread-user-message-navigation-*`） | app-shared 中 `userMessage` 58 次；`local-conversation-turn-*.js` |
| `agentMessage` | Markdown/富文本回复；含代码块、Mermaid、表格、LaTeX（`markdown.*` 56 条、`code.*` 18 条、`mermaidDiagram.*`）；可选「Writing block」行内写作工具（`codex.writingBlock.*`） | `assistantMessage.*`、`markdown.*`、`chatgpt-assistant-message-content-*` |
| `reasoning` | 可折叠的思考摘要（`thinkingShimmer.default=Thinking`、`typing=Typing…`）；reasoning summary 详细度在设置中配置 | `thinkingShimmer.*`（app-initial）；app-shared `reasoning` 243 次 |
| `commandExecution` | 命令卡片：命令文本 + 状态 + 输出折叠；后台终端 tab；`Background terminal` / `No output yet` / `Stop all background terminals` | `localConversation.backgroundTerminals.*` / `backgroundTerminalTab.*`；`codex.terminal.*` |
| `fileChange` | 文件变更卡片，聚合进 Changes 面板（见 4.4）；标记 viewed/unviewed | `codex.review.fileDiff.*` |
| `mcpToolCall` | MCP 工具卡片：active/completed/following/failed 四态活动文案（900+ 条，如 `Created issue "{itemName}"`、`Ran JavaScript`、`Opened pull request`）；审批卡片（`mcpToolApproval` 167 条） | `localConversation.mcpToolActivity.*`、`localConversation.mcpToolApproval.*`、`codex.mcpTool.*` |
| `webSearch` | 联网搜索卡片；web search 模式（Disabled/Cached/Indexed/Live）来自设置 | app-shared `webSearch` 10 次；`settings.agent.configuration.webSearch.*` |
| `plan` | Plan/todo 列表卡片：`Plan` 标题 + todo 项；`Up next`；`/goal` 的 goal 状态 | `codex.localConversation.plan.title`、`localConversation.threadGoal.*`、`turn/plan/updated` 事件 |
| `contextCompaction` | 上下文压缩事件卡片（`/compact` 触发）；`Compact` 斜杠命令、`usage% full` 提示 | app-shared `contextCompaction` 15 次；`composer.compactSlashCommand.*` |

Turn 级状态文案（`localConversation.*`，`app-primary-84ad97f06929.js`）：

- `Working` / `Working for {time}` / `Worked for {time}`（v2）
- `You stopped after {time}`
- `Paused`、`Reconnecting to ChatGPT…`、`Activity`
- 错误态：`This turn couldn't render`（`Try again`）、`Summary panel couldn't render`
- 用量限制：`You've hit your usage limit. Add credits to continue, or try again at {resetDate}.` 等 9 种变体；`Usage limits reset`
- 自动恢复：`Retry`、`Retry history`（`localConversation.retryHistoryLoad`）

### 4.3 工具调用 / 命令输出展示

- 命令执行与后台进程：`Background processes` / `Subagents` 两个汇总区块（`localConversation.backgroundTasks.*`）；`Stop all background terminals`；`Background terminal` tab 有 `No output yet`。
- 子代理：`Open subagents`、`{model}` tooltip、`# working` / `# done`。
- 计划任务心跳：`Next run: {nextRunLabel}`、`Open scheduled task`（`heartbeatAutomation.*`）。
- 输出资产：`Outputs` 面板（`Recent files`、PR、生成图/文件）；`Sources`（`Attach files or connect apps`、`Web search`、`Use plugins`）。
- `Created tasks` 列表（子代理/任务）：status `Starting / Working / Done / Failed`。
- 审批 UI：见 4.5。

### 4.4 Changes（diff）面板 —— 官方完整能力

来源：`codex.review.*`（112 条）、`review.*`（96 条）、`codex.diffView.*`、`thread.sidePanel.*`。

**视图/来源切换**

| 元素 | 文案 | 证据 |
|---|---|---|
| 面板名 | `Changes`（`Toggle Changes panel` / `Toggle Changes`） | `thread.sidePanel.diffTab` / `codex.command.toggleReviewPanel` |
| 来源 | `Last turn` / `Branch` / `Commits` / `Branch comparison` / `Selected commit` / `Cloud changes`；`Review source` | `codex.review.source.local.lastTurn(.V2)` / `source.local.thisBranch` / `all` / `commits` / `branchComparison` / `selectedCommit` / `source.cloud` |
| 分支比较 | `{currentBranch} → {targetBranch}`、`Select branch`、`Branch comparison` | `source.local.branchComparison` / `selectBaseBranch` |
| 提交选择 | `Loading commits…` / `No commits on branch` / `Unable to load commits` | `source.local.commit.*` |
| 阶段过滤 | `Staged` / `Unstaged` / `Uncommitted`；空态 `No staged changes` / `No unstaged changes` | `codex.review.stageFilter.*` |
| diff 模式 | `Auto`（`split for additions and removals, inline for narrow panes or one-sided changes`）/ `Split` / `Unified`；`Switch to split/unified diff`、`Auto diff` | `codex.diffView.auto/autoDescription/switchTo*`、`codex.review.switchTo*` |
| 工具条 | `Expand all diffs` / `Collapse all diffs`、`Word wrap`、`Word diffs`、`Hide white space`、`File tree filters`、`Hide files/Show files`、`Rich preview` | `codex.review.expandOrCollapseDiffMenu.*` / `wrap.*` / `wordDiffs.label` / `whitespace.hide` / `fileTree.*` / `header.*` |
| 文件级操作 | `Mark as viewed` / `Mark as unviewed`、`Open file in a tab`、`Copy path`、`Revert file/hunk/section`、`Copy git apply command` | `codex.review.fileDiff.*` / `revert.*` / `copyGitApplyCommand` |
| 文件树 | `Filter changed files`、`Filter generated files`、`No matching files`、`{path}, added lines: … deleted lines: … comments: …` | `codex.review.fileTree.*` |
| 大 diff | `This diff is large, showing one file at a time`（`Previous file` / `Next file`）；`Diff too large to display`（`Open the file to review changes directly.`）；`Load full files` | `codex.review.largeDiff.*` / `diffTooLarge.*` / `loadFullFiles.enable` |
| 未跟踪文件 | `Showing tracked changes only`（`The Changes tab skipped {count} untracked files to stay responsive…`）、`Copy cleanup command` | `codex.review.untrackedFilesOmitted.*` |
| 空态 | `No file changes yet` / `Changes in this project will appear here.` / `Create a Git repository`（`Track, review, and undo changes in this project.`） / `The last turn was reverted.` / `The last turn was committed or reverted.` | `codex.review.noDiff.*` |
| 错误态 | `Couldn't load changes`（`Refresh` / `Retry`）、`Diff failed to load after retrying`、`Full file content failed to load`、`Some files can't be watched for changes.` | `codex.review.loadFailed.*` / `diff.*` / `fileWatchLimited.*` |
| 文件查看器 | `Open file`（`Select a file from the workspace tree`）、`Go to line`（`Line`、`1–{lineCount}`）、`Go to Definition/References/Implementations/Type Definition`、`Copy file contents`、`Copy absolute/project-relative/repo-relative path`、`Git blame`（`Show author, date, and commit details in the line gutter`）、`Open in GitHub`；不支持预览的格式给明确提示（Word/Excel/PowerPoint/Keynote/Numbers/Pages/ODF/视频/音频/二进制/压缩包） | `review.fileSource.*` / `review.fileLanguage.*` |
| Git 操作 | 提交表单：`Commit message`（占位 `Commit message (leave blank to generate)…`）、`Commit to`（`New branch`）、`Include unstaged changes`、`Commit and push`；成功 `Committed to {branch}`；PR：`Create pull request` / `Create merge request`（GitLab）/ `Repair`（`Failing checks` / `Comments` / `Merge conflicts` / `Everything`） | `review.commit.*` / `codex.localConversation.gitSummary.*` |

### 4.5 审批 / 提问 / 自动审查

| UI | 官方文案 | 证据 |
|---|---|---|
| 审批卡片 | `Approval options`；按钮 `Allow once` / `Allow this conversation` / `Always allow` / `Deny`；`Reason` 输入；快捷键 `Enter` 通过 / `Escape` 拒绝 | `approvalRequestCard.*`；`codex.command.approval.approve`（Enter）/ `decline`（Escape） |
| 自动审查（Auto-review） | `Want fewer approval prompts?`（`ChatGPT can automatically approve eligible actions while it works. This may use more credits.`）；`Approve for me` / `Keep manual approvals` | `approvalRequest.autoReviewNudge.*` |
| 自动审查被拒后重试 | `/approve` 类流程：`Approve a recent auto-review denial`；`Approve`/`Select an auto-review denial to approve one retry. The retry will still go through auto-review.` | `composer.autoReviewDenialsSlashCommand.*` |
| 提问 UI（request user input） | 问题卡：`Question`；`Next` / `Previous` / `Skip` / `Submit` / `Continue`；`Recommended`；自由输入 `Type here`；`ESC`；倒计时 `Dismiss, {seconds} remaining` | `requestInputPanel.*` |
| 权限通知 | 通知标题 `Permission approval`；`Answer a question to proceed.` | `codex.notifications.permissionApproval.title` / `notifications.inputRequired` |
| 全权限确认 | `Use Ultra with Full access?`、`Use Full access` / `Continue` | `composer.mode.agentMode.ultraFullAccessConfirm.*` |

### 4.6 终端

- 入口：`Open terminal`（命令/快捷键/菜单）、composer 底部终端图标、右侧面板 `Terminal` tab、`Ctrl+J` 底部面板。
- 设置：`Default terminal location`：`Bottom` / `Right`（`Choose where the terminal shortcut and environment actions open terminal tabs`）；`Integrated terminal shell`（`Choose which shell opens in the integrated terminal.`）。
- 多终端/后台：`Background terminals`、`Background terminal`、`Stop all background terminals`；环境 setup 脚本运行时在 terminal tab 展示（`Project setup`、`Command to run`、`Environment settings`）。
- 源目录提示：`Source directories`（`Press ⌥Opt + Number` / `Alt + Number` 切换目录）。

证据：`codex.command.toggleTerminal`、`settings.general.defaultTerminalLocation.*`、`settings.openIn.integratedTerminalShell.*`、`thread.bottomPanel.*`、`localConversation.backgroundTerminals.*`、`codex.terminal.workspaceRootPromptHint.*`、`threadPage.runAction.*`。

### 4.7 侧面板 / 标签页 / Side chat

- 标签页能力（`thread.sidePanel.*`、`threadWorkspace.*`、`appShell.tabs.*`、`codex.tabs.*`）：
  - 新建：`New tab`、`New tab in full view`、`New tab` 下拉分组：`Suggested`、`Recents`、`Tools`、`Plugins and MCPs`、`More tools…`。
  - 类型：`Files`、`Changes`、`Terminal`、`Browser`、`Desktop`、`Side chat`、`New page`。
  - 操作：拖拽 tab 到 `left pane / right pane / bottom pane / New chat / new window`、`Pin tab`、`Restore tab`、`Close panel`、`Close other tabs`、`Close tabs to the right`、`Pin to sidebar`。
  - 计数：`{count} open tabs`、`{count} more thread(s)`（collapsed thread list）。
- Side chat：`New side chat` / `Open side chat`；`Side chats` 面板；`Shift+Escape`/`Alt+L` 聚焦主 composer（`codex.command.focusMainChat`）。
- 浏览器面板（如启用）：`Browser`、`Open Browser Tab`（`CmdOrCtrl+T`）、地址栏、`Open in external browser`、`Reload`、`Focus Browser Address Bar`。

### 4.8 线程级操作菜单（Chat actions）

`threadHeader.moreActions`（`Chat actions`）集合，含以下项与文案：

| 操作 | 文案 | 备注/证据 |
|---|---|---|
| 重命名 | `Rename chat` | 快捷键 `Ctrl+Alt+R`（`commands.tsv: renameThread`；title `codex.commandMenuTitle.renameThread`） |
| 置顶 | `Pin/unpin chat` | `CmdOrCtrl+Alt+P` |
| 归档 | `Archive chat` | `CmdOrCtrl+Shift+A`；运行中 `Stop and archive` |
| 标记未读 | `Mark as unread` | `CmdOrCtrl+Shift+U` |
| 新窗口 | `Open in new window` | — |
| Side chat | `New side chat` / `Open side chat` | `CmdOrCtrl+Alt+S` |
| 复制 | `Copy` 子菜单：`Copy as Markdown`、`Copy working directory`、`Copy deeplink`、`Copy conversation path` | `threadHeader.copyActions.*` |
| Fork | `Fork` 子菜单：`Fork chat`（当前工作区）/ `Fork chat in same worktree` / `Fork chat in new worktree`；`Fork chat from here`（从某条消息分叉，可选 `Fork in this worktree/workspace`，`Fork in a new worktree`） | `threadHeader.forkActions.*`、`localConversation.forkFromOlderTurnDialog.*`、`composer.forkSlashCommand.*` |
| 继续 | `Continue in`：`Continue in a new chat` / `Continue in the same worktree` / `Continue in a new worktree` | `threadHeader.continueActions.*` |
| 计划任务 | 显示/移除关联 scheduled task（`Scheduled task unavailable` / `Archive chat and remove scheduled task?`） | `threadHeader.loadingScheduledTask` 等 |
| 删除 | `Permanently delete`（二次确认，删除含子代理任务） | `sidebarElectron.deleteThreadDialog.*` |
| 切换会话 | `Next chat` / `Previous chat` / `Next chat needing attention`（`CmdOrCtrl+Alt+A`） | `codex.command.nextThreadNeedingAttention` |

### 4.9 消息级操作

- 消息渲染工具栏以图标为主；可确认的能力：
  - 复制：复制会话 Markdown / 复制最后代码块（`codex.command.copyConversationMarkdown`、`copyLastCodeBlock`，后者 `CmdOrCtrl+Shift+;`）。
  - 反馈/举报：`Report response`、`Report a conversation`、`Send Feedback`（`codexThreadReportDialog.*`、`feedback.dialog.*`）。
  - 从某条消息 Fork（`Fork chat from here`）。
  - 编辑最后一条用户消息并重发（`Failed to edit message`）。
  - 时间线内搜索跳转（find bar）。
- 引用/批注：`Your guidance`、`Selected text`、`Selected page element`、`Screenshot attached`（附件与 annotation 机制，`comment.*`、`selectedTextAttachment*`）。

### 4.10 上下文用量 / 速率限制 / 任务用量

- `/status` 面板（`composer.statusPlain.*`，`composer.statusSlashCommand`：`Show chat ID, context usage, and rate limits`）：
  - `Status`、`Thread:`、`Threads:`、`Session:`、`Session/Thread:`、`Context:`、`{count}K`、`{used} used / {total}`、`{remaining}% left`。
  - 速率限制：`{modelName} limit:`、`Rate limit`、`{remaining}% left`、`resets {time}`、`{count}m/h/d/mo/y limit`、`Unavailable`。
- Composer 状态条同源（见 §5.2）。
- 任务用量摘要：`Current task usage`、`(Credits and dollar amounts are estimated)`。

### 4.11 空态 / 错误 / 恢复

- `Couldn't load messages`（重试）、`This turn couldn't render`、`Summary panel couldn't render`、`Tab content couldn't render`、`Failed to attach cloud chats`、`Reconnecting to ChatGPT…`、`We're having trouble starting this chat`（`pendingCloud`）。
- 归档态：`This chat is archived. To continue, unarchive it first.` / `Restoring this chat and its workspace…` / `This chat has been restored`。
- 工作目录失效：`This chat's working directory no longer exists` / `Restore the worktree to continue`。
- 云端/远程断连：`Remote connection is disconnected` / `Remote connection needs authentication` / `Project folders changed. Choose an execution environment again`。

---

## 5. Composer（输入区）——控件与全部可选项

来源：`composer.*`（845 条，主要在 `app-primary-84ad97f06929.js`、`composer-controls-67ecf5b2d9c4.js`、`composer-utility-bar-45b46c289c5d.js`、`composer-action-bar-run-location-dropdown-*.js`）、`serviceTier.*`、`settings.agent.configuration.*`。

### 5.1 布局

```
┌──────────────────────────────────────────────────────────────┐
│ [附件/图片/Appshot 缩略图行]                                  │
│ 文本域（支持 markdown、@mention、/slash、粘贴、拖拽文件）      │
│ ┌ 左侧工具条 ────────────────┐  ┌ 右侧动作 ────────────────┐ │
│ │ + 附件 | 模型/推理/速度     │  │ 麦克风/语音 | Send▾ Stop  │ │
│ │ 权限 | 计划模式 | 项目/环境 │  │                          │ │
│ └────────────────────────────┘  └──────────────────────────┘ │
│ 状态条：Context 32K · Rate limit 87% left · Thread · Session │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 控件与选项清单

| # | 控件 | 位置/入口 | 可选文案 | 证据 |
|---|---|---|---|---|
| 1 | **模型选择器** | 左工具条；`Ctrl+Shift+M` 打开；`Open recent models`（`Ctrl+Cmd+M`/`Alt+M`） | 标题 `Select model`；`Default`（`Recommended set of models`）/ `Custom` / 最近模型；`Matching models`；锁定模型 `{model}, locked`（`Unlock {model}`）；`Reset to default`；`Daybreak`（Blue/Red 安全模型，`Turn on/off Daybreak`）；`Select effort`；`Speed` 行 | `composer.modelPicker.*`、`composer.intelligenceDropdown.*`、`codex.command.composer.openModelPicker/openRecentModels` |
| 2 | **Reasoning effort** | 模型菜单内 / `/reasoning` | `None`、`Minimal`、`Light`（`low.label.v2`）、`Medium`、`High`、`Extra High`（xhigh）、`Max`、`Ultra`、`Persistent`；Work 模式 `Standard`/`Extended`；`Reasoning levels other than Persistent have no effect on this agent`；`Ultra adds instructions to use subagents proactively`；`Consumes usage limits faster` | `composer.mode.local.reasoning.*`、`settings.agent.modelFeatures.reasoningEfforts.*`、`composer.intelligenceDropdown.lockedModel.effortTooltip.v2` |
| 3 | **Speed tier** | 模型菜单内 / 命令 `Cycle speed` | `Standard`（`Default speed`）、`Fast`（`1.5x speed, increased usage`）、`Ultrafast`（`The fastest available responses for latency-sensitive work`）；`Enable fast mode` / `Enable standard mode` | `serviceTier.*`、`composer.intelligencePicker.*`、`codex.command.composer.toggleFastMode` |
| 4 | **权限/沙箱模式** | 左工具条权限徽标 / `/permissions` | `Default permissions`（`By default, ChatGPT can read and edit files in its workspace. It can ask for additional access when needed`）、`Full access`（二次确认：`Make Full Access available?` / `When selected, ChatGPT can access the internet and read and edit files without asking for approval — including potentially destructive commands`）、`Read only`、`Workspace write` | `settings.agent.permissionsMode.*`、`settings.agent.configuration.sandbox.*`、`composer.mode.agentMode.*` |
| 5 | **Approval policy**（设置页同源） | 设置 > Agent | `On request` / `On failure` / `Never ask for approval` / `Untrusted`；restricted 提示 | `settings.agent.configuration.approval.*` |
| 6 | **Plan mode** | 加号/工具条 / `/plan` | `Turn plan mode on/off`；placeholder `Describe your task to generate a plan...`；`Plan` 指示器 | `composer.planSlashCommand.*`、`composer.planModeIndicator` |
| 7 | **项目选择器** | 底部/工具条 project chip | `Choose project` / `Select your project` / `Change the project for this chat`；`Don't work in a project`；`New project`；`New remote project`；`Search projects` | `composer.localCwdDropdown.*`；`Ctrl+Alt+Shift+O` 打开 |
| 8 | **运行位置（Work in）** | 新会话/Composer 顶部 | `Work in`：`This computer`、`Worktree`、`Remote`（`Select computer` / `Add computer` / `No remote computers added`）、`Cloud`（`Select environment` / `Create environment`）；`Start in` | `composer.newTask.*`、`hotkeyWindow.home.taskMenu.startIn` |
| 9 | **Run location（ChatGPT Work）** | 动作条下拉 | `Where should this chat run?`：`On your computer`（`This chat stays on this computer`）/ `In the cloud`（`Continue across devices`，`Can't access local files unless attached`）；`Run follow-up in` | `composer.runLocation.*`、`composer.cloudFollowUp.header` |
| 10 | **Worktree 模式** | `/worktree`、Work in 菜单 | `Turn worktree mode on/off`；`Worktree` heredoc 提示（`Create a worktree before starting the task`）；`New local worktree` / `New {repoName} worktree` / `New remote worktree`；`Create a copy of {repoName} to work in parallel.` | `composer.worktreeSlashCommand.*`、`composer.worktreePrompt.*`、`composer.worktree.forRepository` |
| 11 | **Environment（工程环境）** | 环境下拉（worktree 模式） | `Environment` / `Default environment` / `Work without environment` / `Set up project`（`Give Codex access to your project's full dependencies and setup`）/ `Environment settings`；错误 `Error loading environments` | `composer.worktreeEnvironment.*` |
| 12 | **云环境选择** | `/cloud-environment` 或 cloud 运行位置 | `Select environment` / `Create new` / `Cloud environment`；`Select a cloud environment to continue` | `composer.environmentSelector.*`、`composer.slashCommands.cloudEnvironment.*` |
| 13 | **附件** | `+` 菜单 | `Attach files and folders`（`CmdOrCtrl+U`）、`Add photos`、`Capture appshot`；粘贴文本附件、拖拽；限制提示 `This file is too large to attach to a local task` / `Files uploading…` / `Images uploading…` | `codex.command.composer.addFiles/addPhotos/captureAppshot`、`composer.fileAttachment` / `pastedTextAttachment` / `composer.submit.waitForFileUploads` |
| 14 | **@ mention** | 文本域输入 `@` | 分组：`Files`、`Folders`、`Chats`、`Files and chats`、`Apps`、`Agents`（`Live agents` / `Custom agents`）、`Plugins`、`Skills`、`MCP servers`、`Browser tabs`、`Pages`、`Sites`、`ChatGPT conversations`、`Search results`、`Results`；`Type to search for files`、`No results`；`Tab for more` | `composer.atMentionList.*` |
| 15 | **Skills 引用** | `@` 或 `/` 菜单 | `Skills` 分组、`Loading skills…`、skill mention list | `composer.atMentionList.skills`、`composer.skillMentionList.*`、`composer.slashCommands.skillsGroup` |
| 16 | **IDE 上下文** | `/ide` | `IDE context`：`Include current selection, open files, and other context from your IDE` / `Turn IDE context off`；指示器 tooltip `/ide` | `composer.ideContextSlashCommand.*`、`composer.ideContextIndicator.*` |
| 17 | **语音/听写** | 麦克风按钮 / 全局快捷键 | 听写：`Start dictation`（`Ctrl+Shift+D`）、`Hold to dictate, or double-tap for hands-free`、单按听写、听写字典、录音历史；语音聊天：`Toggle voice chat`（`Ctrl+Shift+V`）、`Choose a voice`、`End Voice Chat`、`Toggle Voice Chat microphone/audio` | `composer.startDictation`、`settings.voice.*`、`realtimeVoice.*` |
| 18 | **发送/停止按钮** | 右下 | `Send` / `Queue` / `Steer` / `Stop` / `Resume` / `Sending is disabled while publishing`；`Send message in background`（`CmdOrCtrl+Enter`） | `composer.submitButtonTooltip.*`、`codex.command.composer.submit/queue/steer` |
| 19 | **排队/steer 行为** | 设置 > General | `Follow-up behavior`：`Queue` / `Steer`；说明：`Queue follow-ups while {appName} runs or steer the current run. Press {invertFollowUpShortcutLabel} to do the opposite for one message` | `settings.general.followUpQueueMode.*` |
| 20 | **状态条** | 输入框底部 | `Context:`、`{count}K`、`{used} used / {total}`、`{remaining}% left`、`Rate limit`、`{remaining}% left`、`resets {time}`；`Show context window usage` 开关 | `composer.statusPlain.*`、`settings.general.contextUsageIndicator.*` |
| 21 | **格式工具条** | 选中文本后浮出 | `Bold`/`Italic`/代码/链接等（`composer.formatToolbar.*`）；`RichLinkPopover`、code block 插入、`Plain text composer` 设置 | `composer.formatToolbar.*`、`composer.richLinkPopover.*`、`settings.general.composer.plainTextMode` |
| 22 | **输入增强** | — | Enter 行为：`Enter sends` / `⌘+Enter always` / `⌘+Enter for multiline`；发送快捷键 `Send shortcut`；`CmdOrCtrl+Enter` 后台发送 | `settings.general.enterBehavior.*`、`codex.command.composer.submitInBackground` |
| 23 | **提示性占位** | 空输入框 | `Work with ChatGPT`、`Working…`、`Describe your goal, define measurable outcomes for best results`（goal）、`Describe your task to generate a plan...`（plan）、`Ask ChatGPT anything locally in {project}`（Popout） | `composer.placeholder.*`、`hotkeyWindow.home.placeholder.*` |
| 24 | **提交预检错误** | 发送前 | `Select a project to continue`、`Set up Agent sandbox to continue`、`Update Agent sandbox to continue`、`This chat's working directory no longer exists`、`Restore the worktree to continue`、`Remote connection is disconnected`、`Select a cloud environment to continue`、`Sending messages is disabled during task handoff`、`Permission mode is unavailable`、`Attachments are unavailable for this target` | `composer.submit.*`、`composer.submitToast.*` |

### 5.3 斜杠命令（完整清单，均为官方 title/description 文案）

| 命令 | 标题 | 描述 | 证据 |
|---|---|---|---|
| `/plan` | Plan mode | `Turn plan mode on` / `Turn plan mode off` | `composer.planSlashCommand.*` |
| `/goal` | Goal | `Set a goal to keep pursuing` | `composer.goalSlashCommand.*` |
| `/review` | Code review | `Review uncommitted changes or compare against a branch`；子项 `Review uncommitted changes` / `Review against a base branch`；`Failed to start code review` | `composer.reviewMode.*`、`review-slash-command-submenu-registration-*.js` |
| `/fork` | Fork chat | `Fork this chat in the current workspace or a new worktree`；选项 `Fork chat` / `Fork chat in same worktree` / `Fork chat in new worktree` | `composer.forkSlashCommand.*` |
| `/side` | Side | `Start a temporary side chat`；不可用提示 `/side is unavailable until the current chat has started` | `composer.sideSlashCommand.*` |
| `/new` | New chat | `Start a blank chat in the same workspace` | `composer.newSlashCommand.*` |
| `/compact` | Compact | `Compact this chat's context ({usage}% full)`；`Compact is disabled while a chat is in progress` | `composer.compactSlashCommand.*` |
| `/init` | Init | `Create an AGENTS.md file with instructions for Codex`；`AGENTS.md already exists here. Skipping /init…` | `composer.initSlashCommand.*` |
| `/mcp` | MCP | `Show MCP server status` | `composer.mcpSlashCommand.*` |
| `/status` | Status | `Show chat ID, context usage, and rate limits` | `composer.statusSlashCommand.*` |
| `/usage` | （Usage & billing） | `Open usage and billing settings` | `composer.usageSlashCommand.*` |
| `/model` | Model | `Matching models` | `composer.modelSlashCommand.*` |
| `/reasoning` | Reasoning | — | `composer.reasoningSlashCommand.title` |
| `/speed` | （Speed） | `Turn off {serviceTier} and return to standard speed` | `composer.speedSlashCommand.*` |
| `/project` | Work in a project | `Choose project for new chats`；`None`（`Don't work in a project`） | `composer.projectSlashCommand.*` |
| `/chat` | Chat | `Don't work in a project` | `composer.chatSlashCommand.*` |
| `/local` | — | `Run this chat locally` | `composer.mode.localSlashCommand.*` |
| `/worktree` | — | `Run this chat in a new worktree` | `composer.mode.worktreeSlashCommand.*` |
| `/cloud` | — | `Run this chat in the cloud` | `composer.mode.cloudSlashCommand.*` |
| `/cloud-environment` | Cloud environment | `Choose the cloud environment` | `composer.slashCommands.cloudEnvironment.*` |
| `/ide` | IDE context | `Include current selection, open files, and other context from your IDE` | `composer.ideContextSlashCommand.*` |
| `/memories` | Memories | `Use memories` / `Generate memories` / `Import from ChatGPT`；`These switches apply to the current chat` | `composer.memoriesSlashCommand.*` |
| `/rename` | Rename | `Rename the current chat` | `composer.renameSlashCommand.*` |
| `/archive` | Archive | `Archive the current chat` | `composer.archiveSlashCommand.*` |
| `/star`（pin） | Pin chat | `Keep this chat in the sidebar` | `composer.starSlashCommand.*` |
| `/feedback` | Feedback | `Send feedback about this chat` | `composer.feedbackSlashCommand.*` |
| `/pet` | Pet | `Wake or tuck away the desktop pet` | `composer.petOverlaySlashCommand.*` |
| `/share` | Share chat | `Create a link to a snapshot of this chat`（ChatGPT 分享） | `codex.sharedSnapshot.shareSlashCommand.*` |
| `/approve`（auto-review-denials） | Approve | `Approve a recent auto-review denial` | `composer.autoReviewDenialsSlashCommand.*` |
| `/resume`（Popout） | Resume | `Resume a recent chat` | `composer.hotkeyWindowResumeSlashCommand.*` |
| `/hotkey-new`（Popout） | New | `Return to the Popout Window home` | `composer.hotkeyWindowNewSlashCommand.*` |
| 菜单本身 | Slash commands | 标题 `Slash commands`、描述 `Search and run slash commands`、占位 `Search`、空态 `No commands`、`Skills` 分组 | `composer.slashCommands.*` |

### 5.4 提交后的行为

- 正常发送后若在首页，导航到 `/thread/...`；`Send message in background` 不跳转（`codex.commandDescription.composer.submitInBackground`：`Send the current composer message without opening its chat`）。
- 会话进行中再发送：按设置进入 `Queue`（排队）或 `Steer`（打断当前 turn 并引导）。
- Popout Window（`Alt+Space` 热键）内是精简 composer，支持 `Resume` 最近会话、`New` 返回 home。
- 首页/新会话可先选运行位置/项目/环境/worktree，再发送（提交时做预检，见 5.2 #24）。


---

## 6. 设置（Settings）——官方完整分区

证据核心：`app-initial-fd3c4b862660.js` 中 `HDa`（分区有序数组）、`RDa`（slug 顺序字符串）、`mi`（导航分组）；`settings-page-b0141d46c881.js` 的导航渲染；各 `settings.<section>.*` i18n；页面标题 `settings.section.*`，导航标题 `settings.nav.*`。全部英文 label 见 **`.ref/reference/settings-labels.txt`**（4,246 条）。

### 6.1 设置页骨架

- 左侧二级导航（可折叠：`Collapse settings navigation` / `Expand settings navigation`），顶部 `Back to app`。
- 导航分组（官方本版实际分组，来自 `settings-page-b0141d46c881.js` `mi` 数组）：
  1. **Personal**：`general-settings`、`notifications`、`import`、`profile`、`appearance`、`security`、`account`、`ads-controls`、`parental-controls`、`trusted-contact`、`safety`、`voice`、`storage`、`agent`、`personalization`、`pets`、`keyboard-shortcuts`、`usage`、`billing`、`analytics`、`consumer-view`、`usage-code-review`、`debug`、`agreements`
  2. **Teams**（无标题，单分区）：`teams`
  3. **Integrations**：`plugins-settings`、`file-type-handlers`、`passwords`、`computer-use`、`chronicle`、`appshots`、`codex-micro`、`mcp-settings`、`skills-settings`、`browser-use`、`cloud-computer`、`extension`
  4. **Coding**：`hooks-settings`、`connections`、`cloud-settings`、`codex-cloud`、`cloud-environments`、`code-review`、`git-settings`、`local-environments`、`environments`、`worktrees`
  5. **Archived**：`data-controls`（`Archived chats`）
- 分区顺序（`RDa` 原文）：`general-settings.notifications.import.profile.security.account.age.agreements.parental-controls.trusted-contact.safety.time-management.keyboard-shortcuts.codex-micro.appshots.appearance.voice.storage.pets.chronicle.agent.work-settings.git-settings.data-controls.ads-controls.cloud-settings.cloud-environments.codex-cloud.code-review.personalization.usage.billing.analytics.consumer-view.usage-code-review.debug.browser-use.extension.computer-use.local-environments.worktrees.environments.mcp-settings.hooks-settings.connections.plugins-settings.file-type-handlers.skills-settings.teams.cloud-computer.passwords`
- 设置搜索：`Search settings`；占位 `Search`；无结果 `No results found`；结果 aria `{destination}, {panel}`；清空 `Clear settings search`。
- 未保存修改：`You have unsaved settings changes. Leave without saving?` → `Discard changes` / `Keep editing`；`Discard changes?` / `You have unsaved changes. If you leave now, your changes will be lost.`
- 可见性按产品模式（`use-visible-settings-sections-*.js` 的 `Da` 映射）：`chatGpt` / `codex` / `codexLocal` / `codexOrWorkLocal` / `chatGptOrCodex`；例如 `pets`、`worktrees`、`local-environments`、`git-settings`、`hooks-settings`、`connections` 是 Codex-mode 可见。

> 下面对 **Codex 基线相关分区** 逐节展开；ChatGPT 云端专属分区见 §16。

### 6.2 General（`settings.nav.general-settings` = `General`，`settings.section.general-settings` = `General`）

页面是**多个分组**的长滚动页（`settings.general.*`，282 条）：

| 分组/控件 | 文案与选项 | 证据 |
|---|---|---|
| 外观（Appearance） | `Theme`：`Light` / `Dark` / `System`；`Separate light and dark modes`（`Choose a theme, colors, and font for each`）；`Accent`：`Default` / `Black` / `White` / `Blue` / `Green` / `Orange` / `Pink` / `Purple` / `Yellow` / `Custom`；`UI font size`、`Code font size`、`Content font size`（px）；`UI font` / `Content font` / `Code font`（family + style；`System` / `Regular`）；`Translucent sidebar`；`Contrast`；`Diff markers`：`Color` / `+/-`（`Show changes using colors or +/− markers`）；`Dock icon`（`ChatGPT` / `Codex` / `Space`）；`Reduce motion`：`On` / `Off` / `System`；`Use pointer cursors`；`Font smoothing`；主题导入/导出（`Copy {variant} theme` / `Import {variant} theme`） | `settings.general.appearance.*`；`settings.appearance.*` |
| Composer | `Plain text composer`（`Keep code, Markdown, and links as literal text while writing messages`）；`Send shortcut`（`Enter` / `{mod} + Enter always` / `{mod} + Enter for multiline prompts`）；`Follow-up behavior`：`Queue` / `Steer`（说明见 §5.2#19） | `settings.general.composer.*`、`enterBehavior.*`、`followUpQueueMode.*` |
| 窗口/面板 | `Confirm before closing a window`：`Never` / `Close shortcut only` / `Always`；`Bottom panel`（`Show the bottom panel control in the app header`）；`Full view by default`（`Start new tasks with Chat and content in a single tab strip`）；`Default terminal location`：`Bottom` / `Right`；`Popout Window`：`Default to standalone chat`；`Show context window usage` | `confirmBeforeClose.*`、`bottomPanel.*`、`defaultWorkspaceFullView.*`、`defaultTerminalLocation.*`、`popoutWindow.*`、`contextUsageIndicator.*` |
| 应用行为 | `In-app updates`；`Show in menu bar`（`Keep {appName} in the macOS menu bar when the main window is closed`）；`Desktop app beta features`；`Prevent sleep while running`；`Compress local chat history`（`Save disk space by compressing older local chat history. Restart …`）；`Projectless task folder`（Change / Reset）；`Show educational tips`；`Restart {appName} to apply…` 提示 | `inAppUpdates.*`、`macMenuBar.*`、`desktopAppBeta.*`、`power.preventSleepWhileRunning.*`、`rolloutCompression.*`、`projectlessChatFolder.*`、`educationalTips.label` |
| Experimental features (Beta) | `Request user input`（`Allow Codex to ask questions outside Plan mode. Changes apply only to new threads`）；`Popout Window hotkey`（`Set a global shortcut for Popout Window. Leave unset to keep it off.`）；`No beta experimental features available`；`Restart {appName} to apply experimental feature changes` | `settings.general.experimentalFeatures.*` |
| 链接打开 | `Web URL and link open destination`：`Codex`（in-app browser）/ `ChatGPT` / `Default browser` | `openLinkInTargetPreference.*` |
| 通知（入口） | `Notifications` 分组（见 6.18） | `settings.general.notifications` |
| 语音聊天 | `Voice chat`：`Choose a voice`（`Arbor`/`Breeze`/`Cove`/`Ember`/`Juniper`/`Maple`/`Sol`/`Spruce`/`Vale`，各带英文描述）；`Screen context`；`Voice chat hotkey`；不可用提示 | `realtimeVoice.*`、`realtimeVoiceScreenContext.*`、`realtimeVoiceHotkey.*` |
| 听写 | `Dictation`；`Dictation shortcut`（`Hold to dictate, or double-tap for hands-free`）；`Single-tap shortcut`；`Dictation dictionary`；`Recent recordings`（复制/下载/删除录音）；`Microphone`（`System default` / 设备列表） | `globalDictation*.*`、`microphoneInput.*`、`dictationDictionary.*` |
| 计划任务沙箱提示 | 计划任务页内提示使用当前默认 sandbox（`Full access` 时强警告） | `settings.automations.banner.*` |
| Plugins 开关 | `Plugins`（`Allow ChatGPT to use installed plugins`；重启生效） | `settings.general.plugins.*` |
| Import 入口 | `Import work from other AI apps`（`Bring over your setup, projects, and recent chats`） | `settings.general.importExternalAgent.*` |
| Daybreak | `Daybreak Access`：`Daybreak Blue` / `Daybreak Red`（扩展安全/网络能力） | `settings.general.daybreakAccess.*` |
| GPU Tearing Debug（内部） | `GPU Tearing Debug`：Disable backdrop blur / CSS motion / scroll fade mask / squircles / force opaque web background | `settings.general.gpuTearingDebug.*` |
| 分组标题 | `General` | `settings.general.groupTitle` |

### 6.3 Appearance（`settings.nav.appearance` = `Appearance`）

独立外观页（`settings.appearance.*`，`appearance-settings-4c0a59978faa.js`）：

- `Mode`（主题）、`Visual style`、`Separate light and dark modes`（`Choose a theme, colors, and font for each`）
- `UI font size`、`UI font style`、`Content font size`（`Adjust the base size used for pages`）、`Same as UI font`
- `Smart punctuation`（`Automatically format quotes, dashes, ellipses, arrows, and math symbols as you type`）
- `Accent`：`Default` / `Black` / `White` / `Blue` / `Green` / `Orange` / `Pink` / `Purple` / `Yellow` / `Custom`；错误 `Could not update accent color`；`Your custom color was saved, but couldn't sync to other devices`
- `Advanced`；`Reset to default`（`Some appearance settings could not be reset. Try again.`）

### 6.4 Agent / Configuration（`settings.nav.agent` = `Configuration`；页面标题 `Configuration`）

副标题：`Configure permissions, web access, and agent responses for new chats`（Electron）/ `Configure approval policy and sandbox settings`。分组（`settings.agent.*`，152 条）：

| 分组 | 控件与选项 | 证据 |
|---|---|---|
| **Agent defaults** | `Model default`；`Output detail`（`Low` / `Medium` / `High`，各带 description）；`Reasoning summary`（`None` / `Concise` / `Detailed` / `Auto`）；`Speed`（见 §5.2#3） | `agentDefaults.sectionTitle`、`configuration.modelDefault/modelVerbosity.*/reasoningSummary.*/speed.*` |
| **Permissions** | `Default permissions`（`By default, ChatGPT can read and edit files in its workspace. It can ask for additional access when needed`；`Default permissions are always shown`）；`Full access`（`Show Full access in the composer`；风险文案 + `Make Full Access available?` 确认）；`Full access` 描述：`When ChatGPT runs with full access, it can edit any file on your computer and run commands with network, without your approval. This significantly increases the risk of data loss, leaks, or unexpected behavior.` | `permissionsMode.*` |
| **Approval policy** | `On request` / `On failure` / `Never ask for approval` / `Untrusted`；`Approval policy is restricted by this installation.` | `configuration.approval.*` |
| **Sandbox settings** | `Read only` / `Workspace write` / `Full access`；`Allow network access`（`Allow network access when the sandbox is set to workspace write`）；`Sandbox mode is restricted by this installation.`；inline sandbox 冲突：`This project uses an inline sandbox table. Edit config.toml directly to change network access` | `configuration.sandbox.*`、`configuration.network.*`、`inlineSandboxWriteError` |
| **Web search** | `Disabled`（`Don't allow web search`）/ `Cached`（`Use OpenAI's maintained search index`）/ `Indexed`（`Allow indexed external web access`）/ `Live`（`Allow unrestricted, current web access`）；restricted 提示 | `configuration.webSearch.*` |
| **Model features** | `Available reasoning efforts`（`Choose which reasoning effort levels appear in model controls. Availability varies by model`）；`{count} selected` | `modelFeatures.*` |
| **config.toml** | 作用域：`User config` / `Project config`（`{repoName}`）/ `Admin config`（`Managed by admin policy`）；`Open config.toml`；`Restart ChatGPT after editing to apply changes`；`This config source cannot be edited here.`；`Custom config.toml settings`；`Couldn't update this setting. Check config.toml for errors…` | `configuration.configToml.*`、`configuration.scope.*`、`customConfig.sectionTitle` |
| **Workspace Dependencies** | `Codex dependencies` 开关（`Allow ChatGPT to install and expose bundled Node.js and Python tools`）；`Current version:`；`Diagnose` / `Reinstall`；错误提示 | `dependencies.*` |
| **Suggested prompts** | `Enable ambient suggestions`（`Suggest what to do next by searching project files and connected apps`） | `ambientSuggestions.*` |
| **Import** | `Import external agent config` / `Import from another AI app`；`Detected setup that can be added to {appName}`；`Choose settings, chats, and projects from another local agent app` | `importSettings.*` |

### 6.5 Personalization（`settings.nav.personalization` = `Personalization`）

| 区块 | 文案 | 证据 |
|---|---|---|
| Codex instructions | `Codex instructions` / `Codex custom instructions`；`Give Codex extra instructions and context for all chats. Repository instructions may also apply.`；`Add your custom instructions…`；`These instructions are overridden by AGENTS.override.md`；保存成功 `Codex custom instructions updated` | `settings.personalization.agents.*` |
| About you | `About you`：`Nickname`（`What should ChatGPT call you?`）、`Occupation`（`What do you do?`）、`More about you`（`Interests, values, or preferences to keep in mind`）；`Turn on customization in ChatGPT to edit About you` | `settings.personalization.aboutYou.*` |
| Custom instructions | `Custom instructions`：`ChatGPT` / `Codex`；`Edit ChatGPT custom instructions` / `Edit Codex custom instructions` | `settings.personalization.instructions.*` |
| Custom rules | `Custom rules`（`Default rules`）：哪些动作可无需询问，哪些需审批；`Plugin permissions`（`Open Plugins`）；`This can't be undone`（删除规则） | `settings.userRules.*` |
| Codex memory | `Codex memory`（`Configure how Codex manages memory for {hostName}`）；`Enable Codex memories`；`Allow memories from tool-assisted chats`（`Generate memories from chats that used MCP tools or web search`）；`Delete Codex memories`（`Delete all Codex memories?`） | `settings.memory.*` |
| Mini | `Wake Mini` / `Tuck Away Mini` | `settings.personalization.mini.*` |

### 6.6 Mini & Pets（`settings.nav.miniAndPets` = `Mini & Pets`）

- `Pick a pet`、`My pets`、`None`、`Create your own pet`（`Custom pets` / `Update` / `Open folder`）、`Customize pet`。
- `Appearance`、`Pet size`（`Adjust the size of your pet`）、`Visibility`：`Always visible`（`Keep your Mini on your desktop`）/ `On demand`（`Show with {shortcut}. Hide when you click away.` / 无快捷键时 `Show from the menu. Hide when you click away.`）。
- 说明文案：`Mini manages threads and surfaces what needs attention`；`The lightweight codex companion`；`Pets give you quick access to ChatGPT. Show and focus your pet by pressing {shortcut}`。
- 证据：`settings.pets.*`（28 条）、`settings.mini.*`（9 条）。

### 6.7 Keyboard shortcuts（`settings.nav.keyboard-shortcuts` = `Keyboard shortcuts`）

- 操作区：`Search shortcuts`、`Search by keystrokes`（tooltip 同名）、`Restore defaults`、`Reset all to defaults`（确认 `Reset all keyboard shortcuts?` / `This will discard all custom shortcuts and restore the defaults`）；分组 `App` / `Composer` / `Chat`。
- 编辑：`To change a shortcut, select the key combination, and then type the new keys`；录制框 `Press key sequence`；`Change key sequence for {shortcut}`；冲突 `Already used by {shortcut}`；`none` / `Unassigned`。
- 数字快捷键：`Number shortcuts`（`Use {primary}1–9 to switch chats and {secondary}1–9 to switch tabs` / 反序变体；冲突提示）。
- 外链点击：`Open web link in default browser`（macOS `⌘+Click` / `⇧⌘+Click`；其他 `Ctrl+Click` / `Ctrl+Shift+Click`；`Hold the assigned keys while clicking a web link to open it in your default system browser`）。
- 听写高级：`Works in any app. Press Esc to cancel a recording.`
- 快捷键弹窗（`Ctrl+/`）：`Keyboard shortcuts`，分组 `General` / `Navigation` / `Panels` / `App` / `Configure` / `Chat` / `Project` / `Skills`；`No active shortcuts` / `No matching shortcuts` / `Loading shortcuts…`。
- 证据：`settings.keyboardShortcuts.*`、`keyboardShortcutsDialog.*`。

### 6.8 Plugins / Skills settings（`settings.nav.plugins-settings` = `Plugins`；`settings.nav.skills-settings` = `Skills`）

- 设置内 Plugins 页副标题：`Manage plugins, skills, and MCPs`；`Browse directory`；页面与独立 Skills/Plugins 目录共用（见 §9）。
- 设置内 Skills 页（`settings.section.skills-settings` = `Skills`）与 `/skills` 页面同源。
- `File type handlers`（`settings.nav.file-type-handlers`）：`Select which plugins should open specific types of files`；`No installed plugins support file types`；`Built-in`。
- 证据：`settings.section.plugins-settings.*`、`settings.fileTypeHandlers.*`。

### 6.9 MCP servers（`settings.nav.mcp-settings` = `MCP servers`）

副标题：`Connect external tools and data sources`。

- 列表：`Servers` / `From plugins` / `No MCP servers connected` / `Add server` / `Add MCP server`。
- 编辑：`Connect to a custom MCP` / `Update {name} MCP`；字段 `Name`、`Type`（`STDIO` / `Streamable HTTP`）、`Command to launch`、`Arguments`、`Working directory`、`Environment variables`、`Environment variable passthrough`、`Headers`、`Headers from environment variables`、`Bearer token env var`、`URL`；保存/卸载错误。
- OAuth：`OAuth client registration`：`Automatic` / `DCR` / `CIMD`；`Authenticate`、`Starting…`。
- MCP Apps：`App data`（`Clear site data and cache from all MCP apps`）、`Clear all app data`。
- 切换 transport：`If you would like to switch MCP server type, please uninstall first.`
- 证据：`settings.mcp.*`（58 条）。

### 6.10 Computer use（`settings.nav.computer-use` = `Computer use`）

副标题：`Manage how ChatGPT uses other applications on your computer`。

- 通用：`Any App`（`Let ChatGPT control apps on your computer`）、`Always-allowed apps`（`None yet` / 移除确认）、`Locked use`（macOS：`Let ChatGPT use your Mac when it's locked`）、声音：`Play sounds for foreground clicks` / `foreground and background clicks` / `Don't play sounds`。
- 浏览器控制：`Google Chrome` / `Microsoft Edge` / `Safari`（`Safari extension support is coming soon`）；`Install` / `Reinstall extension` / `Remove extension` / `Permissions`；`@browserName` 在 composer 的显隐。
- Messages：`Read access` / `Send access` / `Per-chat approvals` / `Always allow sending to all chats`；`Reading behavior`：`Always ask` / `Allow by default` / `Allow all chats`；`Never allow`。
- Office：`Microsoft Excel` / `PowerPoint` / `Word` live control 开关。
- 证据：`settings.computerUse.*`（120 条）。

### 6.11 Appshots（`settings.nav.appshots` = `Appshots`）

- Hero：`Take an appshot to show ChatGPT your frontmost window`；`Appshots include visual and text content, including text scrolled offscreen`；`Appshots walkthrough video`。
- `Appshot destination`：`Automatic`（`Uses the current chat if used recently, otherwise starts a new chat`）/ `Current chat` / `New chat`；`Use Mini when visible`（`When Mini isn't visible, Appshots follow Automatic routing`）；`Play sound effect`。
- 热键：设置内录制（`settings.appshotHotkey.*`，9 条）。
- 证据：`settings.appshots.*`（16 条）。

### 6.12 Browser（`settings.nav.browser-use` = `Browser`）

- Codex 模式浏览器设置（`settings.browserUse.*`，226 条，部分属云浏览器）：站点权限（`Requires approval` / `Always allow`）、`Always ask` / `Always allow` approval、可见性开关、站点管理子页（`browser-site-settings-subpages-*.js`）。
- 浏览器扩展（`settings.nav.browser-extension` = `Browser extension`）属 ChatGPT 侧。
- 证据：`settings.browserUse.*`、`settings.nav.browser-use`（= `Browser`）。

### 6.13 Hooks（`settings.nav.hooks-settings` = `Hooks`）

副标题：`Manage lifecycle hooks from config and enabled plugins.`

- 事件：`PreToolUse`（`Before a tool executes`）/ `PostToolUse`（`After a tool executes`）/ `PermissionRequest`（`When permission is requested`）/ `UserPromptSubmit`（`When the user submits a prompt`）/ `Stop`（`Right before ChatGPT ends its turn`）/ `SubagentStart` / `SubagentStop` / `SessionStart` / `SessionEnd` / `PreCompact`（`Before ChatGPT compacts the conversation`）/ `PostCompact`。
- Handler：`Command` / `Prompt` / `Agent` / `MCP server`；`Matcher`、`Timeout`、`Hook type`、`Source`。
- 信任：`Trust all`；`Disabled until hook is trusted`；`Hook changed since last trusted` / `New hook`；`Hooks run outside of the sandbox and may be unsafe`；`Another config layer overrides these hook settings…`。
- 来源：`User config` / `Project config` / `Admin config` / `Plugin` / `Other sources` / `From Plugins` / `From Projects`。
- 其他：`No hooks found` / `Configured hooks will appear here` / `Reload hooks` / `Refreshed hooks` / `Could not load hooks`。
- 证据：`settings.hooks.*`（71 条）。

### 6.14 Connections（`settings.nav.connections` = `Connections`）

| 区块 | 文案 | 证据 |
|---|---|---|
| 连接列表 | `No device connections found. Add a new connection to get started.`；条目副标题 `SSH` / `WSL` / `Signed in device`；状态 `Connected` / `Connecting` / `Disconnected` / `Offline` / `Confirming connection` / `Initializing secure connection` / `Connection failed` / `Requires authorization` | `settings.remoteConnections.deviceConnections.*` |
| 添加 SSH | `Add SSH Connection`：`Hostname`（占位 `host.com or user@host.com`）、`SSH port`（1–65535）、`Display name`、`Alias`、`Identity file path`、`SSH authentication method`：`Identity` / `No Auth`；`Save`；`Add SSH Connection` 发现弹窗（`No SSH connections found` / `Refresh` / `Add manually`） | `dialog.*` / `discoveryDialog.*` |
| 远程 Codex | `Authenticate the Codex CLI on this remote machine to continue`；`Login required` / `Failed to install Codex CLI` / `Approve on your device to use this connection remotely` | `auth.*` / `installCodex.*` / `details.sshRemoteControlPairing.*` |
| 设备控制 | `Control other devices from this Mac/PC`（授权弹窗 `Authorize on chatgpt.com`）；`Devices you can control from this PC`；`Available from signed-in devices`；`Allow devices to control this connection?`；`Keep this Mac awake`（`Prevent sleep when computer is plugged in and remote access is enabled`） | `accessOtherDevices.*` / `authorizationDialog.*` / `details.availableFromSignedInDevices*` / `localHost.keepLive.*` |
| 项目 | `Add remote project` | `addRemoteProject.*` |

### 6.15 Git（`settings.nav.git-settings` = `Git`）

- `Branch prefix`（占位 `codex/`；`Prefix used when ChatGPT creates new branches`）
- `Commit instructions`（`Added to commit message generation prompts`；占位 `Add commit message guidance…`）
- `Pull request instructions`（`Added to PR title/description generation prompts`）
- `Create draft pull requests`（`Use draft pull requests by default when creating PRs from ChatGPT`）
- `Always force push`（`Use --force-with-lease when pushing from ChatGPT`）
- `Pull request merge method`：`Merge` / `Squash`
- `Auto-merge when ready`（`Continue watching until the pull request is merged`）；`Watch and fix pull requests`（instructions 示例：`Comment /merge after checks pass and approve unrelated Chromatic changes…`）
- `Worktree root`（`Directory where ChatGPT creates managed worktrees. Leave blank to use the default location`）
- `Disable Git-based diffs`（`Only show "Last Turn" in the Changes panel and disable Unstaged/Staged/Branch to avoid git operations`）
- 证据：`settings.git.*`（54 条）。

### 6.16 Environments / Local environments（`settings.nav.local-environments` = `Environments`）

- 页面目的：`Local environments tell ChatGPT how to set up worktrees for a project.`
- 项目选择：`Select a project`、`Available projects`、`Inherited environments ({count})`（`From {sourceFolderName} · {fileName}`）、`No projects yet. Add one to configure local environments.`
- 环境编辑：`Create local environment` / `Edit local environment`；`Name`；`Setup script`（`This script runs on worktree creation`；`Advanced options`；平台下拉；`Setup script environment variables`：`Source workspace path` / `New worktree path`）；`Cleanup script`（`Runs at the project root before worktree cleanup`）；`Actions`（`Create a new command to run from the toolbar`；字段 `Name` / `Action script` / `Platforms`：`All platforms`/`macOS`/`Linux`/`Windows`；图标 `Run`/`Test`/`Debug`/`Tool`）。
- 状态：`Unpublished`（`Publish to make available`）、`Saved local environment`、冲突 `This environment changed on disk…`。
- 证据：`settings.localEnvironments.*`（119 条）。

### 6.17 Worktrees（`settings.nav.worktrees.v2` = `Worktrees`）

- Tabs：`Worktrees settings`，`General` / `Environments`。
- `Automatically delete old worktrees`（`Recommended for most users…`；关闭确认 `Disable automatic worktree deletion?`）
- `Auto-delete limit`（`Number of managed worktrees to keep before older ones are pruned automatically. ChatGPT snapshots worktrees before deleting, so pruned worktrees should always be restorable.`）
- `Always fetch upstream before creating worktrees`
- 列表：空态 `No worktrees yet`（`Worktrees created by ChatGPT will appear here`）、`Worktree` 行、`Conversations`（`No conversations linked to this worktree.`）、`New chat in this worktree`（`Starts a fresh chat using the same files and branch`）、`Delete`（`Unpin the chats in this worktree before deleting it`）、`Refresh`、错误态 `Unable to load worktrees`。
- 证据：`settings.worktrees.*`（45 条）+ `settings-tabs-3895021e9276.js`。

### 6.18 Notifications（`settings.nav.notifications` = `Notifications`）

- `Turn completion notifications`：`Always` / `Only when unfocused` / `Never`（`Set when ChatGPT alerts you that it's finished`）
- `Enable permission notifications`（`Show alerts when notification permissions are required`）
- `Enable question notifications`（`Show alerts when input is needed to continue`）
- `Enable dot notifications`（`Show alerts when your dot sends you a message`）
- `Notification sound`：`Default` / `Basso` / `Classic` / `Glass` / `Ping` / `Pop` / `Purr` / `Tink` / `None` / `Choose custom sound…`（MP3/WAV/FLAC/Ogg，<30s、<10MB）
- 系统权限：`Notifications are off` / `Open System Settings`
- 证据：`notifications.*`（38 条）。

### 6.19 Voice / Storage

- Voice（`settings.nav.voice` = `Voice`）：`Show all recordings`；`Dictation sounds`；`Dictionary`（`Words or phrases dictation should recognize`）；语言选择；`Dictation is not available on this device`。
- Storage（`settings.nav.storage` = `Storage`）：ChatGPT library 存储分区；本版对 Codex 模式 `visible:false`（见 `use-visible-settings-sections` 的 `case 'storage'`）。

### 6.20 Codex Micro（`settings.nav.codex-micro` = `Codex Micro`）

硬件键盘/控制器（Work Louder 设备）设置，`settings.codexMicro.*`（223 条）：

- `Connection`：`Connected` / `Detected` / `Connection failed` / `Control unavailable`；`Battery`；`Codex Micro setup`（命令入口）。
- `Agent keys`（6 个键）：跟随 `Pinned chats` / `Priority chats` / `Most recent chats` / `Custom assignments`；`Single tap`：`Open the assigned task and focus the Codex window with a single tap instead of a double tap`；每个键可分配 chat / shortcut / keycap / skill。
- `Analog stick`：为 `Up`/`Down`/`Left`/`Right` 分配动作（App/Settings/Navigation/Panels/Skill actions/Chat/Workspace 分组）。
- 证据：`settings.codexMicro.*`。

### 6.21 Computer history（`settings.nav.chronicle` = `Computer history`，原 Chronicle）

- 设置项：`Computer history` 开关；`Connect Computer History` 权限弹窗（`Allow all apps` / `Allow access` / `Customize apps`）；说明 `ChatGPT captures and summarizes your activity across the apps and websites you use… without ever recording your screen or audio.`
- 历史管理：`Ask about your history`、`Clear last 10 minutes/hour/day/all`、history 列表（早/中/晚）、`Create {name} skill/automation`（从历史建议）。
- 与 Memories 联动：`Turn on Memories to use Computer history?`
- 证据：`settings.chronicle.*`（152 条）。

### 6.22 Import（`settings.nav.import.v2` = `Import`）

- 副标题：`Bring setup, projects, and chats from other AI apps into {appName}`
- `Import from other AI apps`（`No importable setup found` / `Check again` / `Last imported {relativeTime} ago`）
- `Import history`：`{importedCount} imported · {failedCount} did not import · {warningCount} need review`；`Needs attention`（`# server needs authentication`）；条目动作 `Open chat` / `Open in Skills` / `Open MCP settings` / `Open hooks settings` / `Open plugin`；`Converted into Codex skills`。
- `Automatic sync`：`Keep imports in sync`；`Content to sync` 分类：`Agents` / `Chats` / `Commands`（`Imported as skills`）/ `Hooks` / `Instructions` / `MCP servers` / `Memory` / `Plugins` / `Settings` / `Skills`；`All categories, including new ones`；`Sync paused. Your content selections are saved`。
- 证据：`settings.import.*`（84 条）。

### 6.23 Archived chats（`settings.nav.data-controls` = `Archived chats`，归入 Archived 分组）

- 列表：`Search archived chats`；过滤 `All chats` / `Local` / `Cloud`、按 `Project`（`All projects` / `Scheduled tasks` / `Chats`）、`Type`、`Sort by`：`Created` / `Updated` / `Alphabetical`、`Group archived chats`：`Project` / `None`。
- 行操作：`Unarchive`、`View now`、`Delete archived chat`、`Delete all in project`、`Delete all`；成功/失败 toast；`This host doesn't support deleting chats. Update the Codex CLI on the host and try again.`
- 空/错态：`No archived chats` / `No matching archived chats` / `Could not load archived chats`。
- 证据：`settings.dataControls.archivedChats.*`（46 条）。

### 6.24 其他设置分区（Codex 相关但较轻）

| 分区 | 关键内容 | 证据 |
|---|---|---|
| `debug` = `Debug` | 调试面板、trace 录制、RAM 指示器等 | `settings.debug`（4 条）、`traceRecording.*` |
| `usage` = `Usage & billing`（Codex 侧隐藏/受限） | 用量与计费（ChatGPT 账号） | `settings.usage.*`（423 条，多数 out-of-scope） |
| `profile` / `account` / `security` / `agreements` / `age` / `safety` / `time-management` / `parental-controls` / `trusted-contact` / `ads-controls` | ChatGPT 账号/团队/合规 | 见 §16 |
| `notifications`（ChatGPT 子块） | `ChatGPT` 通知子组 | `settings.notifications.chatGpt.*` |


---

## 7. Scheduled tasks（侧边栏 `Scheduled`，即旧 Automations / Inbox）

来源：`inbox.*`（204 条，`automations-page-5f2fc3cbb321.js`、`app-shared`）、`automations.*`（35）、`scheduled.*`（24）、`settings.automations.*`（94）。

### 7.1 页面

- 入口：侧边栏 `Scheduled`；页面标题 `Scheduled` / `Scheduled tasks`（`inbox.mode.automations`）；副标题 `Ask ChatGPT to schedule tasks, set reminders, or monitor for updates`。
- 列表：`Search scheduled tasks`；状态过滤 `Active` / `Paused` / `All`（`Scheduled task status`）；归属过滤 `Personal` / `Team` / `All`；`Upcoming`；`Loading scheduled tasks`；空态 `No scheduled tasks` / `No scheduled tasks found`。
- 行信息：名称、`Next run`、`Paused`、`From`（插件来源）、`Heartbeat • {thread}`（心跳任务）、`{count} runs`；行操作 `Run now`（`Run the saved instructions once`）/ `Pause` / `Resume` / `Delete` / `Scheduled task actions`。
- 关联会话：`Open chat`；`No update from this run`；`Run completed` / `Run failed` / `Running now`。
- 运行历史：`Previous runs`（`Previous run actions`）；`Mark all as read` / `Archive all` / `Unarchive` / `Load more`；`Run was archived`。
- 团队：`Task ownership`（`Personal` / `Team` / `All`）；`Manage teams`；`Open team`。

### 7.2 创建 / 编辑（New scheduled task）

| 控件 | 选项/文案 | 证据 |
|---|---|---|
| 创建方式 | `Create with ChatGPT` / `Create with Codex` / `Set up manually`；`Create scheduled task options` | `inbox.automations.createWith*` / `createMenu.*` |
| 名称/Prompt | `Name`（占位 `Scheduled task title`）、`Prompt`（占位 `Describe what ChatGPT should do`） | `inbox.automations.*` / `settings.automations.*` |
| 项目 | `Project`（`None` / `Select project`；`Only local projects are available here`） | `inbox.automations.folder.label` / `settings.automations.projectDropdown.*` |
| 模型/推理 | `Model` / `Select model`；`Reasoning` | `inbox.automations.model.label` / `reasoning.label` |
| 运行位置 | `Runs on`：`This device` / `Desktop` / `Cloud`（`Runs in the cloud even when this device is offline. Chat, project, model, and reasoning settings aren't available for cloud tasks`） | `inbox.automations.executionLocation.*` |
| 目标会话 | `Runs in`：`New chat each run` / `New chat for this task` / `specific chat`（`Select a chat for this task`） | `inbox.automations.destination.*` / `targetThread.*` |
| 通知 | `Notifications`：`Important updates` / `Failed runs only` / `All runs` | `inbox.automations.notifications.*` / `settings.automations.notifications.*` |
| 重复 | `Repeat`；频率 `Hourly` / `Daily` / `Weekly` / `Monthly` / `Yearly`；`Repeat interval`（`Every` + 数量单位）；`Start time` / `At` / `On days` / `On`（weekday）；`End repeat`：`Never` / `On date`（`Date`） | `inbox.automations.customFrequency.*` / `customInterval.*` / `customWeekdays.*` / `endRepeat.*` |
| 高级 | `Advanced schedule`：`Use an RRULE to define a custom schedule`；`RRULE` 输入；`Edit schedule rule` / `Enter a valid RRULE` | `inbox.automations.scheduleRule.*` |
| 一次性 | `OneTimeScheduleSummary` = `Once`；`Scheduled date` / `Date` | `settings.automations.oneTimeScheduleSummary` / `inbox.automations.oneTimeDate.*` |
| 保存/运行 | `Save`、`Save and run now`（`Save changes, then run the task once`）、`Create`、`Cancel`；错误 toast | `automations.editor.*` / `inbox.automations.saveError` |
| 插件模板 | `From Plugins`；`Set up {name} scheduled task`；`Reset to plugin defaults` | `inbox.automations.pluginTemplate*` |
| 同步到账号（可选迁移） | `Sync your local automations`（`Store your local automations securely in your ChatGPT account while keeping them available on this device`；`Schedules and execution stay on this device`；prompts/paths 加密） | `inbox.automations.habitatMigration.*` |
| 安全提示 | 计划任务使用默认 sandbox；Full access 下强警告（"Running scheduled tasks in the background with Full Access carries elevated risk…"） | `settings.automations.banner.*` |

---

## 8. Worktrees（运行态与生命周期）

来源：`worktreeInitV2.*`（27）、`worktreeRestoreBanner.*`（10）、`localConversation.moveTo*`、`composer.worktree*`、`settings.worktrees.*`、`settings.git.worktreeRoot`。

| 场景 | 官方文案/行为 | 证据 |
|---|---|---|
| Composer 选择 | `Work in` → `Worktree`；`New local worktree` / `New {repoName} worktree` / `New remote worktree`；tooltip `Create a copy of {repoName} to work in parallel.`；多根项目 `Other project source folders will be accessed directly.`；`This repo has git submodules. Worktree creation may fail` | `composer.worktree.*`、`composer.worktreePrompt.*` |
| 创建中 | `Creating worktree…` / `Worktree ready` / `Attaching worktree…`；`Worktree {id}` | `codex.localConversation.environmentSummary.*` |
| 恢复 | `worktreeRestoreBanner.*`：worktree 丢失时 Restore；`Restore the worktree to continue` | 同上 + `composer.submitToast.*` |
| 交接（Move） | `Move to local` / `Move to worktree` / `Hand off chat to {destinationLabel}`；分支名输入（`Branch name` / `new-branch`）、`Bring changes back`、`Hand off`；错误：`Branch is already checked out in another worktree`、`Stash or commit your local changes to hand off`、`Failed to create worktree` | `localConversation.moveToLocal.*` / `moveToWorktree.*` / `moveToHostWorktree.*` |
| 分支状态 | `Detached HEAD`、`Uncommitted: {fileCount} file(s)`、`Commit changes to switch branch`、`Create and checkout new branch…` | `composer.footer.branchSwitch.*`（`git-branch-switcher-*.js`） |
| 清理 | 自动删除旧 worktree（保留 N 个、删除前 snapshot 可恢复） | `settings.worktrees.autoCleanup/keepCount` |
| 设置 | `Worktree root`、`Always fetch upstream before creating worktrees` | `settings.git.worktreeRoot` / `settings.worktrees.upstreamRefresh` |

---

## 9. Skills / Plugins / MCP（页面与目录）

### 9.1 Skills 页（`/skills`，侧边栏 `Skills`）

来源：`skills.*`（217 条，`app-primary`）。

- 标题 `Skills`；副标题 `Add reusable workflows with Skills.`；`New skill` / `Create skill` / `Record a skill`；`Refresh`（`Refresh to use new skill(s)`）。
- 分组：`Installed`、`Recommended`、`Created by you`、`Shared with you`；scope：`Personal` / `Repo` / `Team` / `User` / `Admin` / `Admin installed` / `System`（`builtIn`）。
- Skill 卡片：`Open`、`Details`、`Try now`、`Enable` / `Disable`（成功 `{skillName} skill enabled`）、`Uninstall`、`Copy Markdown`（`Copied SKILL.md`）、`Reveal in Finder/File Explorer/File Manager`；内容加载态 `Loading skill contents...` / `No instructions available yet`。
- 推荐安装：`Install skill` / `Installed` / `{skillName} skill installed`。
- 从 Computer history 建议：`Based on your Computer History` / `Create skill`。
- 搜索：`Search skills`；空态 `No skills found` / `No skills match your filters`。

### 9.2 Plugins / 目录页（`/plugins`，侧边栏 `Plugins`）

来源：`skills.appsPage.*`（与 Skills 共用）、`plugins.*`（377 条，多数为插件详情）。

- 页头：`Plugins`（browseIntro `Connect plugins to let Codex work across your tools`）；`Browse plugins or skills` 切换；`Plugins` / `Skills` tabs（`Skills, new suggestions`）。
- Manage 页签：`Plugins` / `Skills` / `Apps` / `MCPs` / `Marketplace`。
- Directory tabs：`Personal` / `Public` / `Workspace`。
- 分组：`Installed`（`My Plugins`）/ `Recommended` / `Marketplaces` / `My Apps` / `My MCPs` / `My Skills` / `Created by you` / `Shared with you`。
- Marketplace：`Add plugin marketplace`（`Source`：`openai/plugins or git@github.com:org/repo.git`；`Git ref`；`Sparse paths`）、`Upgrade marketplace` / `Upgrade all marketplaces`、`Remove marketplace`（会卸载插件，`Uninstall & remove`）。
- App/插件操作：`Connect` / `Connected to {email}` / `Disconnect`、`Enable/Disable app`、`Reconnect`；`Tools for this app`（`The {appName} app contains {totalActions} tools ({actionTypes})`、`Try now`）；`Request a plugin`；`Create plugin`。
- 搜索：`Search plugins` / `Search skills` / `Search apps` / `Search MCP servers` / `Search marketplaces`。
- MCP：`My MCPs` / `Add MCP server` / `No MCP servers found`（设置页见 6.9）。

### 9.3 MCP（运行时）

- MCP 工具调用卡片见 §4.2；MCP 审批卡见 §4.5；`/mcp` 显示服务器状态；MCP Apps 数据清理见 6.9。
- IPC 佐证：`recommended-skills`、`install-recommended-skill`、`remove-skill`、`local-custom-agents`、`mcp-codex-config`、`download-internal-plugins`（`main-DkWgQSQe.js`）。

---

## 10. Code Review（`/pull-requests`、侧边栏 `Code Review` / `Pull requests`）

来源：`codeReview.*`（73）、`codeReview.sidebar.*`、`codeReview.menu.*`、`settings.codeReview.*`、`codeReviewPlugin.*`、`pullRequestDetail.*`、`pullRequestsPage.*`。

| 区块 | 文案/行为 | 证据 |
|---|---|---|
| 入口 | 侧边栏 `Code Review`、`Pull requests`；空态 onboarding `Review code, catch issues, and make fixes with Codex` | `sidebarElectron.codeReviewRouteNavLink / pullRequestsRouteNavLink`；`codeReview.onboarding.*` |
| Provider | `GitHub` / `GitLab (beta)`；`Review provider`；`Connect GitLab (beta)` | `codeReview.settings.*` |
| 列表分组 | `Pinned`、`Authored by me`、`Needs my review`、`Needs my team's review`、`Recently merged`、`Recents`；搜索/粘贴 PR 链接（`Search or paste a PR link`；GitLab `Search or paste an MR link`） | `codeReview.sidebar.*` |
| 徽标 | `Approved` / `Changes requested` / `Draft` / `Merged` / `Closed` / `Waiting for review` / `Private review unread` / `Private review in progress` | `codeReview.sidebar.*Badge` |
| 行操作 | `Review with Codex`、`Copy link`、`Open in GitHub` / `Open in GitLab`、`Convert to draft`、`Mark ready for review`、`Close pull request`、`Reopen pull request`、`Pin/Unpin pull request` | `codeReview.menu.*` |
| 详情 | PR 摘要（`{head} → {base}` / `· Draft`）、checks、`Failing checks`、`Comments`、`Merge conflicts`；`Repair`；diff 审阅面板见 §4.4 | `codex.review.pullRequests.*`；`localConversation.gitSummary.*` |
| 提交/PR 生成 | `Commit or push`、`Create pull request`、`Create draft PR`、`Merge PR`、`Open PR on GitHub`；commit/PR 信息可生成 | `codex.command.git.*`；`review.commit.*`；IPC `generate-commit-message` / `generate-pull-request-message` |
| 设置 | 个人偏好 + 仓库配置 + Security Review（见 6.20 / settings.codeReview） | `settings.codeReview.*` |

---

## 11. 搜索与命令面板（Command Menu）

来源：`command-menu-dialog-c95da71834af.js`；`codex.commandMenu.*`（44）、`codex.command*`；`settings.search.*`。

### 11.1 Command Menu

- 打开：`CmdOrCtrl+K` 或 `CmdOrCtrl+Shift+P`（`Open command menu`）；标题 `Command menu`；描述 `Search commands and past chats.`；统一占位 `Search chats or run a command`；`Back to commands`。
- 分组（官方文案）：
  - `Quick actions`（Suggested）
  - `Chats`（`Search chats` / `Searching chats…` / `Couldn't search ChatGPT chats` / `Retry`）
  - `Pinned chats`
  - `Recent chats`
  - `Recently viewed chats`（`Recently viewed` / `No recently viewed chats`）
  - `Files`（`Search files`、`No matching files`、`Opened recently`、`Files`）
  - `Browser tabs`
  - `Settings`
  - `Color themes`（`Search themes`）
  - `Switch project`
  - 空态 `No matches` / `Create a chat to get started!`
- 独立文件搜索：`Search Files…`（`CmdOrCtrl+P`）；会话搜索：`Search Chats…`（`Switch chat…`）。
- 设置内搜索见 6.1。

### 11.2 上下文菜单 / 命令拦截

- 应用内右键：标签页菜单（`Close` / `Close other tabs` / `Close tabs to the right` / `Pin to sidebar` / `Unpin from sidebar`）、浏览器菜单（`Back` / `Forward` / `Reload` / `Copy Link` / `Open Link in New Tab` / `Open in External Browser` / `Inspect` / `Comment with Codex`）、会话行菜单、文件树菜单等。
- preload 暴露 `codex_desktop:show-context-menu`（统一右键菜单入口）。

---

## 12. 键盘快捷键（默认值）

> 官方快捷键是「命令注册表 + 可覆写 keymap」：`bootstrap-DvSEn4qy.js` 中每条命令 `{id,titleIntlId,descriptionIntlId,electron:{menuTitle,defaultKeybindings,platformDefaultKeybindings}}`；设置页可改键（§6.7）；native 菜单 accelerator 由 keymap 动态计算。下表为默认值（详见 `.ref/scratch/commands.tsv`，161 条命令）。

### 12.1 导航 / 全局

| 命令 | 默认 | 说明 | 证据 |
|---|---|---|---|
| Open command menu | `CmdOrCtrl+K` / `CmdOrCtrl+Shift+P` | 命令面板 | `commands.tsv: openCommandMenu`；title `codex.commandMenuTitle.openCommandMenu` |
| Search files | `CmdOrCtrl+P` | 文件搜索 | `commands.tsv: searchFiles` |
| Search chats | `CmdOrCtrl+K`（上下文） | 切换会话 | `codex.command.searchChats` |
| Keyboard shortcuts | `CmdOrCtrl+/` | 快捷键弹窗 | `codex.command.showKeyboardShortcuts` |
| Settings | `CmdOrCtrl+,` | 设置 | `codex.command.settings` |
| Back / Forward | `CmdOrCtrl+[` / `CmdOrCtrl+]`、`MouseBack/MouseForward` | 应用内导航历史 | `codex.command.navigateBack/Forward` |
| Browser back/forward | `Command+Left/Right`（mac）/ `Alt+Left/Right` | 内置浏览器 | `codex.command.navigateBrowserBack/Forward` |
| Go to chat 1–9 | `CmdOrCtrl+1..9` | 切换可见会话 | `codex.command.thread1..9` |
| Recent chat 1–9 | `CmdOrCtrl+Alt+1..9` | 最近会话 | `codex.command.recentThread1..9` |
| Next/Previous chat | `CmdOrCtrl+Shift+]` / `[`（+平台别名） | 顺序切换 | `codex.command.nextThread/previousThread` |
| Next chat needing attention | `CmdOrCtrl+Alt+A` | 下一个待处理 | `codex.command.nextThreadNeedingAttention` |
| Next/Previous tab | `CmdOrCtrl+Shift+]` / `[`、`Ctrl+Tab` / `Ctrl+Shift+Tab` | 标签切换 | `codex.command.nextTab/previousTab` |
| Switch Chat / Work / Codex | `Ctrl+1/2/3`（或 `Alt+1/2/3`） | 模式切换 | `codex.command.switchToMode1..3` |
| Show Mini | `Alt+Space`（或 `Super+Alt+P`） | 悬浮 Mini | `commands.tsv: openAvatarOverlay`；title `codex.command.showMiniOverlay` |

### 12.2 会话

| 命令 | 默认 | 证据 |
|---|---|---|
| New Chat | `CmdOrCtrl+N`（平台另 `CmdOrCtrl+Shift+O`） | `codex.command.newThread` |
| New standalone chat | `CmdOrCtrl+Alt+O` | `newProjectlessTask` |
| New Temporary Chat | `CmdOrCtrl+Shift+N` | `temporaryChat` |
| Archive chat | `CmdOrCtrl+Shift+A` | `archiveThread` |
| Pin/unpin chat | `CmdOrCtrl+Alt+P` | `toggleThreadPin` |
| Mark as unread | `CmdOrCtrl+Shift+U` | `markThreadUnread` |
| Delete chat | `CmdOrCtrl+Shift+Delete` / `Command+Shift+Backspace` | `deleteChat` |
| Rename chat | `CmdOrCtrl+Alt+R` | `renameThread` |
| Copy working directory | `CmdOrCtrl+Shift+C` | `copyWorkingDirectory` |
| Copy conversation path | `CmdOrCtrl+Alt+Shift+C` | `copyConversationPath` |
| Copy deeplink | `CmdOrCtrl+Alt+L` | `copyDeeplink` |
| Copy last code block | `CmdOrCtrl+Shift+;` | `copyLastCodeBlock` |
| Copy as Markdown | 无默认 | `copyConversationMarkdown` |
| Fork chat | 无默认 | `forkThread` |
| Open side chat | `CmdOrCtrl+Alt+S` | `openSideChat` |
| Close Tab / Close Window | `CmdOrCtrl+W` / `Ctrl+F4` | `closeTab` / `closeWindow` |
| Reopen closed tab | `CmdOrCtrl+Shift+T` | `reopenClosedTab` |
| Focus main chat | `Shift+Escape` / `Alt+L` | `focusMainChat` |
| Find in chat | `CmdOrCtrl+F` / `Command+F` / `Ctrl+F` | `findInThread` |

### 12.3 Composer

| 命令 | 默认 | 证据 |
|---|---|---|
| Submit / Queue / Steer | `Enter`（普通）/ 设置可改；Queue/Steer 由 follow-up 设置决定 | `composer.submit/queue/steer` |
| Submit in background | `CmdOrCtrl+Enter` | `composer.submitInBackground` |
| Open model picker | `Ctrl+Shift+M` | `composer.openModelPicker` |
| Open recent models | `Ctrl+Cmd+M`（mac）/ `Alt+M` | `composer.openRecentModels` |
| Project picker | `CmdOrCtrl+Alt+Shift+O` | `composer.openProjectPicker` |
| Add files | `CmdOrCtrl+U` | `composer.addFiles` |
| Start dictation | `Ctrl+Shift+D` | `composer.startDictation` |
| Start voice mode | `Ctrl+Shift+V` | `composer.startVoiceMode` |
| Approval approve / decline | `Enter` / `Escape` | `approval.approve/decline` |
| Clear prompt | 无默认 | `composer.clear` |
| Toggle plan mode / fast mode / worktree mode / cloud-local | 无默认（命令面板可用） | `composer.toggle*` |

### 12.4 面板 / 视图

| 命令 | 默认 | 证据 |
|---|---|---|
| Toggle sidebar | `CmdOrCtrl+B` / `CmdOrCtrl+Shift+S` | `toggleSidebar` |
| Toggle bottom panel | `CmdOrCtrl+J` | `toggleBottomPanel` |
| Toggle Changes panel | `CmdOrCtrl+Alt+B` | `toggleSidePanel` |
| Toggle navigation/file tree panel | `CmdOrCtrl+Shift+E` | `toggleFileTreePanel` |
| Full view | `CmdOrCtrl+Shift+F` | `showWorkspaceTabView` |
| Cycle workspace layout | `CmdOrCtrl+Shift+B` | `stepWorkspaceLayout` |
| Open terminal | 无默认（菜单/命令） | `toggleTerminal` |
| Find | `CmdOrCtrl+F`、Find Next `CmdOrCtrl+G` / `Shift+F3` | `findInThread` |
| Zoom In/Out/Actual Size | `CmdOrCtrl+Plus/Minus/0` | 菜单实现 |
| Toggle Full Screen | `F11`（win/linux）/ `Ctrl+Cmd+F` | 菜单实现 |

---

## 13. 原生菜单（Electron Menu）

来源：`main-DkWgQSQe.js` 的 `MJe()`（菜单组装）与 `OJe()`（Edit/Window 模板）；i18n：`windowsMenuBar.*`、`electron.appMenu.*`；中文对照：`.ref/asar-files/native-menu-zh-CN.json`。

菜单结构（macOS：App / File / Edit / View / Window / Help；Windows/Linux：File / Edit / View / Help）：

| 菜单 | 可见项（官方英文） | 备注 |
|---|---|---|
| **App（mac）** | `About {appName}`、`Check for Updates…`、`Services`、`Hide {appName}`、`Hide Others`、`Show All`、`Quit {appName}` | `electron.appMenu.app.*` |
| **File** | `New Window`、`New Chat`、`New standalone chat`（隐藏）、`New Temporary Chat`、`Open Folder…`、`Log Out`、`Close` | 运行时动态插入（多窗口开关）；`codex.command.*` + `g7` intl 映射 |
| **Edit** | `Undo`/`Redo`、`Cut`/`Copy`/`Paste`、`Paste and Match Style`（mac）、`Delete`、`Select All`；mac 另有 `Substitutions`、`Speech` | `electron.appMenu.edit.*` |
| **View** | `Toggle Sidebar`、`Toggle Bottom Panel`、`Toggle Pinned Summary`、`Open Terminal`、`Toggle navigation panel`、`Full view`、`Cycle workspace layout`、`Toggle Changes panel` / `Switch between Chat and tabs`、`Browser` 子菜单（Back/Forward/Reload/Force Reload/Copy Browser URL）、`Find`、`Find Next`、`Find Previous`、`Zoom In/Out/Actual Size`、`Developer` 子菜单（Toggle Debug Panel、Toggle DevTools、Toggle Query Devtools、Toggle React Scan、Show/Hide RAM Usage、Open Deeplink from Clipboard、Copy User ID）、`Toggle Full Screen`；隐藏项用于注册全局 accelerator（copy path/deeplink、pin、rename、archive、thread 1–9 等） | `main-DkWgQSQe.js` View 组装（jt/Mt/Pt 数组） |
| **Window（mac）** | `Minimize`、`Zoom`、`Bring All to Front` | `electron.appMenu.window.*` |
| **Help** | `Documentation`、`Keyboard Shortcuts`、`What's New`、`Troubleshooting`、`System Status`、`Send Feedback`、`Task Manager`、（trace upload: Start/Stop Trace Recording）、`About {appName}`、`Check for Updates…`（非 mac） | `main-DkWgQSQe.js` Help submenu；`sidebarHelp.whatsNew` |

- **accelerator 机制**：菜单项 `accelerator` 不是硬编码，而是从命令 keymap 动态计算（`m.tr({commandId,keymapState,isMacOS})`），用户改键后菜单即时刷新（`set-codex-command-keybinding` → `refreshApplicationMenu()`）。
- **上下文菜单**：`codex_desktop:show-context-menu`（preload）；标签页/浏览器/会话/文件树均有独立右键菜单（见 §11.2）。
- **托盘**：Windows/Linux `Tray` + macOS 原生 `NSStatusItem`（`getNativeStatusItemState`/`onNativeStatusItemMenuAction`），菜单含打开主窗、新会话、最近会话、发送反馈。

---

## 14. 通知 / 未读（运行时）

- 任务完成通知：设置 `Notifications`；通知标题 `Permission approval` / `Question`（`inputRequired`: `Answer a question to proceed.`）等。
- 未读面板：侧边栏 `Unreads` / 活动视图；`Clear all unreads?`（`This will mark all chats and scheduled task updates in Codex as read`，可 `Don't ask me again`）。
- 通知点击行为：打开对应会话/审批；`Codex has a question`（`notifications.asyncQuestion`）。
- 声音与系统权限见 6.18。

---

## 15. 多窗口 / 标签页 / Popout / Mini / Appshots（运行时）

| 能力 | 文案/行为 | 证据 |
|---|---|---|
| 多窗口 | `New Window`；`Open in New Window`；标签拖出 `Release to open in a new window`；`Restore tab`；`This tab is open in a separate window` | `appShell.tabs.*`；`appShell.detachedWindow.*`；`detached-window.html` |
| 分离窗口控制 | `Focus chat`、`Keep window on top` / `Stop keeping window on top`、`Restore to main window` | `appShell.detachedWindow.*` |
| 标签页拖拽 | 拖拽提示 `Move to Chat` / `Move to left pane` / `Move to right pane` / `Move to bottom pane` / `Move to New chat` / `Pin tab` | `appShell.tabs.drag*Cue` |
| Popout Window | 全局热键（实验）；Popout 首页/线程页；`Chat settings` 菜单（Project/Environment/Permissions/Branch/`Start in`）；`Default to standalone chat`；`Resume` / `New` 斜杠命令；`Return to the Popout Window home` | `hotkeyWindow.*`（15 条）、`settings.general.popoutWindow.*`、`experimentalFeatures.hotkeyWindowHotkey.*` |
| Mini（宠物悬浮窗） | `Show Mini` / `Hide Mini`；`Wake Mini` / `Tuck Away Mini`；`Picture in Picture` / `Move to floating window` / `Send to Pet`（远程截图浮窗）；`Show Picture in Picture` | `codex.command.showMiniOverlay`、`settings.pets.*`、`codex.localConversation.remoteHostedPip.*` |
| Appshots | 全局热键截取前台窗口（含滚屏外文本）→ 发送到 `Automatic` / `Current chat` / `New chat`；`Play sound effect`；`Capture appshot` 命令 | `settings.appshots.*`、`codex.command.composer.captureAppshot` |

---

## 16. 超出范围：ChatGPT 云端专属（不展开）

官方 App 是 ChatGPT Desktop + Codex 合体；以下模块在本仓库对标中 **out-of-scope**，只在 feature-index 中标 `out-of-scope`：

| 模块 | 内容 | 证据 |
|---|---|---|
| ChatGPT 会话/云端 agents/Work 云端 | ChatGPT 聊天、云端 agent、Space、Projects(ChatGPT)、Library、Sites、GPTs、Images、appgen | `chatgpt.*`（427）、`chatgptConversations.*`（405）、`space.*`、`libraryNext.*`、`sites.*`、`appgen*.*` |
| Artifacts / Canvas / Pages / 文档生成 | Canvas/Docs/Slides/Sheets、Pages、写作块、artifact 预览/批注 | `artifact*.*`、`codex.pages.*`、`codex.writingBlock.*`、`codex.visualization.*` |
| 云端浏览器 / 网页控制 | in-app browser 云端会话、Browser Sidebar、浏览器账号、Cloud computer | `browser.*`、`browserSidebar.*`、`browserAuth.*`、`restricted.cloudComputer.*` |
| Voice 通话 / 头像 | 实时语音通话、voice floating orb、avatar overlay、choose your voice | `realtimeVoice.*`、`voiceFloatingOrb*.*`、`avatarOverlay.*`、`choose_your_voice.*` |
| 计费 / 钱包 / 用量 | checkout、billing、credits、usage center、rate-limit 购买、wallet onboarding、pricing | `checkout.*`、`billing.*`、`usageCenter.*`、`consumerBilling.*`、`codexWalletOnboarding*.*` |
| 账号/团队/合规 | Account、Profile、Security、Teams、Parental controls、Trusted contact、Safety & wellbeing、Time management、Age、Agreements、Data controls(ChatGPT)、Ads controls、Analytics | `settings.chatGpt.*`（600）、`settings.teams.*`、`settings.profile.*`、`settings.dataControls.*` |
| 云端环境设置 | Cloud environments / Codex Cloud / Cloud preferences / Legacy Codex Cloud / Cloud computer / Passwords / Browser extension | `settings.cloudEnvironments.*`、`settings.codexCloud.*`、`settings.legacyCodexCloud.*` |
| Codex 云端 Code Review（服务端） | Security Review 的云端判定/计费/团队策略（桌面端 UI 已在 §10 覆盖，其云端后端能力超出范围） | `settings.codeReview.*`（云端部分）、`settings.codeReview.cloudTab` |
| 其他 | Meetings、CME、Personal finance、Orbit/dot 等 | `meetings.*`、`cme.*`、`personalFinance.*`、`orbit.*` |

---

## 17. 证据索引 / 复现与置信度

### 17.1 本次抽取的关键证据文件

| 路径 | 内容 |
|---|---|
| `.ref/asar-files/app-package.json` | 版本、产品名、Electron 版本、依赖、build flavor |
| `.ref/asar-files/webview-index.html` / `detached-window.html` | renderer 入口、CSP、启动动画、独立窗口 |
| `.ref/asar-files/native-menu-zh-CN.json` | 209 条原生菜单/命令菜单中文文案（可与英文 id 对照） |
| `.ref/scratch/main-DkWgQSQe.js` | 主进程：菜单、窗口、托盘、更新、about、退出确认、deep link |
| `.ref/scratch/preload.js` | `contextBridge` 暴露面 + 21 个 `codex_desktop:*` channel |
| `.ref/scratch/files/app-initial-fd3c4b862660.js` | 设置分区注册表（`HDa`/`RDa`/`mi`）、大量 i18n |
| `.ref/scratch/files/app-primary-84ad97f06929.js` | composer/thread/settings 大量组件字符串（1,189 条 i18n） |
| `.ref/scratch/files/_virtual_settings-search-documents-e57d6206ad62.js` | 5,111 条聚合 i18n 目录（settings 相关最全） |
| `.ref/scratch/files/bootstrap-DvSEn4qy.js` | 161 条命令定义（含默认键位、菜单 title） |
| `.ref/scratch/catalog-full.tsv` | 全量 13,980 条 i18n（id / defaultMessage / 来源 chunk） |
| `.ref/scratch/dumps/*.txt` | 按 i18n 顶层前缀分组后的文案（784 组） |
| `.ref/scratch/settings-sec/*.txt` | 设置各分区文案分文件 |
| `.ref/reference/settings-labels.txt` | 设置相关 4,246 条英文 label（交付物 3） |
| `.ref/reference/feature-index.json` | 机器可读功能索引（43 模块 / 212 项，交付物 2） |

### 17.2 主进程 IPC 暴露面（反推功能面的强证据）

`main-DkWgQSQe.js` 中可枚举的 IPC handler 键（114 个），按域归类：

- **文件**：`read-file`、`write-file`、`save-file`、`read-file-binary`、`read-git-file-binary`、`find-files`、`pick-file(s)`、`paths-exist`、`workspace-directory-entries`、`remote-workspace-directory-entries`、`apply-patch`
- **Git/Worktree**：`git-create-branch`、`git-push`、`git-merge-base`、`generate-commit-message`、`generate-commit-pull-request-message`、`generate-pull-request-message`、`worktree-create-managed`、`worktree-delete`、`worktree-set-owner-thread`、`prepare-worktree-snapshot`、`upload-worktree-snapshot`、`electron-clone-workspace-repo`
- **Skills/Plugins/MCP**：`recommended-skills`、`install-recommended-skill`、`remove-skill`、`local-custom-agents`、`download-internal-plugins`、`mcp-codex-config`
- **计划任务**：`list-automations`、`automation-run-now`、`automation-run-archive`、`automation-run-delete`、`inbox-items`
- **远程/连接**：`discover-remote-ssh-connections`、`refresh-remote-connections`、`refresh-remote-control-connections`、`save-codex-managed-remote-ssh-connections`、`install-remote-codex`、`set-remote-*-enabled`、`authorize-remote-control-connections`、`start/stop-remote-chatgpt-login-port-forward`、`wsl-bash-availability`、`remote-workspace-directory-entries`
- **命令/快捷键**：`codex-command-keymap-state`、`set-codex-command-keybinding`、`reset-codex-command-keybindings`、`global-dictation-set-hotkey`、`global-dictation-set-toggle-hotkey`、`global-dictation-hotkey-state`
- **浏览器/Computer use**：`browser-use-origin-state-read`、`browser-use-approval-mode-write`、`browser-use-history-approval-mode-write`、`browser-use-file-transfer-approval-mode-write`、`browser-use-full-cdp-access-enabled-write`、`browser-browsing-data-clear`、`computer-use-frontmost-window`、`computer-use-start-capture`、`native-desktop-apps`、`native-desktop-app-icon`
- **设置/全局状态**：`get-setting(s)`、`set-setting`、`settings-read`、`settings-write`、`get-global-state`、`set-global-state`、`get-configuration`、`set-configuration`、`local-environment-config(-save)`、`workspace-root-options`、`projectless-thread-cwd`、`projectless-workspace-root`
- **导入/诊断**：`claude-code-import-status`、`external-agent-import-import`、`external-agent-imported-connectors`、`feedback-desktop-log-archive`、`delete-feedback-desktop-log-archive`、`third-party-notices`、`os-info`、`locale-info`、`openai-api-key`
- **其他**：`add-context-file`、`ambient-suggestions(-refresh/-set-status)`、`queued-follow-up-send-lock-acquire/release`、`codex-agents-md(-save)`、`developer-instructions`、`set-vs-context`

preload 暴露的 21 个 `codex_desktop:*` channel：`chunked-message-ack`、`remote-hosted-pip-video-frame`、`mcp-app-sandbox-host-message`、`show-context-menu`、`get-sentry-init-options`、`get-build-flavor`、`get-system-theme-variant`、`get-initial-sidebar-bootstrap`、`get-fast-mode-rollout-metrics`、`system-theme-variant-updated`、`trigger-sentry-test`、`connect-app-host`、`start-file-drag`、`start-link-drag`、`worker:`、`message-from-view`、`message-for-view`、`get-shared-object-snapshot`；另暴露 `electronBridge`、`codexWindowType`。

### 17.3 置信度与未覆盖项

- **高置信**：所有「官方英文文案 + 选项枚举」均直接来自 i18n `defaultMessage`，可 1:1 采用；菜单位置/快捷键来自主进程代码与命令注册表。
- **中置信**：部分布局细节（哪个控件在左/右、具体图标）由 chunk 名、组件文件与文案推断，未做运行时截图验证（本任务未运行官方 App）。
- **未覆盖**：ChatGPT 云端后端行为、云端 Code Review 策略、Codex Micro 硬件交互细节、部分内部 debug 功能；如需补，可抽对应 chunk（如 `*-settings*.js`、`codex-micro-*`、`browser-*`）。
- **建议下一步（差距分析用）**：以 `feature-index.json` 的 `in-scope` 项为 checklist，按模块与当前 Tauri 实现逐项比对；文案对齐可直接使用 `.ref/reference/settings-labels.txt`。
