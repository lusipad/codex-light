# 23F 分享入口、受众与对话框合同

日期：2026-11-03。状态：实施前只读静态调研。未真实 HTTP、未读取凭据、未官方 UI 实测；不代表功能、像素或用户验收通过。与 [分享合同](23-share-thread.md)、[上传边界](23-share-upload-boundaries.md) 合读。

## 基准及定位

候选 asar：`C:/Users/lus/Codex/_internal/app/resources/app.asar`，SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`，含 offline 修改，不能据其强开分支推断发行版权限。直接内存读取，内容起点 `8 + readUInt32LE(4)`。偏移为 0-based UTF-16 字符，非字节/行号。

| `webview/assets/` 文件 | SHA-256 |
|---|---|
| `app-initial-fd3c4b862660.js` | `577a50e29502f573e2fbccf4940b9bd875339db420d6d5a9798a0d201ee0aff1` |
| `app-shared-a906948d8868.js` | `1ffb0654bdfcba23be50c06c8698e665bdb17330d923758001d01262aa81cb5b` |
| `share-thread-d5a88d0b0559.js` | `d98b18d0838f26a2dd8b7fc4e64a9e0ee4cc60cb38b97990291efed318aa34b7` |
| `use-workspace-users-72736cc010e7.js` | `83b2133b5193708aa3160ad1bcea75d785deda1f8329b855fc9d9285d0259f06` |
| `thread-dialog-45330e4e6e0e.js` | `dd33d6c2ef5bb51549c9574ffec87586eb6d55c509993984112aa0df95df8354` |
| `dialog-shell-396c502f9935.js` | `8b8e707438461db41ad8def91d3d18ea8efc92418167b55af33588b7bcbfeb87` |
| `access-section-a1bd060e4cd8.js` | `9e50ff0d2c56820120b8f9c2a28ed9f6c7dcd627b086654e9851578c41d62259` |
| `thread-preview-a66e4b6c0fff.js` | `c899fbe2876360d9cd4cedf400acc2a8011d2002b1c6ac6dda75f0012f9851d3` |
| `zh-CN-3ed9eb1db28a.js` | `c6ac10a9fb407a393ea002d9aa818a4c7ed0e215e9c8bf0cfe2b798a98e3756f` |
| `app-shared-342447930c78.css` | `916d8fa55c82aedbf6ca0f53eec06274ec9eafe08397bb7e9e495d089781f93d` |

## Gate：不能把候选包的 true 当真实授权

`app-initial.LSo` @7150970、@7151629：`M=fu(scope,"4157559322")`，`M&&!D` 才加入分享菜单。D 为既有另一类会话判定。`fu` 是从 app-shared 导入的 `_Mt`，export 反查为 `BH`，@3248677：

```js
function BH(scope,name){
  let client=scope.get(VH);
  return client!=null&&client.checkGate(name)
}
```

**候选包污染已明确定位：** app-shared `checkGate(e,t)` @3225957 被改为已知列表走 getFeatureGate、其余直接 true，尾注 `codex-offline:default-on-gate-wrapper`。`4157559322` 不在这段列表，故此包 checkGate 会直接 true。不可复用该补丁逻辑。

原始可观察求值机制：

- `_getFeatureGateImpl` @3234517：store.getGate → makeFeatureGate → 可选 overrideAdapter → exposure；不能仅凭 UI checkGate 为 true 确认服务返回值。
- V1InitializeContainer @3203075：`feature_gates[name] ?? feature_gates[DJB2(name)] ?? null`，结果使用 `.value`。
- V2InitializeContainer @32036xx：相同查找，紧凑字段 `v===true`，rule/id_type 等展开；`response_format==="init-v2"` 才选此解析器。
- `_DJB2` @2067692 实际是 `h=(h<<5)-h+charCode` 从0累加、32位无符号十进制；此名称的哈希为 **`1016046617`**，不是常见 seed5381 的另一种 DJB2。
- store 还存在 live_overlay、保留 live 值、缓存/部分用户匹配/增量响应及 override 优先级，不宜把一次原始 JSON 查找声称完整 SDK 等价。

登录 bootstrap：`app-initial.Wer` @2864802：

```http
POST /wham/statsig/bootstrap
```

body（@8996219 wks）：

```ts
{
 app_session_id, app_version, brand_name, build_flavor,
 ...(beta ? {desktop_app_beta_enabled:true}:{}),
 locale, stable_id, system_name, system_version, window_type
}
```

返回消费 `{statsigPayload:string}`；10s超时、retry:false。JSON.parse 后 loose schema 要求 `user`，支持 userID/customIDs/custom/appVersion/locale 等。随后 `new StatsigClient(sdkKey, returnedUser, options)`、`dataAdapter.setData(statsigPayload)`、`initializeSync()`；启用 live values 自动刷新。请求后续通道走官方 Statsig transport，不是仅本地一次布尔求值。

**实施决策建议：** 可以不新增SDK实现“身份绑定、仅识别完整V1/V2 bootstrap快照的已验证 gate 读取”，其它格式/增量/缺项/身份不符明确 unavailable。必须核对返回 user.userID 与当前 userId、customIDs.account_id 与当前 accountId；稳定ID/locale/实际appVersion也应属于同一请求。不得使用官方品牌/版本/窗口身份伪装本项目来请求 gate；应提交本项目真实元数据，服务是否接受仍未验证。未获得可验证 bootstrap 时 gate 保持 unknown/不可用，不能猜 true 或仅由个人 plan 推导。此窄实现不等于完整SDK求值，更不保证服务器为本项目品牌返回与官方相同分流。

## Accounts/check：桌面主路径与 legacy 形状不能混用

app-shared `ixn` @3384771 是 app-initial 导入 `hDt as GNe` 的实现：

1. 等待 accessInputs subscription ready。
2. 默认桌面 enabled 分支走 host `accessInputs.readAccounts(language,force)`。
3. 无 host 时 `GET /wham/accounts/check`，无 query。
4. 另一 legacy 模式才 `GET /accounts/check/v4-2023-04-27`，原始 accounts 是 map，经过 `$bn` 扁平转换，不可拿它冒充 wham 直接响应。

原生 main @682387 `readAccounts` 60s缓存，调用 `/wham/accounts/check`，requestProfile `{kind:"codex",language}`，经真实 workspace routing。现有 bridge 对应固定 URL 为 **`/backend-api/wham/accounts/check`，无 query**；复用 ChatGPT bridge，不走ASB。

main @6800xx `Hue` schema：

```ts
{
 accounts?: Array<{
  id:string, account_user_id:string,
  account_user_role:"account-owner"|"account-admin"|"analytics-viewer"|"standard-user",
  structure:string, plan_type:string, is_zdr:boolean,is_openai_internal:boolean,
  name?:string|null,profile_picture_url?:string|null,
  account_residency_region?:string,can_access_with_session?:boolean,
  enable_account_switching?:boolean,is_deactivated?:boolean,
  is_fedramp_compliant_workspace?:boolean,
  workspace_backend_origin?:"NO_CONSTRAINT"|"https://gov.chatgpt.com"|null,
  account_routing_override?:"NO_CONSTRAINT"|"us"|"us_cr"|null,
  sso_connection_name?:string|null
 }>,
 default_account_id?:string|null, account_ordering?:string[]
}
```

这是普通 object schema，未见 strict。`structure`是 string，不是完整枚举。只确认 `"workspace"` 为工作空间；不能把所有未知字符串当个人。

分享 Nt @约19900 找 `account_ordering[0]` 对应的 accounts[].id；legacy转换 `$bn` 会将 selected/default account 放首位。项目实施应额外确认选中记录 id 等于事务 expectedIdentity.accountId，当前身份未变，ordering 与数据一致；不匹配返回不可用，避免错误受众。account_user_id 是此账号下成员ID，**不能直接用当前 auth userId 代替**。

## 成员/组：固定 GET API 与消费字段

`use-workspace-users` 全文件：trim查询、150ms debounce；仅 chatgpt/chatgptAuthTokens、accountId非空、trim查询非空且debounce稳定时请求。15s超时，retry:false，60s stale，networkMode:always。query key 包含 accountId/查询。

| 来源 | 固定 path（bridge补 backend-api） | query |
|---|---|---|
| 分享成员 | `/accounts/{account_id}/users` | `limit=10&offset=0&query=<trim>&include_profile_photos=false` |
| 分享组 | `/accounts/{account_id}/groups` | `limit=10&offset=0&query=<trim>&include_member_counts=false&include_total=false` |

分享调用默认 source account，不走 `/spaces/people`；后者只是相邻功能分支。消费均为 `response.items`；包内此模块不做 strict response parse。

分享最低消费：

- user：`account_user_id`、`name`、`email`、`id`。`dialog-utils-21c4d759328d.js` 的 `t`/`n` 可确认 label=`name??email??id`，chipLabel/secondaryLabel=`email??undefined`，colorKey=account_user_id，option id=`user:${account_user_id}`；此路径无照片。须过滤当前 account_user_id、已选成员；不能以邮箱当 principal_id。
- group：`id`、`name`、`num_members`（模板为复数计数，虽然请求include_member_counts=false，仍消费它；缺失时不应本地捏造人数）。
- 发布：`{principal_id:user.account_user_id,principal_type:"user"}` 或 `{principal_id:group.id,principal_type:"group"}`。
- groups列在people前；已选组按 group.id 排除。每次搜索须以当前 accountId/事务身份绑定，丢弃旧query晚到结果。
- workspace默认workspace；选第一个成员/组会自动改 invited。若这个自动切换发生，删去最后一项会自动回workspace；用户手动选择invited后空列表则保持invited并禁用发布。切回workspace清选中和查询。
- 未发现成员返回的完整服务 schema；实现最低消费字段校验可拒绝缺ID的项，不能称已恢复全部服务返回字段。

## 官方中文文案

来自本轮重新读取的 zh-CN chunk，非 defaultMessage 翻译：

| Message suffix | 中文 |
|---|---|
| `shareDialog.thread.title` | 分享聊天 |
| `shareDialog.thread.namedTitle` | 分享 {threadTitle} |
| `shareDialog.thread.previewLoading` | 正在加载预览… |
| `shareDialog.thread.previewLabel` | 共享聊天开头部分的预览 |
| `shareDialog.thread.linkLabel` | 分享链接 |
| `shareDialog.thread.retry` / `.close` | 重试 / 关闭 |
| `shareDialog.whoHasAccess` | 谁有访问权限 |
| `codex.sharedSnapshot.shareDialog.copyLink` | 复制链接 |
| `.publicAccess` | 任何拥有该链接的人 |
| `.publicPreviewAccess` | 任何知道此链接的人都可以查看此聊天 |
| `.workspaceAccess` | 此工作空间中的所有人 |
| `.namedWorkspaceAccess` | {workspaceName} 中的所有人 |
| `.invitedAccess` | 仅限受邀成员和群组 |
| `.recipientPlaceholder` | 添加成员或群组 |
| `.recipientSearch` | 通过电子邮箱添加成员或添加群组 |
| `.noRecipients` | 没有匹配的工作空间成员或群组 |
| `.groups` / `.people` / `.owner` | 群组 / 成员 / 所有者 |
| `.groupMemberCount` | `{count, plural, one {# 位成员} other {# 位成员}}` |
| `.prepareFailedRetryable` | 无法准备此聊天以供分享 |
| `.publishFailed` | 无法创建共享链接。请检查谁有访问权限，然后重试 |
| `.copyFailed` | 无法复制共享聊天链接 |
| `.sharedContentNotice` | 分享后，你的姓名以及你添加的新消息不会显示在共享聊天中。<learnMore>了解更多</learnMore> |

learnMore 指向官方 shared-links FAQ 的信息包含片段。该文案不能被扩写为“图片/HTML已清除所有机密”。

## 布局几何与状态

`thread-dialog` → `dialog-shell` → app-initial `nBo` @7664127 → app-shared dialog：

- share Ct 未传size，默认 `cbi(undefined)` @6442521 为 `w-130`，**520 CSS px**，不是 `size:"share"` 的640px。
- modal opaque；fixed left/top 50%，translate(-50%,-50%)；max-width92vw；圆角rounded-3xl、surface-elevated-secondary、shadow-lg、0.5px ring-border。zoom/物理像素必须运行时另测。
- nBo 为header/body/footer三行grid；滚动内容 `-mx-5` / 内层 `px-5 py-5`，min-height24=96px；body布局scrollable max-height `min(85dvh / --codex-window-zoom, --spacing*176)`。
- app-shared CSS `_body_1k5bv_2` @59088：padding-inline/block `spacing*5`=20px；section顶部12px，首个section为0；footer不是首个可见项时margin-top20px。
- header `mb-2`、gap2、`pe-8`（8、8、32px）；title truncate。heading-dialog 20px/28px，codex-dialog取消letter-spacing；正文base14px、小字12px。尺寸依赖root token，非截图测量结论。
- preview：min-height56=224px，aspect1200/630，overflow hidden、rounded-lg、border/default、bg-surface、select-none；role img；内容aria-hidden/inert；底部64px渐隐。预览仅前4个非空turn，不能替代上传全文审核。
- 权限section gap12px；图标容器36×36圆形；trigger gap12px；菜单align start/contentWidth menu；所有者尾部12px描述文字。
- footer outline medium submit按钮，显示“复制链接”；busy时spinner，非busy显示link图标。具体按钮高度/焦点环仍需沿共享button token和运行时测量，勿猜。

| 状态 | 按钮/关闭/错误 |
|---|---|
| loading（读取/资产/上传） | 主按钮禁用且busy；可关闭，关闭abort |
| prepared | 可复制链接即发布；invited空、query未清空时禁用 |
| creating | busy；禁止dismiss（无关闭按钮、ignore outside）；防双击 |
| ready | 缓存服务URL；再次操作只复制，绝不重复发布；受众不可再改 |
| prepare error | role alert替换正文，py-10；主按钮“重试”，关闭旧session后重开准备 |
| publish error | 回prepared保留已上传manifest；显示发布失败；未知结果需项目显式保护 |
| copy error | 保留ready URL；展示只读“分享链接”输入供手动复制；按钮只重试复制 |

workspace controls在非ready、非creating、mutation非pending/success、非prepare-error时可用；搜索字串非空会阻止提交。个人无成员选择。thread-dialog用form submit，阻止默认与冒泡；禁止dismiss时submit也被挡。焦点归还、Escape、IME及真实窗口尺寸本轮未观察。

## 可开发顺序与未证边界

1. 固定accounts/check、users、groups的只读桥及身份/取消/晚到测试；不将群组信息写入日志。
2. 不依赖假gate的对话框状态/受众纯合同，用明确fixture验证；真实入口保持gate unknown直到可证。
3. bootstrap仅用真实本项目profile请求，并实现保守V1/V2消费；若服务不接受、不完整或身份不符，明确不可用。不要装SDK、拷官方品牌版本或把失败改true。
4. 连接已有准备/发布；回归复制失败、发布未知、关闭取消、账号变化与搜索乱序。
5. 同条件官方/本项目原生截图及交互验收；本文件CSS只能提供候选几何，不能宣布1px通过。

本轮只新增文档，不运行产品构建。剩余关键未知：干净官方 gate/分流、真实bootstrap响应/完整live求值、成员完整服务schema、服务对本项目元数据兼容、组织权限、运行时可访问性/焦点与像素证据。
