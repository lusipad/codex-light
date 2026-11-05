# 16I 独立账户通知页：后续开发入口

状态：阶段开发与已执行范围自验完成，待用户验收；未发真实账户请求。结果见[16I阶段记录](../acceptance/16I-account-notifications.md)。承接[16H本地组](16H-general-notifications.md)，本地任务通知与账户ChatGPT通知不能混用。

## 2026-11-06 实施范围与补核

resolver 已追踪 ensureAbsoluteUrl → YK → nZ，生产地址为 `https://chatgpt.com/backend-api/notifications/settings`；桌面初始化 supportedSurface 为 true。accounts/check 原始结构是 account_ordering 与 accounts 字典，不能套用旧数组解码器。详细锚点保存于 reference 中的 resolver 合同。

新增专用 account_notifications_read/write IPC，复用身份 generation、取消、HTTP 与网络策略；前端不能指定 URL 或方法。读取仅暴露渠道资格布尔值，写入重新核验个人账户、服务端字段及联系人。服务端数组驱动界面，不新增默认类别。UI 多选保持展开，乐观值按渠道版本隔离，所有写完成后权威读取收敛；失败不回放未知送达的写入。

先使用生产代码加注入 Transport 验证精确 PATCH、资格拒绝、联系人错误、身份变化和取消；浏览器验证布局及键盘，原生仅执行隔离无账号路径。真实账户远端写入、官方同环境像素配对、物理输入法另列未验证，不以 fixture 通过替代。

## 基准和已证合同

固定Store26.1027.3384.0，整包SHA256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。完整来源、UTF-16锚点/准确中文及仓库复用图在 `.ref/parity/16/actual/16I-account-notifications/reference/`。复核6个entry，其中新增personal-settings-access校验integrity。

- 独立ct→ChatGPT组→qe→personal-settings-access。需要真实chatgpt身份、认证与选中account一致、受支持surface/计划及accounts/check中personal结构资格；不能只用accountRead.type放行，不能让renderer自报personal。
- 相对路由GET/PATCH `/notifications/settings`，明确ChatGPT-Account-ID。最终生产地址经 resolver 独立补核为 `https://chatgpt.com/backend-api/notifications/settings`，详见 `reference/resolver-contract.md`，不是由其他/me调用推定。
- `settings[]`各行category/name/description/options[{channel,name,enabled}]由服务端驱动；PATCH仅 `{updates:{[category]:{[channel]:enabled}}}`。不造默认类别、不整表覆盖。
- 右侧240px多选菜单；摘要按服务端次序拼接enabled名称，全关“关闭”。tasks行“管理任务”跳/automations。teen_safety按/me联系方式筛email/sms，宿主提交前再次验证；对UI只需暴露渠道资格，不返回敏感联系方式本身。
- 官方乐观更新按category/channel mutationId隔离。错误显示“未能更新 ChatGPT 通知设置”，全部当前并发结束后重新GET收敛；不是失败即回旧快照。取消不能证明已发PATCH未在服务端执行，不自动盲重放。

## 未知项优先的实现顺序

1. 补核宿主resolver最终URL及平台/计划gate；构造允许/拒绝/未知个人inventory注入样本。
2. 复用chatgpt_service固定路由、ServiceIdentity、generation、取消、401刷新和网络策略，新增专用access/read；无renderer任意URL或method入口。
3. 真实GET数据渲染、个人资格、加载/错误/重试，新增多选菜单；不复用单选GeneralPreferenceSelect强行互斥渠道。
4. 专用单channel PATCH＋expectedIdentity，宿主重核当前身份/个人资格/字段及联系人渠道；GET确认后才报告已保存。保留乐观版本与并发收敛。
5. Transport故障、乱序/取消/账号ABA和0-turn客户端贯通；宽窄/最终原生读回及官方配对另列。

## 修改前验收

AN01拒绝无资格写；AN02真实数组/身份绑定；AN03精确单字段及GET；AN04不同/相同channel乱序；AN05错误不盲重发；AN06取消/离页/ABA；AN07teen_safety双重资格；AN08空/重复/损坏；AN09tasks路由/摘要/多选键盘；AN10宽窄长名称、原生重开及官方截图。完整步骤见证据合同。

尚无真实账号样本、实际服务写入恢复或官方配对截图。现有ServiceIdentity和账户/me读取不是通知链已实现的证据。真实账号改动只有在明确授权、样本可恢复时执行；开发先用真实生产代码＋注入Transport，不复制凭据或调用付费模型。
