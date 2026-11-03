# Library / Images / GPTs 共享认证 HTTP 桥合同

状态：静态取证完成，可实施宿主桥；真实账号兼容性、HTTP 返回及原生表现未验证。2026-11-03。

## 结论与基准边界

这三页存在一条可开发的真实服务通路：**复用本应用启动的本地 app-server 登录，通过宿主专用 `getAuthStatus(includeToken:true)` 获取 ChatGPT bearer，结合 `account/read.workspaceRouting` 发 HTTP**。不是必须读取官方应用的 Cookie、复制官方令牌或重新设计登录。

证据证明的是所检查包的调用链；本机 CLI 是否仍支持 legacy `getAuthStatus`、当前 token 是否获三页服务授权、工作区返回是否允许请求，必须由协议探针及受控只读请求验证，不能仅凭静态代码宣布可用。`account/read` 只返回账户信息和路由，不能当成 token 接口。

官方提取基准为 `C:/Users/lus/Codex/_internal/app/resources/app.asar`，SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。这是已知带 offline 修改的安装包，**不能称为未经修改的发行基准**。例如 initial 中 `WXt` 身份读取返回 `null`、订阅为空函数，不能照搬为线上合同。保留未修改分支的静态发现，不据此推断原版运行时行为。

证据目录：`.ref/parity/shared-service/reference/`。`manifest.json` 逐项登记原始文件路径、字节大小与 SHA-256，并与 ASAR header integrity 逐项核验；片段位置均为从文件头计数的 **0-based UTF-16 字符偏移**。`*-anchors.json` / `*-focused.json` / `*-contract.json` 是有界片段，不是完整源码恢复。

本轮没有读取真实 `auth.json`、令牌、官方 Cookie，没有修改官方配置，没有发服务请求、生成 turn 或付费操作。

## 已闭合的宿主调用链

| 环节 | 可追溯来源与锚点 | 行为及实施含义 |
|---|---|---|
| 页面客户端 | shared `getRequestTarget`，见 `app-shared-…-contract.json` / focused | `$mn.safeGet/Post/Patch/Delete` 替换 path 参数、拼 query，保留 signal、expectedIdentity、assertRequestCurrent，不在这里添加 backend origin。 |
| 默认头 | shared `LFn` UTF-16 `3596102`，contract 文件 | ChatGPT webview 默认添加 Attach-Auth 与 Attach-Integrity-State；附 OAI-Language、设备标识、web-frontend/window-type。Desktop-Surface 取决于原生 DeviceCheck 能力，不能在 Tauri 一律置 1。 |
| HTTP 通道 | shared `xmn`，见 `app-shared-…-async_function_xmn.txt`，精确偏移保留于 focused | `i6.httpFetch.fetch(requestId, request)` 调宿主 HTTP 服务，取消使用相同 requestId，释放 response/request disposable。不是直接 renderer fetch 或只依赖旧 `fetch` 消息。 |
| 宿主路由 | main `Bue.fetchHttp`、`ensureAbsoluteUrl` | 相对路由经 bootstrap `t7/GSe` 转为绝对 URL；HTTP 不允许伪装为 VSCode 桥。 |
| origin | bootstrap `X5` UTF-16 `2094735`、`t7` `2095542` | 默认 `https://chatgpt.com/backend-api`；开发 override 是可选配置分支，本项目不应为测试修改全局配置。 |
| public-api 例外 | src `xs`，见 `host-header-contract.json`，附近 UTF-16 `82216` | `/public-api/gizmos/discovery` 在生产是 `https://chatgpt.com/public-api/gizmos/discovery`，不能拼成 `/backend-api/public-api/…`。localhost `/api` 分支转换为 `/public/…`，生产无需应用该转换。 |
| Attach 头消费 | src `Ss/Cs/ws/Ts/Es`，同上 | 大小写不敏感；读取后**删除**标记，非 `0`/`false` 视为真；Expected-Account-Id 也只供宿主使用。不能把这些标记原样发给服务当作认证。 |
| token 来源 | main `bue/xue/Sue` UTF-16 `634264` 附近 | 有 Attach-Auth 且没有显式 Authorization 才加载 token；调用本地 app-server connection 的 `getAuthToken({refreshToken})`；Expected-Account-Id 与 token 账户不符报 409/account_changed。 |
| app-server 协议 | bootstrap `getAuthToken` / `requestAuthStatus`，见 `bootstrap-…-async_getAuthToken.txt` | `getAuthStatus` 参数 `{includeToken:true,refreshToken:false}`；只接受 `chatgpt` / `chatgptAuthTokens` 的 `authToken`，API key 不作为 ChatGPT 服务凭据。 |
| 认证头 | bootstrap `i7` UTF-16 `2097449` 附近 | `Authorization: Bearer …`；token claim 的 chatgpt_account_id 转 ChatGPT-Account-Id；FedRAMP claim 决定 FedRAMP 头。无有效 claim 不猜账户。 |
| workspace | bootstrap `Uk` UTF-16 `1285572` | 读取 `account/read(refreshToken:false)` 与 `configRequirements/read`；workspaceRouting.chatgptAccountId 必须匹配 token 账户；当前新版本无路由时不能任意降级 legacy。 |
| HTTP 实发 | main `performDesktopFetch`，见独立 txt | 请求前校验允许 origin、检查身份/取消；支持流响应/字节上传；只向允许目标加认证。 |

18 Library 的 scoped 客户端还会显式设置 `ChatGPT-Account-ID`（见该页的 `library-auth-client.json`）；与 token 不同账户时不能相信 renderer 传入值，应在宿主拒绝身份错配。

## token、刷新与工作区的实现合同

1. 所有 token 读取保留在 Rust 宿主，前端只接收服务数据及脱敏状态。不能为了复用现有通用 `app_server_call` 将 includeToken 结果送入 JS、日志、截图或证据文件。
2. token 使用本应用自身 app-server 认证，未登录时沿用现有登录流程；这不表示拥有官方 App 的 Cookie 会话。不要读取其他应用私有存储作为捷径。
3. bootstrap 缓存解析 JWT `exp`，提前量 `ste=300000ms`。距过期至少 5 分钟才作为有效缓存直接返回；临期可返回尚未过期值并单飞刷新，已过期强制刷新。`forcedAuthTokenRefreshPromise` / eager promise 使并行请求不会触发重复刷新。
4. 请求遇到带 token 的 401 时，释放旧 response body，执行 `getAuthStatus({includeToken:true,refreshToken:true})`，最多重试一次。403、限流、工作区 IP 限制均不等于 token 过期；不无限重试，不将失败改成空数据或成功。
5. main 对禁用 retry、workspace authorization error、特定不可安全重放写请求有限制。当前第一阶段只有只读 GET；不能把 GET 的重试规则未经评估扩展到上传、删除、会话创建。
6. JWT 的账户/用户只用于本地身份一致性和缓存分区，解析不代表本项目能验证服务端签名或授权；最终权限仍由服务返回决定。
7. `account/read.workspaceRouting` 含 `{backendOrigin,chatgptAccountId,accountRoutingOverride}`。生产初始 URL 先按默认 base 与 public-api 规则构造，再使用 workspace backendOrigin 替换 origin，保留 pathname/query；override 不是 `NO_CONSTRAINT` 时附 `X-OpenAI-Account-Routing-Override`。
8. 认证代际随 logout、session switch、account updated、进程重启失效。失效取消在途请求、清理 token/路由/完整性状态与页面账户缓存；晚到结果不能写回新账户。
9. 原包允许 legacy fallback 的版本范围是 `>=0.141.0 && <0.155.0-alpha.5`，且无 residency/network/FedRAMP 限制；当前采样 CLI `0.165.0` 不在该范围。缺 workspaceRouting 时应显示可诊断的路由不可用，不能默认请求公共 origin。
10. `account/chatgptAuthTokens/refresh` 是 server→client 的外部 token 模式回调；不是获取当前 token 的 client RPC，也不能替代 `getAuthStatus`。未使用外部 token 模式时不自行实现一套 OAuth refresh。

现场 CLI 0.165.0 的 `GetAccountResponse.json` 有 `WorkspaceRouting` 的三个 required 字段；当前生成的 v2/ClientRequest schema 未包含 legacy `getAuthStatus`。这只说明 schema 未公开该方法，**不证明执行时一定返回 method not found**。必须使用隔离 CODEX_HOME 探针确认方法支持；无需真实 token 的 method 存在性探针即可先行。若运行时不支持，再检查本地安装的匹配 CLI 能力，不能无依据改为读取 auth.json。

## Integrity-State、DeviceCheck、Sentinel 的区别

**Integrity-State 是宿主 response/request 状态，不是静态伪造 token。** main `P_` 的 header 为 `X-OAI-IS` / `X-OAI-IS-Update`。状态限制 2048 字符，精确格式为 `^ois1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$`，即 `ois1` 前缀加三段数据（按点拆分共四段）；无状态时不发送 X-OAI-IS；响应更新以本次发送状态作 compare-and-set，避免并发旧响应覆盖新状态；账户登出清除。Attach-Integrity-State 是内部请求开关，不能将字符串 `1` 转发当完整性证明。

**DeviceCheck 只在对应能力分支使用。** main 只有请求 Desktop-Surface 时才确保 DeviceCheck Cookie，另一个 Attach-DeviceCheck-Token 仅限 attestation challenge 或指定 messaging POST。普通 Library / Images / GPTs 列表不能自动要求 DeviceCheck，更不能伪造它。Tauri 无原生相应能力时应使用已取证的 browser profile 分支，标注行为差异待验证。

**Sentinel 是 ChatGPT 对话写入的额外合同。** initial 中：

- `d$t` UTF-16 `1575436` 附近：原生支持分支 GET `/ios/attestation_challenge`，其他分支 POST `/sentinel/chat-requirements/prepare`。
- `finalize` UTF-16 `1535789` 附近：POST `/sentinel/chat-requirements/finalize`，带 prepare_token、proof-of-work / turnstile 条件数据。
- `CT` UTF-16 `1532727` 附近：各类 OpenAI-Sentinel-* headers。
- `prepareCompletionStream` UTF-16 `1577588` 附近：POST `/f/conversation/prepare` 与 conduit token；之后真实 SSE completion、stop、resume 使用专用合同。

本轮未发现这些普通只读 GET 的 safeGet 路径显式先执行 Sentinel；这允许先开发列表读取，但**不保证服务永远不会返回 challenge**。收到额外 challenge 应报告需要的能力，不能绕过或伪造证明。不能因为列表读通就宣称 Images 生成 / GPT 聊天已完成；也不能把所有服务页都以“需 Sentinel”整体阻塞。

相关证据：`sentinel-anchors.json` 与 `sentinel-sources.json`。所取包的身份/订阅有已知 patch 迹象，Sentinel 活跃性和最终对话写入顺序必须另取未经修改基准核对。

## 本轮可直接实施的最小切片

先交付 **后台只读 JSON 桥 + 三页真实列表**，不需要先完成所有 ChatGPT 会话协议。

建议宿主内部动作使用固定 operation（不是开放 URL 代理）：

| operation | 方法/逻辑路由 | 用途 |
|---|---|---|
| library_favorites | GET `/files/library/favorites` | Library 收藏入口 |
| library_nodes | GET `/files/library/nodes` | 文件/目录列表，query 按 18 合同 |
| images_init | GET `/images/init` | Images 页面初始化 |
| images_styles | GET `/images/styles?include_image_suggestions=true` | 样式/建议 |
| images_recent | GET `/my/recent/image_gen` | 游标列表，首 25/后 20 |
| gpts_discovery | GET `/public-api/gizmos/discovery` | 发现页 |
| gpts_category | GET `/public-api/gizmos/discovery/{category_or_cut_id}` | 类别 / mine |
| gpts_search | GET `/gizmos/search` | 搜索，具体 query 按 20 合同 |
| gpts_detail | GET `/gizmos/{id}`、GET `/gizmos/{id}/about` | 详情 |

输入含 requestId、operation、受限参数、expected account/user 与 auth generation；返回 status、JSON body、必要的脱敏 response headers。用现有 IPC/app-server 管理器，不新增平行登录状态。所有路由和 query 校验在宿主执行；id 必须编码为 path segment，不能接受前端传 Authorization、backendOrigin 或任意追加头。

当前 `src-tauri/Cargo.toml` 无直接 HTTP 客户端依赖，本机已存在 `C:\WINDOWS\system32\curl.exe`。在“不得新增依赖”的约束下，可先用 tokio 管理该进程的只读 JSON 请求：配置经标准输入传入、凭据不放 argv/文件、禁跟随重定向、限定 https 和目标、取消 kill 子进程、设置超时/输出大小并解析真实 status。这里只是可实施方案，未运行网络验证；若已有项目宿主 transport 后续落地，应优先复用它。不能假称 curl 是已经存在的产品运行依赖；发布前需验证目标 Windows 环境或再决定正式 HTTP transport。

页面读取失败要区分未登录、方法不支持、缺工作区路由、403/不可用、429、网络错误。只有成功服务返回 `[]` 才呈现真实空态；服务不可用不能伪造列表，也不能把一次未验证写死为永久不可用。

写操作后续独立切片：

1. Library 真上传字节/完成处理/CRUD，带真实 reread 与可取消状态。
2. Images/GPTs 接通 ChatGPT conversation prepare/SSE/停止/恢复及 account feature gates。
3. 原生/视觉对照。当前文档不放行“18–20 全页完成”。

## 开发前及实现后的验证顺序

| ID | 场景 | 可验证的预期 |
|---|---|---|
| BR-01 | 隔离未登录 app-server，调用 includeToken legacy 方法 | 明确是方法支持且无 token，或真实 method not found；不读取/复制真实凭据。 |
| BR-02 | 纯本地单测 URL resolver | backend-api 与 public-api 正确；拒绝协议相对、绝对外域、路径注入；workspace origin 保留 path/query。 |
| BR-03 | mock IPC/HTTP transport，初次 401 后 200 | 刷新单飞且最多重放一次；其他失败不盲目刷新；敏感头不进入返回值或日志。 |
| BR-04 | token/account mismatch 或 switch 中晚返回 | 请求取消或明确报身份改变；新账户 UI/cache 没有旧数据。 |
| BR-05 | 两个并发 response 更新 Integrity-State | 只接受合法格式与匹配发送状态的更新；无初始状态不捏造。 |
| BR-06 | 请求取消 / timeout / 非 JSON / 403 / 429 | 实际错误可见、无幽灵成功、资源释放；取消不会开始后续操作。 |
| BR-07 | 受控登录账号，三个页面各一次只读服务请求 | 记录 status、脱敏形状/数量、request id；不记录 token/私密条目。属于后续运行验证，本轮未执行。 |
| BR-08 | 真 Tauri 页面切换/搜索分页/重开 | 数据来自服务、账户分区正确、没有演示卡/本地假收藏；原生与像素分别验收。 |

本轮检查：ASAR 原文件 header SHA-256 核验；证据 JSON 可解析。未执行 BR-01–08、产品构建、原生运行或视觉比较；视觉状态 `not_executed`，`score:null`。

## 2026-11-03 联合实施更新

上述“未执行 BR01–08”是修改前取证记录。BR01 已分别在隔离未登录 CLI 0.159.2/0.165.0 验证支持 includeToken 方法且 token 为空。BR02–06 已通过 Rust 本地注入 transport/auth 合同；20B 前端消费真实固定操作、错误与身份失效。完整检查及全量 Rust135 已通过。BR07 真实账号 HTTP 与 BR08 原生未执行，不将本地 fixture 或构建通过等同于服务接通。实施及产物身份见 [共享桥验收](../acceptance/shared-service.md)。

## 21A 固定操作扩展（2026-11-03）

21A在上述20B十种操作之外增加七种Sites GET：sites_access、sites_list、sites_shared、sites_detail、sites_environment、sites_domains、sites_share_access，路径/参数/返回合同见[21 Sites](21-sites.md)。前端已消费前六种；share_access仅宿主合同与测试，未宣称分享界面完成。仍拒绝任意URL/写方法/越权参数，沿用相同认证身份和取消。以上表是20B历史范围，不能当作当前全量白名单。真实账号HTTP与原生仍未验证。
