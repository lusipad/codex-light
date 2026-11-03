# 16.09B 账户基础字段与公开资料：下一阶段修改前合同

2026-11-03。**本文件仅调研与定义下一阶段，尚未实施，不计入 16.08B 功能完成范围。** 不表示真实账号服务、完整个人资料页或像素验收通过。

固定官方 Store `26.1027.3384.0`，asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。本次只读提取 8 个资源，逐个核 archive header SHA-256；清单和原文位于 `.ref/parity/16.09/actual/16-09B-research/{manifest.json,anchors.json,raw/}`。共享 initial/primary 来源沿用 16.05 同包已提取资源。下列数字均为 0-based UTF-16 字符偏移，不是物理行号。

## 1. 必须分开的三个来源

| 数据/动作 | 官方真实来源 | 已证实字段与边界 |
|---|---|---|
| 账户姓名、邮箱、基础头像 | GET `/me` | app-primary-998934e837fc.js:1537110 lq；1536420 qvn schema：id 必需 string；created 可选 number；email/email_domain_type/first_name/name/phone_number/picture 可选且可 null string |
| 账户姓名修改 | PATCH `/accounts/users/name` | primary:1535590 Wvn body `{name:string}`，expectedIdentity accountId/userId；不是修改公开 display_name |
| 当前公开身份 | GET `/profiles/me` | account-profile-query-d800a7c800bd.js:185，queryKey=`chatgpt-user-profile,accountId,userId`，显式 ChatGPT-Account-ID，403/404 为预期受限 |
| 公开页面 | GET `/profiles/me/page` | initial:5988892 r5i；另有 `/profiles/{username}/page` 供他人/指定用户与personal/workspace视图，不能拿他人数据填当前账户 |
| 用户名检查/修改 | POST `/wham/profiles/username/check`；PATCH `/wham/profiles/me` | body 均 `{username}`；不是 `/profiles/me/page`，也不是本地偏好 |
| 公开显示名/简介/头像形状 | PATCH `/profiles/me` | initial:5994990 v5i，body `display_name/profile_asset_pointer/description/photo_frame_style`；与 GET 相同相对路径但不同职责 |
| 页面显示选项 | PATCH `/profiles/me/page` | profile-1ee0c7e6393f.js:175050，body `{display_settings}`，响应含 display_settings/page_version；不能将整页 PATCH 当资料字段 PATCH |

所有相对路径沿已有 chatgpt service 的固定 backend 前缀、路由与身份刷新处理。不要提供任意 URL/任意 method 透传；不向前端返回 token。读取 `/me` 后须核 `id===当前userId`，绑定 accountId/userId/service generation 并拒绝晚到旧响应。API Key/Bedrock/未登录不应借用上一 ChatGPT 身份资料。

## 2. 账户基础字段与姓名编辑

官方 account-settings-1f838c000711.js:20219 Xn 使用 primary lq(`/me`) 的 name，数据不可用则禁用编辑；邮箱 Mr:45338 取 `/me.email ?? auth.email`。`picture` 是账户 `/me` 字段，公开头像另为 profile_details.profile_picture_url，不能无条件互换。

姓名弹层 Qn:23053：autoFocus 输入；保存要求非 pending、trim 长度>0、原始字符串不同于 initialValue；提交原字符串，未发现这里自动 trim 后发送。pending 禁用输入和取消，外层 close 不关闭；失败保留文本并显示 `settings.chatGpt.account.updateError`。取消不发请求。

Wvn 保存必须有 accountId/userId；PATCH 成功后 invalidate 该身份 `/me` 查询。官方还在 `chatgpt-saved-account-name` 保存绑定 userId/accountId/backend 的 3 小时短期覆盖，仅当 `/me.id` 匹配和宿主 generation 未变化时应用，以应对读迟滞；**这是已完成远程写入后的覆盖，不是本地假保存**。本项目可先完成真实 PATCH→重新 GET，若 GET 迟滞须显示已提交/待同步，不用旧值假装写失败，也不把本地覆盖作为远程读回证据。是否复制覆盖机制须有回归，不扩大为通用缓存框架。

当前 AccountSettings.tsx 姓名/用户名为“未取得”，邮箱只来自 account/read；下一阶段应闭合真实 `/me` 与 profile 读取。ProfileSettings.tsx 当前只显示 account/read 邮箱/计划，明确不足以替代官方个人资料页面。

邮箱变更仍是独立敏感挑战：资格 GET `/accounts/change_email/eligibility`、begin、OTP、冷却与重新登录；本阶段只读邮箱，不用普通文本框冒充完整修改。删除、年龄、policy 等仍列后续，不能称账户整页完成。

## 3. 用户名与权限

账户 username 行 zr:55544 取 `/profiles/me.profile_details.username?.trim()`，有值显示 `@{username}`；没有值且非 pending、未明确 can_edit_username=false 时显示添加；读取失败给重试。mutationKey 绑定 accountId/userId，pending 禁用行。

dialog-1f117777b264.js:641 PATCH `/wham/profiles/me` 带 ChatGPT-Account-ID，body `{username}`，预期错误 400/403/404/409/422。成功响应消费 `response.profile.username`，更新对应 chatgpt-user-profile 缓存，invalidate `profile/page`、`profile/usage`、`profile/identity`，成功后才显示用户名已更新。

username-dialog-4f1bb773647f.js:947 可用性检查 POST `/wham/profiles/username/check`，queryKey 包含 accountId 和输入，retry=false、staleTime=10秒；计划与共享验证器还限制编辑。username-validation-ecf276223074.js 使用共享本地语法与后缀规则，不能凭印象写“英数字3到20位”之类规则。开发前必须继续追共享 src-575605e4d6c4.js/H4i 与检查响应形状；未取证的精确长度、字符、debounce 延迟不写成事实。过期检查结果不能启用新输入保存。

公开页面在非预览、own route 或 `is_self===true` 且 `can_edit===true` 时开启编辑；固定设置页未传 profileUrl，属于 own route，不能另加 is_self 必须为 true 的门槛；profile:168590 附近同时读取 `can_edit_username===false` 单独限制用户名。个人profile从workspace访问可能显示只读与切换个人账号提示。`viewer_access.can_edit` 是 `/profiles/me` 里的账户公开资料资格；page 里的顶层 can_edit/is_self 是页面资格，二者不能混成一个字段，更不能由登录/plan推出全部权限。

官方一些 username 分支把缺 can_edit_username 视为非明确拒绝；本项目未拿到完整 profile、权限/语法合同之前不得以缺字段强开可写。受限和解析未知须清楚分开。

## 4. 公开资料读取、编辑与读回

静态消费已见 `/profiles/me` 有 `profile_details`（display_name、username、profile_picture_url、profile_url）和 `viewer_access`；这些是消费字段，不宣称完整服务端 schema。`/profiles/me/page` 另消费顶层 `is_self/can_edit/can_edit_username`、profile_details，以及 `page.workspace_id/visibility/display_settings/page_version/pins/stats/...`。不将 `/me.name` 当公开 display_name，不把统计缺失当 0。

initial:5992658 p5i 真实资料写入成功后，取消相应 self page 查询，只更新 self 页面 profile_details；保留原 profile_url，再 invalidate profile identity。initial:5993600 h5i 用户名成功后另 GET `/profiles/me`，只有返回 username 与刚保存一致才取 profile_url；个人 URL `/u/` 和 workspace_id 有额外归属约束。不拼接猜测公开链接。

initial:5994990 v5i PATCH `/profiles/me`：displayName→display_name，bio→description，photoShape→photo_frame_style；形状映射 circle→circle、blossom→scalloped_circle、square→rounded_square、oval→oval、scalloped→scalloped_oval。未修改字段使用 undefined 省略；移除照片使用空 profile_asset_pointer，不是猜 null。

头像文件先 initial:5994691 `_5i` multipart POST `/wham/profiles/me/photo`，file字段、MIME 与清洗文件名，服务返回 asset_pointer；再 PATCH profile_asset_pointer。上传成功不等于资料保存成功；两阶段失败必须保留正确状态，不用临时URL冒充保存。crop/photo形状已有独立官方资源，但像素、大小、压缩与裁剪转换还需下一阶段补证，不在未证明时实现假上传。

page display_settings PATCH 当前可见调用没有 expected_version，不应凭通用CAS习惯发未知字段。**贴纸布局** PUT `/profiles/me/sticker-layout` 才明确携带 expected_version=layout_version；409会 invalidate 并重新载入、保留冲突提示，不能强制重试覆盖。409不同来源分开处理；资料字段错误按 display_name/description/profile_asset_pointer 归属显示，不能把部分保存当全成功。

## 5. 下一阶段的有界开发范围

1. 固定 `/me`、`/profiles/me`、`/profiles/me/page` 身份绑定只读桥，校验已消费字段并保持受限/加载/空/错误区别，读取真实姓名/用户名/邮箱/头像，不再永久“未取得”。
2. 账户姓名真实 PATCH 与读回；用户名语法/检查响应补证后，完成检查→保存→读回及错误/取消/身份变化。复用16.08的session/generation与service宿主，不另建认证框架。
3. 个人资料页先用真实 page/permission 驱动基础显示及 display_name/description 编辑，保留真实空/受限与明确重试；公共profile与账户name分开。
4. 头像真实上传/裁剪在取证闭合后单列子单元，不以仅显示 `/me.picture` 声称头像编辑完成。贴纸、pin/showcase、统计图、公开分享/visibility、邮箱挑战等按明确后续单元推进，不能把基础阶段提交当整页1:1验收。

## 6. 修改前可验证合同

- AC09-B01：ChatGPT、未登录、API、身份切换、服务重启；`/me.id` 错配、403/404、未知字段/缺字段、空字符串、网络失败均不污染新身份。
- AC09-B02：账户name与公开display_name不同样本、邮箱与picture不同来源；任一来源失败不覆盖另一个成功来源，不虚构名字/头像/统计。
- AC09-B03：姓名空白/未变禁用、中文IME Enter不误提交、pending禁双击/关闭、取消零写入、失败保留草稿、PATCH后读回/迟滞、跨窗与迟到回复。
- AC09-B04：用户名格式/后缀、已占用/可用/检查错误、输入变化后旧检查晚到、400/403/404/409/422、保存响应与GET读回不同；用户名/公开URL保持实际服务值。
- AC09-B05：can_edit false、can_edit_username false、is_self false、预览、个人profile从workspace访问；不因plan或登录状态绕过权限，不把缺权限解析成许可。
- AC09-B06：公开display_name/bio仅发送已修改字段；部分成功后准确读回，失败不关闭草稿；身份变化取消写入后续步骤，不跨身份更新缓存。
- AC09-B07：若纳入头像，上传失败/PATCH失败/移除/裁剪取消/资源释放分别验证；若纳入贴纸，expected_version与409重读，不自动覆盖。未纳入则明确列未实现。
- AC09-B08：官方固定中文、布局/窄窗、弹层焦点与Escape、同尺寸截图和原生路径独立留证；适用专项、tsc、完整标准、Rust与同源码构建后阶段提交，未实测项不写通过。

本合同未改产品或测试，未运行 Cargo，未调用真实账号网络或修改资料；仅下一阶段待实施资料。

2026-11-03实施补记：本合同的基础账户字段与公开文本编辑已接入，详见[16.09B阶段待验](../acceptance/16-09B.md)；头像、完整资料与真实账号/官方原生像素验收仍未完成。
