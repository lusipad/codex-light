# 16.08B Usage 基础读取与呈现合同

2026-11-03。只读补证，供本阶段基础用量实现使用；不表示真实账号网络、官方运行时、付费历史或像素已验。固定 Store `26.1027.3384.0`、asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。不扩大到购买、重置消费、付费历史和完整企业账单。

原始文件继承 [下一阶段合同](16-08B-next-closure.md) 的已核 archive integrity；新增原文切片 `.ref/parity/16.08/actual/16-08B-research/usage-anchors.json`。以下数字均为 0-based UTF-16 字符偏移。`initial` 指 `app-initial-4267e52fe5b0.js`，`page` 指 `page-dfe0435996a5.js`。这些是静态消费合同，不是完整服务端 JSON Schema；未见到的额外字段不应判定不存在。

## 1. 固定读取、身份与并发

- `initial:4278973 Qbr`：GET `/wham/usage`，物理 `/backend-api/wham/usage`；`OAI-App-Brand: Byr.toLowerCase()`，`initial:4259291` 将 Byr 初始化为 `ChatGPT`，所以此固定包发送 **chatgpt**，不能凭产品名改为 codex；另有 `x-openai-codex-pricing-chooser: 1`。401/403/404 返回 null，其余错误抛出。
- `initial:4276540 Xbr`：读取前捕获 transport、userId、accountId、queryKey 和 push eventId；10 秒超时。读取后身份/transport 变化，取消结果。push 模式还验证响应 `user_id` 和 `account_id`。设置刷新使用独立 `usage-settings-refresh` key、refetchOnMount=always、无自动 interval，完成后更新基础缓存。
- personal 空 account_id 例外：push 模式响应允许 `account_id===""`，但只在真实 personal 标志成立且 user_id 匹配时。`initial:1856932 ov` 要求当前 accountId 等于 authenticatedAccountId 且 accountStructure 为 personal；不能仅凭 plus/pro 猜个人账户。
- `initial:4267307 bbr`：仅同 user_id/account_id 合并；保留更新的 credits 和 credits warning。GET 期间 eventId 变化时，将更新的推送优先合并，不能让迟到 GET 覆盖新余额。没有实现 push 时也须用宿主 generation、请求序号、账号/用户绑定防迟到污染。
- `/wham/accounts/check` (`initial:1862394 A_t`) 返回的当前消费形状为 `{accounts:[{id,structure,plan_type,...}],account_ordering,...}`，`initial:5985745` 附近以 `accounts.find(e=>e.id===activeAccount)` 取当前项。与旧 `/accounts/check` 的 `accounts[id].account` map 不同：`initial:1857693 h_t` 专门把旧 map 转换为上述数组。完整链为 `P8i:5983134` queryFn 直接返回 `A_t:1862170`，没有 select/mapper；O_t:1862141 初始化常 true，wham HTTP 分支直接 safeGet，旧 h_t 仅在 !O_t 分支。`V8i:5985354` 消费 P8i data 数组。因此此结论不依赖把历史 mapper 结果误当 raw。这里只证明静态消费所需字段，不冒充完整响应 schema 或实时网络样本。结构缺失不启用 personal 例外。

## 2. 原始用量字段与安全归一化

以下 TypeScript 仅描述已证实的可选读取边界。`unknown` 表示必须校验，不代表后端实际总发送未知值。

```ts
type RawWindow = {
  used_percent?: unknown;
  limit_window_seconds?: unknown;
  reset_at?: unknown;           // Unix 秒
  reset_after_seconds?: unknown;
};
type RawLimit = {
  allowed?: unknown;
  limit_reached?: unknown;
  primary_window?: RawWindow | null;
  secondary_window?: RawWindow | null;
};
type RawUsage = {
  user_id?: unknown;
  account_id?: unknown;
  plan_type?: unknown;
  rate_limit_name?: unknown;
  rate_limit?: RawLimit | null;
  additional_rate_limits?: Array<{
    limit_name?: unknown;
    rate_limit?: RawLimit | null;
  }> | null;
  credits?: {
    has_credits?: unknown;
    unlimited?: unknown;
    balance?: unknown;         // 已知消费合同为十进制字符串或 null
  } | null;
  spend_control?: {
    reached?: unknown;
    individual_limit?: {
      limit?: unknown; used?: unknown; remaining_percent?: unknown;
      reset_at?: unknown; unit?: unknown;
    } | null;
  } | null;
};
```

依据：`initial:4268823 wbr` 明确四个窗口字段均为 number（用于 warning 的 schema）；`initial:7349306 _ao` 读取主要 raw window，seconds/60 转分钟，reset_at 原样；`initial:7351553 Aao` 输出 `{usedPercent,windowDurationMins,resetsAt}`。`initial:7351684 jao` 输出 `{hasCredits,unlimited,balance:raw.balance??null}`。

建议本项目归一化最小结构：

```ts
type Window = {
  usedPercent: number | null;
  windowDurationMins: number | null;
  resetsAt: number | null;
};
type Entry = {
  key: string;
  limitName: string | null; // core=null，额外组保留真实名
  primary: Window | null;
  secondary: Window | null;
};
```

只接受有限数值；缺失、null、错误类型、NaN/Infinity 保留未知。服务 null/错误不构造零用量。窗口与已知 0% 是不同状态。官方内部 `_ao` 使用 `used_percent??0` 是消费已知数据的容错，不能用来把整个未取得或格式错误响应伪造成 0。

`initial:7349905 Sao`：始终建立 core entry（entry.limitName=null；raw rate_limit_name 只传给 snapshot.limitName）；随后保留所有 `additional_rate_limits` 中 rate_limit 存在且 trim(limit_name) 非空的组。不要只取第一项，不按显示名去重而丢两组数据。保留独立 key，缺少服务 ID 时可用原始位置加角色避免键冲突。

## 3. 多组保留与默认 UI 不是同一回事

底层保留全部有效组。官方默认 page 并不把任意组平铺：`page:51032 ka` 调 `Ra(entries,null)` 取 core，另调 `Ra(entries,"gpt-5.3-codex-spark")` 取 Spark。`page:66783 Ra` core 使用 `find(entry.limitName==null)`，Spark 使用 initial 的标准化名称查找：trim、lowercase、`[_\s.]+` 替换为 `-`。未知额外组不能篡改为 Spark，也不能声称官方默认会展示。

`rate-limit-rows-c4a1587594c4.js:130 a` 收 primary/secondary，过滤 `initial:7342005 Nio`：非 null 且 windowDurationMins>0；再按窗口分钟升序。key 将 300/10080/43200 ±1 分钟识别为 five-hour/weekly/monthly，同名 key 冲突附角色。`page:66909 za` 的显示标签采用目标窗口 ±5% 判定，另识别 1440 日窗；两种容差用途不同。

剩余比例由 `initial Lio` 为 `clamp(100-usedPercent, allowed===true?1:0,100)`；page 的普通窗口调用不传 allowed，故使用 0..100。显示有限已知数值的百分比，进度条表示剩余而非已用；未知不绘制 100% 或 0% 条。重置为 Unix 秒乘 1000 格式化；缺失不造倒计时。`page:68083 Ba` 优先 spend_control.individual_limit 的 remaining_percent/used/limit/reset_at，再退 core 月窗口，不能把不同 unit 合并。

中文取自固定 `zh-CN-3ed9eb1db28a.js`：

| key | 原文 | UTF-16 偏移 |
|---|---|---:|
| settings.nav.usage | 使用情况和计费 | 1550426 |
| settings.usage.overviewTab | 概览 | 1617285 |
| settings.usage.plan.title / view | 当前套餐 / 查看套餐 | 1618347 / 1618382 |
| settings.usage.personalLimits.title | 套餐限额 | 1617791 |
| settings.usage.personalLimits.fiveHour / weekly | 5 小时限额 / 每周限额 | 1617353 / 1617986 |
| settings.usage.limits.title | 通用使用限额 | 1616833 |
| settings.usage.limits.fiveHour.label / week.label | 5 小时使用限额 / 每周使用限额 | 1614992 / 1617071 |
| settings.usage.limits.monthly.label | 每月使用限额 | 1615672 |
| settings.usage.limits.progress.remaining | 剩余 {remaining}% | 1616223 |
| settings.usage.limits.window.resetAt | 重置时间：{time} | 1617115 |
| settings.usage.load.error / loading / retry | 无法加载使用设置。 / 正在加载使用情况设置… / 重试 | 1617168 / 1617208 / 1617252 |

## 4. Credits 单位与默认结构

主 credits.balance 是额度十进制字符串，`jao` 不除 1e6、不转美元。has_credits、unlimited、balance 各自独立，null/missing balance 不代表 0。`usage-data-1a7e0034aa60.js` 的 **thread usage** 才将 estimated_usage_credits_micros、native_usage_usd_micros 除以 1e6；该换算不得移植到主余额。workspace 月度用量的 balance_unit 为 credit/usd，spend control 只有 unit 匹配才可关联。

`page:95773 Do` 工作空间单独余额 Number(balance) 有限时显示 max(0,ceil(balance))；否则使用 `settings.usage.businessCredits.balanceUnknown`：“工作空间额度余额信息不可用”，不是 0。这个 workspace rounding 不能未经依据套到所有 consumer 余额。

`page:100222 Ro` consumer 主体顺序：资格允许时 `ri` 当前套餐（价格来自真实 pricing 查询，缺少价格不造月费）→ `ka` 套餐限额（core/Spark）→ gated `io` 历史→ `rt` credits（按真实 canView/canManage 等权限）→ gated `Ei` 偏好→ `ra` reset。企业 A 分支只使用适用 workspace ka，不能强塞 consumer 当前套餐卡。`page:4823 ri` 的查看套餐为真实计划选择动作；当前阶段若未闭环，不做伪成功按钮。

本阶段实现基础身份、限额、余额与错误/重试；历史、价格、购买、额度重置、自动充值等保留未实现清单，不能展示伪数据代替。

## 5. 默认容器静态样式

已有同包 `.ref/parity/16.06/actual/16-06B-research/raw/settings-content-layout-268f5398cbba.js`：内容 `group/settings mx-auto flex w-full flex-col`；非 embedded 默认 `max-w-3xl electron:min-w-[min(100%,calc(320px*var(--codex-window-zoom)))]`，滚动主体 `flex-1 scrollbar-stable overflow-y-auto p-panel`。default section gap 为 `--spacing(10)`，compact 为 `--spacing(5.5)`。page ls 仅一个 Usage section 且非 workspace 时 compact，否则 default；page panel 自身 `flex flex-col gap-5.5` / `gap-10`。不能以未知 panel token 推定已达到物理像素尺寸。

`settings-group-b4dc2379b608.js`：section `flex flex-col`，Content `flex flex-col gap-1.5`；Header font-medium，有 subtitle 默认 text-lg，无 subtitle 默认 text-base，subtitle `text-sm leading-[18px]`。shared `gYn:4846163`：fullWidth 限额卡 variant=metered、dividers=false，`rounded-2xl overflow-hidden ring-1 ring-inset ring-border-subtle flex flex-col`；普通 default 卡是 `border border-default`。个人限额真实标题是“套餐限额”，Spark 是“GPT-5.3-Codex-Spark 使用限额”。本节只提供静态 class，不构成视觉验收。

## 6. 官方 slug 与 CLI 安全 fallback

`settings-lazy-routes-1c307af3cdd3.js:8895` 同一个 f 对应 `usage`、`analytics`、`usage-code-review`、`consumer-view`。`page` 末段 `ls` 从 tab 查询读 section 并 canonical replace；`Xo` title 固定 usage，多个可见 section 时显示概览等 tabs。可核实的基础页面为 `/settings/usage`；analytics 等是同模块 section aliases，不能等同四张已完成独立页面。billing 在 lazy routes 是另一独立模块，不能直接 alias 到 Usage。

Store 0.166 CLI schema：`.ref/parity/16.07/actual/16-07C-research/schema-store/v2/GetAccountRateLimitsResponse.json`，当前 0.165 对照 `schema-current`。真实 RPC `account/rateLimits/read` 的 rateLimits 为必需 legacy 单组；rateLimitsByLimitId 为可选 map，应优先全部读取，map 不可用才取 legacy。窗口 usedPercent 必需整数，windowDurationMins/resetsAt 可选或 null；credits.balance 为 string|null，hasCredits/unlimited 为必需 boolean。accountId 若返回必须与当前账号匹配；缺 accountId 时只可依前后 account/read 和宿主 generation 做受限绑定，不能宣称完整服务身份验证。

CLI 归一化映射：limitId/map key 保留；limitName 保留；primary/secondary 的字段已经是 camelCase 和分钟，**不能再 /60**；resetsAt 仍为 Unix 秒；credits 不除 1e6。新字段 individualLimit 的 limit/used 为字符串，remainingPercent 为整数，resetsAt 秒；spendControlReached 是 boolean|null，null不是恢复。ordinaryUsageAllowed 只认真实 boolean，不能通过百分比或 resetAt 推测恢复。rateLimitResetCredits 的 credits=null 是“仅知道数量”，[] 是“已查且无详情”，不混淆。本阶段不消费这些 reset 动作。

CLI fallback 不含完整 /wham/usage、页面权限和远程计费数据，因此只能标明真实来源及限制；不能与主服务字段互相覆盖冲突身份，也不能将缺失 credits、limit map 或 token history 造零。建议基础回归覆盖 null/错误、已知0、多个组、core+Spark/未知组、秒分钟边界、缺失余额、身份切换与迟到结果。

本次未调用真实账号网络或登录退出，未改产品/测试，未运行 Cargo。官方运行时权限、全部企业结构、同尺寸像素与原生动作仍未验证。
