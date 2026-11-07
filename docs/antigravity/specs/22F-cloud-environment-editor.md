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
