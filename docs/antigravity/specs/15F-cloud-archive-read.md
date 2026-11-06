# 15F 云端归档只读扩展：开发前合同

2026-11-06。状态：只读调研完成，未开发、未运行HTTP/账号操作、未构建。范围仅设置归档的数据读取与资格、分页、错误和账号生命周期；不含恢复、删除、模型turn或其他云端写操作，不改变正在冻结验收的15E。

## 1. 固定来源与已证服务归属

Store `26.1027.3384.0`，asar固定SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。沿15E已逐entry核验并落盘的 `/.ref/parity/15/actual/15E-settings-archive/reference/{manifest.json,anchors.json,raw/}`；本次未重新整包hash，也未修改15E证据。代码定位均为0-based UTF-16字符偏移。

- `data-controls-805edc0381e3.js:8941` 的bn聚合本地host、durable、ChatGPT conversations、Codex cloud tasks，来源各有enabled/loading/error/nextPage。设置工作面资格与独立归档侧栏不能互换。
- `app-primary-998934e837fc.js:1718715` kDn：cloud task归档hook默认enabled=true，另要求当前账号ID非null；queryKey包括账号与可选搜索。设置bn调用时没有传search，因此使用普通归档列表，不是在输入搜索时发task搜索请求。
- `NDn:1719430`：`GET /wham/tasks/list`，`limit:20,cursor,task_filter:archived`。明确catch HTTP401/403/404后返回 `{items:[],cursor:null}`，其他错误传播。这是实际HTTP结果的来源专用策略，不能用于缺实现、未知资格、超时或取消。
- cloud task客户端Zx由app-primary导入app-initial `_lr`，其实际导出为 `M_`，与ChatGPT conversation的HTTP客户端相同。**不能因名称cloud就复用ASB cloud_service_read或云端环境的/v1/environment-configs服务。**
- `app-initial-4267e52fe5b0.js:5906558` z0i→NAr/PAr（`4487139/4487258`）：`GET /conversations`，`is_archived:true,hide_snorlax:false,order:updated,limit:20,offset`；`includeWorkCloud=false`时还传`exclude_conversation_origin:tpp`。下一页为实际返回`offset+limit<total`；响应items只保留有字符串id的项。
- `data-controls:8941`：ChatGPT来源仅选定host=local、ChatGPT归档基础资格s=true、authenticatedAccountId非null时enabled；includeWorkCloud是独立workCloud资格dvt。cloud task来源不是这同一判定。不得合并成一个cloudAllowed布尔值。

## 2. 当前代码能力映射

| 现有实现 | 应复用 | 明确缺口 |
|---|---|---|
| `src/chatgptService.ts:ServiceIdentity` | accountId/userId/generation，requestId，AbortSignal与cancel，responseBody核对回包身份 | 还没有归档operation或数据解码；body-only接口不适合隐去来源HTTP策略信息 |
| Rust `ServiceOperation`、ServiceRequest、resolve_read_route/resolve_route | 明确enum白名单、deny_unknown_fields、非法参数先于auth拒绝 | 缺归档tasks/conversations与归档资格读取；不能用现有任意operation夹带URL |
| `ChatgptService::read_with:1420` | session single-flight、prepare、token不跨IPC、expectedIdentity、generation、一次401刷新、bounded transport、response decode | 新operation需明确network policy、资格、源特定401/403/404行为，不能只加URL字符串 |
| Rust `CloudOperation::{List,Detail,Draft}` / cloud_read_with | 与归档不复用，仅保持原能力 | 该链是独立ASB credentials/云端环境服务；不承载本合同两个ChatGPT HTTP源 |
| `cloud_service_access` | 不用作归档资格 | 个人计划分支/incomplete是云端环境证据，不是Odt、local/workLocal/workCloud的完整判定 |
| `account_notifications` resolver | 有Odt/Adt计划集合、真实账号/路由验证等基础材料可在未来最小复用 | 通知个人账户限制不是归档限制；不得调用通知endpoint或要求personal来替代归档资格 |
| Rust invalidate/register/cancel | 现有invalidate递增generation、取消全部active、清session；取消先于register有有界登记 | 前端必须建立监听后再读，监听失败不能继续读旧身份 |
| `lib.rs:69`、`app_server.rs:843` | account/updated失效service并发chatgpt-service:invalidated；连接生命周期已有失效路径 | 当前页面仍需scope/epoch防止A→B→A、同账号不同generation的晚到结果 |

HTTP使用现有ChatGPT credentials.origin以及固定`/backend-api/...`路径、ServiceProfile、路由与integrity处理；不接收renderer提供baseURL/token/account header、任意URL或HTTP方法。正常新读取应复用已有profile校验和网络许可检查，在发请求前及回包后核对当前context。不能因为是只读绕过network policy。

## 3. 最小只读API合同（建议实现，尚不存在）

优先扩展现有ChatGPT service白名单，不新建一套网络栈。建议两个明确GET操作：`archive_cloud_tasks`、`archive_chatgpt_conversations`；命名可遵现有风格，但不能复用`cloud_service_read`。只开放每页读取，聚合和load-more放在页面资料层，避免后端一次读取无限页。

| operation | renderer可提供 | Rust固定/校验 | 回包 |
|---|---|---|---|
| archive_cloud_tasks | cursor:string或null | 固定GET /backend-api/wham/tasks/list，limit20，task_filter=archived；cursor按opaque值URL编码；拒绝未知键/控制字符/超限长度 | items、nextCursor；明确来源ID，当前identity。终止HTTP401/403/404的兼容空需保留状态元数据，不能吞其他错误 |
| archive_chatgpt_conversations | offset:非负整数 | 固定GET /backend-api/conversations，limit20、order=updated、is_archived=true、hide_snorlax=false；exclude tpp由后端可信workCloud判定，禁止renderer传includeWorkCloud=true来强开 | items、实际offset/limit/total、nextOffset，当前identity；格式错误/无前进分页为错误 |

参数长度、整数上限需按现有路由约束选合理防护值并记录为本地限制，不能宣称包内证明了某个未观察上限。cursor不得手工拼query；offset+limit需防溢出。列表不是ThreadSummary：保持`source:cloud-task|chatgpt-conversation`及真实ID，projection复合key隔离同名ID；严禁将两种cloud ID传本地thread/unarchive或thread_delete_archived。

返回应保留HTTP来源状态（例如success / official-http-empty）与内容，而不是前端把抛错统统转空。名称只是建议；可沿现有ServiceResponse.status与受控解码保留，不为一个页面造通用结果框架。后端token、integrity和原始auth payload仍不得进入结果/日志。

## 4. 资格：可以落实与必须保留未知

需要一个当前身份范围内的归档来源资格快照，而不是UI猜测。每个来源至少区分allowed、denied、loading、error、unknown/unimplemented；denied与未测/缺实现不能同归空数据。

**cloud task最小子阶段**：官方hook只见账号ID要求，无额外local/workCloud资格条件；可先实现稳定ChatGPT身份下的真实只读task列表与明确HTTP策略。未登录时不要发列表HTTP，页面保留“该来源未启用/需登录”状态；不声称调用成功零项。当前getAuthStatus的chatgptAuthTokens分支与官方页面账号ID是否同样存在仍需fixture/真实只读观测，不能只凭能取token断言工作面可见。

**ChatGPT conversation研究进展**：[15G资格研究](15G-archive-eligibility.md)已补齐Odt、真实账户字典与宿主surface来源：同版宿主固定supportedSurface/workCloudSupportedSurface=true；Odt使用当前可用账户inventory的plan及当前认证账号匹配，不要求personal。ev存在的官方debug override不能仿造。不能只用accountRead.type/plan或通用CloudAccess替代该资格快照。

15G已从固定函数证明可实施分支：free/go的includeWorkCloud明确为false，无需额外gate；plus/prolite/pro/promax取当前身份完整bootstrap的gate1625797156；组织计划由gate1463309241选择beta_settings.wham_local_access或admin_work_mode_enabled，两字段相同时不依赖该gate。已有可信Statsig bootstrap与accounts/check传输可复用，组织settings需新增固定只读操作。当前缺口是尚未接入这些已取证输入及conversation读取，不是必要条件无法确定，也不能长期用unknown缩小目标。

当前15F阶段仍保持conversation来源unimplemented/unknown且不发conversation HTTP，直至相应资格与读取接线、回归完成；这是实施边界，不是官方资格拒绝结论。后续按15G依次落实free/go、付费个人、组织分支。只有本来需要的当前账号gate/settings尚未取得时才保留该分支unknown；不得随意把includeWorkCloud默认false漏掉tpp，也不得true强开。free/go经真实Odt确认后的false是已证正式分支，不应误标为缩减适配。

账号基础材料可复用现有resolver的纯计划/身份校验，但不得继承通知专用personal过滤；组织计划不能因此被错误拒绝。workspace设置与gates沿15G的必要字段建立明确只读合同，不顺手开放任意远端服务。静态取证与函数组合验证已完成；当前账号live gate/settings、接线与真实只读集成尚未验证，分别记录。

## 5. 分页、聚合、来源错误

1. 首次并行启动各已allowed来源的第一页，本地归档保持现有全cursor读；task与conversation保留各自nextPage/loading/error。纯本地已成功不代表全聚合成功。
2. task按照opaque cursor；conversation按返回offset/limit/total。相同cursor、offset不前进、无效items/total应明确失败，不能静默截断称全量。页内/跨页同来源同ID可去重，其他来源同ID不得合并。
3. “加载更多”各来源独立推进，已成功来源保留；一个失败不取消其他成功来源，也不把部分结果显示为完整“全部”。重试仅针对失败页且与当前身份/查询相同；重复点击只发一个相同页请求。
4. 设置官方task hook未传search；15E本地搜索先继续明确兼容规则，不能擅自加入/wham/tasks/search作为本合同要求。后端返回的完整items与前端当前搜索/排序分离，筛选不损坏分页集合。
5. task最终HTTP401/403/404按NDn专用处理；conversation相同状态仍是该来源错误，不能全局吞掉。取消、unknown资格、请求未实现、invalid_response、network denied、429、5xx均不得空成功。当前read_with的一次401刷新是既有传输行为，不能顺便修改全service重试；具体task“终止HTTP-empty”发生在受控刷新之后，并记录该平台适配边界。
6. 所有来源确实完成且都为空才可用完整空态。存在unknown/denied-unavailable/error/未实现来源时，仅可说本地/已启用来源无数据，并显示来源边界；不得“暂无云端归档”。错误文案先沿当前可信通用服务错误，官方语言包仅在语义相同处复用。

## 6. 取消、账号切换与验收（零真实HTTP的前置回归）

| ID | 成功条件 |
|---|---|
| AR01 | 未知operation、额外URL/method/includeWorkCloud、非法cursor/offset在auth/transport前拒绝；允许操作只生成固定GET、固定archived条件和编码query |
| AR02 | 传输fixture证明两类请求都走ChatGPT服务，不走ASB；ServiceProfile、account header、network policy和限时/大小保护保留；token不进入IPC结果 |
| AR03 | task两页+conversation两页各自进度；重复游标、倒退offset、坏响应报来源错误；跨源相同ID保留两条；不凭固定页数宣称已读完 |
| AR04 | task最终401/403/404与普通空成功可区分，其他错误不空；conversation401/403/404不套task策略；IP/network拒绝不当作无数据 |
| AR05 | 资格unknown/denied/loading/error零列表HTTP；Odt账号匹配/计划/加载不同分支；notification personal资格和CloudAccess不能放行或误拒归档 |
| AR06 | 请求前取消、等待session锁时取消、HTTP中取消、响应后取消均不落页面；cancel-before-register与late-listener disposers回归 |
| AR07 | A→B、A→B→A、同accountId不同userId/generation、切host/断连/重连：旧成功和旧失败均不能污染新页；清旧items/cursors/error，查询恢复从新身份第一页开始 |
| AR08 | listener任一注册失败清已完成与晚到订阅，禁读并提供重试；重试注册成功才重新resolve身份；参考现AccountNotificationSettings修复，不在gap中盲读 |
| AR09 | 一个来源失败、一个成功、一个unknown：保留成功列表及各自状态，重试不重复成功页；全部完成前不显示完整空、完整数量或“全部读取成功” |
| AR10 | 本阶段新增列表路径仅固定GET，不出现远端变更、thread/unarchive、模型turn；点击排序/筛选不触发写；全部fixture使用隔离transport与RPC，无真实账号HTTP。后续15G资格可复用既有语义只读Statsig bootstrap POST，不能将HTTP方法单独等同于产品写入 |

完成本地回归后，再单独安排用户可审阅的真实只读集成与原生生命周期检查，明确记录账号能力与实际HTTP结果。静态文件存在、fixture通过、构建通过均不能代替真实资格/可调用性或像素验收。15F未包含云端mutation，相关按钮必须继续保持明确不可用，不以模拟成功替代。

## 15F-A UI动作合同（开发前，2026-11-06）

仅设置入口接收真实只读hook状态，global不运行/消费新来源。cloud task与本地线程同组、同三排序、同搜索投影，row key为source+id；task只使用显式projectless/assignment归属，无cwd/hint推断。task标题为非导航span，云图标，日期环境label按hn/gn和中文dateTimeWithEnvironment资源；只读阶段取消归档禁用并说明原因，不出现本地删除/恢复调用。

来源状态各自呈现：本地失败不阻止已有任务列表，任务失败不抹掉本地；云端/all提供任务刷新、页错误重试/加载更多，local不显示云端故障。签出/非ChatGPT/监听失败不能显示空成功。任务列表即使ready仍不包含资格未知的ChatGPT会话来源，必须明确来源边界；游标未尽只能显示已读取数量，不能声称全部。排序/搜索只投影，不发写；本地全删始终原完整本地集合。

UI生产回归先红后绿覆盖：跨源同ID独立、显式项目归属和无hint猜测、三排序/tie及更新依赖、环境搜索、云端错误与本地部分成功、签出无空计数、页错误重试/加载更多、task无本地mutation，以及global既有行为。
