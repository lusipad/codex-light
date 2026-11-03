# 12B 连接生命周期补充取证

日期：2026-11-03。性质：只读静态候选研究，未做账号 OAuth、官方原生运行时或像素验收。本文补充 `12-next-closure.md`，不放行整页。

基准仍为 SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb` 的含 offline 补丁安装包。已知导航 chunk 被改为 `return!1`；本文不依赖它证明连接行为。`app-initial` 中还存在 `yC(e=sm){return!1}`，因此 hosted 分支是否原样也不可确认。下表数字均为 0-based UTF-16 字符偏移。新增清单：`.ref/parity/12/actual/12B-research/connection-lifecycle-manifest.json`。

## 新生命周期的读取并非猜测

| 文件/位置 | 事实 |
|---|---|
| `app-initial` 8999258 `appLifecycle:"403472035"` | 功能 gate 名称与 ID 的映射；这是运行时 feature gate，不是可写本地偏好。当前账号 gate 值未知。 |
| `plugin-installation-content` 60824 `j=On("403472035"),M=j||m` | 插件准备使用 gate 或 hosted 分支选择新生命周期。 |
| `app-initial` 1388637 `Ozt` | 新路径先 `app/installed`，强制刷新传 `{forceRefresh:true}`，普通读取传 `{}`；再将 ID 按 100 分组 `app/read {appIds}`。`callable` 映射 `isAccessible`，`enabled` 映射 `isEnabled`。 |
| 同上 | 仅 `app/installed` 或 `app/read` 被识别为不支持时退回旧读取；其他错误抛出，不吞掉当旧模式。旧路径 `app/list {cursor,limit:1000,forceRefetch}` 全分页，失败允许重试一次。 |
| `plugin-installation-content` 100942 `qo` | 仅旧路径允许 `app/list.isAccessible===true` 将必需应用标 connected；新路径不能用相同判断代替回调成功。 |

因此可以实现并测试真实运行时新状态读取，无须写死“只支持旧生命周期”。但 `callable=true` 的运行时事实本身，不等于本次 OAuth、某个外部账号或特定 link 已完成。

## 已追到的实际 HTTP 认证链

`app-shared` 的 `vzr`（5161337）实现连接类型分流。它不是 `app-server` 的 OAuth RPC：

1. `GET /aip/connectors/{connector_id}?include_actions=false` 取得真实 connector 元数据、支持的认证类型；header `OAI-Product-Sku`，默认产品为 `CODEX`。不可连接/管理员禁用时失败。
2. API key：`POST /aip/connectors/links/api_key`，body 含 `connector_id,name,action_names,key,link_params,install_attempt_id`；要求 expected identity，禁止自动重试。缺 key 返回 requires-connection-form。
3. 无认证：`POST /aip/connectors/links/noauth`，body `connector_id,name,action_names:[],install_attempt_id`。HTTP 返回 `.id` 后才产生 connected-directly。
4. OAuth：`POST /aip/connectors/links/oauth`，body：
   - `connector_id,name,action_names`（缺省为 null）；
   - `callback_url`：原生桥 `app-connect-oauth-callback-url` 提供，不能直接拿 installUrl 代替；
   - `post_auth_url`：应用 origin 的连接页面或严格验证的 redirectAfter；
   - 可选 `link_params,install_attempt_id,requested_companion_connector_ids`；
   - 特定 Slack 应用可有 `slack_team_id`；特定登录分支可有 `siwc_login`。
   - 同样传 `OAI-Product-Sku` 和 expectedIdentity。返回非空 `redirect_url` 才通知 onOAuthStarted，然后打开外部浏览器。此时结果只是 oauth-started。
5. 服务账号另走 `/aip/connectors/service_accounts/links/{api_key,noauth,oauth}`，参数是 `service_account_account_user_id`，不能复用普通用户身份假装等价。
6. 重授权另走 `POST /aip/connectors/links/oauth/reauth`，body `callback_url,link_id,post_auth_url,requested_scopes`。不得把增加账号、重新授权、首次连接混为同一动作。

主进程 `main-DkWgQSQe.js` 1402400 返回 `${打包协议scheme}://connector/oauth_callback`；3316836 附近收到 connectorOAuthCallback 深链接时显示主窗口，并发 `connector-oauth-callback {fullRedirectUrl,returnTo}`。这条原生路由与本项目当前 Tauri 协议注册不是同一条路，**禁止注册/抢占官方 scheme 或把官方 callback URL 用作本项目成功条件**。

## 回调身份与真正成功条件

`app-initial` 7463945 `BPo`：

- 从服务端 `redirect_url` 的 query `state` 读取 OAuth state，不本地捏造服务端 state。
- 以 state 登记 pending 项：appId、hostId、resumeTarget、callbackOwnerId、claimed/completed、诊断 ID、可选账号、插件安装 OAuth state、companion IDs。
- 插件恢复记录用 `app-connect-oauth-plugin-install-resume-by-state-v1`；当前窗口 owner 使用 UUID；claim 防重复处理。增加账号还检查 accountId、userId、attempt expiry。
- 插件尝试与 OAuth 尝试有各自 identity。旧安装回调不能恢复后来重装/卸载的插件。

`app-initial` 7474967：

```text
POST /aip/connectors/links/oauth/callback
OAI-Product-Sku: 真实上下文产品值
body: { full_redirect_url: 完整回调URL }
```

HTTP 成功返回 `link` 后才标 callback completed；使用 `link.connector_id`、`link.id`、name 建立成功结果并失效相关缓存。访问拒绝、服务端错误、scope mismatch 有失败/取消路径；新插件生命周期还涉及安装回滚，不能只显示通用成功 toast。

- 当前连接 link：`GET /aip/connectors/{connector_id}/link`（1412523）。应用绑定必须匹配 connector ID，不能只匹配显示名。
- 账号可访问 links：`POST /aip/connectors/links/list_accessible`，body `{principals:[],link_refresh_strategy:"BLOCKING"}`，带 `ChatGPT-Account-Id` 与产品 header（1401098）。
- companion 成功不是主应用 OAuth 成功自动推导：对每个真实 link 重读，只有 `auth_status==="ACTIVE" && auth_type==="OAUTH"` 才计入 connectedCompanionAppIds（7477300 附近）。
- 普通可连接状态还区分 `REAUTH_REQUIRED`、`unavailable_reason`、`DISABLED_BY_ADMIN`、隐藏和 implicit links。不能用“links 非空”推断全部可用。

## 可落地范围与缺口

已证实存在真实 HTTP 启动和 callback 完成链，故不能称“官方没有 OAuth API，只能打开 installUrl”。在本项目实现完整链的前提是：现有鉴权 HTTP 桥能正确绑定账号/用户并发送产品 header、本项目自己的被服务端允许的 callback 机制已验证、深链接单实例和窗口路由已打通、state/owner/尝试隔离和错误回滚有回归。

本次没有向真实账号发起连接或读取私密 link。服务端是否接受 Tauri 自有 scheme、回调白名单、当前账号 gate、各认证类型 schema 的运行时完整性均未证实。故可立即开发 app/installed＋app/read 的新生命周期只读能力；有真实服务端 HTTPS installUrl 时可提供外部连接和显式状态重读，但应明确“等待确认”，不宣称已复制自动 OAuth 回调。完整 OAuth 应作为明确后续合同，不通过拼接官方 URL/篡改 gate 来假装完成。
