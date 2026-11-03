# 23E 分享上传边界补充调研

日期：2026-11-03。只读静态调研；本轮未写产品代码、未访问真实 HTTP、未读取凭据、未实测官方 UI。本文件补充 [23-share-thread.md](23-share-thread.md)，不代表开发或验收完成。

基准仍为带 `codex-offline` 补丁的候选包 `C:/Users/lus/Codex/_internal/app/resources/app.asar`，SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。不可当作干净发行版或当前账号 gate 结果。直接从 asar 内存读取，内容起点 `8 + readUInt32LE(4)`；下列代码偏移全部为 **0-based UTF-16 字符偏移**。

| 包内文件 | SHA-256 |
|---|---|
| `webview/assets/app-initial-fd3c4b862660.js` | `577a50e29502f573e2fbccf4940b9bd875339db420d6d5a9798a0d201ee0aff1` |
| `webview/assets/app-shared-a906948d8868.js` | `1ffb0654bdfcba23be50c06c8698e665bdb17330d923758001d01262aa81cb5b` |
| `webview/assets/share-thread-d5a88d0b0559.js` | `d98b18d0838f26a2dd8b7fc4e64a9e0ee4cc60cb38b97990291efed318aa34b7` |
| `.vite/build/main-DkWgQSQe.js` | `d33ed281dc58766cbbccb8e92a7149268a528901de8858c2d69750d12c6c205b` |
| `.vite/build/bootstrap-DvSEn4qy.js` | `5a901ee1d59062eed03495e017158f6c44b9414cf27e876d4124e0361e91ddd6` |
| `.vite/build/startup-requirements-Da3KfG8r.js` | `076910a884f85d9c61678914cb49ec10d9a2e478d283f74b15280190a2b56ad4` |

## 1. 远程图片校验是服务请求，不是本地域名列表

`app-initial` export 表 @11086163：`MVs as TC`。其定义 @9250703：

```js
async function MVs(e){
  return(await vf.safePost(`/ecosystem/url_safe`,{
    requestBody:{resolved_pineapple_uri:null,url:e}
  })).safe===!0
}
```

分享文件 @4053 `ct` 的完整 HTTP 分支可确认：

1. `/^https?:\/\//i` 来源先 `await xe(o)`，只有严格 `safe === true` 才继续。
2. 使用浏览器 `fetch(o,{credentials:"omit",redirect:"error",signal:a})`。
3. HTTP 非成功、无 body reader、非法 MIME、读取异常均不产生可上传资产。
4. Content-Length 与逐块读取均检查既有 25MiB 上限；abort 后抛出取消。
5. 校验函数本身没有传入此次分享的 signal；原样复刻会留下校验请求取消隔离缺口。实现可在阶段前后复查事务身份/取消，并为固定的安全校验 POST 传 signal。

**已知边界：** `url_safe` 的服务器实现、DNS/IP 规则及返回 false 的具体原因均不可由包内代码恢复。不能用“HTTPS 就安全”、猜测 OpenAI 图片域名或本地几个 private-IP 判断冒充该服务。若此固定校验 endpoint 尚未实现，远程图应转 unavailable，明确记录缺失，不开放任意宿主下载代理。

## 2. XAt PUT 链与认证注入

`app-shared` export 表 @7689132 附近：`vU as XAt`；类赋值 @3282477。

- `vU.fetch` @3284xxx → `xmn` @3278866 → `i6.httpFetch.fetch(requestId,request,progress)`。
- `fetch` 将 URL、method、body、headers、expectedIdentity、retry、returnErrorResponse 传宿主；非 2xx 经 `bmn` 抛错。成功不要求 JSON，所以空 PUT body 合法。
- 分享 @6459 与资产上传链均直接使用 authenticated `upload_urls` 返回的 URL/headers；本次完整包扫描仅分享文件含 `shared_threads/upload_urls`，没有发现独立的服务返回 Zod strict schema。
- `app-shared.getRequestTarget` @3292662 只组合 path/query 和 additional headers；`makeRequest` @3293310 最终原样返回 response body，**safePost 名称不表示 response schema 校验**。

宿主 `main.fetchHttp` @6662xxx → `performDesktopFetch` @668793：

```js
this.options.applicationNetwork.assertAllowed(c);
// ...
v=bue(n,{inferAuth:this.shouldInferCodexApiAuth(c)});
// ...
if(v.attachAuth&&!this.isDesktopAuthAllowedUrl(c))
  throw ...("Refusing to attach authentication to non-OpenAI URL");
```

`shouldInferCodexApiAuth` @676713 仅对被允许的 OpenAI URL，且 pathname 为 `/wham`、`/api/wham`、`/backend-api/wham` 或指定 estuary/content 路径时推断 auth。其他目标不因“来自同一个 fetch 类”自动附 ChatGPT token。桌面 surface、DeviceCheck、integrity 也各有目标检查。

`performDesktopFetch` @671818 的网络调用使用 `credentials: h ? "include" : "same-origin"`。普通返回 URL 的 PUT 没显式 `credentials:"omit"`，也没由分享调用设置 redirect；只有 workspace routing 激活时强制 `redirect:"error"`。因此：

- **不能声称官方 PUT 本身已证明固定 host allowlist、禁止重定向或绝对不带任何 cookie。**
- 本项目宿主 curl 不使用浏览器 cookie jar，不附 ChatGPT Authorization/account/integrity，并拒绝重定向，是可审阅的保守实现边界；其中拒绝重定向比已观察到的普通 PUT 调用更严格，需保留差异。
- URL/headers 必须仅由宿主 authenticated `upload_urls` 响应产生，保存到身份绑定的 preparation/session 中；renderer 只能引用该 session，不能提供任意 target URL、header 或替换 manifest。

## 3. 官方目的地策略来自组织配置

`bootstrap` @1761700–1763510：网络策略随 app-server requirements 加载；连接/账号更新会刷新/失效。`allows` 使用 `startup-requirements` 导出的 `na`；所有宿主 fetch 进入 `assertAllowed`。

`startup-requirements` @102658 `ta`：

```js
let i=r.data.requirements?.application?.network;
return i?.enabled===true
  ? {kind:"restricted",allowedDomains:new Set(
      Object.entries(i.domains).filter(([,v])=>v==="allow").map(([k])=>k))}
  : {kind:"unrestricted"};
```

@103275 `na` 对 restricted 模式仅允许 HTTPS/WSS 且 hostname 精确出现在 allowedDomains（移除尾部一个点）；不是后缀通配规则。无有效策略则网络默认拒绝；app/data/file 等内部 scheme 分支与 PUT 用途无关。

**可实施判断：** 无需猜测 Azure/S3 等生产域名，能够实现只消费认证服务目标的 host-owned PUT；服务提供的上传 URL 是本次操作的授权数据。仍应做 HTTPS、无 userinfo/control 字符、合理 URL/header 长度、无凭据注入、无跳转等本地结构校验。若要宣称组织策略 1:1，还必须读 `configRequirements/read` 的 `requirements.application.network` 并执行同等策略；不能因 URL 来自服务就绕过已启用的组织域名限制。严格域名列表不是从上传样本猜来的静态依赖。

“拒绝 loopback/private 目标”等 SSRF 加固可作为本项目额外边界，但本轮没有证据表明这就是官方 `na` 的规则；不要写成官方合同。DNS rebinding 完整防护也未从此链得到证明。

## 4. POST 的已观察重试与未知结果

`main` @635022 `Cue`：仅 `attachAuth && token != null && status===401`。`performDesktopFetch` @672xxx：

- `retry !== "never"`、无 workspace IP authorization error、且满足 Cue 时，刷新一次 token 后重新发送；不限 GET，所以分享 POST 也可能被重放。
- 唯一显式的特殊 POST 排除在 `/flora/browser/form-fill`；不是分享。
- `share-thread._t` 未提供 `retry:"never"`；UI mutation @约10500 明确 `retry:false`，只禁止 React mutation 重试，不能阻止宿主 401 刷新重发。
- 没观察到分享 POST 的通用网络/5xx retry、idempotency key 或响应丢失恢复 endpoint。其它 trace-export POST 的退避重试属于另一个功能，不得套用。

本项目可选择发布 `retry:"never"` 等价的单发策略，保留网络结果未知状态并禁止盲目重发。不能同时称“完全复制官方 401 自动重放”与“发布绝不重放”；前者是本轮静态事实，后者是需明示的保守选择。身份已变时不得用新账号重发旧事务。

## 5. Audience 与 feature gate

`app-initial.LSo` @7150970 起：`M=fu(e,"4157559322")`，之后 `M && !D` 才加入 share-thread 菜单；D 是既有另一类会话判定。该 gate 的账号实时值未知，候选包还含其他 gate 的 offline 改写，不能默认所有账号具备分享。

`share-thread.Nt` @约19900：

```js
o=queryClient.getQueryData(["accounts","check"]);
s=o?.accounts?.find(({id})=>id===o.account_ordering?.[0]);
c=s?.structure==="workspace";
```

这决定 `isWorkspaceAccount`。不是由邮箱、plan 字符串或 userId 推断。`Ct` @约8900 默认 `workspace` / `public`；@约15100 workspace 的选项仅 `workspace` 和 `invited`。个人分支 public，不显示 workspace 邀请控件。

用户 principal 使用 account_user_id；group 使用 group.id。`use-workspace-users` 实际搜索与 groups 查询尚未在本文件完全还原。`accounts/check` cache ordering 必须确认是当前已选账号语义，不能随意取数组第一项替代。运行时是否还有服务拒绝/组织分享限制未知。

## 6. 当前 bridge 的复用结论

`src-tauri/src/chatgpt_service.rs` 现有 `Credentials`、`ServiceIdentity`、generation、cancel、workspace routing 与 integrity store 可复用。`build_http_request`：

- URL 为已验证 `credentials.origin + 固定 route`；
- origin/accountRoutingOverride 来自真实 `account/read.workspaceRouting`；
- 可形成 `/backend-api/wham/shared_threads/upload_urls` 与 `/backend-api/wham/shared_threads` 固定路由；**不复用 ASB 云环境的 codex-cloud-backend origin**；
- 现有浏览器 profile 验证、认证与 account header 由宿主添加，保留不向 renderer 泄露凭据；
- 现有 read_with 的 401 refresh/replay 循环不能直接用于发布写入。

现有 HttpRequest/transport 仅 GET，需增加明确的 method/body 与空 body PUT 成功路径；renderer 不得调用这个扩展成为任意网络代理。事务必须绑定 expectedIdentity+threadId+hostId，申请/上传/发布前后复查，取消/身份失效清 session，丢弃晚到结果。已成功发布的 URL 应缓存在会话，复制失败只重试复制。

建议先用 production transport 的 mock 测试证明：

1. authenticated POST 仅两个固定发布路由及固定 url_safe 路由；PUT 不携 bearer/account/integrity/cookie。
2. target 不能由 renderer 注入/替换；header 大小、换行、case-insensitive 保留策略正确。
3. 账号切换、取消、过期、乱序晚到结果不能发布。
4. 非 2xx、空 PUT body、redirect、缺失/重复/额外 asset target、无效 response shape 均有明确结果。
5. 发布网络结果未知不自动重发；已发布而复制失败不二次发布。

严格响应 schema 仍未发现。可实现 **本项目的运行时消费验证**（非空 etag/file_id、URL/header 类型、assetId 精确映射、share_id/share_url），但不能给额外字段 deny_unknown_fields 后声称源自官方 strict 服务合同。

## 7. 剩余未证与验收限制

- 干净发行包、真实 gate、账号权限、组织策略、服务响应与目标域样本。
- `url_safe` 服务器策略；本地/远程主机图片读取边界。
- Workspace 成员/组搜索完整合同、中文 UI 与像素/原生实测。
- 发布响应丢失恢复/幂等、上传孤儿清理与撤销 API。

本文件仅用于实施边界，未进行构建或产品测试。文档空白检查应单独执行；任何后续功能通过声明应引用对应源码/测试/真实服务证据。
