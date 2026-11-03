# 22 Cloud Environments：官方静态调研与修改前合同

状态：调研完成，可开发 22A 新 Cloud 环境只读列表及详情；未进行账号服务、原生或像素验收。2026-11-03。

## 基准与证据

基准 ASAR：`C:/Users/lus/Codex/_internal/app/resources/app.asar`，SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。这是已知有 offline 补丁的包，不能称为干净发行基准。当前门控值和账户可用性仍需未修改的官方运行时验证。

证据目录 `.ref/parity/22/reference/`：

- `manifest.json` 登记官方原文件的大小、SHA-256 和 ASAR header integrity；逐文件已核对。
- 小 chunk 原样提取；initial/shared/main/bootstrap 只保存有界片段，不搬入产品。
- 所有 `offsetUTF16` 均为从文件头计数的 **0-based UTF-16 字符偏移**，不是物理行号。
- `native-service-anchors.json`、`transport-core-anchors.json`、`cloud-v2-contract-anchors.json` 为新系统 HTTP/认证/schema 的主要索引。
- `startup-requirements-Da3KfG8r.js` 包含新系统实际请求和响应 Zod schema；`search-refresh-baf795ebded3.js` 包含设置页全量分页合同。

本轮仅只读分析安装包和本仓库，没有读真实凭据、请求服务、执行模型任务或修改真实配置。文档中的合同属于静态发现，不能作为实际可用性证明。

## 先区分两代产品

| 项目 | 新 Codex Cloud | Legacy Codex Cloud |
|---|---|---|
| 设置入口 | `/settings/codex-cloud` | `/settings/cloud-environments` |
| 创建入口 | `/cloud-environments/new`，仓库选择后开启环境配置任务 | `/settings/cloud-environments/new`，旧环境编辑表单 |
| 服务 | 宿主 `environmentConfigs` → ASB HTTP `/v1/environment-configs` | `safeGet/Post/Patch` → ChatGPT backend `/wham/environments` |
| 标识/响应 | `id,name,version_id,repositories,network_policy,draft` | `id,label,machine_id,repos,agent_network_access,etag` |
| 网络 | disabled / unrestricted / restricted + egress rules | off / on / custom + preset_allowlist |
| 环境编辑 | draft、revision、approval、setup thread | etag PATCH |
| Reset cache | 本轮未找到新系统相同动作 | 已证实 POST `.../{environment_id}/reset-cache` |

不能用 Legacy 的 `/wham/environments/search` 实现新系统目录，不能把列表配置称为正在运行的容器。旧页面中的运行/休眠、CPU/GPU/内存规格、镜像模板、三条固定 secret、Date.now 创建、本地清缓存成功提示、仅环境名普通聊天均无本次新系统合同依据，应撤除。

`cloud-environments-settings-page-c26f18c52a08.js` 明确把原页面标为 “Legacy Codex Cloud”，提供迁移提示及继续支持 Code Review/Linear/GitHub 的说明。`16-26-cloud-preferences.md` 的 `/wham/settings/user` 属于旧偏好，不是新环境配置接口。

## 新系统认证与 origin：不能直接套现有 ChatGPT backend routing

官方主进程 `main-DkWgQSQe.js`：

1. UTF-16 `690480` 附近 `Yv` 为 ASB HTTP client。
2. `Que = wss://codex-cloud-backend.chatgpt.com/`；`Jv(options)` 当前返回该 cloud app-server host。
3. HTTP origin 由该 websocket URL 把 `wss:` 转成 `https:`，清空 path/query/hash。当前静态结果为 **`https://codex-cloud-backend.chatgpt.com`**，路径从根 `/v1/…` 开始，**没有 `/backend-api` 前缀**。
4. 仅接收 `/` 开头、非 `//`、同 origin 的 path，fetch `redirect:"error"`、`cache:"no-store"`。
5. `wpe` UTF-16 `894493` 附近以 desktop account 的 `getAuthToken({refreshToken:false})` 创建 `Tpe`，不是 API key。
6. `Tpe` 在请求前后核对 token accountId/userId；变化则返回 authentication，拒收旧结果。
7. `Yv.fetch` 设置 `Content-Type:application/json` 和 **`X-OpenAI-Product-Sku:codex`**，调用 bootstrap `I` 注入认证/desktop surface。
8. `bootstrap-DvSEn4qy.js` 的 `exports.I=i7`，`i7` 加 Authorization Bearer、ChatGPT-Account-Id、适用的 X-OpenAI-Fedramp；`a7` 加 desktop originator 和官方 desktop UA。

此调用链没有走 ChatGPT backend `workspaceRouting.backendOrigin` 重写；不要把固定 ASB origin 改到普通 ChatGPT origin，也不要为了复用现有 helper 添加任意 URL 代理。可以复用宿主 token 获取、JWT 身份校验、取消/generation、受控系统 curl 和脱敏错误，但需要独立固定的 ASB destination/header policy。renderer 永远不能接收 token 或提交任意 Authorization/URL。

官方此窄链路未发现自动 401 重试分支；若项目复用桥的一次 token refresh，需作为已登记实现差异，不称已证明官方时序一致。官方只读通常 30 秒超时；POST 审批某些分支 600 秒。真实账号和政府版部署适用性未验证，不能因 JWT fedramp 位直接推断另一个 ASB origin。

## 22A 可落地的固定只读操作

### 环境目录

实际调用：`environmentConfigs.list({accountId,userId,cursor?})`。

宿主并行执行两个 scope，首屏都请求：

```text
GET https://codex-cloud-backend.chatgpt.com/v1/environment-configs?scope=user&limit=100&omitDraft=true
GET https://codex-cloud-backend.chatgpt.com/v1/environment-configs?scope=workspace&limit=100&omitDraft=true
```

续页每 scope 独立 `&cursor=<URL encoded cursor>`。上层 cursor 为 `{user:string|null,workspace:string|null}`；存在 cursor 对象而该 scope cursor 为 null 时不重复请求已完成 scope。任何一侧错误均不能合成“完整空列表”。

**服务原始响应**（不要拿宿主转换后的 camelCase 当 HTTP JSON）：

```text
{
  data: [{
    id: nonempty string,
    name: string,
    is_owner?: boolean,
    share_settings: "private"|"workspace",
    repositories: [{repository_id:string, ref:string}],
    version_id: nonempty string,
    thread_id?: nonempty string|null,
    version_revision?: positive integer
  }],
  next_cursor: string|null
}
```

原包 schema 把每项转为 camelCase，增加 `status:"ready"`、`latestReadyVersionId:version_id`。**这里 ready 是已发布配置目录转换，不是容器运行状态。** 不得映射为旧 UI 的“运行中/唤醒”。

宿主 `list` 返回 `{ok:true,page:{data,nextCursor}}`。新设置页的 `search-refresh` 在内部循环抓完所有 pages，按 id 使用 Map 合并，再交 UI；不是只取第一个 scope 或首 100 条。`catalog` 是另外的缓存/订阅 API：按 account+user 分桶，user/workspace 合并按 id 去重；尚不完整、失败与空态区分。22A 可先完成无缓存全页读取，缓存订阅单独跟进，不能称整个官方目录机制完成。

### 详情

```text
GET https://codex-cloud-backend.chatgpt.com/v1/environment-configs/{configId}
GET https://codex-cloud-backend.chatgpt.com/v1/environment-configs/{configId}/drafts/{draftId}
```

configId/draftId 宿主 schema 为 `^[A-Za-z0-9_~-]+$`，path 仍需编码。HTTP 响应是**直接 config 对象**，宿主包装为 `{ok:true,config}`：

```text
name: nonempty string
repositories: [{repository_id:nonempty string, ref:nonempty string, depth?:integer 1..2147483647}]
install_script?: string
cwd?: string beginning "/"
start_skill?: string
network_policy:
  {type:"disabled"} |
  {type:"unrestricted"} |
  {type:"restricted", presets?:["package_managers"], egress_rules:[{host:nonempty string}]}
share_settings: "private"|"workspace"
id,version_id: nonempty string
status: string
is_owner?: boolean
version_revision?: positive integer
latest_ready_version_id?: string|null
environment_id?,thread_id?,onboarding_skill?: nonempty string|null
vpn_connection_id?: nonempty string|null
tcp_network_access?: {ip_ranges:string[],domains:string[]}|null
secrets?: [{id?,name,source:"environment"|"user_provided",optional?,error?,target}]
runtime_requirements?: [{source,optional,delivery,error?}]
outbound_identity_requirements?: array
draft?: {
  id,base_version_id: nonempty string,
  revision: nonnegative integer,
  repositories,network_policy,secrets,
  install_script?,cwd?,start_skill?,runtime_requirements?,
  pending_runtime_requirements?,outbound_identity_requirements?,
  vpn_connection_id?,tcp_network_access?
}|null
```

详情 GET 后核对返回 id 与请求 configId；指定 draftId 时还要核对 config.draft.id。不匹配按失败处理。

`secrets.target` 为 environment_variable 或 http_header 的判别 union，域名限制为数组；响应只证明 secret 名称/来源/目标，不提供实际 secret value。不可凭名称伪造掩码条目，不在证据记录值。

### 仓库展示名

新配置中的 repository_id 不是仓库 URL。原包另经 ChatGPT backend：

```text
GET /wham/github/repositories/{repo_id}
```

返回 `repository_full_name`。401/403/404 的特定不可访问分支显示 Unknown repository；不能把 config id 格式反解为 owner/repo。此请求走既有 backend bridge routing，与 ASB origin 分开。未接名称 resolver 时应显示“仓库名称尚未解析”，可展示实际 id 作为调试辅助，但不冒充官方展示一致。

## 官方动作、状态和呈现合同

| ID | 动作 | 已证静态预期 | 22A范围/验收 |
|---|---|---|---|
| CE01 | 打开新环境设置 | cloudAccess 为 true、accountId/userId 非空；loading/未登录/error/empty 不混淆 | 先实现真实只读，不强开未知 gate |
| CE02 | 读取目录 | user/workspace 分页抓全，按 id 合并；任一 scope 失败可见并重试 | 用双scope、空页cursor、错响应、二页失败 fixture |
| CE03 | 输入搜索 | 本地按 name 和已解析仓库名，trim + toLocaleLowerCase；maxLength 128 | 不发送假后端搜索 |
| CE04 | 搜索无匹配 | 稳定 300ms 后原包触发一次真正 refresh（非独立搜索 API） | 未实现该行为列差异，不伪造查询参数 |
| CE05 | 查看详情 | loading/error/retry，显示真实网络/仓库/版本/脚本/secret名称，优先 draft??config 的编辑值 | 验 id、未知状态、空字段 |
| CE06 | 关闭/切账号/离页 | 只接收同 account+user 的响应，旧详情不能回写 | 取消和 generation 回归 |
| CE07 | 新建 | 选择 GitHub repositories，0选中或模型加载中禁 Get started；创建 setup task | 写链不在22A；不可点击即成功 |
| CE08 | 编辑 | 独立 createDraft，再打开环境配置任务；versionRevision=1 文案 Continue setup | 不允许本地抽屉假保存 |
| CE09 | 保存配置 | draft base_version_id/expected_revision，处理 conflict；发布需要 approval operation | 写链单独合同和真实读回 |
| CE10 | 删除 | 确认弹窗、pending禁止重复；仅服务成功后移除/失效相关缓存 | 不在22A，不能 localStorage 删除成功 |
| CE11 | 网络与 secret | 类型来自实际 config，个人 secret 独立库；值不从目录泄露 | 先只读真实元数据 |
| CE12 | Reset cache | 新系统未找到同名 HTTP/动作；旧系统独有已证路径 | 不在新页放假按钮 |

官方新设置页是 settings row 布局，列标题为 Environment / Sharing，仓库名在环境名下，宽屏共享列 `w-32`，窄屏垂直排列。操作在行尾菜单，包含编辑/删除等权限相关动作；不采用旧实现资源卡片+容器状态 tabs。原包存在个人 vault tab，属于独立单元，不以22A代替它。

新设置页 `Nn` 受 shared `GEt`（`Oxn`）cloudAccess 门控；`Oxn` 来源 `hG.cloudAccess===true`。`375130565` 影响新云入口/旧云迁移导航等，**不能只凭该门值替代 cloudAccess**。原包新建 route 还检查身份、bootstrap/auth状态和宿主 environmentConfigs 可用性；offline 包具体 gate 值不作生产依据。

## 写链的精确静态合同，供后续切片

以下均走上述固定 ASB origin；本轮未执行：

| 操作 | 方法/路径 | 关键条件 |
|---|---|---|
| 创建配置 | POST `/v1/environment-configs` | `{name,repositories:[{repository_id,ref}],network_policy,share_settings:"private",start_onboarding:false}`；继而 cloud app-server 创建/恢复 setup thread |
| Legacy 迁移 | POST `/v1/environment-configs` | `{legacy_environment_id,start_onboarding:true}`，不能把两代id混用 |
| 改 name/sharing | PATCH `/v1/environment-configs/{id}` | 仅 `{name?,share_settings?}`，至少一项 |
| 建编辑 draft | POST `/v1/environment-configs/{id}/drafts` | optional `{start_thread:boolean}`；返回 `{draft_id,environment_id,thread_id:null|string}` |
| 改 draft | PATCH `/v1/environment-configs/{id}/drafts/{draftId}`；无draftId时 `/draft` | `{base_version_id,expected_revision?,...}`；指定draftId时 expected_revision 必需；repositories/script/cwd/network/runtime/secrets/vpn等最小变更 |
| 开始审批 | POST `.../{draft|drafts/id}/approve/begin` | `{expected_revision,idempotency_key}`；返回 operation |
| 读 operation | GET `/v1/environment-operations/{operationId}` | `{id,kind,environment_id,state:"PENDING"|"RUNNING"|"SUCCEEDED"|"FAILED",failure?}` |
| 审批 | POST `.../{draft|drafts/id}/approve` | `{expected_revision}` |
| 完成审批 | POST `.../{draft|drafts/id}/approve/complete` | `{operation_id,thread_id?}` |
| 删除配置 | DELETE `/v1/environment-configs/{id}` | 账户绑定，确认后调用 |
| VPN | GET/POST/DELETE `/v1/environment-configs/{id}/vpn?draft_id=…` | POST body 也带 draft_id；provider capabilities来自服务 |
| 个人secret元数据 | GET `/v1/personal-secrets?namespace=sensitive|not_sensitive&cursor=…` | `{secrets:[{id,name,env_var?,target?}],next_cursor}`，不含值 |
| 个人环境变量值 | GET `/v1/personal-environment-variables/{id}/value` | 明确用户操作和数据边界，不能目录预取全部值 |
| 写环境值 | POST `/v1/environment-values` | 另见原schema，不在只读桥开放 |

创建会话不是普通本地 `thread/start`。`pending-onboarding-actions` 使用 cloud serviceName:`codex_cloud`、deferred environment savedEnvironmentConfig、`/workspace`和`/tmp`、environment_onboarding turnTrigger，且先要求用户讨论需求；不得用 envName 拼一段普通prompt当接通。

createDraft 的网络结果未知时，原包保留“Couldn’t confirm whether the editing task was created”并禁重发，避免重复任务。写链回归必须覆盖这点，不能自动无限重试 POST。

## 开发顺序与验收证据

22A：固定 ASB 只读宿主操作 → 双 scope 全分页 → 新 settings row 列表/搜索 → 详情和仓库名 resolver。先撤 fake 状态与写成功提示，同时提供实际读取能力。

22B：GitHub 真实选仓 + cloud setup 任务链；22C：draft编辑/冲突/审批及真实保存读回；22D：个人vault、VPN、身份连接、权限与迁移按能力拆分。不要为进度把所有未接能力直接标为完成或长期只显示未连接。

修改前需补充实现映射及 fixture，至少覆盖：缺认证/API key、403/429、畸形数据、分页scope独立结束、跨scope重复id、cursor循环保护、详情id错配、取消/切账号旧响应、secret不泄值、ASB固定origin/header、不接受任意URL、错误不伪空。关键服务结果需真实账号隔离只读验证；fixture只证明处理这些样本。

视觉/native 当前均 `not_executed`。没有同DPI、语言、主题、客户区和等价数据的官方截图，不能给像素分数或声明1:1。交付时仍要完整检查、当前源码原生构建、UI键盘/焦点验收、差异图与用户验收。

## CE01 补证：cloudAccess 的完整数据链与最小诚实接入

本节补正先前仅记录 getter 名而未追原始输入的缺口。证据为 `cloud-access-chain-anchors.json`；本轮仍未发外部请求。

### getter 不是一个 app-server capability 字段

`app-shared-a906948d8868.js` UTF-16 `3391482` 的 `hG` 使用三个输入：

1. `cG` 当前认证/账户资料；initial 以 `JEt as wa` 导入，在 UTF-16 `8845356` 附近写入 `{accountId,accountInfoError,accountInfoLoading,authLoading,authMethod,plan,supportedSurface,workCloudSupportedSurface}`。
2. Statsig `WH` feature gate `3769444934`（是否启用本地 RBAC 分支）及 `1355972088`（读 permissions 还是旧 beta_settings）。
3. 工作区设置 query `sG(accountId)`；后者走真正 backend HTTP，不是 ASB 的 `/v1/environment-configs`。

`cG.plan` 来自账户信息。官方宿主 `k_`（main UTF-16 `632797` 附近）通过 desktop `getAuthToken` 解 JWT `https://api.openai.com/auth.chatgpt_plan_type`、chatgpt_account_id、chatgpt_user_id，再经过 accessInputs.readAccountInfo 和 renderer account provider。既有 app-server `account/read` 可以提供基础账户/plan资料；**不能据此假称它返回 hG.cloudAccess 或 Statsig结果**。

实际分支：

| 条件 | cloudAccess |
|---|---|
| RBAC gate `3769444934` 为 false | true；manageWorkspaceEnvironments另算，不能混用 |
| RBAC gate 为 true，认证/资料还在加载 | undefined，等待 |
| RBAC gate 为 true，authMethod不是chatgpt/chatgptAuthTokens，或账户/plan无效/读取失败 | null，不能当空目录 |
| RBAC gate 为 true，plan为 free/go/plus/prolite/pro/promax | true；manageWorkspaceEnvironments=false |
| RBAC gate 为 true，其他plan，Statsig还在加载 `HH` | undefined |
| RBAC gate 为 true，其他plan，workspace settings加载/错误 | undefined/null |
| 工作区且 `1355972088` 为 true | `permissions.includes("chatgpt.workspace.feature.allow-codex-access.access") === true` |
| 工作区且 `1355972088` 为 false | `beta_settings.wham_access === true` |

个人plan清单来自 `WW/Ubn`（shared UTF-16 `3381106`）。因此**已核对身份且plan明确属于此个人清单时，两条RBAC分支都得到cloudAccess=true**；可以基于此有证据的窄推导自动读取，仍不能宣称完整gate系统已复刻。unknown/新plan不可自行归个人分支。

工作区管理权限使用另一个 permission `chatgpt.workspace.feature.codex-manage-workspace-environments.access`，不应作为只读目录的替代条件。

### 工作区设置的真实读取链

```text
hG -> sG(accountId)
 -> axn(scope,accountId,signal)
 -> 等 accessInputs subscription ready
 -> accessInputs.readWorkspaceSettings({
      accountId,
      profile:{kind:"codex",language:<实际语言>}
    })
 -> main Uue.readWorkspaceSettings
 -> fetchWrapper.fetchAuthenticatedJson
 -> GET /accounts/{encodedAccountId}/settings
```

无宿主accessInputs的浏览器fallback也是同一路径 `OU.safeGet("/accounts/{account_id}/settings")`。主进程初始化把 `(path,options)=>fetchWrapper.fetchAuthenticatedJson(path,options)` 注入 Uue（main UTF-16 `3213471`）；随后在RPC服务表中导出 `accessInputs:this.accessInputs`（`3221801`）。这不是可以发给CLI的同名JSON-RPC method。

这是**ChatGPT backend桥**路径，与ASB固定origin不同。可以新增固定操作 `workspace_settings`，accountId必须来自宿主当前已验证身份，不允许renderer任意指定其他账户。现有共享桥可复用其token与workspaceRouting；禁止把此路径发往ASB origin。

实际响应schema `hue`（main UTF-16 `631900` 附近）为可保留扩展字段的对象：

```text
{
  beta_settings: Record<string,boolean>,       // 必需
  beta_settings_str?: Record<string,string>,
  permissions?: string[]|null,
  admin_work_mode_enabled?: boolean,
  admin_work_local_enabled?: boolean,
  desktop_app_beta_policy?: "blocked"|"optional_default_off"|"optional_default_on"|"required",
  allow_third_party_gpts?: "allow_all"|"allow_none"|"allow_specific",
  ...其他与本页无关字段
}
```

宿主readWorkspaceSettings包装 `{status:"ready",data}`、`{status:"error",message,httpStatus,errorCode}` 或 `{status:"unavailable",reason}`；本地connection/身份变化、unsupported-auth和subscription失败均不能变成通过。官方读取10秒deadline，缓存通常60秒，身份更新清缓存并通知订阅者。

### Statsig gate 的来源和当前可实现边界

`WH`（shared UTF-16 `3254483`）从 `VH` 的 Statsig client `getFeatureGate(id,{disableExposureLog:true}).value` 读取；`HH` 是加载标记。initial 的 `WAs/wks` 登录后引导链为：

```text
POST /wham/statsig/bootstrap
body:{
  app_session_id,app_version,brand_name,build_flavor,
  desktop_app_beta_enabled?,locale,stable_id?,
  system_name,system_version,window_type
}
 -> {statsigPayload: JSON string}
 -> JSON.parse(payload).user
 -> new StatsigClient(clientKey,user,options)
 -> dataAdapter.setData(payload)
 -> initializeSync()
 -> StatsigProvider / VH -> WH
```

endpoint调用在initial UTF-16 `2864759`，bootstrap组装在`8996225`，client初始化在`9018845`。另有浏览器/失败fallback的 async init/updateUser 链。当前包有已知gate补丁，不能把本地客户端默认false或补丁true当实际账号服务评估值。

现有CLI `account/read`、`getAuthStatus`、`configRequirements/read` **未证明提供这两个Statsig评估值**。上述bootstrap是已找到的真实HTTP来源，但其完整payload验证、SDK评估语义、身份绑定和fallback尚未在本项目实现/实测；不能仅拿HTTP200或任意JSON字段称为官方gate通过。当前不应为了22A新增依赖或伪造官方app_version/brand_name/client身份来拼bootstrap。

### 给22A的执行决定

- 身份与个人plan已由宿主核对时，可以按上表窄推导自动读ASB，记录 `gateEvidence:"personal-plan-branch"`，不是ASB HTTP200反推gate。
- 工作区账户可接入真实 `/accounts/{id}/settings` 作为权限原始证据；但缺少两个Statsig实际评估时仍是 `gateEvidence:"incomplete"`，不擅自选择permissions分支或beta分支。
- 在工作区gate未知的开发阶段，最小诚实交互为明确显示“官方云访问资格尚未完成核对”，提供用户主动的“读取云环境”按钮执行既有授权范围内的真实只读请求。这属于**显式读取模式差异**，不得标官方CE01通过；请求后按服务结果呈现，403不绕过，HTTP200只证明本次读取获服务接受。
- 该按钮不能暗中开启创建/编辑/删除，不能修改官方或账号配置；后续完成身份绑定的gate读取后才恢复官方自动加载合同。

## 22A 修改前实施映射（2026-11-03）

宿主ChatgptService新增独立CloudServiceRequest/CloudProfile与固定list/detail/draft操作，ASB固定根origin不依赖workspaceRouting。实际host UA来自app-server initialize返回，originator用本项目真实initialize name codex-tauri-native；不伪装官方版本/品牌。前后getAuthStatus核身份、同generation取消、30秒超时、不重试401。仓库名resolver独立github_repository走现有ChatGPT backend，并保留路由/权限失败。

CE01宿主cloud_service_access先核token身份、读取account/read真实plan、再次核token身份。精确命中六种个人plan返回personal-plan-branch后自动加载；其他/incomplete仅提供显式“读取云环境”按钮，仍不声称官方gate通过。未新增Statsig依赖或强开未知gate。

前端cloudEnvironmentService负责HTTP原始schema校验、user/workspace并行各自全分页与cursor循环保护、跨scope按id合并、后页错误保留真实已读项、真实仓库名与错误。页面按环境/共享行布局呈现，本地搜索仅匹配真实name与已解析repo名；无匹配稳定300ms只触发一次真实刷新，避免循环。详情真实configId，草稿优先network/repositories/scripts/secrets元数据，不显示secret值，不将status当容器运行。切号/离页/详情关闭取消旧读并拒绝晚到。

撤旧示例资源/本地配置写入/假运行休眠/假创建清缓存与普通prompt云任务回调。真实新建/编辑/setup/审批/删除/vault等仍在22B–D范围，不以隐藏假按钮当完成写链。自动回归执行生产helper/TSX/Rust本地fixture，真实账号HTTP/原生/像素独立未验。
