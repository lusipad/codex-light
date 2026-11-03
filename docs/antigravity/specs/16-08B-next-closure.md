# 16.08B 账户、登录生命周期与用量：修改前合同

2026-11-03。状态：固定包只读调研，未实施本阶段，不表示官方运行时或像素已验。本阶段保持总目标；复杂公开资料编辑继续16.09B，受限计费/永久删除分支保留待闭环，不能以本阶段提交代表完整账户与计费已完成。

## 1. 固定来源与页面纠偏

Store `OpenAI.Codex_26.1027.3384.0_x64__2p2nqsd0c76g0`；asar SHA256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。新增资源逐个核archive integrity，原始资源/完整SHA和精确0-based UTF-16锚点在本机ignored `.ref/parity/16.08/actual/16-08B-research/{manifest.json,anchors.json,raw/}`。

| 页面 | 真实路由和chunk | 中文/范围 |
|---|---|---|
| account | settings-lazy-routes:3160→account-settings-1f838c000711.js:58393 Gr | “账户”；姓名/用户名/电子邮箱/账户状态、资格限制的资料选项/年龄/政策/删除分支 |
| profile | lazy:2724→profile-settings-42d4db6272aa.js:491→profile-1ee0c7e6393f.js | “个人资料”；公开资料页、权限化编辑、贴纸/固定内容等，不是账户邮箱只读表 |
| usage/analytics等 | lazy:1456 f→page-dfe0435996a5.js:100222 Ro | “使用情况和计费”；计划、用量窗口、信用余额、记录、资格化购买/重置等独立能力 |

主资源hash：account 63867 bytes / `49c80cf1a3ed2512b91135a85aa0b36201be1b48d42b49270b687e9c54838621`；profile route 3452 bytes / `2e56db8a04d2d07c567d241bf2b2aba68739682a3370a44357f4bffecc5d9c7f`；usage 114378 bytes / `618fe6228c4423c44cbadd114afdd06d846473f8f4099aa05d9604f6a1c59ae5`。

官方没有当前本项目“账号与额度”诊断拼接页。不能把`account/*`协议名、Backend origin或账号ID放进产品主表单当作官方设计。页面是否显示仍受product mode/真实访问控制：use-visible-settings-sections:40796账户要求chatgpt/chatgptAuthTokens；39138用量依赖ft访问状态；39610资料依赖独立profile visibility。包里存在路由不等于当前账号都可见。

## 2. 真实身份/登录与退出

已生成的当前CLI0.165及Store0.166 experimental schema提供account/read、account/login/start、account/login/cancel、account/logout、account/rateLimits/read、account/usage/read及通知；schema位于16.07C研究目录。仅证明协议形状，本次没有执行真实登录退出。

登录UI来源必须使用桌面onboarding，不误用ChatGPT浏览器login-page：onboarding-login-content-292c6d26f044.js:422读取configRequirements/read.allowedLoginMethods；requirements为null时以config.forced_login_method回退；requirements对象缺allowedLoginMethods为unsupported，读取失败/未知结构为error。不能读取失败就开放全部登录方式。

官方桌面文案：“使用 ChatGPT 继续”“取消登录”“OpenAI API 密钥”；API入口/ChatGPT入口按managed要求显示。initial:2589980起loginWithChatGpt只允许一个activeLogin，验证type/authUrl/loginId；completion必须匹配loginId，Abort调用cancelLogin并清监听。initial:3227283附近logout发送account/logout。

实施需闭合：签出→要求读取→登录进行中→成功/失败/取消→重新account/read确认；不以浏览器打开成功证明已登录。旧loginId的晚到completed不得改变新请求；服务重启、窗口关闭/取消和重复点击释放资源。API key不得进入日志、偏好、截图或普通前端持久存储。外部token注入为内部不稳定协议，不作为普通登录方式暴露。

当前lib app_server_call已在account/login/start和logout时invalidate_chatgpt_service，可复用，但缺前端真实生命周期。退出后需清理账号数据/额度/服务缓存，不能清空项目/聊天，也不能让晚到旧响应重新灌回。

## 3. 官方账户与资料服务边界

账户Gr主要顺序：Xn姓名、zr用户名、Mr邮箱、账户状态、Zn公开资料资格选项、年龄区；另有policy状态和personal账户删除区。

- 账户姓名不是可持久化本地“Developer”；资料读取来源含实际用户与`/profiles/me`，account-profile-query:185以accountId/userId隔离，403/404为预期受限响应。
- 邮箱编辑先GET `/accounts/change_email/eligibility`（account:54424），后`/accounts/change_email/begin`和验证/冷却/重新登录流程；不能只改本地文本。
- 公共profile编辑须遵循viewer_access.can_edit/is_self、can_edit_username等；profile main:175050 PATCH `/profiles/me/page`，124053 PUT sticker-layout带expected_version/409冲突。详细编辑另交16.09B，账户页不伪造简易替身。
- 删除账户调用`/accounts/deactivate`，需要个人账户、最近登录、Sentinel、邮箱/电话和DELETE确认；不是account/logout。本阶段可以取证/实现合同与mock边界，不能自动在真实账号执行删除。

这些服务动作都须复用身份绑定的固定路由宿主桥，不能暴露任意URL或令牌。无服务资格保留真实受限状态；不能用本地profile偏好冒充远程保存。

## 4. 用量主数据与当前差距

官方主要来源：app-initial:4278923 Qbr GET `/wham/usage`，附`OAI-App-Brand`真实brand小写与`x-openai-codex-pricing-chooser:1`；物理前缀沿16.07C transport为`/backend-api/wham/usage`，workspace routing保留。401/403/404返回null，不当成0用量。4276540 Xbr核查user_id/account_id/transport，防止迟到GET覆盖新推送/身份。

Usage page另有`/wham/usage/plan_limit_balance_history`（69907）、reset credits history（25615），queries-972767eeb521.js区分consumer/workspace/business的credit/token history。不能将个人token总量解释为付费账单，也不能将不同单位credit/usd混加。购买/自动充值/兑换quota reset涉及实际收费或消费，不在无操作确认的自动实测范围。

rate-limit-rows-c4a1587594c4.js按每个limit entry收集可用primary/secondary、按windowDuration排序；5小时/周/月窗口有独立锚点，不是只显示“主额度/次额度”一组。CLI数据可以作为真实本地读取或受限适配，但不等于完整官方usage服务。

当前源码只读审查发现：

| 当前实现 | 对最终一致性的影响 |
|---|---|
| SettingsView account合并身份、协议诊断、额度、14天tokens | 页结构与官方account/usage分开不同，显示实现细节 |
| accountRateSnapshot优先legacy rateLimits，否则byId第一项 | 丢其它limit组；不能认为覆盖所有窗口 |
| usedPercent缺失归0；缺usage桶填14天0 | 把未取得数据误显示成零，需区分已知0/缺失/错误 |
| accountSnapshot前后身份核对和部分失败 | 可复用；需进一步绑定服务generation/account/user，支持推送/重启及并发刷新 |
| ProfileSettings只显示account/read邮箱/计划 | 真实但不足以替代官方公开资料服务与编辑权限；保持16.09未完成 |
| 登录/退出仅可透传RPC，无产品流程 | 需要真实启动、取消、完成通知、失败恢复和清缓存闭环 |

## 5. 16.08B 一次推进的有界实现范围

1. **身份与会话生命周期**：真实账号状态、managed登录方式、ChatGPT/API登录/取消、退出、服务重启/身份失效恢复；跨窗/晚到事件有一致性保护。
2. **账户与用量结构纠偏**：从合并诊断页恢复官方账户和独立Usage结构，基础姓名/邮箱/计划使用真实来源；profile详细编辑不重复实现。
3. **真实usage读取**：固定`/wham/usage`桥、身份/权限校验、动态多limit窗口/credits状态、刷新与通知；CLI quota适配明确标证据边界。缺失不能当0，不伪造历史图。
4. **官方动作资格合同**：计划/充值/额度重置/邮箱编辑/永久删除等保留来源和准入；只有完整服务与显式用户操作才执行。阶段可不做真实付费/删除测试，但未完项必须继续队列，不能写整页1:1完成。

## 6. 修改前测试合同

- AC08-B01：signed-out/API/ChatGPT/受限与unknown模式；managed requirements读取失败或未知时禁用入口，旧版本unsupported有重试/升级状态。
- AC08-B02：单一active login、匹配loginId的完成/错误、取消/再登录、乱序/晚到/窗口关闭、浏览器打开失败、服务断开后恢复；不使用真实账号自动登录退出作为普通测试。
- AC08-B03：退出真实RPC成功后重新读取signed-out并清账号服务缓存；失败不假退出；旧token/旧generation不得跨身份复用。
- AC08-B04：多limitId、primary/secondary乱序/缺失/同长窗、0/100/超界、resetAt秒单位、未知percent/credits，不能丢组或造0。
- AC08-B05：wham usage成功/401/403/404/限流/未知响应、身份切换/推送与GET竞态；真实服务失败保留语义，不由演示余额替代。
- AC08-B06：consumer/workspace/business单位与history范围分开；未支持查询不造图；credits购买/兑换/删除的不可逆动作必须在隔离mock验证边界。
- AC08-B07：账户/Usage中文/菜单焦点/窄窗、原生浏览器登录与用户验收分别留证；缺官方同尺寸截图时不评分为像素通过。
- AC08-B08：完整标准+相关与全Rust、同源码原生构建/指纹、阶段验收文档和Lore提交；不以自动检查代替用户与官方验收。

## 7. 账号自定义指令gate的当前桥状态

2826489636是官方Statsig gate，来源不是account/read或HTTP200。当前宿主确有`share_access_bootstrap`固定POST `/backend-api/wham/statsig/bootstrap`，返回真实statsigPayload并绑定ServiceIdentity；shareAccess.ts已有全量V1/V2 payload/账号一致性校验，但只消费分享gate4157559322/1016046617。

本次查到的产品源码没有2826489636专用消费器或通用live Statsig evaluator，不能据分享gate值推导账号指令gate。可复用真实bootstrap传输与完整payload验证，单独读取该gate并记录身份/缺失/delta/过期边界；没有实际返回前不得猜值或强开。16.07C新增账号GET/PATCH桥是存储能力，不是该UI资格证明。

本次未调用真实账号网络、登录退出、计费或删除；当前gate/页面可见性、完整profile/usage服务、Windows原生交互和配对像素仍需独立证据。
