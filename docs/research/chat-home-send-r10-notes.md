# R10 实施备注

计划：[普通 ChatGPT 消息消费者](chat-home-send-r10-plan.md)。当前开发前取证/运输层阶段，尚未交付真实聊天消费者。

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
