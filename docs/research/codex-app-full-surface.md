# Codex App 全量页面与功能清单

> 调研日期：2026-10-25<br>
> 调研对象：Windows 本机官方 Codex App（Electron，ChatGPT Desktop 同体）<br>
> 方法：Computer Use 实际操作 + 本机 `app.asar` 代码、路由、设置注册表、命令注册表与 i18n 交叉核对<br>
> 用途：下一阶段产品设计与开发的前置基线；本文只描述官方能力，不代表本项目已经实现。

## 0. 版本、范围与证据口径

| 项 | 本次确认值 |
|---|---|
| 官方应用 | `C:\Users\lus\Codex\_internal\app\ChatGPT.exe` |
| 安装包 | `C:\Users\lus\Codex\_internal\app\resources\app.asar` |
| App 版本 | `26.928.21956` |
| Build | `12404`，`prod` |
| 桌面壳 | Electron `42.3.0`，React SPA |
| 实测语言 / 平台 | 简体中文 / Windows |
| 代码一致性 | 当前安装包的 `main-DkWgQSQe.js`、`app-shared-a906948d8868.js` 与既有抽取逐字节一致 |

证据标记：

- **[实测]**：本次通过 Computer Use 在真实官方窗口中看到或操作到。
- **[代码]**：在本机路由、组件、原生菜单、IPC 或 i18n 中确认，但本次未逐项点击。
- **[门控]**：仅在产品模式、账号、套餐、工作区、平台、硬件、权限或 feature flag 满足时出现；不可做成无条件常驻入口。
- **[隐藏]**：当前代码明确 `visible:false` 或只保留兼容路由，不等于正式可见页面。
- **[流程]**：登录、回调、首次运行或特殊窗口，不是普通侧栏页面。

“完整”的边界：本文覆盖官方安装包自身可枚举的页面、工作面、设置和全局能力。第三方插件在运行后自行提供的页面无法从官方安装包穷举，本文覆盖其宿主路由、安装、授权、管理和调用机制。动态模型、 marketplace 内容和账号套餐也不硬编码为产品常量。

本文是**全 App 总表**；[reference-inventory.md](reference-inventory.md) 保留为 Codex 本地模式的专项明细。两者冲突时，以本文的路由、可见性和本次实测结论为准。本次没有发送任务、安装插件、删除数据、改变设置、授权位置、登录或退出账号。

---

## 1. 应用信息架构与页面总目录

### 1.1 产品模式和导航壳

- **[代码]** 三种主要产品模式：`ChatGPT`、`ChatGPT Work`、`Codex`；另有 Home 工作面。模式决定首页、Composer、会话类型和设置可见性。
- **[实测]** 当前左侧导航轨有：首页、定时任务、资料库、图像、插件、探索（更多）、代码审查、个人资料。
- **[实测]** “探索”在当前布局中打开更多菜单：项目、站点、地图、购物、GPT、代码审查；`/explore` 自身只是重定向到 `/`，不是 GPT 页面。
- **[实测]** 首页侧栏包含模式切换、活动视图、搜索、新聊天、快速聊天、项目、项目内会话、最近会话，以及排序／分组／自定义分区等代码已确认的菜单能力。
- **[代码]** 主窗口由侧栏、主内容、线程标签条、右侧／底部工作面板和 Composer 组成；另有原生菜单、托盘、通知、多窗口、Popout、Mini 和全局听写窗口。

### 1.2 全 App 页面族总表

| 页面族 | 主要页面 / 路由 | 核心功能 | 证据 |
|---|---|---|---|
| Home / 新任务 | `/`、`/projects?projectId=...` | 三种模式的新会话、项目与环境选择、建议、完整 Composer | 实测 + 代码 |
| Codex 本地会话 | 本地 conversation 动态路由 | 本地 Agent、工具、审批、Changes、Files、Terminal、Side chat | 实测 + 代码 |
| ChatGPT 会话 | `/c/:conversationId`、`/branch/:conversationId/:messageId` | 云会话、编辑／重生成、分支、分享、语音、工具 | 代码 / 门控 |
| Work 云任务 | `/remote/:taskId` | 云任务、接续对话、本地与云端交接 | 代码 / 门控 |
| Codex 项目 | `/projects` | 本地／远程／云项目、source folders、信任、会话组织 | 实测 + 代码 |
| ChatGPT 项目 | `/g/:projectId/project` | 项目聊天、文件、连接器、记忆、说明、分享 | 代码 / 门控 |
| 定时任务 | `/scheduled`；兼容 `/automations`、`/inbox` | 创建、计划、事件触发、运行历史、通知、暂停和归档 | 实测 + 代码 |
| Skills | `/skills` 及技能／插件详情 | 搜索、启停、安装、创建、录制、详情、打开文件 | 代码 |
| Plugins | `/plugins`、`/plugins/:pluginId` | 目录、安装、详情、Apps／Skills／MCP／Hooks、分享、市场 | 实测 + 代码 |
| Code Review | Code Review 插件工作面 | 本地／私有 review、修复、PR 关联、review chat | 实测入口 + 代码 |
| Pull requests | `/pull-requests` 及参数化详情 | PR/MR 列表、详情、checks、评论、修复、合并 | 实测 + 代码 |
| Codex Security | `/security/*` | 安全工作面与 findings | 代码 / 门控 |
| 归档 | `/archive`、`/settings/data-controls` | 搜索、筛选、恢复、删除、批量操作 | 代码 |
| 连接 | `/remote-connections`、`/codex-mobile` | SSH、WSL、已登录设备、远程控制、移动配对 | 代码 / 门控 |
| 云环境 | `/cloud-environments/new`；设置内列表／详情／编辑 | 云开发环境 CRUD、网络、变量、secrets、sharing | 代码 / 门控 |
| 资料库 | `/library/*`、文件与分享子路由 | 文件、文件夹、收藏、上传、预览、生成、分享 | 实测 + 代码 |
| Space / Pages | `/space`、`/spaces/:spaceId` 等 | Pages、Files、Sites、团队空间、协作和模板 | 代码 / 门控 |
| 图像 | `/images` | 图像生成、模板、图库、编辑、下载、分享 | 实测 + 代码 |
| GPT | `/gpts`、`/gpts/mine`、`/g/:gizmoId` | 发现、搜索、分类、我的 GPT、创建／迁移、GPT 会话 | 实测 + 代码 / 门控 |
| Workspace Agents | `/agents`、`/agents/studio/*` | Agent 目录、详情、Builder、发布、Slack 渠道 | 代码 / 门控 |
| Sites | `/sites`、`/sites/:projectId/*` | 创建、编辑、发布、分享、分析、数据库、自动化 | 实测 + 代码 / 门控 |
| Maps | `/maps/:entityId?` | 附近推荐、地点分享、位置权限、地图 Composer | 实测 + 代码 / 门控 |
| Shopping | `/shopping` | 商品推荐、购物 Composer、加载／重试 | 实测 + 代码 / 门控 |
| Health | `/health` | Records、Chats、Accounts、健康数据连接 | 代码 / 门控 |
| Finances | `/finances` 及子页 | 账户、交易、财务聊天、仪表盘、导出 | 代码 / 门控 |
| Profile | `/profile`、`/u/:username`、`/settings/profile` | 公开资料、showcase、分享、照片和用户名 | 代码 / 门控 |
| dot / Orbit | `/dots/*`、`/o/*` | 个人 Agent、连接器、outputs、计划、消息渠道 | 代码 / 门控 |
| 设置 | `/settings/:section/*` | 个人、集成、编码、账号、团队、归档等全部分区 | 实测 + 代码；见 §5 |
| 登录与首次运行 | `/login`、`/welcome`、`/onboarding`、`/first-run` 等 | 认证、导览、工作区、导入和法律确认 | 代码 / 流程 |
| 特殊窗口与工作面 | Quick Chat、Hotkey、Mini、Dictation、Diff 等 | 悬浮输入、宠物、听写、独立 diff／plan／扩展面板 | 代码 / 流程；见 §7 |

注意：`/work` 是 browser-only 流程，不是桌面端正常 Work 页面；桌面 Work 从模式切换、Home／Projects 和 `/remote/:taskId` 进入。`/workspace` 不是本版主路由树中的正常页面。Artifacts、Canvas 和 Apps 也不是三个同名顶层路由，详见 §6。

---

## 2. Codex 本地核心：导航、线程与工作区

### 2.1 侧栏与会话组织

| 功能组 | 完整功能点 |
|---|---|
| 搜索与新建 | 全局搜索、新聊天、快速聊天、项目内新建、连接内新建、独立无项目聊天、临时聊天 |
| Activity | 未读、运行中、等待输入；Chat／Work／Cloud／Codex 过滤；全部已读；清除已读；待处理会话跳转 |
| Pinned / Chats | 置顶、拖拽排序、创建时间／更新时间／手动排序、最近会话、会话 hover card |
| Projects | 按项目分组、项目会话数／未读／等待数、项目置顶、编辑、打开目录、移除、项目内归档 |
| 连接与分组 | 按连接／按项目／单一列表；Local、SSH、WSL、Remote、Cloud；断连与重连状态 |
| 自定义分区 | 新建、重命名／编辑、删除；会话和项目拖入；分区内全部已读／归档 |
| 会话行操作 | 重命名及 emoji、置顶、已读／未读、归档、永久删除、打开新窗口、复制链接 |
| 批量操作 | 多选、批量置顶／取消置顶、批量归档、批量标记已读 |
| 个人菜单 | 剩余用量、Mini、邀请、设置、帮助、退出登录；账号与 workspace 切换由账号能力决定 |
| 通用状态 | 加载、空列表、失败重试、目录丢失、连接失败、运行中停止后归档、删除二次确认 |

### 2.2 线程页与工作面板

- **标题栏**：标题、项目、连接状态、Pin、聊天操作、摘要、标签显示和完整视图。
- **标签类型**：Chat、Files、Changes、Terminal、Browser、Desktop、Side chat、New page，以及插件／MCP 提供的工具页。
- **标签操作**：新建、关闭、关闭其他／右侧、重开、Pin、拖到左／右／下面板、移到新聊天、拖成新窗口、恢复主窗口。
- **布局**：右侧 Changes／Files／Terminal／Browser／Side chat，底部 Terminal／Browser，完整视图，面板最大化，布局循环。
- **Browser**：地址栏、前进／后退／刷新、外置浏览器、下载、截图、批注、标签复制／重命名／静音、权限和 detached-tab handoff。
- **Desktop / Computer Use**：工具卡、应用状态、点击、拖拽、键盘、滚动、输入、PiP、发送到 Mini；未发现可靠证据支持把它写成“人工随时接管桌面”。
- **Side chat**：新建／打开、主侧聊天切换、独立 Composer、聚焦主聊天的快捷键。

### 2.3 Turn、消息和工具渲染

| 类型 / 区域 | 功能清单 |
|---|---|
| User message | Markdown／附件、长文本折叠、编辑最后一条并重发、复制、从此处 Fork、用户消息序号导航轨、Bookmark |
| Agent message | Markdown、代码块、表格、LaTeX、Mermaid、复制、反馈／举报、选区操作 |
| Reasoning | Thinking／Typing 状态、可折叠摘要、原始推理（能力允许时）、摘要详细度设置 |
| Command execution | 命令、工作目录、状态、输出折叠、后台终端、停止全部后台终端 |
| File change | 文件及增删行、查看变更、撤销、按 turn 聚合、viewed 状态 |
| MCP tool call | 运行／完成／失败／等待审批、工具进度、MCP App、OAuth／elicitation |
| Web search | 搜索活动与结果；Disabled／Cached／Indexed／Live 策略来自设置和账号能力 |
| Plan / Goal | todo／plan、Up next、Goal 状态、进度与完成／暂停 |
| Context compaction | 压缩事件、上下文用量、手动 `/compact` |
| Subagents / tasks | Created tasks、Starting／Working／Done／Failed、打开子代理、后台进程汇总 |
| Turn 产物 | File、Image、PR、Review、Commit、App preview、Web preview、云盘文件等预览和 Outputs |
| 选区操作 | Add to chat、Ask in side chat、Comment、Edit instruction；不要与“编辑 assistant 原消息”混为一谈 |
| 线程操作 | Rename、Pin、Archive、Unread、Open in new window、Side chat、Copy、Fork、Continue in、Delete |
| Copy / Fork | Markdown、working directory、deeplink、conversation path；当前工作区／同 worktree／新 worktree；从指定消息分叉 |
| 查找与导航 | 线程内查找、上／下一个结果、上／下一会话、最近会话、下一待处理会话 |
| 状态与恢复 | Working／Worked／Stopped／Paused、重连、重试、历史加载失败、归档、目录失效、worktree 恢复、额度耗尽 |

### 2.4 审批、提问与安全确认

- 命令、文件修改、额外权限、MCP 工具、用户提问和选项选择。
- `Allow once`、`Allow this conversation`、`Always allow`、`Deny`；命令理由、execpolicy 记忆、网络与文件系统权限范围。
- 多问题卡的 Previous／Next／Skip／Submit／Continue、推荐项、自由输入、倒计时。
- Auto-review 提示、自动批准／拒绝、高风险、停止、超时，以及最近拒绝的一次重试。
- Full access、Ultra + Full access 等风险确认；precaution findings、继续或新会话确认。
- Enter 批准、Escape 拒绝；通知可跳回对应审批。任何实现都不能自动越过风险确认。

### 2.5 Changes、Files、Git 与 Worktree

| 模块 | 完整功能点 |
|---|---|
| Diff 来源 | Last turn、Branch、Commits、Branch comparison、Selected commit、Cloud changes |
| Git 阶段 | Staged、Unstaged、Uncommitted；空态和未跟踪文件提示 |
| Diff 展示 | Auto、Split、Unified；展开／折叠全部、自动换行、word diff、隐藏空白、rich preview |
| 文件树 | 过滤变更／生成文件、增删行和评论数、隐藏／显示文件树 |
| 大 Diff | 单文件模式、前后文件、过大不显示、加载完整文件、watch 受限和失败重试 |
| 文件操作 | Viewed／Unviewed、打开 tab、复制路径、复制 `git apply`、revert file／hunk／section |
| 提议修改 | Accept、Edit、Reject；与 staged／unstaged 和当前 turn 的关系 |
| Diff 评论 | 新建、保存、回复、删除、dismiss、重试；dismiss 只从 diff 隐藏，仍保留 transcript |
| Review 动作 | Request changes、Copy selection、Open with／Open in、评论发送失败恢复 |
| Files | 工作区文件树、多根目录、文本／Markdown 编辑、tab 切换保留 draft、后退／前进 |
| 代码导航 | Go to line、Definition、References、Implementations、Type Definition、Git blame、Open in GitHub |
| 路径与预览 | Copy file contents、absolute／project-relative／repo-relative path；图片与不支持格式的只读 fallback |
| Commit | 空消息可生成、包含未暂存修改、新分支、Commit、Commit and push |
| PR/MR | 创建／草稿、生成标题与描述、打开、合并、修复 failing checks／comments／merge conflicts |
| Worktree 创建 | 本机／远程、指定 repo、branch name、环境、创建中／ready／attaching、submodule 提示 |
| Worktree 交接 | Move to local／worktree、bring changes back、分支冲突、未提交修改提示、失败恢复 |
| Worktree 生命周期 | 丢失后 Restore、保留数量、自动清理、清理前 snapshot、删除与会话关联约束 |

**仍需开发前补证的细节**：本地代码已确认 text／Markdown draft 和编辑工作面，但不能仅凭这些字符串断言所有文件的自动保存、外部修改冲突和只读规则；实现文件编辑器前应继续核对实际保存链路。

### 2.6 集成终端

- 右侧或底部默认位置、可配置 shell、多标签、工作区多 source directory 切换。
- 普通终端与后台终端、后台输出、停止全部、环境 setup script 和自定义 environment actions。
- 代码块运行、文件路径打开、终端面板快捷键和输出状态；远程环境能力按连接分别处理。

---

## 3. Composer 完整功能清单

### 3.1 控件与选项

| 控件 | 功能与选项 |
|---|---|
| 文本输入 | 多行、富文本／纯文本、粘贴、拖放、撤销重做、选区格式工具、链接和代码块 |
| 模型 | Default 推荐模型集、显式模型、最近模型、锁定模型、Reset；模型由账号与运行时返回，**不得硬编码本次看到的模型名** |
| Reasoning | None、Minimal、Light／Low、Medium、High、Extra High、Max、Ultra、Persistent；按模型能力过滤，实测当前控件为分级滑块 |
| Speed | Standard、Fast、Ultrafast；实测有快速模式开关和“用量更多”提示 |
| 权限 | Default permissions、Read only、Workspace write、Full access；approval policy 与 sandbox 分开建模 |
| Plan | 开关、计划专用 placeholder、真实 collaboration mode，不只是提示词前缀 |
| Goal | 设置持续推进的目标、可衡量结果提示、目标状态与清除 |
| 项目 | Choose／Change project、不属项目、New local／remote project、搜索项目 |
| Work in | This computer、Worktree、Remote、Cloud；实测本账号菜单显示本机与云端，Remote 由连接能力决定 |
| Worktree | 开关、repo 选择、新 worktree、多 source folder 和 submodule 提示 |
| Environment | Default environment、无环境、项目设置、setup script、云环境选择与创建 |
| 附件 | 文件／文件夹、图片、粘贴文本、Appshot、拖放；上传中、过大和目标不支持状态 |
| `@` mention | Files、Folders、Chats、Apps、Agents、Plugins、Skills、MCP、Browser tabs、Pages、Sites、ChatGPT conversations、搜索结果 |
| IDE context | 当前选区、打开文件和其他 IDE 上下文，可开关并显示指示器 |
| Skills | `@` 和 `/` 引用、加载状态、刷新后可使用 |
| 听写 / Voice | 听写、全局听写、录音历史；Voice chat、声音选择、麦克风／输出静音、屏幕上下文 |
| Send / Stop | Send、Queue、Steer、Stop、Resume、后台发送；发布／交接中禁用及原因 |
| Follow-up | Queue 或 Steer，反向快捷键可只对当前消息反转行为 |
| 状态条 | Context 已用／总量／剩余、Rate limit、reset 时间、Thread／Session；可配置显示 |
| 预检 | 未选项目／云环境、沙箱未安装或需更新、目录失效、远程断连、权限模式不可用、附件不支持 |

### 3.2 斜杠命令全集

| 命令 | 功能 |
|---|---|
| `/plan` | 开关 Plan mode |
| `/goal` | 设置并持续推进 Goal |
| `/review` | Review uncommitted changes 或 compare against base branch |
| `/fork` | 当前工作区、同 worktree 或新 worktree 分叉 |
| `/side` | 新建临时 Side chat |
| `/new` | 同工作区新建空白聊天 |
| `/compact` | 压缩当前聊天上下文；运行中禁用 |
| `/init` | 创建 `AGENTS.md`；已存在时跳过 |
| `/mcp` | 查看 MCP server 状态 |
| `/status` | Chat ID、上下文和 rate limits |
| `/usage` | 打开 Usage & billing |
| `/model` | 搜索并切换模型 |
| `/reasoning` | 调整推理强度 |
| `/speed` | 切换速度／恢复 Standard |
| `/project` | 选择新项目或退出项目 |
| `/chat` | 不在项目中工作 |
| `/local` | 本机运行 |
| `/worktree` | 新 worktree 运行 |
| `/cloud` | 云端运行 |
| `/cloud-environment` | 选择云环境 |
| `/ide` | 开关 IDE 上下文 |
| `/memories` | 当前聊天的 memories 使用、生成和 ChatGPT 导入 |
| `/rename` | 重命名当前聊天 |
| `/archive` | 归档当前聊天 |
| `/star` | Pin 当前聊天 |
| `/feedback` | 对当前聊天发送反馈 |
| `/pet` | 唤醒或收起桌面宠物 |
| `/share` | 创建会话快照分享链接（账号能力门控） |
| `/approve` | 对最近的 auto-review denial 批准一次重试 |
| `/resume` | Popout 中恢复最近聊天 |
| `/hotkey-new` | Popout 返回新建首页 |

Slash 菜单自身支持搜索、Skills 分组、空状态和不可用原因；Skills 与插件可以扩展命令，不能把上表当成禁止扩展的封闭枚举。

---

## 4. Codex 专项页面

### 4.1 Scheduled tasks

- **列表**：搜索、Active／Paused／All、Personal／Team／All、Upcoming、下一次运行、运行次数、插件来源和 heartbeat 关联。
- **创建方式**：Create with ChatGPT、Create with Codex、Set up manually、插件模板。
- **基本字段**：名称、Prompt、Project、Model、Reasoning、运行位置、目标聊天、通知策略。
- **运行位置**：This device／Desktop／Cloud；云任务与本机任务可用字段不同。
- **目标聊天**：每次新聊天、本任务专用新聊天、指定现有聊天。
- **通知**：Important updates、Failed runs only、All runs。
- **时间**：Once；Hourly／Daily／Weekly／Monthly／Yearly；Interval／Weekdays 简化模式、开始／结束日期、cloud timezone；高级 RRULE 编辑器及校验。开始时间必须在未来且不超过两年，结束日期不能早于今天。
- **事件触发**：`Trigger on {app} event`；事件任务不能当作普通任务提供手动 Run now。
- **行操作**：Run now、Pause、Resume、Delete、Open chat、Open plugin、Scheduled task actions。
- **历史**：Previous runs、Running／Completed／Failed／No update、全部已读、归档／恢复、Load more。
- **模板与迁移**：Daily brief、Follow-up monitor、Weekly review、插件默认值重置、本地 automations 账号同步。
- **异常**：任务删除／不可用、历史不可用／未确认、插件 Disabled／Unavailable／Uninstalled、归档部分失败。
- **安全**：默认 sandbox 和 Full access 后台运行风险警告。

### 4.2 Skills

- 搜索；Installed、Recommended、Created by you、Shared with you；Personal／Repo／Team／User／Admin／System scope。
- Open、Details、Try now、Enable／Disable、Install、Uninstall、Refresh。
- Copy Markdown、Reveal in File Explorer、读取 `SKILL.md`、无说明和加载状态。
- New／Create skill 是 **`$skill-creator` 会话预填流程**，不是已证实的独立本地表单；首次与后续 prefill 行为不同。
- Record a skill 是 **插件／会话驱动流程**：选择录制能力，必要时安装或启用，再进入带默认 prompt 的会话。录制、暂停和步骤编辑界面尚需单独取证，不能臆造。
- Computer history 可建议创建 skill；插件可提供更多 Skills。

### 4.3 Plugins、Apps、MCP 与 Marketplace

| 区域 | 功能清单 |
|---|---|
| 目录 | Public／Personal／Workspace，搜索、分类、Recommended、Installed、Refresh、Manage、Add |
| Manage | Plugins、Skills、Apps、MCPs、Marketplace；My Apps／MCPs／Skills 和已安装内容 |
| 插件详情 | Information、Capabilities、developer、category、version、website、privacy、terms |
| Includes | Apps、Skills、MCP servers、Hooks；数量、展开、启停、设置跳转 |
| Hooks | Review、Trust all、Manage in settings、变更后重新信任 |
| 插件自身 | Settings、Scheduled tasks、Try now、Edit、Open plugin、Uninstall、desktop handoff |
| 安装 | Install modal、能力说明、required apps、OAuth、安装中、失败、连接后刷新 |
| Connected accounts | 多账户、nickname、reconnect／disconnect、重新认证 |
| 账户权限 | Always ask、read-only、low-risk tools、all tools（elevated risk）、恢复默认 |
| 分享 | Invited／Workspace link／Directory、people／teams、update shared version、copy link |
| Marketplace | Git source、Git ref、Sparse paths、local folder；Upgrade、Upgrade all、Remove |
| 合规与激励 | 数据共享／记忆／隐私说明、required app consent、workspace credit offers、账号与 host 一致性、安装并使用奖励及失败恢复 |
| 创建与管理 | Plugin Creator 会话、Upload plugin archive、Create MCP App、Download ZIP、Upload new version |
| 状态 | Disabled by admin、plan required、workspace approval、required app unavailable、desktop only |
| MCP 设置 | STDIO／Streamable HTTP、command、args、cwd、env、headers、token env、URL |
| MCP OAuth | Automatic／DCR／CIMD、Authenticate、重连；App data 清理；transport 切换需先卸载 |

### 4.4 Code Review 与 Pull requests

- **入口不是同一概念**：侧栏 Code Review 可进入插件工作面；`/pull-requests` 是 PR/MR 列表与详情，不能合并成一个页面模型。
- **Provider**：GitHub、GitLab（beta）、provider connection、账户失效后的重新关联。
- **列表**：Pinned、Authored by me、Needs my review、Needs my team's review、Recently merged、Recents；搜索或粘贴 PR/MR 链接；Compact／Detailed 和 Sections 显示选项。
- **状态**：Approved、Changes requested、Draft、Merged、Closed、Waiting for review、Private review unread／in progress。
- **行操作**：Review with Codex、Copy link、Open in provider、Convert to draft、Ready for review、Close／Reopen、Pin。
- **详情**：head → base、checks、comments、merge conflicts、diff、review comments 的 Reply／Resolved／Expand／Collapse／Add to chat。
- **关联**：Attach existing PR/MR、Undo association、Compare branch、PR/MR tab、checks 重新附着。
- **Review chat**：Ask about this PR/MR、修复评论、处理冲突、failing-check／conflict attachments。
- **私有本地 review**：结果只在当前 chat，不写入 Code Review；归档线程需先恢复。
- **Review delivery**：Inline 尽量留在当前线程，Detached 使用独立 review chat。

---

## 5. 设置中心：所有分区、子页与可见性

### 5.1 设置中心公共能力

- 设置搜索、分组导航、折叠导航、返回应用、无结果、清空搜索。
- User／Project／Admin config scope；只读来源、管理策略、配置冲突、非法配置警告、保存失败和重试。
- 未保存修改离开确认：Discard changes／Keep editing。
- 部分入口是当前产品模式下的原生页、外部网页、另一个设置的 tab 或重定向，不能全部实现成独立原生表单。
- **[实测]** 当前账号可见入口包括：常规、通知、个人资料、外观、家长控制、受信任联系人、语音、配置、个性化、Mini 与虚拟宠物、键盘快捷键、使用情况和计费、账户、插件、Passwords、电脑操控、应用快照、浏览器、Cloud computer、Hooks、连接、Codex 云端、Codex 云端（旧版）、代码审查、Git、Worktrees、已归档聊天，以及外部安全设置入口。

### 5.2 设置注册表与扩展入口全表

“可见入口”仅指本次账号；“门控”不代表该功能不可用，也不代表所有账号都可见。

| Slug / 页面 | 功能清单 | 本版可见性 / 处置 |
|---|---|---|
| `general-settings` | 默认／完整权限、无项目目录、默认打开位置、shell、语言、关闭确认、完整视图、底部面板、终端位置、历史压缩、速度、建议、插件、Composer、Popout、开源许可、Toys | **实测内容** |
| `notifications` | Turn completion：Always／Unfocused／Never；权限、问题、dot 通知；Default／Basso／Classic／Glass／Ping／Pop／Purr／Tink／None；自定义 MP3／WAV／FLAC／Ogg（<30 秒、<10 MB）；OS 权限 | 本账号可见入口 |
| `import` | 从其他 AI App 导入 setup／projects／chats；导入历史、失败、自动同步与内容分类 | 能力与 flag 门控 |
| `profile` | 名称、照片、bio、username、公开展示、showcase、分享 | Profile v2 门控；本账号有入口，另有公开 `/profile` |
| `security` | 原生 Security 设置兼容内容 | **固定隐藏**；当前外部“安全设置”链接是另一入口 |
| `account` | 账号资料、状态、删除及 CME 能力；当前也有外部账号设置入口 | 账号能力门控；本账号可见 |
| `age` | 年龄相关兼容设置 | **固定隐藏**；使用 `/verify_age` 等流程 |
| `agreements` | 协议、接受状态和账号相关合规内容 | 账号状态门控 |
| `parental-controls` | 家长／监护人控制和限制 | 本账号可见入口；账号资格门控 |
| `trusted-contact` | 受信任联系人邀请、管理和移除 | 本账号可见入口；资格门控 |
| `safety` | Safety & wellbeing、年龄和保护相关设置 | 资格与 flag 门控 |
| `time-management` | 时间管理兼容设置 | **固定隐藏** |
| `keyboard-shortcuts` | 搜索命令或键位、录制、冲突、恢复默认、数字快捷键、外链点击修饰键 | 本账号可见入口；完整注册表见 §7.3 |
| `codex-micro` | Work Louder 硬件、6 个 Agent keys、摇杆、旋钮、滚动、reasoning 和自定义动作 | 硬件 + flag 门控 |
| `appshots` | 前台窗口截图、滚屏外文本、路由到当前／新聊天／Automatic、Mini、声音、热键 | 本账号可见入口；平台门控 |
| `appearance` | Light／Dark／System、亮暗分别配置、accent、自定义色、字体和字号、对比度、动画、指针、diff markers、导入／导出主题 | 本账号可见入口 |
| `voice` | 语音、听写语言、声音、字典、录音、麦克风、屏幕上下文、听写声音 | 本账号可见入口；设备能力门控 |
| `storage` | 旧 Library 存储兼容内容 | **固定隐藏（并非仅 Codex 隐藏）** |
| `pets` / Mini & Pets | 宠物选择、自定义、大小、Always visible／On demand、唤醒／收起、Mini 管理 | 本账号可见入口 |
| `chronicle` / Computer history | 跨 App／网站活动摘要、应用权限、历史查询、清除时段、创建 skill／automation | 能力与权限门控 |
| `agent` / Configuration | Approval、Sandbox、Network、Web search、verbosity、reasoning summary／efforts、实验功能、依赖诊断／重装、config.toml | **实测内容** |
| `work-settings` / Work preferences | Work 默认模型、reasoning、speed、可用 efforts、Ultra；本地审批、文件、网络、搜索和浏览器 | Work capability 门控；不是 Codex Local 必选项 |
| `git-settings` | Branch prefix、commit／PR instructions、draft PR、force-with-lease、merge method、auto-merge、watch and fix、worktree root、禁用 Git diff、Review delivery | 本账号可见入口 |
| `data-controls` / Archived chats | 搜索、Local／Cloud、Project／Type、Created／Updated／Alphabetical、分组、恢复、删除和批量删除 | 本账号可见入口 |
| `ads-controls` | 广告隐私与个性化 | 账号资格门控 |
| `cloud-settings` / Cloud preferences | 云端 diff Unified／Split；branch format、占位符、预览和格式校验 | 本账号可见；新环境开关下可重定向到 `cloud-environments` |
| `cloud-environments` | 环境列表、搜索、详情、创建、编辑、删除、Reset cache；repo、image、setup、网络、变量、secrets、sharing | 账号／cloud access 门控 |
| `codex-cloud` / Legacy | 旧 saved-config／draft-task、legacy migration、继续设置、Personal Vault | 本账号可见旧版入口；不要与新环境 CRUD 混用 |
| `code-review` | Personal／Review agent、Repository、Security Review、App preferences、仓库详情和 path overrides | 本账号可见入口；云／app 能力分别门控 |
| `personalization` | Codex instructions、About you、ChatGPT／Codex custom instructions、rules、memory、Mini | 本账号可见入口 |
| `usage` / Usage & billing | 5 小时／周／月额度、credits、历史、turns／lines／tokens／messages、model／reasoning／speed、Top chats、工具活动、购买和 reset | **本账号可见**；购买等动作仍按套餐门控 |
| `billing` | 旧 Billing 兼容分区 | **固定隐藏**；计费和充值由 Usage／pricing 流程承载 |
| `analytics` | 使用量分析、plan history、产品／模型维度和图表 | 套餐、数据与 flag 门控 |
| `consumer-view` | Consumer analytics（内部） | 内部／账号门控 |
| `usage-code-review` | Issues found、PRs reviewed、priority、reactions、reaction sentiment | 有 review 数据等条件门控 |
| `debug` | Chrome debug pages、GPU Tearing Debug：blur、CSS motion、scroll fade、squircles、opaque background | debug build／flag 门控；Trace／RAM 属 Debug 菜单 |
| `browser-use` | Browser Use、URL、history、downloads、站点权限、WebMCP、CDP、密码、扩展、联系信息、数据清理 | **实测内容** |
| `extension` | 旧 Browser extension 独立设置 | **固定隐藏**；扩展管理在 `browser-use/extensions` |
| `computer-use` | Any App、浏览器扩展、Office、always-allowed apps、Messages、Locked use、声音 | **实测内容**；平台／插件门控 |
| `local-environments` | 项目本地环境、setup／cleanup、变量、Actions、平台、发布和磁盘冲突 | 原生能力；可与 Worktrees 的 Environments tab 合并显示 |
| `worktrees` | 自动清理、保留数量、fetch upstream、worktree 列表、关联会话、恢复／删除；General／Environments tabs | 本账号可见入口 |
| `environments` | Alpha 外部环境设置入口 | 外链，不是另一个本地环境编辑器 |
| `mcp-settings` | 自定义 MCP、状态、OAuth、工具／资源、插件来源、App data | 可并入 Plugins 管理，不一定单独显示 |
| `hooks-settings` | 11 类生命周期事件、Command／Prompt／Agent／MCP handler、matcher、timeout、trust、来源 | 本账号可见入口 |
| `connections` | SSH、WSL、signed-in devices、remote Codex 安装／认证、远程控制、远程项目 | 本账号可见入口；连接能力门控 |
| `plugins-settings` | 插件、Skills、Apps、MCP 和 Marketplace 管理 | 本账号可见入口 |
| `file-type-handlers` | 内置／插件 viewer、按类型选择、首次授权、打开失败和偏好保存失败 | 有可用 file entrypoint 或 MCP 资源时出现 |
| `skills-settings` | 旧 Skills 设置兼容路由 | **固定隐藏**；使用独立 `/skills` 和 Plugins 管理 |
| `teams` | 团队 CRUD、成员／角色／邀请、shared plugins／connections、Spaces、scheduled、activity | Workspace + flag 门控 |
| `cloud-computer` | 云浏览器网站权限、cookies、passkeys、密码管理连接 | 本账号可见入口；ChatGPT 能力门控 |
| `passwords` | 密码服务／1Password 等集成 | 本账号可见入口；账号与集成门控 |

### 5.3 设置子路由与详情页

| 子路由 | 内容 |
|---|---|
| `/settings/computer-use/messages` | Messages 读取／发送权限、按聊天审批和始终允许规则 |
| `/settings/browser-use/extensions` | 扩展安装、移除和配置 |
| `/settings/browser-use/downloads` | 下载搜索、暂停／恢复／取消、打开、删除和清空 |
| `/settings/browser-use/history` | 浏览历史搜索、Agent／Other 来源、选择、删除和清空 |
| `/settings/browser-use/contact-info` | 地址、电话、邮箱自动填充 |
| `/settings/browser-use/passwords` | 内置密码管理 |
| `/settings/browser-use/site-settings/*` | 摄像头、麦克风、位置、通知、剪贴板、JS、cookies、弹窗、USB 等 |
| `/settings/connections/:tab[/:action]` | SSH／WSL／Devices 及添加、详情、授权流程 |
| `/settings/cloud-environments/*` | 环境详情、编辑、分享、变量／secrets 和 Reset cache |
| `/settings/code-review/repositories/:repositoryId` | 单仓库自动 review、安全、severity、merge protection、路径覆盖 |
| `/settings/teams/:teamId[/join]` | 团队详情与加入流程 |
| `/settings/plugins/:server/:toolName` | 设置中的 MCP App／工具宿主 |
| `/settings/open-source-licenses` | 第三方开源许可；本次在 General 中实测到入口 |
| `/settings/profile` | Profile v1／外部资料流程，与 v2 `/profile` 区分 |

### 5.4 重点设置的完整字段

- **Cloud environment**：名称、描述、repository、container image、Universal packages／版本、workspace directory；Automatic／Manual setup、maintenance、container caching；Agent internet On／Off／Custom、domain presets、自定义域、read-only HTTP methods；环境变量、domain-scoped secrets、Private／Workspace sharing、additional editors。
- **Code Review 个人**：Automatic review、Review trigger、Exhaustive review、Use credits；安全 review 的独立自动／手动 severity 和额度策略。
- **Code Review 仓库**：All PRs／Team PRs／Follow personal；PR open／every push／smart detect／code review triggers；自动／手动 severity、path overrides、`AGENTS.md` review instructions。
- **Security Review**：blocking severity、merge protection、threat model source／path、workspace funding、管理员权限。
- **Review App preferences**：provider instance、跨仓库本地 review instructions、PR 链接打开位置。
- **Hooks**：PreToolUse、PostToolUse、PermissionRequest、UserPromptSubmit、Stop、SubagentStart、SubagentStop、SessionStart、SessionEnd、PreCompact、PostCompact；来源分 User／Project／Admin／Plugin／Other。
- **Usage reset**：仅在用户于对话中显式请求且当前限额剩余不超过 **10%** 时使用；官方文案明确“Resets are never used automatically”。购买、auto-reload、subscription 和 request more usage 与只读用量展示分开验收。

---

## 6. ChatGPT、Work 与同应用其他页面

### 6.1 ChatGPT Chat、Work 与分享

| 页面 / 路由 | 功能清单 | 条件 |
|---|---|---|
| ChatGPT Home `/` | 新聊天、模型／thinking、附件、工具、语音、项目和建议 | ChatGPT 能力 |
| Chat `/c/:conversationId` | 消息流、编辑、重生成、分支、聊天内搜索、临时聊天、分享、移动项目、Work handoff | 账号／工具／套餐门控 |
| 分支 `/branch/:conversationId/:messageId` | 指定消息分支会话 | 同上 |
| Work Home `/`、`/projects` | 云／本机任务选择、Work 偏好、项目、任务启动 | Work access |
| Work task `/remote/:taskId` | 云任务、follow-up、本地／云端 handoff、项目记忆限制 | Work cloud access |
| GPT chat `/g/:gizmoId/c/:conversationId` | 指定 GPT 下的完整 ChatGPT 会话 | GPT 可见性 |
| Shared chat `/share/:id`、`/share/e/:id` | 只读公开／workspace 分享、报告、反馈、私有内容提示 | 分享权限 |
| 项目分享 `/g/:projectId/shared/c/:conversationId` | 项目范围内的分享会话 | 项目权限 |

ChatGPT 消息工具还包括写作块、联网、Apps、图像、文件和语音；这些能力受账号与工具开关控制，不能全部套用到 Codex 本地线程。

### 6.2 ChatGPT Projects

- **路由**：`/g/:projectId/project`；项目分享会话使用上面的专用路由。
- 项目聊天、Pin／Move／Remove、图标和颜色、custom instructions。
- 文件和 connector sources、default／project-only memory、Library／Space access。
- 分享、删除、权限不足、部分 source 只能到 Web 编辑。
- 与 Codex `/projects` 的“本地目录 + source folders + Git／Worktree”模型不同，不能共用一套简化数据结构。

### 6.3 Library、Space、Pages、Artifacts 与 Canvas

| 页面 / 路由 | 功能清单 |
|---|---|
| `/library/*` | Recommended／Favorites／Folders／Images／All，网格／列表、搜索、过滤、上传、新建、设置 |
| `/library/file/:libraryFileId` | 文件预览、下载、收藏、移动、原聊天、note／cloud preview |
| `/library/share/*` | 分享邀请接受／拒绝、access review |
| `/space`、`/space/personal` | All／Personal／Pages／Files／Sites、recents、pinned、spaces、搜索、过滤和创建 |
| `/space/d/:directoryId`、`/space/files`、`/space/files/d/:directoryId` | 目录与文件浏览 |
| `/space/file/:libraryFileId` | Space 文件预览与返回 Space |
| `/space/sites/*` | Space 内的 Sites 工作面 |
| `/space/browser/:url` | Space 内嵌网页 |
| `/space/:pageId` | Page 编辑、关联聊天、评论、mentions、分享、访问申请、模板 |
| `/spaces/new`、`/spaces/:spaceId` | 团队 Space 创建、首页、成员和权限继承 |
| Artifacts 工作面 | DOCX／PDF redlines、comments、request edits、下载、zoom、slideshow、workbook 编辑导出、版本历史 |
| Canvas 工作面 | Space whiteboard、写作 canvas、图像编辑 canvas；各自能力独立 |

- **Library 操作**：新建 folder／note、上传、连接文件应用、生成 document／presentation／spreadsheet／image、移动、删除、Trash、Activity 和访问申请。
- **Space 创建菜单**：Page、Sheet、Slide、Canvas、Site 和模板；各文档类型有独立 capability，Sheet／Slide 等可显示 Coming soon，不能默认全部可创建。

**迁移关系**：Pages／Space capability 开启时，Library 主导航可重定向到 Space；Library 不是与 Space 永远并列且内容完全相同的两套库。`/sites/library` 是到 Library 的兼容重定向。

**不存在的顶层路由**：没有统一 `/artifacts` 或 `/canvas` 页面。它们是对话、Space、文件预览或编辑器内的工作面。

### 6.4 Images

- **[实测]** 页头、图像描述 Composer、附件、模型、听写、发送、热门／Templates、模板卡片和打开资料库。
- My Images 图库、生成与编辑、前后浏览、打开原会话。
- 下载、分享、收藏、prompt ideas、Library／Space shortcut。
- 图像／视频 lightbox 和编辑界面；可用性由账号和图像 feature gate 决定。

### 6.5 GPT 与 Workspace Agents

| 页面 / 路由 | 功能清单 |
|---|---|
| `/gpts` | Public／Workspace 目录、精选、热门、分类、creator 过滤、搜索 |
| `/gpts/mine` | Created／Shared、编辑、删除、迁移、受众信息 |
| `/g/:gizmoId` | GPT 入口，解析后进入相应聊天或详情 |
| `/gpts/create` | Create／Configure／Preview；名称、说明、instructions、starters、knowledge、工具和发布 |
| `/agents` | Recent／Mine／Team or Workspace、搜索、可见性和编辑 |
| `/agents/a/:agentId` | Agent 详情与 legacy fallback |
| `/agents/studio/new`、`/agents/studio/edit/:agentId` | Apps／connections、模型、reasoning、memory、web／image、starters、图标、分享和发布 |
| `/agents/studio/edit/:agentId/channels/slack/setup` | Slack 提及／相关消息、立即回复或先审阅、频道 instructions |

**[实测] 迁移提示**：当前 GPT 页显示“GPT 将于 12 月11日停用”，由创建者迁移的 GPT 之后仍可作为插件使用；同时仍有我的 GPT 和创建入口。后续设计应保留迁移／兼容状态，不要把 GPT 当成没有生命周期的永久目录。

### 6.6 Sites

- **列表 `/sites`**：实测 Owned／Shared、网格／列表、搜索、创建、共享对象、打开和更多操作。
- **详情 `/sites/:projectId`**：站点预览、打开发布站点、编辑和分享。
- **子页**：`settings`、`analytics`、`analytics/events`、`automations`、`database`、`edit`。
- **编辑与发布**：创建、编辑、预览导航／刷新／批注／request edits、发布、打开。
- **设置**：slug、custom domain／DNS、环境变量和 secrets、共享／团队／公开访问、所有权转移、删除。
- **数据与分析**：流量和事件查询、数据表和行、定时任务；数据库 mutation 需要审批。
- **状态**：Sites Terms、未发布访问限制、访问申请、owner／editor／viewer 权限、analytics 独立 gate。

### 6.7 Apps、MCP App 与 Profile

| 页面 / 路由 | 功能 |
|---|---|
| `/mcp-app/:server/:toolName` | MCP App／工具宿主、授权和内容承载 |
| `/mcp-app/plugins/:pluginId/:toolName` | 插件工具宿主 |
| `/plugins/:pluginId/app/:toolName` | 插件 App 工具页 |
| `/settings/plugins/:server/:toolName` | 设置中的工具页 |
| `/connector/oauth_callback` | App connector OAuth 回调，含授权／MFA 流程 |
| `/profile` | 自己的 Profile v2、公开预览、showcase 和分享 |
| `/u/:username` | 公开资料；private／not found 状态 |
| `/settings/profile` | 旧资料设置或外部资料流程 |

没有独立的通用 `/apps` 路由。Apps 是 Plugins 管理 tab、MCP App 路由、对话工具和 connector 流程的组合。

Profile 还包括照片裁剪、照片形状、pet／stickers、公开显示选项、activity／token／plugin 统计、sites／skills showcase、分享卡和外部社交分享；部分装饰能力有内部或资格限制。

### 6.8 Maps、Shopping、Health、Finances 与 Merchant

| 页面 / 路由 | 功能清单 | 证据 |
|---|---|---|
| `/maps/:entityId?` | 附近地图、地点推荐、新闻／天气 prompt、位置授权 banner、共享地点、错误态 | **实测授权前页面** + 代码门控 |
| `/shopping` | 商品目录／carousel、购物 Composer、starter prompts、推荐加载失败与重试 | **实测页面和重试态** + 代码门控 |
| `/health` | Home／Records／Chats／Accounts、连接健康数据、conditions、medications、family history、医疗声明 | 账号健康资格与年龄门控 |
| `/finances` | dashboard／widgets、账户连接、金额显隐、导出、memory、布局和法律声明 | 账号 feature discovery 门控 |
| `/finances/accounts`、`/chats`、`/transactions` | 账户、财务聊天、交易明细 | 同上 |
| `/ledger/plaid/web/oauth_redirect` | Plaid 回调 | 流程页 |
| `/merchants/settings` | 商家设置 | 商家账号与 deep-link 门控 |

### 6.9 dot / Orbit

- `/dots` → `/dots/home`、`/dots/new`、`/dots/:conversationId`；另有 `/o/*` 别名。
- 创建和 onboarding、Google／Microsoft connectors、local／cloud computer。
- 消息、outputs、plugins、scheduled、Slack／Teams／短信渠道。
- Pause／Resume／Rename／Delete，以及安全和插件建议页。
- 受账号、seat 和 restricted feature 限制，不是普通 ChatGPT 首页的同义词。

### 6.10 Pricing、Checkout 与托管账号页

- `/pricing-plan`：原生 pricing／plan 页面。
- `/checkout/web`：托管 checkout WebView。
- `/workspace-settings/web`：托管 workspace 设置。
- Usage 中的购买、auto-reload、订阅变更、app limits、request more usage 是独立动作和对话框，不应因为做了只读 Usage 就标记为完成。

---

## 7. 登录、首次运行、特殊窗口与全局能力

### 7.1 登录、Onboarding 与流程页

| 路由 / 工作面 | 功能与边界 |
|---|---|
| `/login` | 浏览器登录、已有会话继续、其他账号、Google／Microsoft、API key、注册、复制链接和错误恢复 |
| `/welcome` | 桌面 Welcome：角色、首个任务、Computer Use／History／Local Files、连接器、插件、其他 AI 设置与聊天导入、跳过 |
| `/onboarding` | Work／workspace onboarding；role／department，Health 或特定工作区流程；与 `/welcome` 不同 |
| `/first-run` | Codex 首次法律条款、autonomy、云端示例和检查事项 |
| `/select-workspace` | 选择／新建**本地项目文件夹**、全选、跳过；不是选择企业 tenant |
| `/verify_age`、`/verify_guardian` | 年龄和监护人验证 |
| `/trusted-contact/nominee`、`/decline`、`/remove` | 受信任联系人邀请、拒绝和移除 |
| `/codex-access` | Codex access denied 页面；允许时回到首页 |
| `/connector/oauth_callback` | Connector OAuth 回调 |
| `/chatgpt_health_oauth_redirect` | Health OAuth 回调 |
| `/browser/handoff` | 浏览器与桌面 handoff |
| `/refer/:linkId` | Referral 分享链接页 |
| `/workspace/deactivated` | 路由状态标记，无独立正常内容页 |

### 7.2 特殊窗口与独立工作面

| 路由 / 窗口 | 功能 |
|---|---|
| `/chatgpt/quick-chat`、`/chatgpt/quick-chat-prewarm` | 精简 Quick Chat 和预热窗口 |
| `/hotkey-window` | 全局 Popout 首页、精简 Composer、Chat settings |
| `/hotkey-window/new-thread` | Popout 新任务 |
| `/hotkey-window/thread/:conversationId` | Popout 本地会话 |
| `/hotkey-window/remote/:taskId` | Popout 云任务 |
| `/global-dictation` | Ready／Listening／Transcribing、波形、复制／粘贴失败辅助、关闭 |
| `/avatar-overlay` | Mini／宠物浮窗，不同于普通页面 |
| `/diff` | 独立 diff 工作面 |
| `/plan-summary` | 独立 Plan summary |
| `/extension/panel/new` | 扩展侧栏的新线程面板 |
| `/debug` | 调试页面；另有 Debug 菜单和模态 |
| `/internal/demo-tools` | 内部 demo tools，仅特定 build／capability |
| Detached window | 独立聊天／标签窗口、置顶、Focus chat、Restore to main window |

### 7.3 命令菜单、搜索与快捷键

**Command menu**：

- 打开命令菜单、会话搜索和独立文件搜索；占位为搜索聊天或运行命令。
- Quick actions、Pinned／Recent／Recently viewed chats、Chats、Files、Browser tabs、Settings、Color themes、Switch project。
- 支持聊天搜索的服务端加载／失败／重试、文件无结果、最近打开文件和空会话引导。
- 原生右键菜单：会话、项目、标签、文件树、浏览器、链接和文本选区。

**命令注册表**：本版已提取 **161 条命令定义**，完整 ID、标题、默认键位、scope、required access 和 flags 见 [.ref/scratch/commands.tsv](../../.ref/scratch/commands.tsv)。下表只是最高频入口，不替代完整注册表。

| 功能 | 默认快捷键（Windows 常用） |
|---|---|
| Command menu | `Ctrl+K`、`Ctrl+Shift+P` |
| Search files | `Ctrl+P` |
| Settings | `Ctrl+,` |
| Keyboard shortcuts | `Ctrl+/` |
| New Chat | `Ctrl+N`（另有 `Ctrl+Shift+O`） |
| New standalone chat | `Ctrl+Alt+O` |
| New Temporary Chat | `Ctrl+Shift+N` |
| New Window | 命令／File 菜单 |
| Open Folder | `Ctrl+O` |
| Next／Previous chat | `Ctrl+Shift+]`／`Ctrl+Shift+[`（与 tab 命令按上下文区分） |
| Next chat needing attention | `Ctrl+Alt+A` |
| Go to Chat 1–9 | `Ctrl+1…9`（受数字快捷键设置影响） |
| Recent Chat 1–9 | `Ctrl+Alt+1…9` |
| Rename / Pin / Unread | `Ctrl+Alt+R`／`Ctrl+Alt+P`／`Ctrl+Shift+U` |
| Archive / Delete | `Ctrl+Shift+A`／`Ctrl+Shift+Delete` |
| Side chat / Focus main chat | `Ctrl+Alt+S`／`Shift+Escape` 或 `Alt+L` |
| Copy working directory | `Ctrl+Shift+C` |
| Copy conversation path | `Ctrl+Alt+Shift+C` |
| Copy deeplink | `Ctrl+Alt+L` |
| Copy last code block | `Ctrl+Shift+;` |
| Model picker / Recent models | `Ctrl+Shift+M`／`Alt+M` |
| Project picker | `Ctrl+Alt+Shift+O` |
| Add files | `Ctrl+U` |
| Submit in background | `Ctrl+Enter` |
| Dictation / Voice | `Ctrl+Shift+D`／`Ctrl+Shift+V` |
| Approve / Decline | `Enter`／`Escape` |
| Sidebar / Bottom panel | `Ctrl+B`（另有 `Ctrl+Shift+S`）／`Ctrl+J` |
| Changes panel / Open review tab | `Ctrl+Alt+B`／`Ctrl+Shift+G` |
| Navigation panel / Full view | `Ctrl+Shift+E`／`Ctrl+Shift+F` |
| Cycle workspace layout | `Ctrl+Shift+B` |
| Browser tab / Focus address | `Ctrl+T`／`Ctrl+L` |
| Find / Find next | `Ctrl+F`／`Ctrl+G` |
| Close tab / Reopen | `Ctrl+W`／`Ctrl+Shift+T` |
| Full screen / Zoom | `F11`／`Ctrl +`、`Ctrl -`、`Ctrl 0` |
| Mini | 默认注册表为 `Alt+Space` 或平台变体；当前账号菜单显示自定义键，**以用户 keymap 为准** |

### 7.4 原生菜单与桌面集成

| 菜单 / 能力 | 功能清单 |
|---|---|
| File | New Window、New Chat、New standalone chat、New Temporary Chat、Open Folder、Log Out、Close |
| Edit | Undo、Redo、Cut、Copy、Paste、Paste and Match Style、Delete、Select All；macOS 另有 Substitutions／Speech |
| View | Sidebar、Bottom panel、Pinned summary、Terminal、Navigation panel、Full view、Layout、Changes、Browser navigation、Find、Zoom、Developer、Full Screen |
| Help | Documentation、Keyboard Shortcuts、What's New、Troubleshooting、System Status、Send Feedback、Task Manager、Trace、About、Check for Updates |
| macOS App／Window | About、Services、Hide／Show、Quit、Minimize、Zoom、Bring All to Front |
| 菜单 keymap | accelerator 从用户命令 keymap 动态计算，不是另写一套硬编码快捷键 |
| Tray | 打开主窗口、新会话、最近会话、发送反馈；macOS menu bar 由设置和平台决定 |
| Deep link | `codex://…`，可定位设置／连接等；Debug 支持从 clipboard 打开 |
| Updates | Check、Downloading、Restart to update、版本和 build 信息 |
| 退出／关闭确认 | 进行中本地任务、启用的计划任务、待处理 worktree；Never／Close shortcut only／Always |
| 文件集成 | 选择文件／目录、打开系统文件管理器、默认打开目标、文件拖拽、文件类型 handler |
| 系统权限 | 通知、麦克风、位置、辅助功能／电脑操控、浏览器扩展、远程设备授权 |
| 反馈与诊断 | Send feedback、日志归档、Trace recording、RAM、Task Manager、第三方许可、系统信息 |

### 7.5 通知、未读与跨窗口能力

- Turn 完成、权限、提问、dot、scheduled run；系统通知点击回到具体会话／审批。
- Activity、未读计数、全部已读、清除已读、通知声音、仅在未聚焦时提醒。
- 多窗口、线程新窗口、标签拖出、detached window 置顶和恢复。
- Popout 全局快捷键、默认独立聊天、Resume／New、Project／Environment／Permissions／Branch。
- Mini／Pets、Appshots、全局听写、Voice floating UI、远程 PiP。
- 窗口状态、全屏、睡眠阻止、关闭确认和更新后任务恢复。

### 7.6 所有页面都应覆盖的通用状态

后续 PRD／设计稿不能只画成功态。每个页面按适用性覆盖：Loading、Empty、No matching results、Error、Retry、Offline／Reconnecting、Unauthorized、Forbidden、Admin restricted、Feature unavailable、Unsaved changes、Conflict／Changed on disk、Deleted／Moved、Archived、Read-only、Partial success。

---

## 8. 对旧调研和常见实现假设的纠错

1. **`/explore` 不是 GPT 发现页**：它重定向到 `/`；GPT 是 `/gpts`。当前侧栏“探索”实际是更多功能菜单。
2. **`/work` 不是桌面 Work 主页面**：它是 browser-only 流程；桌面 Work 由模式、Home／Projects 和 `/remote/:taskId` 组成。
3. **路由字符串不等于页面**：后端 API、OAuth callback、外链、兼容重定向和状态标记必须与正常页面分开。
4. **设置注册表不等于可见设置**：还要经过产品映射、平台、账号、工作区、插件、能力和 feature flag。
5. **Library 与 Space 有迁移关系**：Space 开启时主 Library 可重定向；不能复制成两套独立常驻数据模型。
6. **Code Review 与 Pull requests 不是同一个路由**：私有本地 review、插件工作面、PR 列表和 PR 详情需分别建模。
7. **Cloud preferences、Cloud environments、Legacy Codex Cloud 是三套不同内容**：新环境 CRUD 不能与旧 draft-task 混写。
8. **`skills-settings` 固定隐藏**：正式 Skills 页面是 `/skills` 和 Plugins 管理，不是再做一个隐藏设置页。
9. **`security`、`storage` 等固定隐藏**：不能因存在 slug 和文案就显示；外部 Security Settings 是单独入口。
10. **Debug 设置页不等于全部调试功能**：GPU／Chrome debug 在设置页，Trace、RAM、Query／React 调试在菜单／模态。
11. **Skills 创建与录制是会话／插件驱动**：当前证据不支持凭空设计独立 Skill Creator／Recorder 表单。
12. **Files 不是只读 viewer**：有文本／Markdown 编辑和 draft；但保存与冲突语义仍需补证后验收。
13. **没有通用 `/apps`、`/artifacts`、`/canvas` 顶层页**：它们分别由 Plugins／MCP App、对话产物和 Space／编辑器工作面承载。
14. **模型不是前端常量**：本次实测的模型名和滑块档数只属于当前账号与所选模型，开发必须使用运行时能力和模型列表。
15. **i18n catalog 不是绝对全量**：现有 `catalog-full.tsv` 是 868 个 chunk 的阶段性提取；GPT、Sites、Images 等仍有独立 chunk 文案，必须结合路由和实际 chunk。
16. **旧报告“未运行官方 App”的限制已不再适用**：本次已做运行时巡检，但门控页面仍只标为代码证据，不伪装成实测。

---

## 9. 后续开发可直接采用的分期基线

### P0：Codex Local 可日常使用闭环

- App shell、模式感知的 Codex 导航、项目／会话／自定义分区／Activity。
- 新任务、完整 Composer、运行时模型／effort／权限、附件、queue／steer／stop。
- 流式 turn、全部核心 item 类型、审批／提问、Goal／Plan、上下文与额度状态。
- 会话操作、Fork／Revert／Compact、消息导航和查找、恢复与错误状态。
- Changes、Files、Diff comments、Accept／Edit／Reject、Git、Worktree、Terminal。
- General／Agent／Git／Keyboard／Archive 等核心设置，所有开关都有真实消费方。

### P1：协作与开发生态

- Scheduled、Skills、Plugins／Marketplace、MCP、Hooks。
- Code Review、PR/MR、Review chat、仓库和 provider 设置。
- Command menu、完整 keymap、原生菜单、通知、多窗口、托盘、Deep link。
- Connections、本地 Environments、只读 Usage／Code Review analytics。

### P2：桌面扩展与云能力

- Browser／Computer Use／Appshots／PiP、File type handlers。
- Cloud environments、Work preferences、云任务和 handoff。
- Voice、Mini／Pets、Computer history、Codex Micro。
- 插件分享、多账户授权、Skills 录制、Scheduled 云与事件触发、Legacy migration。

### P3：完整 ChatGPT App 扩展包（需单独确认范围）

- ChatGPT Chat／Work、ChatGPT Projects、Library／Space／Pages／Artifacts。
- Images、GPT 迁移、Workspace Agents、Sites、Apps／Connectors。
- Profile、Teams、账号／计费／合规、Health、Finances、Maps、Shopping、dot。

**建议的下一步**：先确认做“P0 + P1 的 Codex 产品”还是“包含 P3 的完整 ChatGPT Desktop 同体产品”，再把本文相应条目转成页面级 PRD、交互原型和验收用例。不要在没有范围决策时把所有条目都放进同一个 P0。

每个页面级 PRD 至少填写：路由与入口、可见性条件、数据源、核心操作、空／错／加载态、权限与管理策略、危险操作确认、快捷键、跨页面状态、验收用例。

---

## 10. 本次 Computer Use 实测记录

| 实测页面 / 工作面 | 本次看到的重点 |
|---|---|
| 主窗口与会话 | 原生菜单、导航轨、项目／会话侧栏、线程、Composer、Changes 卡、浏览器／新标签工作面 |
| 新任务首页 | 项目问候、项目切换、本机／云端、Worktree、附件、权限、模型、听写、Voice |
| 运行位置 | 本机与云端菜单；Remote 等由代码和连接能力补充 |
| 模型控件 | 推荐模型集、动态模型列表、强度滑块、快速模式和用量提示 |
| Scheduled | 搜索、新建、Upcoming、任务模板和空／加载状态 |
| Library | Recommended／Favorites／Folders／Images／All、网格／列表、筛选、搜索、新建、设置 |
| Images | 图像 Composer、热门／Templates、模板图库、打开资料库 |
| Plugins | Public／Personal、搜索、Refresh、Manage、Add、分类目录、安装／更多操作、已安装入口 |
| 更多菜单 | 项目、站点、地图、购物、GPT、代码审查 |
| GPT | 搜索、分类、我的 GPT、创建、迁移／停用提示、插件入口 |
| Code Review / PR | PR 链接搜索、Authored／Needs review／Team review 分组、未选择详情空态 |
| Projects | 搜索、创建、更新时间排序、项目操作、Pin、项目内新聊天 |
| Sites | Owned／Shared、网格／列表、搜索、创建、分享、打开、更多操作 |
| Maps | 地图 Composer、精确位置授权前提示；未开启位置 |
| Shopping | 购物 Composer、推荐加载失败和 Retry；未提交任务 |
| Profile 菜单 | 剩余用量、Mini、邀请、设置、帮助、退出入口；未进入退出流程 |
| Settings 导航 | 当前账号全部可见分区及外部设置入口 |
| General | 权限、目录、默认打开位置、Shell、语言、窗口、终端、历史、速度、建议、插件、Composer、Popout、通知等 |
| Agent / Configuration | 非法配置警告、config.toml、Approval、Sandbox、Network、Web search、verbosity、reasoning、实验特性、依赖诊断／重装 |
| Browser | Browser Use、URL、历史、下载、批注、密码、联系信息、扩展、站点权限、WebMCP、完整 CDP 风险 |
| Computer Use | Any App、Chrome／Edge 扩展状态、Office、始终允许的应用；未安装扩展或改变权限 |

未执行：发送 prompt、运行任务、安装／卸载、 marketplace 变更、删除／归档、Git 写操作、设置切换、购买、登录／退出、位置授权、麦克风授权、远程授权。一次 UIA 读取异常后改用当次截图坐标核对，没有据此重复执行不确定操作。

代码补证但未逐项实测：ChatGPT／Work 会话、Space、Agents、Health、Finances、dot、账号／团队／合规、云环境编辑、硬件和部分 debug 页面。它们均带门控标记。

---

## 11. 证据索引

### 11.1 版本与主代码

- `.ref/asar-files/app-package.json:5`：版本；`:117`：build number。
- `.ref/scratch/main-DkWgQSQe.js`：主进程、窗口、菜单、托盘、更新、Deep link、IPC。
- `.ref/scratch/app-shared-a906948d8868.js`：共享 renderer、会话与协议类型。
- 本次当前安装包主进程 SHA-256：`d33ed281dc58766cbbccb8e92a7149268a528901de8858c2d69750d12c6c205b`。
- 本次核心 renderer SHA-256：`1ffb0654bdfcba23be50c06c8698e665bdb17330d923758001d01262aa81cb5b`。

### 11.2 路由、设置和命令

- `.ref/scratch/files/app-initial-fd3c4b862660.js:4590`：主路由树；长 minified 行，按具体 route 字符串定位。
- 同文件运行时导航与平台门：约 `:3775`、`:3709`。
- `.ref/scratch/files/use-visible-settings-sections-95eb305c54fe.js:1`：设置产品映射、能力门控、固定隐藏、重定向和导航过滤。
- `.ref/scratch/files/settings-page-b0141d46c881.js`：设置页和导航。
- `.ref/scratch/commands.tsv:1`：161 条命令及默认键位；完整机器表。
- `.ref/asar-files/native-menu-zh-CN.json`：原生菜单中文文案。
- `.ref/scratch/preload.js`：桌面 bridge 与 `codex_desktop:*` channels。

### 11.3 功能文案与组件

- `.ref/scratch/settings-sec/`：按设置域拆分的文案。
- `.ref/scratch/settings-sec/codeReview.txt:1`：Personal／Repository／Security Review 设置。
- `.ref/scratch/settings-sec/cloudEnvironments.txt:1`：新 Cloud Environments CRUD 与网络／分享／secrets。
- `.ref/scratch/settings-sec/browserUse.txt:1`：Browser Use、历史、下载、权限、CDP、WebMCP。
- `.ref/scratch/dumps/workPreferences.txt:1`：Work preferences。
- `.ref/scratch/dumps/plugins.txt:78`：插件详情、账户权限、安装和分享。
- `.ref/scratch/files/skills-page-6e8cfa26f4fc.js:1`：`$skill-creator` 会话 prefill。
- `.ref/scratch/files/editable-review-file-source-tab-content.electron-d0a1a73d1efd.js:1`：Files 编辑与 draft 证据。
- `.ref/scratch/files/debug-settings-1815e1c2c027.js:1`：Debug 设置页。
- `.ref/renderer-asset-filenames.txt`：懒加载页面和组件 chunk 文件名索引。
- `.ref/scratch/catalog-full.tsv`：阶段性 i18n 目录，**不是绝对全量页面目录**。
- `.ref/reference/settings-labels.txt`：设置文案索引。
- [reference-inventory.md](reference-inventory.md)：Codex 本地专项历史明细，使用本文 §8 的纠错说明。
