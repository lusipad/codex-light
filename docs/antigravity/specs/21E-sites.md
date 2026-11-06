# 21E Sites：固定发行包取证与完整工作面合同

2026-11-07。状态：**静态调研完成，尚未实施21E**。本轮仅新规格和只读取证，无产品/测试修改、真实HTTP、官方GUI、Cargo或构建。页面编号21是Sites，22是云环境。当前产品已有真实Sites GET目录、搜索、分页、域名/环境读取；保留这些成果，不能按旧21规格中的修改前假数据描述回退。

## 基准和证据边界

- 固定Store `26.1027.3384.0`，`C:/Program Files/WindowsApps/OpenAI.Codex_26.1027.3384.0_x64__2p2nqsd0c76g0/app/resources/app.asar`。
- 整包SHA256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`，明确复用19E `resource-baseline.json` 最近完整测量，本轮未重复整包hash。
- 本轮fresh读取header，SHA256 `58b11f647e1119b429ae364292977cf86fe116de3987265ccd2a265991fb9d85`；从该header提取资源，逐文件hash核对entry integrity，见 `.ref/parity/21/actual/21E-sites/reference/manifest.json`。
- `raw/`保留108份完整原文件；`anchors.json`包括完整函数和明确标识的bounded字面量上下文，`function-index.json`提供检索地图。**所有位置是0-based UTF-16 code units**，不是行号或字节。AST解析的`export-resolution.json`用实际ExportDeclaration确认跨chunk别名，不能在巨型包内首次文本命中`as tv`就认定是真实export。
- `translations.json`保留350项相关真实中文；新UI引用的key若本locale缺失应记录缺失，不能自行翻译成“官方中文”。例如新`appgenPage.list.visitors`/`traffic.visitorsTotal`不能用同包较旧pageViews/visits键冒充。
- `self-check.json`记录资源、函数、片段、export和中文的hash/offset往返结果；这是静态资料正确性证据，不是功能或像素验收。未测账号gate、Windows DPI、App缩放、窗口尺寸、官方运行时，视觉score=null。
- 旧 `21-sites.md` 来自offline修改包，仅作为线索；本轮路径/chunk/方法重新确认。没有在线官方功能文档或连接器服务调用，未推定远端可用性。

## 路由、入口和资格：三个层面分别验证

|职责|fresh来源|合同|
|---|---|---|
|独立Sites入口|`appgen-route-409e4bf826d7.js:m`，initial `Jji`|gate637432221先允许query，再GET **`/codex/sites/access`**。enabled=true→available；false/失败→unavailable；未定→loading。不能只读取`/websites/access`就声称官方总入口门槛一致。|
|Sites列表|`appgen-page-f663c992a2ef.js:Qt`，initial `FNi/TNi/DNi`|另读`/websites/access`的supports_workspace_listing、supports_editable_listing；缺省false，受共享gate476199071控制。总入口、共享列表与设置能力不是一个boolean。|
|插件资格|新页Qt导入initial `oNn`（真实export BBn）|查询Sites插件/连接器状态，用于创建/空态等UI；不能把它误标为`/codex/sites/access` query。真实宿主插件安装/模式仍需完整链路验证。|
|Space/collection变体|`sites-view-3878021e2c94.js:p`、`space-sites-page-7e2d16f0a243.js:l`|`/sites/library`导航归一到`/sites`再封装`/space`；保留URL search/state。子详情有独立封装。不能把所有场景简化为一个全局dialog。|
|详情子页|`appgen-site-detail-route-b91d53e86600.js:v`、`site-details-53f8af233393.js:C`|settings、analytics、database、automations、**plugins**。Space默认settings；analytics gate262557526，events gate663642302。未知/不可用按真实redirect，不伪造数据。|
|首次条款说明|`appgen-publication-terms-route-8927c4f167e0.js:a`、preflight `J/z`|账户/用户绑定的一次说明，关闭与继续都标记seen；“继续”不是接受条款。server seenAnnouncements与本地pending同步，不自动写为已同意。|

## 主列表的真实呈现

`Qt`复用searchable-page-layout，`contentWidth:extraWide`、compact sticky header、滚动折叠标题、换行展开搜索；真实标题“站点”，副标题“将你的想法变成真实网站”，右侧“创建新站点”。应复用本项目已对齐的公共布局，先实测其宽度/滚动边界，不能继续保留双层路由padding和定死960px窄内容。

- 默认list，`sites-view-mode`只允许list/grid；持久化偏好，不缓存假站点。
- 页签由gate/变体决定：独立页“你拥有的”，collection页“你的网站”；共享资格成立显示“与你共享”；gate1425956883显示“已置顶”；**“全部”仅collectionNavigation存在且共享可用时显示**。当前恒常owned/shared/all不等价。
- 切tab清search并更新`view` URL；collection搜索`search`保存在URL并replace；独立页搜索为内存状态。无条件固定maxLength256不符合源：workspace共享或pinned为200，其余未设置该限制。
- owned及旧editable在已加载条目title/slug/description上trim/lowercase过滤；workspace共享、pinned走实际服务搜索。fallback共享应排除`current_user_role===owner`；all将owned标owner，再按id去重、updated_at倒序。
- 列表是subgrid，表头“站点 / 所有者（共享） / 共享对象 / 条件访客图 / 操作”。行`min-h-[82px]`、px4/py4、rounded-xl；520px以下隐藏共享列文字/所有者，720px另一布局压缩。不是只把普通卡片列成一列。
- 网格卡h64、rounded-2xl、border/shadow、预览图+下方h16信息操作；gap6，按真实container断点1/2/3/4列。不是当前auto-fill/min280/gap16即视作等价。
- 每行真实缩略图、名称、相对更新时间、“未发布”状态；owner信息、sharing计数/策略、置顶/日程图标来自服务。状态active且live_url=null才未发布；suspended禁编辑/访问并按workspace_admin/openai展示差异tooltip。不能给每行固定“活跃”badge替代官方呈现。
- 流量缩图是gate262557526与60299493共同允许；只在owner、已发布、未禁用时读取。IntersectionObserver可见批量拉30d/daily，batch参数来自821253728动态配置；不可固定假图或假访客数。
- 分页通过真实末端加载控件/可见边界触发，并单独加载骨架、后页错误与重试；不能用首屏错误覆盖已有条目。

几何class是静态原值，rem/token到物理像素仍须同环境测量；不能以项目13px根字号直接换算为官方像素。

## 点击、菜单和详情权限

新页 `Sn/Cn/wn` 与primary **`C5n`**（真实export nv）是菜单和主动作来源：

1. owned页：current_user_role非editor视为owner；共享页只有明确owner才管理，owner/editor可编辑。这个owner推导只属于该上下文，不应修改任意shared原始响应角色。
2. 默认可编辑行点击进入真实**编辑会话**；1498265771且collection导航/live_url具备时才改为打开站点预览。只读访问者点击安全实际live_url；不是全部点击打开信息dialog。
3. 菜单按条件有置顶/取消置顶、网格“打开网站”、未发布“发布”、共享、编辑、真实日程、分析、设置。禁用条件、owner才能首次发布的tooltip、menu disabled仍可聚焦均来自原组件。
4. 列表操作hover/focus-within/pointer-coarse显示；菜单end对齐，键盘关闭和焦点返还待原生实测。grid仅菜单/无独立同样排列按钮。
5. 设置是完整route工作面，名称/URL/共享/转让所有权/环境变量/自定义域名/危险区；详情还有analytics/database/plugins/automations子页。当前只读dialog无法承载这套外部行为，后续应改路由工作面而保留已有详情/配置读取错误隔离。

## HTTP与原始shape

所有路径是逻辑路径，经固定宿主认证/工作区/完整性桥解析；不给renderer token、任意URL或header。GET、MCP只读POST、写PATCH/POST/DELETE分别枚举操作，不能开通泛用代理。

|动作|真实方法/逻辑路径|关键合同|
|---|---|---|
|总入口|GET `/codex/sites/access`|gate637432221；10分钟缓存；与列表能力分开。|
|能力|GET `/websites/access`|30秒列表能力缓存；设置capability独立1分钟query。|
|owned|GET `/websites`|limit20/include_editable=false，首after=null（实际编码按wrapper），后页cursor；5分钟。|
|fallback shared|GET `/websites`|include_editable=true，首after=`sites-shared-projects:`；仅首屏400关闭fallback并replace到owned，后页400保持错误。|
|workspace shared|GET `/websites/shared`|limit20/query/after；query空省略；非空首屏300ms等待后检查取消，后页不延迟；30秒。|
|置顶目录/状态|GET `/websites/pinned`、`/websites/{id}/pin`|account/user分区，limit20/after/query，30秒；状态与目录按时间协调。|
|置顶写入|POST/DELETE `/websites/{id}/pin`|服务返回is_pinned后更新并失效列表、Space pins、搜索；pending/未知状态不重复写。|
|owner摘要|GET `/websites/{id}`|`CNi`仅该客户端将缺角色补owner，再按summary schema解析。|
|配置只读|GET `/websites/{id}/environment`、`/custom_domains`、`/share_access`|完整shape与project身份校验；secret值不展示、不日志化。|
|名称|POST `/websites/{id}/metadata` `{title}`|仅真实返回更新缓存；按updated_at保护晚响应，保存失败保留输入。|
|slug检查/变更|POST `/{id}/slug/availability` `{slug}`；POST `/{id}/metadata` `{slug}`|pending/complete；pending缓存10分钟，不能收到pending就宣布URL改变成功；轮询/超时/重试独立。|
|环境写入|POST `/websites/{id}/environment`|`{remove:[key],set_values:[{is_secret,key,type:"envvar",value}]}`，源调用无推测性revision字段。未变stored secret不写`<REDACTED>`，转换公开前必须新值。|
|域名写入|POST custom_domains `{hostname}`、POST `/{domain}/refresh`、DELETE `/{domain}`|返回真实CustomDomain；active更新项目缓存；未发布错误单独说明；DNS服务给值，不写死。|
|共享写入|**PATCH** `/websites/{id}/share_access`|fresh `sites-share-query:h`，retry never；不是旧资料POST。action必须有合法access_mode或从当前policy取值，admins_only拒绝；pending/accepted或明确null按原合同处理，undefined/其他status失败；串行scope、失败重读、保留pending语义。|
|转让资格|GET `/codex/sites/projects/{id}/owner`|476199071+1664214667、workspace、真实owner；404→can_transfer_ownership=false，其余错误不冒充无能力。|
|转让写入|POST同owner路径 `{owner_account_user_id}`|fresh `dialog-d57ef6c44cae.js`；同工作区候选，自己不可选；未保存先flush/阻止；400/404/409真实错误；成功自己保留editor并导航共享、失效owner/目录/共享策略。|
|访问请求|GET/POST `/websites/{id}/access_request`|真实token绑定project，GET query token/POST bodytoken；400/403/404/410不再可用，其他失败重试；不是直接写任意分享。|
|永久删除|DELETE `/websites/{id}`|输入非空精确slug确认，服务success必须true；后续清目录/pins/详情/环境缓存，不能只移除React卡片。|

summary原字段：id/title/slug/updated_at、description nullish、status active/archived/suspended/deleting、live_url nullable、hosted_url nullish、screenshot_url nullable、latest_edit_context、disabled_by、current_user_role、owner、sharing（access_mode/user_count/group_count/**counts_available**）、**is_pinned**。initial `FNi`将sharing转换camelCase。MCP详情是current_live_url/current_preview_url/latest_version_number等另一shape，`ONi`才转换摘要，不能混用。

环境schema另有requires_secrets。自定义域名包含真实CNAME/A/validation_records/ssl/provider/last_error，不仅hostname。转让候选 `use-workspace-users` 150ms trim debounce，GET `/accounts/{account_id}/users` limit10/offset0/query，15秒取消边界；空查询不读，当前用户排除（dialog函数），不是全局搜索账号。

## 创建、编辑和发布：必须恢复完整真实工作流

primary **`k5n`**（真实export tv）被新列表Qt使用：

- create切Work，使用真实Sites插件来源常量及结构化mention序列化，中文“使用 {sitesMention} 创建新网站”，带尾空格预填新会话/sidebar。**不立即发送、不创建本地ready资源、不自动部署。** 插件ID必须沿sf真实常量解析，不凭显示名拼接。
- edit导航`/sites/{projectId}/edit`并传accountId/userId/projectId/projectTitle/latestEditContext/prompt/liveUrl及现有state。`site-edit-route:Be`检查链接account_id、真实当前身份、模式、host/thread；错账户显示切换说明，未激活站点退回，不偷换账户。
- 恢复真实ChatGPT conversation或Codex host/thread；不可恢复才真实预填包含站点mention的编辑请求，保留prompt，不仅传标题。失败重试/回站点；关闭取消晚结果。
- publish切Work，真实站点mention与Sites插件mention组成中文“{siteMention} 发布此站点”预填，保持待用户提交。首版发布仅owner，不能绕过菜单禁用状态。
- 预览只用真实live/preview URL。`appgen-site-view-page:C`读取preferred live；无地址显示错误重试和可用外链；supports_chatgpt_preview=false只外链。认证截图需response派生opaque资源读，不给renderer任意图URL；资源撤销/切号旧图片也要清除。
- 页面存在真实详情版本号、preview/live URLs和工具部署tags，但本轮**未证明**一个独立部署历史/回滚REST端点。不能把ChatGPT `/conversations/{id}/versions`当站点部署版本，也不能根据无匹配说远端完全不存在。模型发布/部署结果需连接器完整合同与真实授权服务补证；仍在整页目标中，不从计划删除。

## 设置保存、删除和子页的动作合同

名称max100，900ms debounce，composition start暂停、end重新计时，Enter排除isComposing/keyCode229，blur提交；trim空名不写。title与environment各自保存状态与队列，账户/用户/site绑定的autosave pending不因切页或并发而丢失；失败保留草稿，显式重试，不用toast证明落盘。环境键空/重复、stored secret改公开缺新值均阻止；删除变量有独立破坏性确认；地域requires_secrets/invalid_secret_name/区域限制错误分别呈现。

删除站点dialog警告永久下线及用户数据删除，要求输入精确slug（`site-delete-confirmation:c`不trim后冒充匹配），pending防重入、阻止关闭；失败保留确认文本并重试，成功重读/清缓存。

数据库真实MCP `sites.get_database_overview`及`get_database_table_rows`，绑定、表、limit25/offset/has_more；rows可能在result._meta `openai/sitesDatabaseTableRows`。分析/日程/插件均有独立lazy页及真实服务，不能用静态指标、空数组或复用本地任务页冒充。`page-6e7b33d09a28.js`、`page-de03b33fc838.js`及其依赖已fresh提取；复杂子页需要后续独立完整动作表/验证，不以存在chunk宣称实现。

## 当前源码差距与保留项

本轮读到 `SitesView.tsx/.css`、`sitesService.ts`、`chatgptService.ts`及Rust固定路由，hash见implementation-baseline.json：

|当前真实能力（保留）|未对齐/缺失|
|---|---|
|固定认证桥、真实access/list/shared/detail/environment/domains GET，取消和身份generation|缺总入口`/codex/sites/access`和官方gate；当前仅sites_access映射`/backend-api/websites/access`。监听promise失败未显式处理/未等待确认即读取，应补回归。|
|owned/shared后备、limit20、300ms workspace搜索、后页保留错误、all去重倒序|缺pinned；all无条件显示、tab不跟URL、fallback未过滤owner、循环只防相邻重复cursor。|
|真实service状态、安全外链、不拼codex.app、不用localStorage站点假数据|缩略图/owner/sharing/latestEditContext/is_pinned被parser丢弃；主动作不符合编辑/访问条件；条款说明、插件能力缺失。|
|真实只读详情、project身份匹配、域名错误和secret遮蔽|目前原生dialog+手动“读取域名与环境变量”，与真实route完整设置/子导航不同；列表/grid字体、宽度、breakpoint和按钮均未对齐。|
|视图偏好官方键，离页/切号abort|缺真实创建/编辑会话mention、首次发布/模型执行结果、全部设置写链、分享/转让/删除/pin、analytics/database/plugins/automations工作面。|

旧21文档第7节说DEFAULT_SITES/Date.now伪部署仍在是历史修改前观察，**当前源码已不含这些假实现**。本阶段不能重复删除真实能力或宣称整页从零占位。

## 可实施顺序与逐动作验收

1. **资格与模型**：独立读取真实总入口gate与codex/sites/access，保留列表capability分支；恢复summary/context/sharing/pin/screenshot元数据；监听失败、身份变化晚到、不可用不能发后续读。证据：生产函数失败回归→修复→wrapper固定路由/取消/身份测试。
2. **列表工作面**：公共sticky/search布局、条件tab/URL/list-grid、官方row/card/共享/owner/未发布、真实opaque图片。保留分页；测试同ID多页、A→B→A cursor、页中断、搜索切换/后页失败/首400仅fallback、520/720容器及宽窄实际DOM几何。
3. **主动作与详情route**：创建/编辑/发布结构化mention预填、当前账户/线程/host上下文和回退、访问预览、真实settings route。用离线真实类型回放验证不自动发送；真实模型/发布服务必须另验，不以bridge mock成功冒充。
4. **明确的远端写链**：先pin，再标题/环境autosave、slug pending/轮询、域名、PATCH共享及转让、永久删除；每步先验证失败/未知结果/并发与读回。敏感值不日志；用户正常操作才发写，回归仅隔离fixture不改真实账号。
5. **详情子页和完整发布**：analytics、database、plugins、automations、模型发布/部署/preview及账户/gate各独立合同和测试，不从整页范围省略；缺连接器执行授权时留真实阻塞与可验证余项。

|ID|操作|必须证明的结果|
|---|---|---|
|S-E01|gate未知/false、service失败/false/true|loading/unavailable/available区分；未知不读列表，不把错误转空。|
|S-E02|独立/collection、共享/置顶gate组合，URL返回前进|tab数量、中文、URL/search与选中完全按分支；不可达tab不残留旧数据。|
|S-E03|owned/shared/pinned首屏与多页；错/重复cursor|真实参数/过滤/排序，已完成页不重读，失败保留条目，取消无晚覆盖。|
|S-E04|300ms共享搜索输入/清空/切号、中文IME|首请求可取消、后页不重复delay；query/header/identity正确，旧图/旧结果不泄露。|
|S-E05|owner/editor/viewer与suspended/unpublished|主点击、menu enabled、首次发布owner限制、sharing与tooltip符合官方条件。|
|S-E06|创建/编辑/发布、错误账户、旧线程不可用|真实mention/state恢复，失败重试/返回；预填不自动发turn，不插本地上线记录。|
|S-E07|标题900ms/blur/Enter/IME、同时改环境并切页|输入不丢、单飞/排队、失败保留，真实成功再读回；已存秘密遮罩不写回。|
|S-E08|slug pending/complete/超时，DNS pending/active/failed|真实中间态、轮询/重试、DNS指引来自服务；pending不视作发布成功。|
|S-E09|共享PATCH pending/accepted/undefined、转让400/409|方法/body真实，串行/权限/身份保护；失败重读不假成功，转让后角色及目录一致。|
|S-E10|删除取消/错slug/pending/失败/成功|取消零写；精确确认、重复点击一次请求；success:false失败，成功服务读回/缓存清除。|
|S-E11|真实子页、发布/部署结果|服务数据/错误/权限和对应渲染一致；不把普通会话版本或固定计时器当部署。|
|S-E12|640/1280+宽窗、菜单/长标题/滚动，当前Tauri|截图/DOM/焦点/Tab/Escape/中文IME、无横向溢出；官方同环境配对差异≤1物理像素，缺配对不得评分通过。|

所有阶段最终需要当前源码对应构建、完整标准、受影响公共组件回归、原生实际操作与用户验收。静态资料/离线fixture通过只证明该层，不等同真实账号或1:1。未完写链与深层页面仍保留在完整目标中。
