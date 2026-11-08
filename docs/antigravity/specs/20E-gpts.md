# 20E GPT 目录：当前发行包重新取证与开发前合同

日期：2026-11-06。**公共目录、搜索与只读详情已开发，阶段自验进行中；没有官方运行时、真实账号 HTTP 或像素验收。** 当前实现与精确验证范围见[20E阶段记录](../acceptance/20E-gpts.md)。 当前 `GptsView` 已有真实目录、搜索、分类分页及详情 metadata 读取，不能称为占位页。本单元应在此基础上改正可观察差异，保留身份绑定、取消和错误恢复，不回退为永久“未连接”。

## 基准与证据边界

- 固定未修改 Store 包：`C:/Program Files/WindowsApps/OpenAI.Codex_26.1027.3384.0_x64__2p2nqsd0c76g0/app/resources/app.asar`。
- SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`；**复用本轮 19E 于 `2026-11-06T22:24:08.9404008+08:00` 的完整文件测量**，记录为 `.ref/parity/19/actual/19E-images/verification/resource-baseline.json`。20E 没有再次整包流式计算。
- 20E 独立重读 header，SHA-256 `58b11f647e1119b429ae364292977cf86fe116de3987265ccd2a265991fb9d85`；35 个原始 entry 均重新读取并与 header 的 integrity SHA-256 核验。
- 新证据根：`.ref/parity/20/actual/20E-gpts/reference/`。`manifest.json` 记录逐文件完整 hash/大小；`anchors.json` 保存 **56 个完整函数/样式表或明确有界片段**；所有位置是 **0-based UTF-16 code units**，不是字节、物理行或旧包偏移。
- `translations.json` 提取实际 `zh-CN` 的 268 个 GPT 相关键；`self-check.json` 记录文件 hash、锚点往返核对及 16 项原始纯函数断言。纯函数样本不构成 React、服务集成、运行时 gate 或视觉通过。
- `implementation-baseline.json` 记录研究时现有页面/服务源码 hash。调查起始 HEAD 为 `469b74fc4d30ff491cbf947a1bc3c0d683622019`，同时存在主线程的 19E 未提交变更；20E 不修改这些输入。

**旧 `20-gpts.md` 的包是带 offline patch 的另一份 ASAR，不能直接继承其 chunk/hash/布局。** 例如旧 `gpt-discovery-page-4510329cc78f.js`、`gpt-about-dialog-b2bdfa2c0142.js` 在本固定发行包中不存在。本次重新定位的是 `gpt-discovery-page-61b23db251d5.js`、`gpt-about-dialog-818642adeeb0.js`；其公共搜索 250ms、limit12、分类 limit6 是当前静态事实，不能继续以旧规格或当前代码的 300ms/20 为依据。

当前 Windows 缩放、应用缩放、官方窗口客户区、账户权限、当前动态配置值均未实测。所有 CSS 数值是源码坐标/token，不能直接宣称物理像素误差小于 1。官方素材许可未确认，本轮只保留本机参考，不复制到产品资产。

## 原始来源索引

以下位置引用 `anchors.json` 的 ID，可通过其 offset/end/hash 直接回原文件，不依赖混淆行号。

| 证据 | 当前原文件 / 关键锚点 |
|---|---|
| 路由与准入 | `app-runtime-e4b4e09bd942.js` → `route:gpts-guard`；`app-route-components-e99df9131659.js` → `route:guard`；`app-initial-4267e52fe5b0.js` → `route:paths` |
| 页面/公共目录/工作区 | `gpt-discovery-page-61b23db251d5.js` → `discovery:Bt/lt/kt/Ft/bt` |
| 分类/搜索/条目/更多 | `directory-banner-9504db8e489d.js` → `directory:G/Xe/tt/ot`、`limits:public-search-category` |
| 详情/工具/权限/附加信息 | `gpt-about-dialog-818642adeeb0.js` → `about:wt/Tt/dt/_t/it/kt` |
| 网格/键盘语义 | `skills-page-grid-cfb4684abd0f.js` → `grid:layout`；`card-tile-b0b37249cdd1.js` → `card:semantics/layout-keyboard` |
| Header/滚动/间距 | `searchable-page-layout-99049fa44c3f.js` → `layout:ye/N/I`；`126a18e4438e.css` → `layout:module-css` |
| 头像 bytes/失败回退 | `app-primary-998934e837fc.js` → `avatar:presentation`；`app-initial-4267e52fe5b0.js` → `avatar:resolver/source/protected-url/protected-endpoints` |
| 详情读请求/会话身份 | `app-primary-998934e837fc.js` → `detail:resource-query`；`app-initial-4267e52fe5b0.js` → `chat:request-mode` |
| 创建/迁移/管理准入 | `gpt-management-access-897383c3bec7.js` → `management:guard`；`directory-banner-9504db8e489d.js` → `directory:mt/_t/vt` |
| 中文 | `zh-CN-88ebb426d686.js` → `translations.json` 中实际 key/value/offset |

## 页面怎么呈现

### 入口与新旧 Header

直接 `/gpts`、`/gpts/mine`、`/g/:gizmoId` 在实际路由表中包裹同一个 `Dw`。该组件默认读取 `chatgpt` 和 `chatgpt.seat-access`：加载时给 fallback；seat-access 分支进入对应屏幕；`chatgpt` 不可用则 replace 到 `/`；满足能力后才渲染页面。**不能用 sidebar 是否显示代替直接路由准入。**

Sidebar 的 GPT 入口另要求 ChatGPT sidebar mode/相应分支、`chatgpt.isCapable`、allowed 且含 plan，并排除 `RT.FREE/RT.FREE_WORKSPACE`，`visibleByDefault:false`。`sidebar:gpts` 保存整个函数，排除值另见 `sidebar:excluded-plans`。当前账号的实际值仍未知。

`discovery:Bt` 使用实际 `JD` 新布局状态，不自行开 gate。`layout:gate` 的 JD = gate `3085093835` 且不处于 denied/unsupported-auth；它只是布局分支，不能作为服务授权。

| 分支 | 实际传给 SearchablePageLayout 的属性 |
|---|---|
| JD false | 外部 `HeaderToolbar` 放工作空间/公开切换和动作；headerVariant=inset、headerPlacement=page、contentWidth=default；搜索 variant=default |
| JD true | 外部 Header 内容为空，动作回到页内；headerVariant=compact、headerPlacement=sticky、collapseHeaderOnScroll=true、expandSearchWhenWrapped=true、contentWidth=extraWide；搜索 variant=toolbar-compact；工作空间切换为 stickyControls |

两分支都有标题、说明、搜索、动态 migration banner 及真实内容；`animateContentLayout:false`，不能添加自行设计的卡片飞入动画。标题的官方中文为 **“GPT”**，说明为“发现集说明、额外知识和任意技能组合于一体的自定义版 ChatGPT”；搜索为“搜索 GPT”；“我的 GPT”和“创建”是独立动作。窄布局把动作转入“GPT 操作”菜单，具体阈值受 header container query，而非凭视口宽度猜。

`layout:N` 的 extraWide 上限为 1440px，compact 使用 `px-6 lg:px-12`，另有 compact-page-gutter 分支 `px-7.5`；default 宽度来自 `--thread-content-max-width`。**不能直接把 18I 的固定 48px gutter 无条件套到 GPT**。Header 测量/滚动公式可复用 18I 已有结构，但须逐 props 对齐并按两分支复验，保留其已记录的 zoom/titlebar inset 未验限制。

### 公共目录及分类

页面主体是 `flex flex-col gap-8`：限制说明、分类导航、workspace-filtered 提示、加载/错误、各 cut、quorum 提示，均按真实条件出现。

- discovery 返回 cuts；保留有 cursor 或至少一个非 snorlax 的 section。分类导航仅取 `info.display_group != null`，按该 name 去重，不硬编码固定类别。
- 横向导航为 page tabs，点击记录 selected key 并滚动到对应 section。`scrollIntoView({behavior: reducedMotion ? 'instant' : 'smooth', block:'start'})`，section wrapper 为 `scroll-mt-40`。本锚点没有证明自动滚动时更新选中项，不能自行写成已证实 scrollspy。
- 每个 section 有 `h2`、可选 description、条目网格、独立“查看更多”。初始 cut 是 infinite query 的 initialData；`display_type==='featured'` 不显示排名，其余传入索引 + 1。
- 网格不是当前 `auto-fill/minmax(320px)`：`@container/skills-grid` 中，默认单列，**容器宽度达到 581px 时两列**；catalog 间距 `gap-x-6 gap-y-2`。CSS 原始 `--spacing:.25rem`；是否等于期望物理像素需同环境验证。
- 条目使用共享 CardTile 默认 presentation=card，并叠加 `group justify-center border-none text-base select-none`；图标 36 CSS px（`size-9`）、排名 `w-5`、排名与图标 `gap-2`；标题 trim 后为空才 fallback ID；description 单行 clamp；下方真实作者和 `num_conversations_str`。不自行添加 lift/translateY(-2px) 或虚构作者/使用量。
- `tags` 决定限制：优先 interactions_disabled，其次 fedramp_incompatible、openai_gpt_workspace_disabled，再 workspace_disabled（owner+allow_specific 有例外）。限制条目降低 opacity 并显示 warning；没有 onClick 时渲染非交互 div/tabIndex=-1，而不是仍可打开详情的普通按钮。

### 搜索与工作区目录

- search 在 URL query 中，输入更新使用 replace；清空删除 search 参数。公共目录将 trim 后搜索 **防抖 250ms**；工作区 **300ms**。公共非空 query 才切换搜索；不能给两个分支统一使用 300ms。
- 公共搜索结果有隐藏 `h2`/aria-labelledby；loading 是居中 spinner+polite status，空态“未找到 GPT”/“换个搜索词试试”；失败“无法加载 GPT”/连接恢复说明和“重试”。追加错误保留结果，以分页按钮重试。
- workspace 且 plan 非 quorum 时显示“工作空间 / 公开”，默认 workspace（`view=public` 显式覆盖），路由切换保留其他 query 参数。workspace 响应是 `gizmos/query_continuation`，不是 public `resource.gizmo`。
- workspace 有类别多选及创建者多选；创建者菜单自身搜索 300ms，limit30/offset，要求 response.total，勾选 preventDefault 保持菜单；有错误重试、无结果、更多、清除筛选。
- workspace grid 也按 581px 两列；真实 `avatar_url/name/description/creator_name|email`、accurate_num_paid_conversations 优先于 num_paid_conversations。分页按钮同时被 IO 观察，rootMargin **`0px 0px 400px 0px`**；公共分类/公共搜索只有“查看更多”，不能把 18I 的默认 IO sentinel 套到全部 GPT。

## 固定读取协议与页大小

以下 `/gizmos/...` 是官方共享 safeGet 的逻辑 route，现宿主将其映射到 `/backend-api/...`；`/public-api/...` 保留该前缀。不能根据 public 字样省略身份/完整性。query 的 undefined 意味着省略，而非传 null。

| 操作 | 原始 route / 参数 / 形状 | 当前能力与差距 |
|---|---|---|
| 公共 discovery | GET `/public-api/gizmos/discovery`，附加官方 shared header；cuts、locale、workspace_filtered | 已有 `gpts_discovery`；页面丢弃 locale/display_group/display_type/description/workspace_filtered |
| 分类追加 | GET `/public-api/gizmos/discovery/{category_or_cut_id}`；cursor、**limit6**、locale；`list.items/list.cursor` | 已有 `gpts_category`，当前页固定20、没有 locale。官方 helper 对真实空 `list.items` 且 cursor 非空再取一次，不是对过滤掉 snorlax 后的空数组继续 |
| 公共搜索 | GET `/gizmos/search`；q、**limit12**、cursor；workspace_only 为 true 才发送，否则省略；items/cursor | 已有 `gpts_search`，页目前20。官方 search helper 的空 query 特殊分支取 recent cut limit3，但当前 page 的公共空搜索不直接渲染该 helper，不能据 helper 存在强行请求 recent |
| workspace | GET `/workspace-resources/{account_id}/gizmos`；query_continuation、limit10、search、categories、user_ids | 当前宿主无固定操作；必须按已验证当前 identity 派生 account path，不能前端任意传账号/URL |
| workspace settings | 先身份输入订阅，再固定账户 settings；allow_third_party_gpts 参与说明/owner例外 | 不可仅用目录成功推断全部 workspace 规则已具备 |
| creators | GET `/accounts/{account_id}/users`；limit30、offset、query；items/total | 当前无该 GPT 操作；不得用本地作者字符串拼 creator 列表 |
| detail | GET `/gizmos/{gizmo_id_or_short_url}`，普通 GPT；顶层资源 `{gizmo, tools, ...}`，queryKey detail | 已有 `gpts_detail`；business-agent 的 conversation context/headers 是另一路额外校验，不能直接扩展为任意 header |
| about | GET `/gizmos/{gizmo_id}/about`；独立 account/gizmo query，about_blocks | 已有 `gpts_about`，当前页面尚未使用 |
| 同作者 | GET `/gizmo_creators/{uid}/gizmos`；来自真实 resource.gizmo.author.user_id | 当前无固定操作；只在对应详情分支 enable |
| pin/bootstrap | `/pins?item_type=gizmo`、`/gizmos/bootstrap?limit=20` | 详情 overflow pin 状态来自服务，不能 localStorage 冒充 |

## 详情、头像与动作

1. 公共卡通常把已取得 resource 交给详情，**不是每次必须先清空再请求**；只有 migration gate `2160578039` 分支会继续按 ID刷新。workspace 卡以 ID 进入，需详情读取。详情没有资源时是 editor/chatgpt dialog：loading accessible title/description + spinner，失败独立错误和重试。
2. 真实详情默认 wide/promotional；已迁移插件满足相关条件时 catalogDetail/compact/catalog。内容区自身 scroll，`px-5 pt-20 pb-4 sm:px-10`；头像 `size-20`，居中标题/作者/说明；底部行动区固定为 shrink-0。不能用原生默认 `<dialog>` 的无样式四段文本冒充。
3. about_blocks 独立加载，generic_title_subtitle、rating、category 等只按服务返回渲染；缺失/空时隐藏，不编造评分、分类或统计。
4. “对话开场白”最多前4条，额外 gate `1825130190`、已发布状态和未迁移等条件共同控制。点击只把 prefillPrompt 带入真实 GPT chat route，供发送前检查；不自动发送，也不转成普通 Codex thread 的 prompt。
5. 工具能力是从真实 tools 映射并去重；browser/canvas/python/image_gen|dalle/memory/plugin/connector 有各自中文，未知/不展示种类跳过，不能据 title 自己附加能力。
6. Overflow 只在 live_version 非0显示。pin 状态未读到时禁用；pin/unpin失败回滚并报错。非 private 可复制真实 short_url|id 的 `https://chatgpt.com/g/...`；复制成功才呈“已复制链接”；Report 为另一个真实子流程。本研究单元不执行真实写入，不把本地 toast 视为 pin/迁移成功。
7. 头像使用真实 `display.profile_picture_url`/workspace avatar_url；公开卡36、详情80、相关项48。官方 `xX` 取 shared resolver，失败后对该 src 回退图形，alt为空；不能用 emoji、作者首字母或网上随便找到的 logo。
8. shared resolver `gia/yia/Cia` 对 HTTPS chatgpt.com/子域（排除 ab. 前缀）的 `/backend-api/estuary/content` 与 `/backend-api/estuary/public_content/enc` 使用 profile-picture cache + authenticated asset 路径；其他 URL可走外部 src。**官方 img 可直接外链不代表 Tauri 应给任意 metadata URL 附加 token。** 实施需受身份与用途约束的固定资源注册、受控 bytes、redirect/MIME/大小验证、离页/换账号撤销和晚到清理；可复用 19E 的安全边界，但 GPT avatar 角色必须单独确认，不混入 Images capability。当前 ServiceOperation 没有 GPT avatar bytes 操作。

官方 Modal/Menu 共享层的 Escape、外点、Tab trap、焦点返回、菜单打开时关闭上层详情等链尚未完整恢复。本次能证明 `onOpenChange(false)→onClose` 及 CardTile Enter/Space（仅 target===currentTarget，preventDefault→click）。其余键盘/焦点规则列为待追共享组件及原生实测，不能声称旧 `<dialog>.showModal()` 天然等价。

## 创建、迁移、开始聊天的边界

### 详情榜单与复制链接补证

重新核对 Store `26.1103.4239.0`，asar SHA-256 `fb47d6491dc3006b708cb1e14de479b882bf50f88b7daa81818f154c253266aa`。`716164.ac9a1c8325.js` 15068–16850 的 about block 将星标置于分数前，有排名时以 `#名次` 为主值，副标题使用类目与可选地区，无排名时以类别名为主值并标注「类别」。同 chunk 21800–23500 的 overflow 在 live_version 为 0 时不显示，private 没有复制动作；复制使用 trim 后的 short_url 或 ID，经 encodeURIComponent 拼入固定 `https://chatgpt.com/g/`。实际简体中文见 `1561.0f4c0bdc0f.js` 的 `chatgptConversations.gpts.about.*`。

本轮验收：由已发布的非私有详情展示「GPT 操作」和「复制链接」，成功时重开可见「链接已复制」，失败可重试。Escape 先关闭菜单并回焦，再关闭详情；写剪贴板前确认仍处于该详情。缺失发布或可见性信息时保守隐藏。固定到侧边栏、举报、作者更多作品与 GPT 对话继续独立验收。

### 详情功能列表与同作者卡片

同一基准 `716164.ac9a1c8325.js` 21500、27010、29972 附近，真实工具由元数据按支持类型映射、按标题去重；「功能」分组保留来源顺序，每项左侧为绿色勾，说明另起一行并与标题对齐。无可展示工具时隐藏整组。验收使用原有工具解析和详情夹具，检查图标不进入可访问名称、支持项不重复、空值不造功能。

同 chunk 19745 的同作者读取使用真实作者 ID，非迁移展示分支下读取 `/gizmo_creators/{uid}/gizmos`。27864 处使用作者名称与横向卡片，30383 处 `ed` 点击直接调用 `onStartChat(resource)`。同作者分组需与真实 GPT 对话路由一起验收。

- “我的 GPT”在 gate2160578039=true 时进应用路由；false 时通过官方 browser bridge 打开 management URL，不能总按同一种页面呈现。
- 管理 guard 检查当前 auth/account、accounts/check、当前 Statsig account context 一致、有效订阅或允许 plan；workspace FE controls / RBAC下另要求 `chatgpt.workspace.gpt.crud`。context不符、设置缺失、加载失败不放行。
- Create 受 config2513446768.disable_gpt_creation、2160578039、1663164947、插件创建权限影响；可能进入 GptCreatePluginPrompt 或真实 GPT Builder（fresh chunk `page-924feacfde40.js`），不是本地技能页。migration banner另受2562735250.enabled、身份、套餐、workspace权限及可迁移真实资源控制。未核实值不显示全员固定退休日。
- 详情 Start Chat 根据真实 short_url|id导航 `/g/...`，清理相关新聊天上下文并设置 chat 模式；direct route加载资源、区分404/其他错误、normalize地址、保留search/hash/state，最后进入真实 ChatGPT route。
- `chat:request-mode` 当前原始构建确有 `conversation_mode:{kind:'gizmo_interaction',gizmo_id:<真实ID>}`。普通 Codex app-server turn 不提供等价绑定，不能仅把 ID塞到任意字段、使用projectId或prompt假冒。创建/编辑/发布/迁移也须另行真实请求合同及读回，不能为了按钮可点而伪造成功。

## 当前代码具体差距与下一开发单元

当前有用的行为应保留：真实服务返回才显示卡片、snorlax过滤、身份/取消、分页错误保留结果、重复cursor保护、detail错误重试。现页的 API读取不是演示数据。

| 差距 | 最小修正及证明 |
|---|---|
| metadata提前压扁成 id/name/description/author，丢失分类/排名/限制/头像/详情字段 | 单独 decoder 保留本单元实际字段；真实 fixture覆盖缺省/损坏/snorlax/限制优先级、服务success空与不可用分开 |
| 公共搜索300ms/limit20，分类20 | 先以官方250ms/12/6及 locale/省略字段写红例，再改请求；空页续取依照原始 list.items，而不是过滤后items |
| 所有资源同一种div网格，CSS320auto-fill、双行description、hover位移 | 按581容器两列、gap、条目层次、限制不可点击还原；宽/窄fixture真实渲染+官方同条件图待补，不给score |
| 无标题说明/分类导航/动态能力布局 | 保留真实gate未知；先完成public分支和准确Header props，缺能力不强显workspace/create；切换URL、清空搜索/取消/回退测试 |
| detail只四字段，每次清空/重新读，没有about/头像/工具 | 保留catalog resource立即详情、按真实gate刷新；about独立状态；avatar bytes须先完成宿主资源合同，不直接token-fetch URL |
| workspaces/mine/真实GPTchat/管理写链缺失 | 分开后续验收单元，保留准确不可用；不能为了完成public切片把其他页面标通过 |

**建议下一最小真实切片：20E1公共目录+搜索+只读详情。** 先metadata decoder/实际payload+资格layout快照，接现有4个gpts读操作及about，修复250ms/12/6/locale和原始空页语义；受控头像bytes是独立前置小块。完成真正可渲染public页后继续workspace固定读合同，最后单独处理真实ChatGPT会话绑定和管理写链。此排序不是将整页目标缩减为public，其他范围明确留队列。

## 开发前动作验收矩阵

| ID | 操作 / 必须观察与结果 |
|---|---|
| GE01 | `/gpts`能力loading/denied/seat-access/allowed，检查请求是否正确阻止；sidebar隐藏不自动deny直接路由 |
| GE02 | 返回cuts→只展示真实有效sections；display_group去重导航，点击滚到真实锚点；reduced-motion分支 |
| GE03 | public连续输入/清空/快速换query；250ms只发最后trim query，limit12且首cursor/workspace_only省略；旧响应不能覆盖 |
| GE04 | 分类更多limit6/locale/cursor；真正空原始页仅再取一次；过滤snorlax不等于原始空；重复cursor报错且保留内容 |
| GE05 | search追加失败保留已显示结果并可重试；initial错误/成功空/无权限区别，不能错误变空 |
| GE06 | 卡片metadata、ranking/featured、作者/usage、restriction优先和owner例外；限制不可click/tab/Enter打开 |
| GE07 | 普通条目鼠标、Enter、Space一次打开；子元素事件不二次打开；详情关闭/Escape/Tab/焦点返回通过实际共享层与原生验证 |
| GE08 | public已有resource立即详情、gate刷新/ID加载、失败/重试；about独立成功/空/失败不遮掉有效metadata |
| GE09 | avatar不同host/协议/redirect/MIME/过大/坏图、身份变更与晚到；不外泄认证header，不跨avatar/其他图像用途复用 |
| GE10 | 宽窄Header新旧分支、581容器断点、长标题/无作者/无头像、滚动、菜单及dialog不溢出；配对同环境官方图后才判像素 |
| GE11 | workspace defaults、filters300ms/10/30、offset/continuation、IO400px和手动fallback；当前仅合同，未实现不得记过 |
| GE12 | Start Chat开真实gizmo route及会话请求绑定，promptStarter只prefill不send；旧普通thread假绑定必须保持不存在 |
| GE13 | 换账号/失效/离页取消目录、搜索、分页、详情、头像；晚到内容/bytes不得写回，所有listener/observer/timer清理 |

初始取证时只执行来源自检、原始纯函数16断言与文档检查；后续产品开发及检查见20E阶段记录，不沿用此历史范围作为当前状态。初始取证没有构建或产品测试；没有真实HTTP、GUI、IME、官方同环境图、创建/迁移/会话动作。整页仍未开发完成、未自验通过、未用户验收。


## 直接路由能力补证（20E 开发前）

补证见 `.ref/parity/20/actual/20E-gpts/reference/access-contract.md/.json`：保存12个完整原函数与16项离线执行结果。`Dw` 默认查的是 `Gb(chatgpt)` 与 `Gb(chatgpt.seat-access)`；`Cv` 仅在 JD Header 布局计算里使用，不能代替 GPT 产品资格。实际 chatgpt 资格由 `Odt` 身份/精确计划集合、`770071981` 条件 workspace permission `chatgpt.workspace.feature.desktop-app-chat.access`、default host 完整 `experimentalFeature/list` 中 `in_app_chat!==false` 共同决定。`770071981=false` 不代表拒绝。`Dlt` 的 Og 表不含 `team`，不能把所有 workspace 都强制该 permission。Seat 要保留 raw `accounts/check` entry 的 `features`，`codex_only` 才进入专用 seat screen，且该分支在拒绝跳首页前处理。`share_accounts` 宿主实际保留原 map，不能套用 Images/Library 的前端数组假定。当前账号快照未实测；不以这些静态样本宣称真实账号可用。


### 20E 当前桥形状兼容差距

宿主 `ShareAccounts` 的 `/backend-api/wham/accounts/check` 响应保持官方 `accounts` keyed map / `account_ordering` 原形；Images/Library 当前客户端按数组查找 selected 是已有兼容差距，不能把其解析逻辑继承为 GPT 资格证据，本补证未改这些模块。GPT 应保留 entry.account 与 entry.features，明确与当前前端数组假定的边界。公共 discovery/category 的 shared safeGet 附加标记为 `X-OpenAI-Attach-Auth: 1`（directory S / discovery M ← shared ggt ← Oct），不是任意 renderer header 通道；来源与 native 转译边界见 access-contract。


### Header 原生消费结论（后续补证，覆盖此前未定边界）

已确证 X-OpenAI-Attach-Auth 是内部 fetch marker：同包 early-bootstrap.js 的 XIF→nW→nH 在读取后删除该键；early-bootstrap-491-e75c34fa1b2c0832.js 的 performDesktopFetch 消费其布尔值，获取 token，再将已去 marker 的 headers 附真实认证后交 applicationNetwork.fetch。Tauri 固定鉴权链是等价实现，不应把 marker 原样发给 server。access-contract.json 保存两个新文件 integrity、完整消费函数/方法和4个原函数离线删除样本，均未调用真实 HTTP。


详情原始形状补证：`reference/detail-resource-contract.json`保存safeGet→makeRequest→fetchJson与wH→wt/Tt完整链，没有resource解包。HTTP详情返回顶层gizmo，与目录item.resource.gizmo不同；头像宿主必须登记body.gizmo，不能用旧wrapper夹具证明正确。实施修正与红绿范围见20E记录。
