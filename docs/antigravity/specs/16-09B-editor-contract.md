# 16.09B 编辑器精确补证合同

2026-11-03。只读补证，供本阶段基础姓名/用户名/公开显示名与简介开发使用；尚未实施本文件，不代表当前产品或官方运行时已验。固定 Store `26.1027.3384.0`、asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。原文与SHA位于 `.ref/parity/16.09/actual/16-09B-research/`，本次新增共享 `src-575605e4d6c4.js` 与 `errors-a423955c3514.js`，均核 archive integrity。偏移均为 0-based UTF-16。

## 1. 用户名语法、输入和可用性

initial=`app-initial-4267e52fe5b0.js`，shared=`src-575605e4d6c4.js`。

- initial:5942683 z4i：先 trim；若以 `@` 开头，去掉**一个**前导 `@` 再 trim。不自动转小写。
- initial:5942953 H4i：规范化后空→empty；长度<3→tooShort；>20→tooLong；正则 `/^[a-z0-9._-]+$/` 不匹配→invalidCharacters；其余 `{ok:true,username}`。常量 g3i=3、_3i=20、v3i 正则在5946663附近。
- shared:72368附近 Tr：另拒 `/^[._-]|[._-]$/`，首尾不能为句点/下划线/连字符，中间可用。输入与初始值相同不检查、不保存。输入变化时先清 timer、增加 sequence，置 checking，**400ms** 后检查；只有当前sequence返回才能更新 availability。卸载清timer并增加sequence。
- check=`POST /wham/profiles/username/check`，body `{username}`，显式当前ChatGPT-Account-ID；外层queryKey含accountId/input，staleTime=10000、retry=false（username-dialog-4f1bb773647f.js:947）。共享UI仅消费响应 `available`，最小安全shape为 `{available:boolean}`；没有依据声称另有reason或suggestions。错误不能当available=false而永久误报已占用，应有独立错误与重试。
- 保存必须：弹层开启、有账号、规范化值不同于初始、H4i通过、无edge错误、**当前输入**已查available、非外部pending、非内部保存pending。pending禁止取消/双重提交；保存失败保留输入与可读错误，成功后关闭。

用户名保存：dialog-1f117777b264.js:641，PATCH `/wham/profiles/me` body `{username}`，预期错误400/403/404/409/422；响应消费 `{profile:{username:string|null}}`。不要将profile详情PATCH响应和该嵌套响应混淆。账户对该身份profile query更新 username，再invalidate page/usage/identity；公开页路径还GET `/profiles/me`，仅username一致才采profile_url。

### 后缀不是普通编辑器的同一门槛

initial B4i 紧接z4i：普通后缀列表 `.data/.rsc/.manifest`；internal另加`.html`，endsWith匹配；没有toLowerCase。username-validation调用此规则用于profile访问/恢复；profile Yu恢复页同时验证H4i和blockedSuffix。**普通Tr编辑器可保存条件未调用B4i**。宿主若额外拒这些后缀，须登记为本项目收紧，不能把静态访问恢复规则说成普通保存API强限制；不猜internal资格，不通用禁`.html`。

用户名可能有 `~` suffix：initial d5i按第一个`~`拆localUsername/suffix；普通编辑器编辑localUsername，不能把带后缀完整值直接塞进仅20位local字段，也不能随意截断真实用户名。精确输入清洗存在V4i去空白并slice20，但H4i本身不会静默修正大写或内部空白；应用在哪个输入分支必须区分，宿主应拒不合合同的原值。

## 2. 权限字段的位置和用途

- GET `/profiles/me`：`profile_details.username`；账户用户名入口读取 `viewer_access.can_edit_username===false` 明确禁用。读取失败给重试，pending禁止编辑。
- `/profiles/me.viewer_access.can_edit` 在账户 Zn:21303 用于 **GPT builder profile** 的display_name编辑入口；没有证据把它叠为公开页显示名/简介的通用门槛。
- GET `/profiles/me/page`：顶层 `can_edit`、`is_self`、`can_edit_username`；page rd:168570上下文：`le=usernameRoute==null || page.is_self===true`，`preview=le&&requestedPreview`，`canEdit=!preview&&le&&page.can_edit===true`。所以me route官方不额外强求is_self字段，而指定username路径需self。桥若保守要求is_self===true，应记录为收紧，不能说官方该分支强制如此。
- 显示名/简介编辑不需叠加username权限；username禁用不应禁用display_name/description。预览不得写。账号/用户/generation变化后旧权限失效；权限缺失、服务受限与false分别保留，不因plan推测开放。

## 3. 公开显示名与简介

profile=`profile-1ee0c7e6393f.js`：116045附近固定maxLength `{displayName:64,bio:140}`，HTML maxLength和JS `.length`均为UTF-16 code units，不是Unicode码点。昵称与账户`/me.name`是不同字段。简介真实读取 `profile_details.description`，不是bio；page rd中 `ie=view.profileDetails`，`Pt=(ie.description??"").replace(/\r\n|[\r\n\u2028\u2029]/g," ")`。

bio输入将CRLF、CR、LF、U+2028、U+2029换为空格；普通Enter preventDefault，但nativeEvent.isComposing时不拦。displayName要求trim后非空；bio允许空字符串清空。profile:123258保存先trim两者，只将trim后与初始trim不同的字段加入patch；所有字段均未变化则关闭而不发请求。bio长度超过140时禁用保存；name输入maxLength64。不要把账户姓名Qn的“发送原字符串”语义套到公开显示名。

initial:5994990 v5i PATCH `/profiles/me` 将displayName→display_name、bio→description；本阶段白名单仅这两个字段，未修改字段省略。响应是**直接profile详情对象**，消费display_name/profile_picture_url等，非 `{profile:{...}}`。真实成功后取消self页面读取、更新对应profile_details并invalidate身份；先前合同中写“p5i”作此mutation名不精确：真正函数为 **m5i**（紧接空初始化p5i后），避免据错函数名定位。

服务字段拒绝由 `errors-a423955c3514.js`：profile_update_moderation_failed按field display_name/description/profile_asset_pointer分别呈现；未知错误保留服务message或统一失败，不把简介审核失败误标为姓名失败。失败不关闭草稿、不显示成功。账号切换时不得继续写或覆盖新身份；PATCH后GET读回与响应分别留证，HTTP200不等于重新读取已一致。

### Moderation 的真实 HTTP envelope

`errors-a423955c3514.js` 导入的 Wzn 实为 initial **NPn:3477115**。它 `JSON.parse(error.message)` 后使用 PPn schema，再返回 `data.detail`；PPn:3477241 只接受根 `detail`，其 union 为：

```ts
{ detail: string } // => {type:null,message:detail}
{ detail: { type:string, message:string, field?:string } }
{ detail: { error_code?:string, message:string, type?:string } }
// 第三分支 => {type:type ?? error_code ?? null,message}
```

因此定向moderation已证最小形状是 `{"detail":{"type":"profile_update_moderation_failed","field":"display_name","message":"..."}}`；field另外可为description/profile_asset_pointer。不能凭通用API习惯改读根error或根type。initial `odt` 读取 HTTP `response.text()` 原r，传 `new Yg(r || statusText || fallback,...)`，证明这里error.message承载HTTP原JSON文本；底层诊断的error解析不能替代该profile专用合同。非JSON、缺detail、message/type错误类型均不进入定向字段提示。

三个固定中文实际位于同包另一个语言资源 **zh-CN-88ebb426d686.js**（已重新从固定asar提取、核integrity）；先前通用zh-CN-3ed资源没有这三key，不能据其缺失造翻译：

| field / key | 固定中文 | UTF-16偏移 |
|---|---|---:|
| display_name / profile.displayNameModerationError | 显示名称未通过审核。请换一个名称重试。 | 1486027 |
| description / profile.bioModerationError | 简介未通过审核。请修改后重试。 | 1485980 |
| profile_asset_pointer / profile.photoModerationError | 头像未通过审核。请换一张图片重试。 | 1488570 |

400/422仍区分通用服务拒绝与合法detail的moderation，不应统一抹掉字段信息。本阶段只支持显示名/简介；头像中文是后续合同，不代表头像操作已实现。保存用户名的null响应也不能伪造成请求成功读回：官方账户dialog缓存允许username null，但本项目确认态须保留真实响应并用GET比较；没有非空可核对用户名时标记待同步/未确认，不能拼接请求值当服务结果。

## 4. 中文与结构

固定zh-CN资源已证：

| key | 中文 |
|---|---|
| profile.editUsername / title | 编辑用户名 |
| profile.editUsername.cancel / change | 取消 / 更改用户名 |
| profile.editUsername.invalidEdge | 用户名不能以句点、下划线或连字符开头或结尾 |
| profile.usernameHelper | 请使用 3-20 个小写字母、数字、句点、下划线或连字符 |
| profile.usernameAvailability.checking | 正在检查用户名是否可用… |
| profile.usernameAvailability.available / unavailable | 用户名可用 / 该用户名已被占用 |
| profile.usernameAvailability.checkError / retry | 无法检查用户名是否可用。请重试 / 重试 |
| profile.usernameValidation.empty | 请输入用户名 |
| profile.usernameValidation.tooLong / tooShort | 用户名不能超过 20 个字符 / 用户名须至少包含 3 个字符 |
| profile.editProfileTitle / Label | 编辑个人资料 |
| profile.nameInputLabel / bioInputLabel | 显示名称 / 简介 |
| profile.editProfileSave / Cancel | 保存 / 取消 |

username-dialog H真实使用size=`beacon`和共享form/body/footer；不要凭该值推定物理宽度。公开编辑器有弹层/side panel/inline targets多种分支，不能一律称固定居中弹层。普通字段行原class：`grid min-h-[72px] grid-cols-[minmax(0,1fr)_minmax(0,220px)] items-center gap-4 px-4 py-3`；input wrapper `flex h-10 min-w-0 items-center rounded-lg border border-primary-outline bg-primary-soft px-3 text-base leading-6 focus-within:border-ring`；input `min-w-0 flex-1 bg-transparent text-base leading-6 text-default outline-none`；label text-sm leading-5，error text-sm leading-5 text-danger。panel分支复用设置行，不能直接套普通grid。

公开编辑保存按钮size=toolbar，取消color=ghost；pending禁用。profile Nl:135804 openAutoFocus阻止默认并focus容器；Pl:135920阻止interactOutside关闭；closeAutoFocus按trigger回焦。实际焦点与Escape仍需原生实测，不能把class当像素验收。

## 5. 本阶段验收重点与后续队列

本阶段重点：用户名3/20边界、大写/中文/内部空白、前导@与edge、400ms查询/旧结果/卸载、available错误类型、保存409与403；displayName64与bio140含emoji UTF-16边界、换行与IME、trim变化判断、空bio清除、name空白禁止、权限只限制对应动作、两种mutation响应形状与GET读回、旧身份晚到拒绝。

后续明确排队：头像file/crop/上传→asset_pointer→PATCH与撤销；photo_shape；page display_settings与读回；贴纸expected_version/409；pin/showcase；公开visibility分享与链接；统计图；邮箱敏感挑战、年龄/policy和删除。基础阶段不得因此宣称公开资料整页或全部账户功能完成。

本次只读补证，无产品/测试修改、无Cargo、无真实账号网络或资料写入。

## 2026-11-03 实施状态补记

上述为修改前取证合同，基础姓名/用户名/公开文本链现已实施，证据及未完成范围见[16.09B阶段待验](../acceptance/16-09B.md)。不将静态依据或受控回放写成官方运行时/原生/像素通过。
