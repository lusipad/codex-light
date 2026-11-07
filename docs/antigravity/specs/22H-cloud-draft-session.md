# 22H 云端草稿会话恢复

承接 [22F](22F-cloud-environment-editor.md) 与 [22G](22G-durable-host.md)，继续完成 F04 的真实编辑入口。已复核当前安装的 Windows Store 26.1027.3384.0 和 674,296,148 字节 asar 整包 SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。6 份新增源、111 个精确锚点和 33 组原函数隔离回放保存在 `.ref/parity/22/actual/22H-cloud-draft-session/reference/`，当前处于开发中。

## 修改前合同

现有环境的编辑入口创建真实草稿，保存 config/draft/environment/thread 回执，导航真实聊天并要求打开设置侧栏。该路径不能套用新建环境 onboarding 的自动发起 turn。恢复调用不携带伪造线程 ID，不经本地 CLI，不把路由内部名当成实际宿主。

| 用例 | 成功条件 |
|---|---|
| H01 | 按官方现有编辑链的精确顺序读取并恢复真实远端 thread；最终参数来自原函数回放，保留服务端权限默认值。 |
| H02 | 创建成功而恢复失败时保留同一回执，只重试恢复，不再次 POST 创建草稿。线程为空或创建结果未知继续阻止重复写。 |
| H03 | config/draft/thread 与 account/user/generation 绑定。旧账号、旧导航、旧连接的返回和通知不能覆盖当前状态。 |
| H04 | 加载与历史分页按 durable 宿主派发。真实模型目录及选择缓存不与本地同 ID 会话混用。 |
| H05 | 设置独立页面和嵌入设置的编辑入口均打开同一个真实聊天及侧栏，加载、错误、重试和关闭焦点有可观察结果。 |
| H06 | 完成适用原生、宽窄和键盘检查。缺少官方配对图时保持像素未验证；真实云端账号与模型任务另行验证，不用隔离样本冒充。 |

## 实现边界

原生 IPC 只开放经取证的固定动作和参数，不允许任意地址、凭证或 RPC 方法透传。每次请求复用 22G 的身份、网络策略、取消与通知准入边界。恢复不等于 turn 启动成功；审批、工具与 elicitation 未处理前不开启发送。

## 已核实的恢复和历史边界

- 现有编辑走共享恢复 hook。`Ndn` 先发送 `thread/read`，`includeTurns:false`，准备配置后并行读取历史和恢复。最终 `thread/resume` 带 `model:null`、云端 `excludeTurns:true`；不会直接发 hook 的 `reasoningEffort` 和 `collaborationMode`。派生 tier 为 undefined 时省略、null 时保留 null。
- 未显式指定权限时 durable 保留服务端默认权限。原函数回放覆盖 gate `4226282475` 的 true/false，两种都省略恢复请求中的 `approvalPolicy`、`sandbox`、`permissions` 和 `approvalsReviewer`。不能借用本地 Windows cwd 和沙箱配置。
- 普通云端历史先发 `thread/turns/list`，首屏 `cursor:null`、`limit:5`、`itemsView:'notLoaded'`、`sortDirection:'desc'`，随后用 `thread/items/list` 分页补实际内容。受限模式的 turn 与 item 上限不同。仅取 turn 元数据不能显示为无历史。
- 草稿关联存于 renderer 的身份限定配置记录与聊天状态，按 config/draft/thread 核对侧栏 GET。配置准备调用和字段来源已录入证据目录 `config-preparation.md`：正常 F04 用当前 durable 的配置缓存，按非空 tier 条件读 requirements，按身份和 host 准备实验值及开发者指令。接入时不能复用本地模型偏好的 Windows 路径、profile、沙箱、MCP 或工作树覆盖，也不能把空配置和新建 onboarding 参数当成现有编辑的实现。
- 原始 `PZ` 按 thread ID 更新 `environment-setup-server-configs-v1`，保留最近 100 项。重进时核当前账号和用户；当期 generation 用于阻止晚到事件，不能把历史 generation 当成跨重启身份。已有编辑在关联后发起标题更新，未等待结果即导航；现有编辑没有新建 onboarding 的 `onlyIfUntitled` 选项。
- 侧栏消费匹配聊天的 `openEnvironmentSetup:true` 并请求显示和焦点，不要求工作区已就绪。侧栏的真实草稿配置加载、标题更新和聊天恢复可交错；最终焦点、关闭和窄窗表现单独取证验收。

## 已实现的回执和恢复参数适配

`src/cloudDraftBindings.ts` 提供已确认回执的持久绑定，以及用同账号、同用户读取实际私有草稿的适配。GET 复用现有 `readCloudService` 和 `parseCloudDetail`，核对配置和草稿 ID；活动请求继续使用当前身份代次和取消信号。历史记录不保存代次或凭证，读取失败可见，写入失败返回给调用方以便保留已确认回执。未接编辑入口，尚不具备完整的 F04 恢复、重试、侧栏和焦点行为。

`node scripts/verify-cloud-draft-bindings.mjs` 从缺失实现失败到通过，覆盖最近 100 项、同账号跨代读回、不同账号或用户拒绝、正确 GET、错 ID 和晚取消。原有云环境组件回归、TypeScript 检查和前端构建通过。新增回归已登记到标准及发布检查入口；本增量未纳入 preview.11 标签。

`src/cloudDraftResume.ts` 负责普通 durable 分支的最终参数序列化，输入必须是已解析的 metadata、偏好和配置结果。保留服务端权限，区分 tier 省略与 null，并处理空覆盖及复用 idle thread 时省略指令和 config。原始 Ndn 的 6 个 gate×tier 输出与产品参数逐对象匹配。证据为 `source-wire-comparison.json`。

## 原生协议与历史聚合

`cloud_service_thread` 使用固定操作派发 `thread/read`、`thread/resume`、`thread/turns/list`、`thread/items/list` 和恢复所需的两种配置读取。连接复用模型目录的认证、网络策略、取消和身份代次校验。恢复请求保留 `null`，拒绝本地 cwd、权限覆盖和未证实的配置键。原生配置读取仅返回当前准备逻辑需要的偏好与速度能力。原生会话响应核对 thread ID，包装的 item 核对 turn ID。

`src/cloudDraftHistory.ts` 通过真实 IPC 适配层读取两级分页。支持直接和包装条目，保留完成状态及时间戳，按时间正序返回并去重，记录每轮较早游标，拒绝重复游标和错误宿主。当前覆盖普通私有会话的快照，通知缓冲、实时合并、opening user message 补查、超大消息降页和特殊线程分支仍需集成。

Windows 回环覆盖同一连接上的模型目录、会话读取、恢复和历史请求。全库 Rust 通过 652 项。随后按 Mun 和 339 宿主封装修正 `configRequirements/read` 的无参数形态，最终 24 项 durable 专项复验通过，其中回环断言线上请求省略 `params`。前端 95 项回归和生产构建通过。证据在 `.ref/parity/22/actual/22H-cloud-draft-session/verification/`。

## 创建与恢复流程

`src/cloudDraftSession.ts` 通过原生创建接口取得回执，校验账号与请求，保存绑定后发出标题更新。调用方可在标题请求完成前取得会话，存储失败时仍可持有确认过的回执。无有效 thread ID 的回执产生未确认错误。

恢复流程先读同一 durable 线程的 metadata 与偏好，然后使用调用方的配置准备结果，并行发起历史和恢复。按 Ndn 的顺序先等待恢复结果，再收取历史结果。已发出的恢复请求超时才可按 120、240、480 秒期限重试。收到当前线程的关闭错误时，按 750、1500、3000、6000 毫秒等待，随后重试。取消终止等待，恢复和重试沿用已确认的 thread ID。Windows 回环验证错线程的关闭信息保持普通远端错误，前端验证了标题异步处理、取消及无重复创建。

运行时配置和指令提供方、聊天编辑入口与侧栏仍在开发。真实云端恢复和像素对照待验。本增量留待编辑流程接通后再纳入发布。

本轮全库 Rust 653 项通过，含已派发恢复超时分类和 Windows 回环标题及关闭错误回执。前端 95 项回归及生产构建通过。`verification/session-full-rust.log` 和 `verification/session-frontend.log` 保留此次结果。

## 普通环境编辑入口

独立环境列表和设置内嵌列表的有权菜单可创建草稿。创建期间拦截重复点击，确认后传入真实回执，进入独立的 durable 聊天路由。账号失效会取消进行中的读取并清除路由状态。原生快捷键仍可导航和缩放，当前云端页的发送、终端、工作树和线程操作与本地线程隔离。

普通恢复准备从 durable metadata 取得 path 和 cwd，从同一宿主的配置读取取得 personality，沿用取证中的普通分支和服务端权限。当前覆盖新草稿的无显式 tier 入口。完整开发者指令、模型代理与实验覆盖仍待接。侧栏并行读取绑定的私有配置，复用环境字段展示，支持关闭、焦点返回和读取重试。窄窗使用全宽侧栏并隐藏背后的聊天区。

页面当前可恢复会话、查看文本历史、加载更早的轮次并查看绑定配置。已确认草稿的界面重试沿用相同 thread ID。会话发送、非文本历史卡片、实时通知合并和跨重启从聊天列表重进仍待接。

隔离验证覆盖 14 项环境组件场景、实际 App 快捷键派发、首次恢复失败后重试、配置先于会话恢复显示、历史分页及 Escape 焦点。1280×800 和 440×800 的浏览器视口无横向溢出。`verification/browser-result.json` 保留完整视口测量，`cloud-draft-wide.jpg` 是完整宽窗截图，`cloud-draft-narrow-cropped.jpg` 只有 440×275，仅用于查看局部。浏览器使用明确的隔离数据边界，当前没有官方配对图、真实账号和原生 GUI 验收。

阶段构建通过前端生产构建、95 项前端回归、收尾后的快捷键派发与环境菜单专项以及 Windows debug 构建。原生候选位于 `dist-artifacts/cloud-22H-entry-20261107/CodexNative.exe`，SHA-256 为 `c9fae72da16f9adb8529075d989f5bf84cdc0e79d84983e2b8c981c20aa6f0e4`。阶段仅本地提交，发布验收仍待后续交互闭环。

## F05 安装脚本与启动技能

固定版本的 `vHn` 与原生配置 wire schema 证据位于 `.ref/parity/22/actual/22F-cloud-editor/reference/`。保存使用私有草稿固定路径 `PATCH /v1/environment-configs/{configId}/drafts/{draftId}`，携带 `base_version_id` 和 `expected_revision`，按实际差异发送 `install_script` 与 `start_skill`。清空发送空字符串。正式版配置、元数据与发布仍属后续范围。

打开编辑时冻结版本并暂停轮询。保存前重新核验权限和身份。Windows 桥验证回执，并用同一路径 GET 校验目标、基准版本、修订推进和变更字段。额外读回是本项目的确认步骤。冲突或结果不明时保留可复制的输入，先用只读核对确定草稿状态。版本未变时由用户明确点击重试。

隔离浏览器验证核对前后写入次数均为 1，手动重试后为 2，并展示读回的两个字段。首轮发现按钮类型在点击期间切换导致表单误提交，修复后用同一序列复测。全库 Rust 656 项通过，前端回归包含差异字段、显式清空、身份和读回形状校验。真实云端写入、全局导航草稿保留、原生 GUI 和官方配对像素待验。

## F05 互联网访问

重验官方 Windows 26.1027.3384.0 的 asar，SHA-256 为 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。以 22E 提取的 `configuration-fields-df76627e4826.js` 中的 `go`、`ir`、`In`，以及 `app-primary-998934e837fc.js` 中的 `TBn`、`EBn`、`XBn`、`YZ` 为依据。按钮和域名错误使用已知中文资源，包管理器标签在本次提取的中文资源缺少对应值，使用默认英文。

- 全量访问开启时禁用包管理器开关和域名编辑，恢复关闭时保留本次编辑的下层选项。关闭全部访问发送 `disabled`。包管理器或域名启用时发送 `restricted`，带 `presets` 和 `egress_rules`。全量访问发送 `unrestricted`。
- 域名弹窗复制当前列表，支持 Enter、逗号与多行粘贴。主机名小写，移除一个末尾点，校验长度、完整 IPv4、重复、URL 与端口。无待提交输入时才可应用，取消或 Escape 保留外层草稿。
- 仅外层保存可发 PATCH。网络同值或仅域名顺序变化不写入，结果不明时只读核对模式、预设与域名，再决定是否允许重试。VPN、TCP 和发布另行实现。官方原生弹窗焦点、像素与真实账号写入待验。

回归通过 30 个官方 `XBn/YZ` 原函数向量、98 个前端回放入口与 658 项全库 Rust 测试。Rust 验证非法策略在发请求前拒绝、网络单字段请求、乱序读回及预设不匹配。隔离浏览器验证域名取消、回焦、批量粘贴和内外层写入次数。全量模式下禁用细分控件，关闭后恢复原选项。修复全局外边距重置造成的弹窗偏移后，1280×720 和 440×800 的弹窗居中且无横向溢出。证据见 `verification/network-official-vectors.json`、`verification/network-browser-result.json` 和 `verification/network-rust-final.log`。

Windows 调试构建通过，产物为 `dist-artifacts/cloud-f05-network-20261107/CodexNative.exe`，SHA-256 为 `950160d80ef1d0a3c2e5f209e95ebb5781ef27fea2e84abc2ff50869503274b1`。此增量保留本地提交，完整标准检查、远端 CI 和预览发布在下一发布候选上执行。

## F05 环境元数据

重验同版本 asar。依据 `tab-panel:Kt` 的内联名称编辑、`configuration-fields:go` 的描述和隐私控件、`app-initial:svt/cvt` 的工作区管理资格，以及 `app-primary:vHn` 和原生 `environmentConfigs.request` 的写入顺序。名称输入上限 128 个 UTF-16 单元，提交时 trim，空名称拦截。描述两行，上限 512 个 Unicode 码点。共享到工作区要求管理资格，非所有者不能设为私密。

有两类差异时先保存私有草稿，确认后才 PATCH 根配置的实际元数据差异，根请求不携带草稿版本字段。根 PATCH 确认后 GET 原私有草稿，校验同一配置、草稿及变更字段。第一次成功而第二次失败时保留确认的草稿修订与待保存的元数据。结果不明时只读区分已应用、仍可重试和冲突。根接口缺少条件写参数，发送前对比将改动的根字段，仍有读写之间并发变更的窗口。

隔离浏览器验证空名称零写入、Escape 恢复名称并回焦、草稿和元数据依次发出、只读核对保持写入次数 `1/1`、显式重试后为 `1/2`。1280×720 和 440×800 均无横向溢出。Rust 传输测试核验根 PATCH 请求体、私有草稿 GET、错误草稿拒绝。隐私暂用原生下拉和通用工作区文案。真实云端账号、物理 IME 和官方配对像素待验。

## F05 仓库选择与应用

固定安装包哈希已重新核对。官方仓库选择器 `repository-picker-7f31ee605cf7.js` 用 `Kya` 联结默认 GitHub 和 Enterprise 模板目录与 `Ek` 的可访问授权列表。排除管理员专用连接、隐藏及隐式授权。禁用、要求重新认证和不可用授权不能读取仓库。连接与组织切换后以新的范围重新分页。

`app-initial-4267e52fe5b0.js` 中 `wLn/TLn/HLn` 给出组织查询与四条仓库读取路径。trim 后的查询以 200ms 防抖，页面从 1 开始，每页 20 项，原始响应满 20 项才有下一页，按仓库 ID 去重。跨组织搜索用 `limit`，指定组织搜索用 `per_page` 及返回的账号登录名、类型。仓库默认分支来自服务端，`vHn` 保留已存在仓库的 ref 和 depth。

原生桥复用已验证的登录、代次、取消和网络策略。默认连接查询的 403/404 返回空结果供 Enterprise 分支继续使用。可访问授权请求使用 `link_refresh_strategy: NONE`，回包只保留选择器字段。仓库缺少默认分支时保留空值，后续不得自行填 `main`。

应用消息见 `app-primary:ZVn/QVn`。它从读回的仓库集合过滤仍有效的增删项，以真实名称或 ID 组成 JSON 列表。发送前重验账户、用户与绑定会话，在 durable 宿主的 `/workspace` 上用 `turnTrigger: environment_onboarding` 和 queue 模式提交。仅允许清理无未提交或未推送工作且确实已移除的 checkout。消息失败时保留待重试操作，禁止重复写已确认配置。

已执行四条官方 `TLn` 原函数路由分支，并保留 `ZVn` 定位，证据见 `verification/repository-official-contract.json`。本增量实现原生发现协议。连接组合与选择器界面、仓库写入和 durable 应用消息仍需接入，真实账号与像素另行验收。

本地 Rust 全库 662 项通过，包含新加的三项仓库发现回归。用例核对四类路由、参数和转义、授权请求体、账号不匹配拦截及返回字段过滤。日志见 `verification/repository-rust.log`。

### 仓库选择器界面

同版本 asar 已复核。侧栏 `configuration-fields:ka` 用 Manage 打开 `Ca` 紧凑弹窗，复制已有选择，最多 16 项，按集合判定更改。弹窗 Save 只暂存，关闭或 Escape 丢弃弹窗内改动。已有仓库按保存记录保留分支和深度，新仓库缺默认分支时不可暂存。搜索与分页的验收覆盖晚到旧连接、组织和关键字结果不覆盖当前列表。

本地阶段先接选择与暂存。存在暂存的仓库差异时，阻止外层提交并显示原因，用户可撤销该差异。仓库变更正式启用前，必须完成私有 PATCH、服务读回和 durable 应用消息。GitHub OAuth 回调、官方配对像素另验。

使用实际组件与隔离 IPC 验证原连接和组织的晚到响应被丢弃、第二页去重、查询去除空白、断连提示、缺默认分支禁用、Escape 取消回焦、相同集合不产生改动、暂存零写入和撤销。已有仓库保留 `pinned`，新仓库使用服务端 `release`。440×800 实测弹窗宽 408px，选满 16 项后第 17 项禁用，无横向溢出。连接和组织当前用原生下拉，未做官方像素匹配。

99 个前端回放入口、生产构建和 Windows 调试构建通过。浏览器结果见 `verification/repository-picker-browser.json`。本地调试版为 `dist-artifacts/cloud-f05-repository-picker-20261107/CodexNative.exe`，SHA-256 为 `46ea408ce65d245fc590e2d9320c3d00dae91334b6e1462d1913b322d13562b1`。

### 仓库草稿写入

固定安装包已重验。原生配置 schema 和 `app-primary:vHn` 使用同一私有草稿 PATCH。请求带 `base_version_id`、`expected_revision` 和变更后的 `repositories:[{repository_id,ref,depth?}]`。清空仓库显式发送空数组，无变更时省略。读取确认按仓库 ID 匹配分支和深度，允许响应重排，拒绝缺项、多项、重复或不一致字段。此阶段验证配置协议，侧栏仍保留应用步骤就绪前的保存保护。

`app-primary:ZVn/KVn` 把应用消息交给 turn coordinator。`app-initial:Imn` 在 queue 模式遇到活动轮次、待启动或排队工作时使用 enqueue，空闲时准备启动。下节复核实际队列准入与本地队列回退。请求超时后的投递确认、断线恢复与重复防护单独验收。

隔离执行官方原函数验证五种投递意图。空闲进入 start 准备，活动轮次、待启动和已有排队项进入 queue，需恢复的线程先准备恢复。另执行 `ZVn`，核对读回后过滤已失效的增删项、固定会话和工作目录、首次发送失败、仅重发消息和成功后拦截重复点击。证据见 `verification/repository-apply-replay.json`。

在 `renderer-app-server-managers-115e3136926e.js` 的 `Gm` 中，云端服务端队列受 gate `1189013788` 控制。原生 `early-bootstrap-491-e75c34fa1b2c0832.js` 的对应分支检查 `codex-app-cca-queued-follow-ups`。本地队列另用 gate `2120612410` 和 `threadQueue` 能力判断。不能从当前会话拥有 durable ID 直接推断已开启服务端队列。

本地 664 项 Rust 测试及 99 个前端回放入口通过。新增传输用例检查清空数组、重排读回、分支或深度不一致、重复仓库与无效数据零派发。前端复验同值省略，以及已有旧数据重复项时仍可修改其他字段。Rust 日志见 `verification/repository-patch-rust.log`。

### 仓库应用消息的启动传输

固定版本 `app-initial-4267e52fe5b0.js` 中 `Vhn` 位于 UTF-16 偏移 3244202。隔离执行原函数确认，即便云端服务端队列已启用，`canEnqueue` 也只接受省略触发器或使用 `composer` 的提交。`ZVn` 的 `environment_onboarding` 消息走客户端队列回退。证据见 `verification/repository-apply-admission.json`。客户端排队、等待空闲和恢复由会话协调层负责。

本阶段只接通空闲后启动消息所需的固定 `turn/start` 传输。请求绑定会话和客户端消息 UUID，使用 `/workspace`、`environment_onboarding` 与只含仓库增删信息的固定文本。有效回执投影为 turn ID。传输交接后的超时、断线、回执格式错误或已回显标识冲突均保留为投递待确认。回执仅确认启动，工作区应用结果还需后续核对。

侧栏仓库保存保护继续生效。客户端队列、闲忙确认、重启恢复、历史核对和最新配置联动是开放保存之前的验收项。

### 运行中的会话历史

同版本 `app-initial-4267e52fe5b0.js` 的 UTF-16 偏移 2894783 和 2896465 处理 `turn/started` 与 `turn/completed`，均按 `threadId` 定位会话。2886719 的 `thread/status/changed` 独立更新线程运行状态。因此轮次通知可触发历史核对，完成通知本身不足以确认整个线程可启动下一轮。静态片段和文件摘要见 `verification/live-turn-notification-anchors.json`。

本项目在恢复前订阅原生 durable 桥，按宿主、账号、用户、代次和线程筛选。恢复中的通知合并到恢复后刷新，读回进行中的通知合并为一次后续读取。使用已有分页接口取回消息，不直接渲染通知载荷。刷新替换重叠轮次，保留连续的已加载旧页和服务暂时落后时的已知新尾部；无重叠时使用最新页及其分页游标，避免跳过中间缺页。离开或切换账号取消请求和订阅，刷新失败保留原时间线并可单独重试。

隔离用例通过实际历史读取与订阅逻辑验证恢复前通知、异账号和线程拒绝、单飞、失败重试、消息更新、分页合并、取消和迟到的监听注册。逐字流式、真实账号推送和原生界面待验。本节没有开放仓库保存。

后续排队协调参考同一 chunk 的 `Bmn.#n`（3141330）、执行订阅（3145680）和 `Hmn`（3160366）。被中断的轮次会暂停排队项，普通完成触发重新判断执行条件，跟随端和仍在运行的线程不可直接启动。历史确认使用 `Umn.wasMessageAccepted` 调用的 `dOe`（42971），按原始 `userMessage.clientId` 精确匹配提交 UUID。官方也识别带服务端消息 ID 的 accepted 提交投影。相同正文不能证明同一提交，历史暂未找到也不能证明发送失败。两个原函数的隔离执行样本见 `verification/repository-apply-reconcile-replay.json`，投影类型判定使用替身，真实投影仍需核对。
