# 16.07C：账号指令专用存储桥

2026-11-03。本文件描述固定来源和已实现的宿主边界，不代表当前账号已取得官方入口资格或已执行真实账号写入。

## 官方来源

固定 Store `26.1027.3384.0`；原 `app.asar` SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。逻辑与物理链见 `.ref/parity/16.07/actual/16-07C-research/transport-anchors.json`，偏移均为 0-based UTF-16 字符偏移。

- `cloud-preferences-80117a3a1dcd.js` `C` @647 为 GET `/wham/settings/user`，`E` @1073 为带 `expectedIdentity` 的 PATCH。body 是调用者的设置变更对象。
- `personalization-settings-bfea882ec410.js` `wi` @35183 读取 `r.custom_instructions ?? ""`；编辑器保存只传 `{custom_instructions: textareaString}`，清空传空字符串，不是 null 删除。
- 逻辑客户端到宿主链：initial `M_` @1839306 → `aht.makeRequest` @1832645 → `Zg.fetch` @1757575 → `udt` @1752026 → host httpFetch → early491 `ensureAbsoluteUrl` @1471031 → early339 中 `prodApiBaseUrl` 所引用常量 `https://chatgpt.com/backend-api` → early-bootstrap `nZ` @185744 拼接。
- 因此实际固定 pathname 是 **`/backend-api/wham/settings/user`**。workspace routing 可以替换 origin，不能删除 backend-api 前缀。expectedIdentity 不进入 HTTP JSON body 或自造 header。
- 官方 early491 @1468190 的默认认证重试会在显式 401 后刷新并再发一次；这个条件没有排除 PATCH，cloud-preferences 也没有禁用 retry。最初“所有 PATCH 都不重试”的假设已被此反证纠正。

## IPC 与返回

产品实现位于 `src-tauri/src/chatgpt_service.rs`，复用现有 ChatgptService 和宿主认证，不新建通用 URL 代理或第二套 token 缓存。

```text
account_instructions_read({request:{
  requestId, expectedIdentity:{accountId,userId,generation}, profile
}}) -> {requestId,identity,contents:string}

account_instructions_write({request:{
  requestId, expectedIdentity:{accountId,userId,generation}, profile, contents:string
}}) -> {requestId,identity,contents:string}
```

request 类型拒绝未知字段。profile 沿用真实 Chromium 上下文结构，由已有代码验证格式；前端不传 URL、HTTP method、token、任意设置 key 或账号切换指令。写入 body 固定只有 `custom_instructions` 一个键。序列化请求限 256 KiB，是既有 JSON 传输上限，不能将它解释为官方当前账号编辑器字数限制。

GET 成功响应必须为 object；`custom_instructions` 缺失/null 转为空串，字符串原样保留，包括换行和空白，其余类型拒绝。其它账号设置不进入 IPC 返回，因此不会因保存指令而覆盖 communication guide 等未知字段。

## 读写与认证顺序

1. 登记 requestId，核 generation/取消状态，获取现有 session 单飞锁；沿用 getAuthStatus、account/read 的 token/routing 验证，不向 renderer 暴露凭据。
2. 使用固定 pathname 与实际 routing origin，现有 HTTP headers 包含真实账号 ID、Bearer、语言、integrity、Fedramp、routing override 等。
3. 读取组织 application/network requirements 并检查实际目标，不能因为有账户 token 就绕过网络策略。
4. PATCH 发送固定序列化 body；只有**明确收到第一份 401 响应**才刷新 token，并在第二次发送前重新核当前 generation、账号/用户 identity、取消状态。第二次 401 直接失败；其它错误不进入该重试。另按 early339 `hT` @1194186，401 JSON 的 `error.type=ip_not_authorized`，或 `error.code` 为 `ip_not_authorized / validate_whitelist_failed / workspace_ip_not_authorized` 时是工作区 IP 策略拒绝，GET/PATCH 均不刷新或重放，返回 `ip_not_authorized`。
5. 网络错误、超时、5xx 或未知送达结果不自动重放。服务返回 `instructions_write_unknown`，用户需先读取确认实际状态。
6. PATCH 的 2xx 不直接成为保存成功。仍持有 session 锁，向同一路径 GET 读回；GET 可按已有读语义在 401 后刷新一次，**不会回到 PATCH 循环**。
7. 只有读回的 custom_instructions 与请求字符串完全一致且 identity 仍有效，才返回成功。读回不符返回 `instructions_readback_mismatch`；已确认 PATCH 后读取失败返回 `instructions_readback_failed`，明确可能已经保存，不自动再写。
8. 取消和账号切换拒绝旧结果，释放 request registration；取消已发送写入不能撤销服务端可能发生的变更，不能向用户承诺“取消等于没有写入”。

现有其它 ServiceOperation 的 GET 刷新逻辑保持不变。新增 `HttpMethod::Patch` 只用于这个固定专用入口，curl 的私有配置、body 临时文件、禁止重定向和凭据不出日志规则沿用现有实现。

## 能力与资格分离

专用桥证明应用具备正确认证与传输能力，**不证明任何账号已开启该编辑入口**。前端需要独立处理官方 capability/gate、账号与用户身份、服务 403 及其它可用性状态。未知 gate 不能当 true，不能在 Work/账号不可用时转写本地 AGENTS.md。

账号指令与本机 Codex 指令具有不同作用域。此桥不会读取或修改本地 AGENTS.md，也不会通过配置 TOML 假装远程保存成功。固定包外的 gate 和服务响应变化仍需真实运行时证据。

## 隔离回归与证据边界

新增 `account_instructions_` Rust transport fixtures 覆盖：固定路由/headers、仅单一白名单字段、空字符串清空、null/缺值 GET、非法响应、令牌不跨 IPC、明确 401 同身份刷新一次同 body、四种工作区 IP 策略 401 的 GET/PATCH 均零刷新零重发、刷新后身份改变零重发、其它 HTTP 错误不重发、网络未知单发、PATCH 后 GET 读回不符/失败、超限/未知请求字段、预取消零发送、发送中取消/账号切换丢弃晚结果。

该回归使用合成 token、隔离 FakeTransport 和已有 fixture RPC，不请求真实服务，不修改真实账号。编译和实际测试退出码由父阶段的串行 Cargo 验证记录补充；本文件不能仅凭测试定义宣称测试通过。开发时已通过 rustfmt 只读解析与 `git diff --check`，未全文件格式化以免产生无关改动。

未验：真实账号 gate、真实 GET/PATCH/后续会话消费、官方原生编辑器行为与配对像素。上述内容不能由模拟传输或构建通过替代。
