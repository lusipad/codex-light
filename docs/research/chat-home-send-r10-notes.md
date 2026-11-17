# R10 实施备注

计划：[普通 ChatGPT 消息消费者](chat-home-send-r10-plan.md)。R10基础之后继续R10B主窗文本消费者；下列旧记录保留其阶段语境，最新接线与验证见文末。整页仍未验收。

## 决策

- 当前检查`src-tauri/src/chatgpt_service.rs`的`CurlTransport`在EOF后完整解析。新增独立增量流运输不改旧服务的有界完整响应语义；认证与固定业务路由仍由受限服务入口提供。
- 不读取真实用户token或发起模型turn做验证；使用自有fixture证明运输生命周期及已登记源的业务回放。
- 前置来源已闭合：客户端草稿ID为`local-chatgpt:<UUID>`，新空草稿parent固定`client-created-root`，不能把二者冒服务conversation id。requirements初始key是实际浏览器环境封装，并非缺少一个外部npm SDK；只重实现已证初始采样，不执行/复制官方VM，不默认服务无challenge。
- `chatgptMessages.ts`保源普通文本构造与已知next字段投影；`chatgptRequirements.ts`只采真实WebView字段，缺必需环境未就绪。`chatgptStreamState.ts`保v1逐channel快照、实际message id和逻辑/运输终态区分，未知content不假空文本。
- Tauri Channel逐请求传实际frame与递增序号；命令回执和Channel可能分属不同队列，`chatgptTextClient.ts`按实际eventCount排空后再退休。复审复现最终identity await期间多余帧仍可被消费，已按声明计数拒绝并二次核验；11组client回归通过。
- 错误终态也使用明确`transport-error`/eventCount/error信封，客户端先排空实际已投递partial，再拒绝原结构错误；不是用户成功回执。对应12组client回归通过，原失败保留。0帧前失败仍是错误，不创造会话或消息。
- 源raw DONE需要主动关reader。新增StreamControl让业务选择Stop，运输立即kill/wait后成功收尾，不把业务字符串硬编码进一般framer。真实live socket先红后绿；本轮基线596项service组通过（537 filtered），不是新的全库声明。
- 后端新增受限普通text-only DTO与源browser requirements往返，source无required/token时不额外强设token门槛。未支持挑战返回明确错误且零completion。初次force_login与retry判定不同，后续修正不反向加首聊源门槛。
- 业务层仅消费EOF尾的合法JSON并交付partial，之后仍返回incomplete；未完`[DONE]`不作正常完成。正文配置已分离本地POST阈值：旧buffered请求仍256KiB，Chat stream使用与DTO一致的2MiB并复用原header/config转义；新增正反边界回归。2MiB仍是本项目资源约束，不是已证官方限制或完整长文验收。

## 偏离

暂无。无法验证的认证、上传、事件与重连输入保留为未知，不视作完成或降级授权。

## 新发现

- 首页merged非Work→ChatGPT composer→completion stream与Work native sender是两条实际路径，不能只换模型字段复用CLI。
- 错误回执也可能先于已派partial Channel帧到达；正在增加受限transport-error envelope及实际eventCount排空，不能因invoke先拒绝而丢文本。
- 通用WHATWG EOF不派未完frame，而固定Chat消费者还尝试JSON解码剩余buffer、且不触发raw DONE回调。正在保留EOF pending frame由业务层处理，不能丢合法partial或把未终止DONE冒成功。
- 旧curl POST本地上限256KiB与新plain DTO当前2MiB校验不是同一阈值，不能报告后者已全链可发送；均非已证官方限额。界限须在接线前统一或精确列为限制。

## 待审阅

- 真实服务、原生GUI/IME及配对像素未验；本阶段仍须按主链成功条件推进，不因运输层测试通过而放行整页。
- 当前尚未接主窗owner/controller、首页/c/路由采纳与transcript。已核UI接受/optimistic/response accepted分立；后续需补真实响应头接受元数据与当前稿比较，不能把第一个业务frame或完整DONE无依据当同一接受时点。复用本项目UserMessageBubble/Markdown只是实现复用，官方气泡子树与像素仍未恢复。
- `/f/conversation/prepare`与conduit预备、真实服务端投递existence核验、resume/WS、上传/工具/多模态、required挑战与native attestation、远端偏好同步及完整持久会话图仍在范围内。当前无prefetch的源stream_unprepared路径不代表可删除它们；无新UI交付、不升级R10完成状态。
- SSE执行器的显式取消/Stop已做kill+wait回归；requirements/stop仍复用原有bounded JSON curl路径，外部future超时/drop与临时文件回收的真实原生边界未新增验证，不能将SSE专项外推到所有HTTP请求。

## R10B 主窗接线（2026-11-18）

修改前依据沿用固定源consumer合同CU01–CU21，区分optimistic插入、导航和HTTP接受，不以首个文本frame作为接受时点。安装版只读核对仍为26.1111.2228.0；本轮没有重新计算整包SHA。证据根为`.ref/parity/16/chat-home-ui-r10b-20261118/`。

- 首页非Work模型及后续文本走独立ChatGPT controller/Channel，使用实际server ID接续；侧栏支持同owner的多个内存会话，后台流不依赖当前页面可见性。新聊天明确传`clientId:null`，跟进明确指定原clientId，退休目标零发送。
- 收到成功HTTP与SSE MIME后、首个正文前派独立response元数据。curl真实回归发现`--include`未及时输出头，改`--dump-header -`后原严格用例通过；不是以延长等待或先造业务消息消除失败。
- 草稿清空和失败恢复比较owner、原文及修订号，覆盖改过又改回的ABA。前置明确未发送的失败允许重试；已派送或未知结果不自动重发，partial保留。
- `/c/`与`/g/.../c/`按真实ID替换。Home准备晚回时仍在后台发送A，但保留用户已打开B的选择和URL。设置拒绝离页时，侧栏打开聊天不会先修改选择/native ID；延期确认受owner/host/navigation/URL及一次执行限制。
- Chat页面拒绝本地steer、队列启停/增删及代码审查入口，停止走独立Chat停止请求。队列、附件上传和Work模型转换尚未接通时明确提示并保留输入，不调用普通CLI替代。
- transcript复用现有用户气泡与Markdown组件；这是实现复用，未知消息显式显示，不能当官方GSDP子树或像素还原证据。

真实回归先红记录：`app-native-isolation-red`、`app-late-chat-route-red`、`controller-late-route-red`、`response-red`、`service-green-02`；另有旧AST夹具缺新增route ref导致失败，补齐真实native路由前置而未删除原断言。1145全Rust测试通过、0失败/忽略/过滤；实际App组合9组、controller30组及TSC/前端生产构建已通过。最终整组前端及原生构建结果另见本批验收记录，不以此句推断未完成命令。

本阶段只接text-only内存会话。远端历史列表/持久图、冷启动恢复、prepare/conduit、resume/WS与存在性核验、附件/工具/多模态、required挑战/native attestation、远端偏好同步仍在总范围。真实账号/付费模型、原生GUI/物理IME、同环境官方宽窄配对像素及用户验收未做；visual verdict为unverified、score=null。不push，不触发、重跑或查询托管CI。

## R10C 普通完整详情与冷路由恢复（2026-11-18）

按[本批计划](chat-history-r10c-plan.md)继续，不将本批改称完整历史交付。固定版本重新读取仍26.1111.2228.0；普通历史与冷模型两份合同/锚点保存在`.ref/parity/16/desktop-host-r1-20261116-current/chat-history*-r10c-*`。41+11个官方UTF-16切片及两份清单的资源条目直接与当前安装asar的bytes/SHA/header核验，未重算整包哈希。

### 功能与实现映射

- H01–07：受限GET单数`/backend-api/conversation/{id}`，只允许服务器ID；临时参数只在明确temporary请求加`history_off=true`。g-p项目才附项目头，不用登录user补owner；history默认不带completion专有MCP form头。真实凭据、路由、取消和网络政策在读取前后核验，错误保留。没有普通CLI或模型写调用。
- H08–09/H12/H30–33：从真实`current_node`沿parent回溯，保留全部raw mapping和非当前分支；null消息节点仍可作为父链，隐藏气泡不改变下一轮parent。缺节点/环/坏消息不假完整历史。记录真实只读、模型、effort和原始异步状态；不会将owner相等推成发送权限。
- 冷模型沿Ow2S.e0/mNEt.G独立投影，使用真实目录、一般lastModel与用户设置；不复用首页workspace policy或补medium。必需模型/账号读取失败时保留已经读取的历史，重试只填原会话尚空的模型，核身份/owner且不覆盖用户后来选择或在途请求。
- 初始普通`/c/`及`/g/.../c/`地址可读取并安装服务器详情。同页popstate切到B会切换已有B或读取B；A的晚事件不能把B地址改回A，B尚未加载的输入写入B的草稿，不能通过旧A回调投递给A。恢复后手动文本跟进使用真实当前节点。
- 历史读取pending/error/retry与发送pending/unknown分开，重试按钮只重新读取，不重发消息。只读与已证远端active/background状态单独提示，未接远端SSE不能冒已恢复的本机stream或假停止按钮。

### 验证与边界

后端7项隔离回归先由`not_implemented`真实失败再通过，覆盖固定GET/headers/query、认证前拒非法输入、无项目/CustomGPT、不吞HTTP/JSON/IP错误、取消与generation ABA及前后fresh身份/政策。完整Rust1152项通过，0失败/忽略/过滤。前端纯图22组、controller40组、客户端15组、cold模型8组和Pane6组已通过；实际App组合及冻结构建的最终结果以`.ref/parity/16/chat-history-r10c-20261118/verification-summary.json`为准，不把中间检查冒最终通过。

冻结检查为55个相关前端全部通过（含实际App14组及受影响四项导航），TSC、前端构建与原生EXE/MSI/NSIS均退出0，616产品输入稳定。候选与hash见16.23A，不将构建或离线VM当真实账号/GUI验证。

本批不等于退出重开后自动找回全部聊天：服务端历史列表、星标/项目合并、上次窗口地址与草稿/图持久化仍未接。动态`num_turns`分页、版本图/活动分支合并、locked PIN、完整模型fallback条件/权限、远端resume/WS与实时取消、上传/工具等继续队列。临时冷路由的官方入口条件另有约束，本批未自动开放；底层temporary参数用例不代表临时恢复已完成。

本地资源上限2048字节ID/8MiB响应、50秒读取仍是本项目约束，非官方限额。只读HTTP暂保一次请求，源`except-rate-limit`重试尚未全对齐。真实账号/模型、原生GUI/物理IME、官方配对像素、完整非Fast标准/全部协议探针和用户验收均未做，score=null；CI/push继续暂停。旧R10/R10B局部限制按本批已实现项更新，不用本批通过覆盖仍缺的恢复分支。
