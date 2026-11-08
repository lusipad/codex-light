# 22F 云端环境创建与编辑

基准为 Windows Store 26.1027.3384.0，asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。本轮核对同一包头、22E 原始资源和新增切片。95 个页面锚点、456 条中文键记录、远端宿主 44 个精确锚点及 12 组原函数回放保存在 `.ref/parity/22/actual/22F-cloud-editor/reference/`。偏移以 UTF-16 从零计数，右端不含。真实账号、官方界面和像素验收待做。此前只读入口见 [22E](22E-cloud-environments.md)。

| 用例 | 官方入口与结果 | 实现前验收 |
|---|---|---|
| F01 | ASB 设置的创建入口。按资格和体验 gate 打开仓库选择或直接开始设置。深链只接受证实的参数形式，关闭回退校验身份与来源。 | 分别验证无权限、加载、正常、深链、回退和账号切换。 |
| F02 | 仓库选择读取 WHAM 仓库与 GitHub 安装，搜索去空格、200ms，支持分页。选择真实仓库 ID 和默认分支。 | 搜索、分页、取消、连接断开、去重和选择后提交参数。 |
| F03 | 新建真实环境配置和草稿，取得真实 `thread_id`，恢复远端会话再启动 onboarding。 | 记录真实 config/draft/thread 回执。覆盖超时、重复点击、身份变化、配置已建但会话未启动和未知写入。 |
| F04 | 设置列表有权用户点「编辑」或「继续设置」，经 createDraft 进入远端聊天并打开设置侧栏。无权用户点「查看」，进入只读配置。 | 验证权限与创建回执、`thread/resume`、侧栏参数和关闭焦点。覆盖 404、权限变化、未知结果、重复点击。 |
| F05 | 侧栏按配置与权限展示字段。先提交 VPN 与值，再 PATCH 配置，最后 PATCH 元数据。部分成功保留真实回执。 | 逐字段保存、重开读回，校验 revision/base、验证错误聚焦、账号切换。repo 应用消息失败只恢复消息。 |
| F06 | 发布从审核入口发起，begin→按真实 operation 轮询→complete，按实际 revision 回读。 | 验证一次操作、失联续查、失败、审批中及冲突状态。隔离账号实测真实发布需具备相应授权。 |
| F07 | 同一 Windows 环境中的创建弹窗、设置聊天、侧栏和发布状态。 | 配对截图、窄窗、Tab、Escape、焦点回返、中文 IME 和用户验收。 |

原始 UI、HTTP schema 和请求顺序见证据目录的 `contract.md`。F04 正常编辑走远端会话侧栏。已有列表的只读查看入口继续承载详情。Legacy 环境走独立 WHAM 路径。

OpenAI Docs 记录了在桌面 App 选择云端环境、进入设置聊天、保存草稿、发布，以及从现有环境的菜单编辑并重新发布的产品流程。固定版本的入口、权限和请求顺序以本轮 asar 取证为准。[创建和发布云端环境](https://learn.chatgpt.com/docs/environments/cloud-environments#create-and-publish-an-environment) · [编辑环境并复用状态](https://learn.chatgpt.com/docs/environments/cloud-environments#reuse-and-update-saved-state)

## 远端会话前置条件

原生 `early-bootstrap-491-e75c34fa1b2c0832.js` 的 `AO` `[1488988,1489115)` 固定 `durable` 主机。`eRQ/eRY` `[4081624,4084482)` 选择 WebSocket 并在宿主绑定登录身份。初始化及派发位于 `early-bootstrap-339-096ec1020e8592e0.js`，传输位于 `early-bootstrap-824-e56448c7829c41c2.js`。原文件哈希、请求能力字段和逐锚点定位见 `durable-rpc-contract.md`、`durable-rpc-replay.json`。

公开 App Server 的 `--listen ws://` 是实验性的入站监听，配置认证后使用 `Authorization` 头。公开生命周期是 `initialize` 后发送 `initialized`。固定桌面包的 `durable` 连接则使用原生 WSS 子协议认证，源码中核实的是初始化完成后的宿主事件。远端验收应独立采证线上帧，不能把两条路径混作同一个握手。[App Server 协议](https://learn.chatgpt.com/docs/app-server#protocol) · [生命周期](https://learn.chatgpt.com/docs/app-server#lifecycle-overview)

1. 宿主取得当前账号的有效凭证，核对 account、user 和 generation。固定安全连接地址，按证实的顺序发送认证子协议，凭证留在原生宿主。环境配置 HTTP 与远端会话分开。前端没有透传 URL、头或任意方法的入口。
2. 单飞初始化，匹配 `__codex_initialize__` 回执，30 秒超时。Windows 会公布接收证明请求，平台分支返回协议定义的不可用回执。区分初始化成功、连接成功与设置会话已恢复三个状态。
3. 用 config/draft 绑定真实 `thread_id`。按官方序列化恢复会话，通知只来自当前连接和当前身份。连接关闭时结束待处理请求，忽略已退役连接的回执。未知的变更请求通过明确读回恢复。
4. WinHTTP 是当前不引入依赖的 Windows 传输候选。Rust 回环编译及实测通过 101、认证子协议顺序、跨帧 UTF-8、恢复请求与通知交错、阻断 307 跳转、关闭、读超时和取消。不受信任的回环证书得到安全错误，服务端记录零 HTTP 升级。Windows 文档的 WebSocket keepalive 最短 15 秒，固定包的 ping 为约 10 秒，需单独验证连接存活表现。真实服务 TLS、实际协商、代理与云端身份仍待验证。[WinHTTP 并发规则](https://learn.microsoft.com/en-us/windows/win32/winhttp/concurrency-in-winhttp) · [选项文档](https://learn.microsoft.com/en-us/windows/win32/winhttp/option-flags)

Rust 候选和复现入口在证据目录的 `durable-socket.rs` 和 `winhttp-loopback.mjs --rust`。WinHTTP 持有的收发缓冲区及回调上下文通过固定分配维持地址，session unload 确认回调终止后释放。候选区分正常关闭、未完成接收时的主动中止和读超时，独立关闭期限保留服务端关闭码与原因。协商接受已提议的子协议并拒绝重复头。迁入时由独占原生 worker 持有连接，身份退役在请求入队和事件派发时均需核对。初始化与恢复的 RPC 关联、真实凭证与应用入口尚未接入。[关闭状态 API](https://learn.microsoft.com/en-us/windows/win32/api/winhttp/nf-winhttp-winhttpwebsocketqueryclosestatus) · [响应头枚举 API](https://learn.microsoft.com/en-us/windows/win32/api/winhttp/nf-winhttp-winhttpqueryheaders)

先验证固定主机的隔离传输与身份退役，再接 F04 的权限、草稿回执、真实会话与设置侧栏。F01–F07 分开记录，当前状态为取证和实现准备。

## 原生草稿创建增量

`cloud_service_create_draft` 只接受 requestId、configId 和 expectedIdentity。复用宿主凭证、固定 ASB 地址和当前桌面 profile，发送无请求体的 `POST /v1/environment-configs/{configId}/drafts`。客户端权限入口仍待远端会话链完整后接入，服务端授权由实际服务执行。

派发前后读取应用网络策略、核对身份和取消。专用传输与外层等待均为 600 秒。回执保留真实 draft/environment/thread ID，thread 为 null 时保留回执并拦住再次创建。2xx 坏回执、服务错误、超时和派发后取消均保留未确认记录，不重放。明确 HTTP 拒绝可以重新发起用户操作。当前对 408 采用未知结果处理，与设置编辑原异常分类不同，待真实服务验证。

同一 account/user/config 的在途和未确认创建共用登记，身份代次失效时保留已派发记录，旧回调不会清除新记录。登记目前随应用进程保存，应用重启后的恢复尚待接入。已有 F04 创建回执、远端恢复、标题、聊天导航和设置侧栏仍需串联验收。

## 现有聊天链的接入点

当前 `bridge.ts::callAppServer` 经 `app_server_call` 到本地 stdio 管理器。`ThreadSummary` 没有聊天宿主字段，`ThreadProjectAssignment.hostId` 属于项目分配。App 的 `selectThread` 会调用本地 thread/read、resume、历史分页、附件及 goal；直接交给它草稿 thread ID 会使用错误宿主。

下一单元先建立原生 durable manager 与 host/account/generation 事件 envelope，再接聊天宿主分派。加载、发送、打断、引导、队列、模型目录与选择缓存均按宿主及身份区分。复用历史归一化、timeline reducer、消息渲染与 Composer。页面回调需从独立 CloudEnvironmentsView 和嵌入 SettingsView 两处送到 App，携带原生草稿回执；设置侧栏仍需实现。此顺序用于验证完整 F04，源码落点来自本轮独立只读检查。

## F03 配置创建传输验收

复用同版本 `pending-onboarding-actions:re` 和原生 `#e7`。原函数回放 `create-config-sequence-replay.json` 区分带仓库与空列表、连接超时零 POST、缺少草稿会话 ID、已有回执复用 GET，以及会话已显示但启动轮次失败。原生桥的根创建走 30 秒请求，后续私有草稿创建走独立 600 秒请求。

本阶段校验固定根 POST、仓库分支和默认网络策略、服务端配置标识、可空环境与会话标识、账号切换和重复请求。根创建响应丢失或畸形时，保留同账号的未确认登记，等待后续 UI 核对。此处没有服务端幂等键，测试不会以再次 POST 探测结果。前端仍需完成服务档位准备、持久化回执、草稿恢复和启动轮次之后才开放入口。

启动轮次的进一步取证见 `create-onboarding-payload-anchors.json`。`pending-onboarding-actions` 的第一段文本由仓库名称和分支的 JSON 加上共享常量 `## My request:` 组成。第二段来自服务端 skill、私有草稿的固定 skill 回退或本地化默认请求。这里的官方原函数隔离回放把共享常量替换为占位，最终实现以补充锚点和中文资源为准。

原生和前端桥均已接入。隔离回归验证空仓库和带仓库配置、重复仓库零请求、明确拒绝后可重试、异常回执禁止重复 POST、同账号身份刷新保留防重记录，以及原编辑草稿可独立使用。当前未确认登记保留于应用进程，跨重启恢复仍属下一阶段。670 项 Rust 全量、99 个前端回放入口和生产构建通过。真实服务、设置轮次和原生页面未验。

### F03 配置与草稿的重开恢复

固定版本 `re` 在解析远端服务档位后才写入，保存配置回执后才创建私有草稿。已知配置恢复走带配置 ID 及可用草稿 ID 的 GET。草稿创建缺失回执或返回空会话时暂停，不重复 POST。

- 同账号与用户的创建由同源锁串行。写入前保存发起标记，收到真实回执后覆盖标记。存储不可用时停止在写入前。
- 重开后，配置结果不明且没有真实 ID 时保留待核对。已知配置或草稿使用已知 ID 读取，只在返回身份相符时继续。明确 HTTP 拒绝可重试对应步骤。
- 已有线程和环境 ID 时可交给会话恢复。草稿 ID 可空，保留服务端原值。无线程的草稿可保留真实草稿 ID 供下次只读恢复，不生成会话。

创建协调器已经接通上述保存与只读恢复，保留现有编辑入口对空线程的拒绝。隔离回归覆盖并发继续、同账号重载、其他用户隔离、已知拒绝后仅重试草稿、异常回执与过期档位准备不写入。结果未知的根配置暂时没有可自动定位的服务端 ID，不能按同名环境推断。还需把协调器接入创建页面和设置轮次。

服务档位的原函数向量见 `create-service-tier-replay.json`。官方先读远端资格，再按当前档位选择或活动配置 profile 计算。模型默认的 `fast` 可解析为 `priority`；独立 `ultrafast` 与被组织禁用的 `fast` 分开处理。当前协调器接收可取消的档位解析回调并限制准备时间，未实现页面侧的实际档位来源。

### F03 档位和首轮设置传输

核对 `Ozs/kzs/Azs/Uh` 与共享 `tht/cht`。普通配置路径先读远端档位资格，再读不含配置层的远端配置，并按活动 profile 的非空字段覆盖根值。没有显式档位时从固定首个模型目录页按模型 ID 或默认模型计算。普通读失败可回落空档位；超时或账号变化禁止进入创建写入。

核对 `pending-onboarding-actions:re` 与 `app-initial:upn/fpn/Jfn`。首轮提交带真实会话 ID、客户端消息 ID、服务档位、模型与推理档、两段设置文本以及 `environment_onboarding` 触发器。宿主仅接收固定结构，不接受自定义指令正文或权限覆盖。启用产品入口前仍需接会话恢复、首轮发送记录、已发送核对与实际页面。

当前创建协调器已使用远端档位解析。首轮原生操作复用既有 durable 鉴权和回执校验，按真实 UUID 及会话校验回显。专项测试覆盖三种设置文本来源、拒绝任意正文、请求断开后只派发一次和正确回执。官方 `thread/settings/update` 与发送锚点见 `create-start-wire-anchors.json`。独立的后续会话设置写入、页面选择覆盖和发前档位复核仍待接入。

### F01 直接创建入口与首轮派发

当账号确认创建资格且启用直接创建体验时，环境列表以官方默认名和空仓库发起创建。已有待处理记录时继续原会话。真实线程、环境和配置回执交给现有 durable 会话页，私有草稿可恢复编辑，服务端直接返回的根配置会话只读。

会话恢复成功后，按真实状态等待空闲，重新解析远端档位，未命名时设置标题。首轮发送前记录 UUID。回执丢失时只从历史中核对同 UUID。实际浏览器隔离演练了按钮、空闲唤醒、回执丢失和重开核对，始终只有一次创建和一次首轮发送，见 `setup-entry-browser.json`。仓库选择创建分支、深链与会话后续回复仍待接入。本阶段未实测真实账号、Windows 原生界面或官方配对像素。

### 设置会话的文本回复

复核固定版 `Imn`、`Bmn.#n`、`Hmn` 和 `dOe`。普通文本使用 `composer` 触发器。忙碌时本轮实现官方存在的客户端队列分支，待空闲且最新轮次已正常完成后启动。未核实服务端队列准入时使用本地待发记录。中断后等待用户继续；写入后结果不明时按消息 UUID 或已确认轮次 ID 核对。

验证空白与输入法确认、活动线程零发送、空闲唤醒、取消未发消息、账号隔离、已确认与不明投递重开。当前范围为文本与一条本地待发回复。完整 Composer 的附件、引导、服务端队列和多条排队单独验收。

当前环境会话已接通文本回复。待发记录以账号、配置和线程隔离。打开仍有待发回复的环境会复用原线程。隔离浏览器演练了多行输入、忙碌零发送、空闲启动、结果不明后历史核对，回复只派发一次。1280×720 宽窗及关闭覆盖侧栏后的 640×800 窄窗均可完整显示输入区。截图和计数见 `setup-reply-browser.json` 与 `setup-reply-layout.json`。官方同条件截图、真实账号和原生输入法待验。

### F02 先选仓库再创建

固定包 `create-dialog-cabd9ed761bf.js:Ce` 在明确关闭直接创建体验时打开仓库选择。以首个仓库真实短名作为环境名，以仓库完整名展示，传真实仓库 ID 和默认分支。提交前取消、Escape 和无有效选择均不写入。对话框使用已核实中文文案、480px beacon 宽度及视口滚动，沿用现有连接、组织、200ms 搜索和分页读取。未知体验开关不自动选分支。

当前源码已接通。短名保留自服务的 `name`，缺失时可展示仓库但不能用作首项。编辑仍限 16 项；创建上限沿用当前原生请求的 100 项防护。隔离浏览器验证两次搜索的选中项保留，取消和 Escape 零创建且回焦，提交一次配置并进入设置会话。1280×720 和 440×800 下分别测得约 480px 和 405px 对话框宽度，均无横向溢出。证据见 `create-picker-browser.json` 与 `create-picker-layout-final.json`。当前使用项目表单控件，官方插画、GitHub 重连动作、真实账号、Windows 原生与同条件像素对照待验。

### F01 外部创建链接的新版证据

本机 Microsoft Store 安装已更新到 `26.1103.4239.0`。2026-11-08 实测包 SHA-256 为 `fb47d6491dc3006b708cb1e14de479b882bf50f88b7daa81818f154c253266aa`。本节使用该版本，前述已实现单元仍保留其原基准。文件哈希和 UTF-16 零基定位记录在 `.ref/parity/22/actual/22I-cloud-create-link/reference/manifest.json`。

- 主进程解析器 `early-bootstrap-339-ce026819bf837ba7.js` 在 1065186 附近接受 `codex://cloud-environments/new` 的目标和路径，要求空查询和空片段。同一解析器在 1064287 附近对 `https://chatgpt.com/cloud-environments/new` 另有分支，允许空查询或精确 `?utm_source=chatgpt.com`，并检查主机、凭据、端口和片段。这两种链接的入口分别验证，静态分支尚不足以证明 Windows 默认拦截 HTTPS。
- 主进程分派 `early-bootstrap-199-e3316cddb4ea6a6b.js` 在 4923686 将创建目标送至 `/cloud-environments/new`，没有附带页内来源状态。渲染层 `579232.e37e2cbf72.js` 在 1750 将精确跟踪查询规范化，其他非空查询或片段回首页。它等待就绪后检查账号、用户和宿主环境接口，再按体验开关进入直接设置或仓库选择。
- 新版创建路由的关闭逻辑仍区分页内来源。外部入口关闭回首页，页内来源只有在发起设置前且账号与用户均匹配时才返回原页。设置启动后关闭回首页。

开发前验收合同。分别覆盖冷启动与运行中收到有效 Windows 协议链接、无效参数零创建、主窗口才可消费、较新的导航覆盖待处理链接、重复链接不重复创建、账号变化与不具资格时零写入、仓库选择取消回首页，以及创建成功后使用真实会话回执。HTTPS 路由、真实账号和原生像素另行验收。

本阶段接通由应用启动参数交付的 `codex://cloud-environments/new`。原生侧拒绝带附加参数和非规范路径的输入，并复用主窗口的待处理队列。创建入口使用既有资格读取、仓库对话框和设置协调器，不加载环境列表。外部入口关闭回首页，已打开设置会话时忽略重复创建链接。账号失效会关闭入口并取消当前操作，已派发请求的回执核对由既有协调器负责。

### F06 私有草稿发布传输合同

复核 Store `26.1103.4239.0`。`19052.bfed17cb8e.js` 的 `wuQx.Px` 在发起前记下预期 revision 和幂等键，保存服务端 operation ID 后可继续查询。六组隔离原函数回放记录在 `.ref/parity/22/actual/22J-cloud-publish/reference/`。公开文档区分保存配置与发布文件系统。 [OpenAI 云环境说明](https://learn.chatgpt.com/docs/environments/cloud-environments#create-and-publish-an-environment)

原生请求路径来自 `early-bootstrap-199-e3316cddb4ea6a6b.js` 1984870、1985035、1982971，schema 来自 `early-bootstrap-133-1c544c3280919085.js` 的 17911 模块。先对已有可编辑会话的私有草稿接通 `POST …/drafts/{draftId}/approve/begin`、`GET /v1/environment-operations/{operationId}`、`POST …/drafts/{draftId}/approve/complete`。发起体只含预期 revision 与 UUID，完成体只含服务端 operation ID 和私有草稿 thread ID。

验收要求。验证固定主机和请求体、同身份与环境、拒绝异常 ID/operation kind、取消与账号变化、失败和运行状态不得触发完成、完成回执身份。完成前由原生重读 operation，仅在匹配且为 SUCCEEDED 时发送完成请求。POST 结果不明时返回待核对状态，禁止传输层自动重发。共享与旧同步分支、发布页面、持久化操作恢复和发布版本读回分别验收。
