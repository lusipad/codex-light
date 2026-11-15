# 全软件功能缺口与整页开发队列

核查日期：2026-11-16。源码基线：`489028326a239e4a81001d5c2a62f505a7b84f4c`。本轮只盘点与调整计划，没有修改产品代码、重跑产品构建或新增通过记录。

**完整执行入口**：[全软件复刻总计划](FULL-REPLICA-PLAN.md)已将本清单展开为R0–R9、26设置任务、依赖与G0–G5门槛。本文保留现状与粗粒度优先级，具体执行/放行以总计划为准，不把缺口清单本身当完整开发规格。

## 1. 本轮调整的决定

1. **停止用首页小修补代表全软件进度。** 首页01H保存现有成果，仍未验收；下一主线转入插件与设置。置信度高，依据用户反馈与当前源码。只有用户改变优先级才调整这一决定。
2. **先核电脑操控、Appshots和浏览器的宿主可行性，再承诺页面开发。** 当前三者是说明页，app-server可运行不证明具有桌面操控/窗口文本/浏览器服务。置信度高，依据[当前组件](../src/components/ControlCapabilitySettings.tsx)。若找到同版真实宿主合同与可调用能力，再从“仅说明”升级为开发中。
3. **保留插件、Sites及其他页面已有真实链路，按整页补齐。** 不重做已存在的数据层，不把所有禁用状态都判为缺功能。置信度高；账号/平台/管理员门控必须与“未实现”分开。
4. **整页主流程、官方界面、原生行为与用户验收分列。** 本清单没有任何条目因历史测试数而自动升级为完整可用或已验收。

## 2. 假设、依据和边界

- 本次是当前源码入口盘点及历史证据索引复核，不是全软件官方运行时验收。状态类别反映实现覆盖，不能推导功能正确率或完成百分比。
- 固定参考沿用01H的官方Windows Store `26.1103.4239.0`；本轮未重新提包或计算整包哈希。不同产品模式下的Sites、GPT、桌面操控等入口不能只因同名而合并。
- DPI、官方应用缩放及同场景配对截图仍缺证。官方注册程序被现有computer-use工具映射到ChatGPT.exe，工具规则禁止自动操作该UI；不绕过，官方运行时取证单列依赖，不阻塞可独立完成的静态研究与本地真实链路验证。
- 实现“源码有调用”不等于真实账号验证；历史“待用户验收”不等于用户已确认。真实服务、隔离桥、原生GUI、像素分别留证。
- 下表使用：**部分实现**（存在具体功能链路但未覆盖整页）、**仅说明**（不具备所述主要操作）、**需核验**（仅确认入口或存在历史证据）。“缺失”仅在明确动作无实现时使用；本轮没有足够依据将任何整页标为“完整可用”。

## 3. 主页面及跨页能力

编号沿用旧逐页计划；编号不是当前路由数量。设置另分区列出。

| 编号/页面 | 当前类别与已有实现 | 必须补齐或重新验证 | 当前源码/证据入口 |
|---|---|---|---|
| 00 基准 | 部分建立：固定版本及asar来源 | 同条件官方运行时、产品模式/账号门控、DPI/缩放、配对图 | [01H规格](antigravity/specs/01H-whole-home.md) |
| 01 首页与公共壳 | 部分实现：项目/草稿/模型/附件、侧栏和标题；01H真实创建/登记/同根ID及键盘修复 | 新建外观、零源托管目录；完整附件/IME/成功发送与恢复；官方像素 | [App](../src/App.tsx)、[01H记录](antigravity/acceptance/01H-whole-home.md) |
| 02 会话 | 部分实现：真实聊天生命周期、消息渲染和用户动作 | 完整编辑流程、长内容、流式与失败组合、全部动作的官方呈现 | [App](../src/App.tsx)、[用户消息](../src/components/UserMessageBubble.tsx) |
| 03 执行与审批 | 部分实现：工具、思考、计划、审批等事件分支 | 专用app/widget覆盖及权限/取消/中断结果，不能以通用卡片替代所有官方工作面 | [App事件分支](../src/App.tsx) |
| 04 项目组织 | 部分实现：目录/项目表单、多根项目及选择 | 完整管理surface、外观/默认托管源、排序和官方创建全流程 | [项目页](../src/components/ProjectsIndexView.tsx)、[表单](../src/components/ProjectEditDialog.tsx) |
| 05 文件 | 部分实现：文件树、读取、编辑及保存 | 完整多文件/冲突/脏稿流程及官方面板结构，逐项复查历史缺口 | [文件树与抽屉](../src/components/DiffDrawer.tsx) |
| 06 Git/变更 | 部分实现：真实状态/补丁/暂存/提交等 | 全部菜单及提交/PR流程、官方布局、错误组合与原生验收 | [变更抽屉](../src/components/DiffDrawer.tsx)、[Git后端](../src-tauri/src/git.rs) |
| 07 终端 | 部分实现：真实PTY、输入/输出、停靠与生命周期 | 官方标签/恢复/快捷键、中文输入及多窗/退出组合 | [终端](../src/components/TerminalDock.tsx)、[后端](../src-tauri/src/terminal.rs) |
| 08 搜索 | 部分实现：聊天/命令/文件入口及键盘/分页等增量 | 逐产品分支核官方范围、排序、完整命令与空/错误态 | [搜索](../src/components/QuickSearchModal.tsx) |
| 09 活动 | 部分实现：本地Inbox及账号通知入口 | 本地通知、账号通知和官方Activity的来源/门控不能混为同一完成项 | [Inbox](../src/components/InboxView.tsx)、[账号通知](../src/components/AccountNotificationMenu.tsx) |
| 10 计划任务 | 部分实现：列表/配置与调度链路 | 官方模板、完整编辑/目标/历史与运行结果、原生对照 | [计划任务](../src/components/AutomationsView.tsx)、[后端](../src-tauri/src/automations.rs) |
| 11 工作树 | 部分实现：真实Git工作树/库存及部分保护恢复 | 全部管理操作与窗口/失败恢复组合、官方布局 | [工作树](../src/components/WorktreesView.tsx)、[库存](../src/components/WorktreeInventory.tsx) |
| 12 插件 | 部分实现：目录、已安装、本地/远端操作及准备/结果核验 | 按同版重列目录→详情→安装→连接/授权→可用→管理/卸载，核布局、账号门控和作用域；不能把打开外链算授权成功 | [插件/技能组件](../src/components/SkillsMcpView.tsx)、[准备面板](../src/components/PluginPreparationPanel.tsx) |
| 13 技能 | 部分实现：推荐/预览、安装、编辑与试用草稿 | 完整浏览/管理入口、来源与作用域、真实安装及官方呈现 | [技能组件](../src/components/SkillsMcpView.tsx)、[预览](../src/components/SkillPreviewDialog.tsx) |
| 14 代码审查 | 部分实现：本地与远端独立工作面 | 执行/审批/结果全链与真实服务验证；兼容入口逐项核定 | [本地](../src/components/CodeReviewView.tsx)、[远端](../src/components/RemoteReviewView.tsx) |
| 15 归档 | 部分实现：多来源列表及恢复/删除处理 | 同版筛选/排序/批量、权限、原生确认与官方像素 | [归档](../src/components/ArchiveView.tsx) |
| 16 设置 | 26个导航入口，另有类型/兼容分支；覆盖不等于完成 | 见下一节，按分区独立验收 | [设置壳](../src/components/SettingsView.tsx) |
| 17 Quick Chat | 需核验：历史存在独立窗口与接续实现 | 重新核当前原生入口、草稿/主窗接续、快捷键及窗口生命周期 | [App](../src/App.tsx)、[路由/类型](../src/types.ts) |
| 18 资料库 | 部分实现：真实浏览/路径/分页/偏好及预览 | 完整主操作与来源权限、资源失效、同环境UI；不能沿用旧“只有状态页”的结论 | [资料库](../src/components/LibraryView.tsx)、[预览](../src/components/LibraryPreviewPane.tsx) |
| 19 图像 | 部分实现：目录、历史/资源预览与本地草稿 | **生成、上传、编辑缺失**，当前发送禁用；选模板填草稿不能计为生成 | [图像](../src/components/ImagesView.tsx) |
| 20 GPT | 部分实现：发现、搜索、分类与详情读取 | **开始聊天缺失**，当前按钮禁用；目录可读不代表GPT可使用 | [GPT](../src/components/GptsView.tsx) |
| 21 Sites | 部分实现：列表、置顶、名称/环境/URL/已有域名及共享等链路 | **创建、编辑、发布、数据库、日程、整站删除缺失**；新增域名/DNS及各子页另核 | [Sites](../src/components/SitesView.tsx)、[服务](../src/sitesService.ts)、[HTTP客户端](../src/chatgptService.ts) |
| 22 云端 | 部分实现：环境、草稿会话与新云端聊天链路 | 环境直接详情保存/个人保险库/删除当前有未接入口；完整聊天交互及真实云端账号待验，不沿用旧“只有列表” | [环境](../src/components/CloudEnvironmentsView.tsx)、[草稿](../src/components/CloudDraftView.tsx)、[新聊天](../src/components/CloudNewChatView.tsx) |
| 23 跨页与原生 | 部分实现：导航/深链/快捷键/窗口和资源处理 | 全局焦点/IME/菜单/多窗、不同宿主服务及资源释放，需跨页操作序列 | [App](../src/App.tsx)、[快捷键](../src/shortcuts.ts)、[原生入口](../src-tauri/src/lib.rs) |

## 4. 设置逐分区盘点

以当前`SETTINGS_NAV_GROUPS`为导航事实来源，避免把类型联合中的兼容值误计为可见页面。所有分区均未因此获得整页1:1或用户验收结论。

| slug / 分区 | 当前类别 | 已有链路 | 主要缺口或下一核验 | 源码依据（`src/components/`） |
|---|---|---|---|---|
| general-settings / 常规 | 部分实现 | 默认打开位置/Shell/终端位置读写，发送/跟进/上下文、本地通知和Beta配置消费者 | 官方完整控件/门控及原生作用域 | SettingsView.tsx、GeneralOpenPreferences.tsx、NotificationSettings.tsx |
| notifications / 通知 | 部分实现 | 账户通知分类/渠道读写及身份失效 | 真实账号保存、跨窗同步、官方缓存时序 | AccountNotificationSettings.tsx |
| import / 导入 | 部分实现 | app-server检测、Claude Code/Cursor导入与状态 | 子项选择、Cowork、未知结果恢复、项目登记 | ImportSettings.tsx |
| profile / 个人资料 | 部分实现 | 资料读取、名称/简介修改及读回 | 头像上传裁剪、展示/可见性及统计等官方分支 | ProfileSettings.tsx |
| appearance / 外观 | 部分实现 | 主题/颜色、导入复制、字体目录/字形、字号/对比度/动效偏好 | 官方分组/排序、强调色、Mode图形及几何 | AppearanceSettings.tsx、AppearanceColorPicker.tsx |
| account / 账户 | 部分实现 | 登录/取消/退出及姓名/用户名读写 | 邮箱挑战、年龄/政策、账户删除等分支；登录须人工授权边界 | AccountSettings.tsx、AccountDetails.tsx |
| archived-chats / 归档 | 部分实现 | 共用多来源Archive与App动作 | 各来源真实权限、筛选/批量、原生确认 | ArchiveView.tsx |
| voice / 语音 | **仅说明** | Composer另有Web Speech草稿回退 | 设备、语言/声音、权限、全局听写与词典服务；回退不等于官方语音 | VoiceSettings.tsx |
| storage / 存储 | 部分实现 | 云配额读取及进入文件/图像资料库 | 完整官方管理动作；不能把配额显示当存储管理完成 | StorageSettings.tsx |
| agent / 配置 | 部分实现 | 本地作用域、锁定、配置写回及打开文件 | Work远端偏好、完整gate/preset、官方工作面 | AgentSettings.tsx |
| personalization / 个性化 | 部分实现 | 个人指令读写、草稿guard、Memory控制 | 账户资格、完整Markdown/远端host、在线记忆 | PersonalizationSettings.tsx、MemorySettings.tsx |
| pets / 宠物 | 部分实现 | 本地资源/偏好、Mini显隐/大小/选择 | 独立桌面overlay、云宠物；当前存在本地emoji回退 | PetsSettings.tsx |
| keyboard-shortcuts / 快捷键 | 部分实现 | 搜索/录入/冲突/重置及既有命令消费者 | OS-global、语音/浏览器/Pages/Artifact等依赖服务命令 | KeyboardShortcutsSettings.tsx |
| usage / 使用情况和计费 | 部分实现 | 真实用量/额度窗口/余额及降级 | 官方价格/历史/购买/账单等适用分支，不以外链替代真实完成 | UsageSettings.tsx |
| plugins-settings / 插件 | 部分实现 | manageOnly、本地管理、远端库存启禁/卸载 | 完整详情/权限/真实账号变更及官方UI；与目录页联合核验 | SkillsMcpView.tsx |
| computer-use / 电脑操控 | **仅说明** | 跳转插件管理 | 应用清单、权限/授权状态、真实应用控制服务 | ControlCapabilitySettings.tsx |
| appshots / 应用快照 | **仅说明** | 附件另有主屏像素截图 | 前台窗口/屏外文本、全局快捷键及路由 | ControlCapabilitySettings.tsx |
| browser-use / 浏览器 | **仅说明** | 当前无设置服务 | 浏览器宿主、历史/下载/扩展/站点权限；没有可工作的CDP设置 | ControlCapabilitySettings.tsx |
| hooks-settings / 钩子 | 部分实现 | hooks/list、trust/enabled状态及打开定义 | 原生编辑器及完整运行时对照 | HooksSettings.tsx |
| connections / 连接 | 部分实现 | MCP配置/状态、STDIO/HTTP编辑、启禁/卸载、重启 | 外部MCP/OAuth及远程host；配置保存不证明连接可用 | McpSettings.tsx |
| cloud-settings / 云端偏好 | **仅说明** | 当前无云偏好读写 | 差异视图/分支格式的实际配置服务与消费者 | CloudPreferencesSettings.tsx |
| codex-cloud / Codex云端 | 部分实现 | 资格/环境/仓库和设置会话创建/编辑 | 详情保存、环境删除、个人保险库禁用；真实云端权限 | CloudEnvironmentsView.tsx |
| code-review / 代码审查 | 部分实现 | 打开位置/指令、提供商与实例选择 | 完整执行/持久聊天、DiffViewer、远端gate | CodeReviewSettings.tsx、ReviewProviderSettings.tsx |
| git-settings / Git | 部分实现 | 偏好、提交/PR指令及部分生成消费者 | 官方远端模型覆盖、分支/合并/reviewDelivery分支 | GitSettings.tsx |
| local-environments / 环境 | 部分实现 | 配置发现/编辑、CAS保存读回、终端执行及setup/cleanup | 官方菜单/运行时和原生IME | LocalEnvironmentSettings.tsx |
| worktrees / Worktrees | 部分实现 | 根路径/host偏好、保留数/清理确认及库存 | remoteRef入口、真实网络及官方运行时 | WorktreeSettings.tsx、WorktreeInventory.tsx |

合计26个可见导航分区：**5个仅说明、21个部分实现**；这不是5/26缺失率或21/26完成率。`providers-models`、`experimental`存在于类型联合，未列入本次26个导航入口；Beta内容已在常规中挂载，不能额外算一个可见分区。各缺口的适用条件仍须按同版官方产品模式核定，不将所有账户分支一律要求在每个账号显示。

## 5. 实施顺序和可观察交付

此顺序覆盖旧整页计划的排队顺序，保留其取证、验证和用户验收规则。一次主开发线处理一个完整工作面，跨页共享能力研究可并行；不为每个按钮重跑整套打包，也不因缺官方图而无限磨首页。

| 顺序 | 工作单元 | 开发前要解决的未知项 | 阶段交付与验收入口 |
|---|---|---|---|
| P0，下一步 | 插件整页合同 + 桌面三项能力可行性 | 当前固定版普通/Work入口、官方中文区域树与控件；Computer Use/Appshots/浏览器的实际宿主RPC、依赖、Windows支持、权限与服务可用性 | 插件双向控件/动作清单；三项宿主能力矩阵，区分已有可复用、需实现、受限；不能只交“管理插件”跳转 |
| P1 | 插件目录/详情/管理整页 | 本地/账号插件身份、安装及授权前置、管理菜单和错误语义 | 完整操作序列、保存/读回证据、宽窄与弹层、原生焦点、清晰遗留；未经授权不实际安装外部软件或登录 |
| P2 | 设置壳 + Computer Use/Appshots/浏览器，各自独立验收 | P0确认可调用的宿主合同与实际平台分支 | 有服务则实现真实可用应用/状态/动作；缺执行器时先开发所需宿主并验证，不能先摆可保存但无消费者的开关；不可复现能力保留阻塞并继续下一独立单元 |
| P3 | Sites主要工作面 | Work会话/站点身份、创建→编辑→预览→发布的真实合同、账号权限与发布副作用 | 本地或隔离可审阅草稿、真实状态恢复；公开发布前核已有授权。不用配置页代替站点创作闭环 |
| P4 | 其余设置 | 依次常规/外观/通知→账号/资料/使用情况→配置/个性化→导入/归档/存储→语音/宠物/快捷键→Hooks/连接/Git/环境/工作树/云/审查 | 每分区控件、状态、生效及真实读回、取消/失败/重启、原生与官方对照各有结论，复用已存在链路 |
| P5 | 其他主页面整页补齐 | 依次会话执行→文件/Git/终端→项目/搜索/活动/任务→资料库/图像/GPT/云→Quick Chat/跨页 | 对照第3节的主要缺口逐项关闭；首页保留项在相关共享能力完成后回归，禁止遗忘 |

P0结束后才确定三项桌面能力的具体代码方案。asar只能证明静态客户端合同，不能证明能直接复用官方宿主、服务授权或跨进程捕获。若平台无对应支持，记录原因和可行替代研究，不擅自降低1:1目标。

## 6. 偏离规则与验证

- 对明确、可逆、无外部副作用的实现自主推进。发现证据改变动作含义时更新合同及实施日志，采取最小影响方案；不凭自己的理解补出“近似功能”。
- 新依赖、系统安全/隐私设置、真实付费、外部消息、公开发布、破坏性数据变更按既有授权边界处理，先准备可审阅结果。不能为测试更改用户全局配置。
- 每项动作验收至少包含：前置条件→操作→可见状态→真实协议/存储结果→失败/取消/重试→焦点。明确哪些是源码、回放、真实服务或原生GUI证据。
- 仅说明页至少补齐实际执行器及消费者后，才能升级为部分实现；部分实现必须补全主要操作并逐项验证，才能申请整页用户验收。没有对应官方证据的像素分数保持空值。
- 较大阶段统一冻结、回归、打包和原生操作后提交；同提交托管CI成功前不发布。当前CI账单阻塞沿用上一阶段记录，本轮未重新触发流水线。
- 实施备注复用`docs/IMPLEMENTATION-LOG.md`和对应整页记录，随时记录决定、偏离、意外及待核事项，不再新建重复台账。

## 7. 本轮验证

已将26个分区slug与当前导航源码逐项比对，连续编号00–23的范围项完整，未重复或遗漏；5个说明页的组件均直接读取核实。新增清单、整页计划、Antigravity首页与AGENTS内62条本地链接存在，空白检查通过。首次检查发现一个误写的FileExplorer.tsx链接，已改为实际承载文件树的DiffDrawer.tsx并重查。纯文档盘点不需要产品构建；本轮没有宣称任何新产品测试通过。
