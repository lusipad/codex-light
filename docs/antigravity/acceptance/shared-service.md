# 共享认证只读桥 BR01–BR08

状态：本地合同与隔离协议自验中；真实认证 HTTP、原生 IPC 与像素未验证。规格与原包证据见 [合同](../specs/chatgpt-service-bridge.md)。

新增 Rust chatgpt_service，复用现有 app-server 获取认证，在宿主内处理 token；不读取 auth.json，不把 token 返回 renderer。通用 app_server_call 拒绝 getAuthStatus。固定十种只读 operation、受限 query 和 path segment 编码，不接受任意 URL 或认证头。账户/连接变更增加 generation、取消旧请求；返回脱敏 account/user/generation，前端再次核对 requestId/identity。

系统 curl.exe 以 stdin 接收配置与凭据，不进 argv/文件，禁重定向、限制 HTTPS origin、超时与响应大小、取消释放进程；未新增依赖。只透传白名单响应头；401 最多刷新重放一次，403/429/错误 JSON 不变成空数据。Integrity-State 严格 ois1 格式与发送状态 CAS。串行请求、同步临期刷新与官方并发/eager 实现不同，暂不宣称行为完全一致。

BR01 隔离未登录协议探针已分别验证官方 CLI 0.159.2 与 npm CLI 0.165.0 支持 getAuthStatus(includeToken:true)，空 token；没有读取真实 auth、发送模型 turn 或付费调用。证据位于 .ref/parity/shared-service/actual/protocol-auth-support-*.json。

BR02–06 由 Rust 本地注入 transport/auth fixture 验证：路由与参数、身份绑定、刷新边界、Integrity、取消、超时、协议错误及脱敏。前端 helper/20B 生产组件另有执行回归；均不能替代 BR07 真实登录账号请求与 BR08 原生页面实测。workspaceRouting 缺失时明确失败，不盲降公共 origin；当前 CLI 是否在登录账号下提供所需路由未验证。系统 curl 的目标发布环境兼容性未验证。

完整自动检查、全量 Rust、常规 EXE/MSI/NSIS 构建及输入哈希在 .ref/parity/shared-service/actual/20B 归档。原生显式测试启动此前被自动审批拒绝，仅返回 blocked by policy；未绕过重试、未标通过。无同环境官方截图，本批视觉 not_executed、score:null。18 Library/19 Images 云端列表尚未消费此桥，不能标已接通。

联合归档完成：完整标准检查/全量Rust135/常规构建/diff-check退出0，171产品输入稳定；build-manifest.json及原始日志位于 .ref/parity/shared-service/actual/20B。共享桥限定实现待用户验收，BR07–08未通过。
