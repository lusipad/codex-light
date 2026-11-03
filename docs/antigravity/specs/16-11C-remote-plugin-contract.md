# 16.11C 远程插件：完整读取、变更、读回合同

2026-11-03。下一阶段修改前合同，**尚未实施、未调用真实账号服务**；不计入16.11B本地管理交付。固定Store `26.1027.3384.0`，asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。复用已核integrity的同包initial/primary/shared与16.11B资源；新增证据位于 `.ref/parity/16.11/actual/16-11C-research/`。以下偏移为0-based UTF-16。

## 1. 当前接线与应保持的身份

当前App独立SkillsMcpView和Settings插件管理器均把modelAccountIdentity与app-server指纹放入connectionIdentity；组件root/connectionIdentity变化会提升context与request代次、清旧列表/详情/准备状态。`loadInstalledPlugins`目前只调 `src/plugins.ts listInstalledPlugins`→`plugin/installed {cwds:workspaceRoots}`，没有ChatGPT服务已安装库存。CLI读失败与服务不可用应分开，不能以新服务失败清空仍可用的本地列表。

新增服务库存应携带 `ServiceIdentity{accountId,userId,generation}`，所有分页和写/读回共享同一身份与请求生命周期。App accountIdentity是UI失效信号，不能替代Rust宿主实际token身份。未登录/API/服务不支持时保留CLI事实，不自动进入HTTP，也不借用旧ChatGPT缓存。

## 2. 真实服务库存与分页

initial **XJn:3717279**：GET `/ps/plugins/installed`，物理backend前缀沿已有固定服务transport，不能接受任意origin。query：

```ts
{limit:1000, pageToken:previous.pagination.next_page_token,
 includeExtensions: explicitIncludeExtensions ?? (productContext==="chatgpt" ? true : undefined)}
```

官方OA默认productContext=`codex`、includeExtensions默认true，因此标准OA路径会显式true；XJn直接调用缺参数时仍有上述fallback，不能混淆。逐页合并`response.plugins`，直到next_page_token为空；pageToken不透明，不解析/拼接业务含义。异常、重复cursor、坏分页结构不能假装完整库存或无插件。

headers：显式当前accountId时 **ChatGPT-Account-ID**；LO(productContext)产生 **OAI-Product-Sku=CODEX**（默认codex）；Ipe导入shared.bgt→Dct:1779927，为 **X-Codex-Surface**，标准库存consumer给surface=`other`，其它页面可能有真实surface值。本阶段用已证other，不编造专用标签。认证沿宿主Bearer/真实workspace路由，不将token交前端。

服务raw最低外层消费形状：`{plugins:RawPlugin[],pagination:{next_page_token:string|null}}`。尚无真实响应样本，不把所有mapper属性一律定为服务必需字段；身份与核心id/名称/布尔/列表结构必须严格校验，未知字段保留或安全忽略，不提供演示默认余额/状态。

## 3. 已安装row完整消费映射

initial **EA** 紧接XJn，以下是固定包已消费字段，并非恢复完整后端schema：

| 原始 | 官方投影 / 注意 |
|---|---|
| id | plugin.remotePluginId；所有HTTP写path用此真实raw id |
| name | plugin.name；UI复合id=`name@remoteMarketplaceName`，不是HTTP id |
| enabled属性存在 | installed=true；enabled取该属性实际布尔。不能从status或本地缓存补true |
| status | DISABLED_BY_ADMIN→availability同值，否则AVAILABLE；与enabled独立 |
| disabled_reason | disabledReason；缺且status为管理员禁用时fallback disabled_by_admin |
| installation_policy/source | installPolicy（官方缺省AVAILABLE）、installPolicySource；不能当拥有者资格 |
| installed_at | Date.parse/1000为installedAt；无效日期应保持未知，不能变当前时间 |
| authentication_policy | authPolicy（官方缺省ON_USE）；新服务解析未知策略须显式受限 |
| eligible_plan_types | eligiblePlanTypes或null |
| release.version | plugin.version；localVersion=null；source={type:remote} |
| release.display_name | row.displayName与interface.displayName |
| release.interface.short_description / release.description | row.description优先short_description |
| release.keywords / interface.capabilities | keywords |
| release.interface.logo_url/logo_url_dark/composer_icon_url | 图片URL投影；不能当本地文件路径 |
| release.interface.long_description/developer_name/category/capabilities | 对应interface说明、开发者、分类、能力 |
| release.interface.website_url/privacy_policy_url/terms_of_service_url | 对应真实链接，仍走现有安全外链 |
| release.interface.default_prompts / default_prompt | defaultPrompt数组；单旧字段包一项 |
| release.interface.brand_color/screenshot_urls | brandColor/screenshotUrls |
| canonical_app_id/connector_id/release.app_ids | 去null后的appIds；canonicalAppId单独保留 |
| scope/workspace_id/creator_account_user_id | ownership元数据，不据其猜启禁权限 |
| is_template/template_plugin_id | template状态/关联id |
| release.requires_local_executor | requiresLocalExecutor，仅明确true |
| must_show_installation_interstitial | 独立安装提示资格，不强制已安装项重装 |
| extensions.default_pinned/thread_entrypoints | defaultPinned与hosted入口；不在基础阶段伪造消费者 |
| release.skills/onboarding_skill_name/disabled_skill_names | 仅enabled且status=ENABLED且技能未禁用时选真实onboardingSkill |

row还保留servicePlugin=原始对象、marketplacePath=null、remoteMarketplaceName固定服务来源、shareContext=null。源码中的字段缺省是消费容错，不表示损坏服务响应应该被忽略为完全可用。

### 不重复CLI remote条目

primary `vgn`：优先 `plugin.remotePluginId ?? plugin.shareContext?.remotePluginId`→`remote:<id>`；否则`plugin:<marketplaceIdentity>:<plugin.id>`。不能按显示名或裸name去重，也不能把本地自定义同名插件删掉。服务库存与CLI remote项的同raw id可合并为一行，保留真实CLI执行来源与服务状态身份；冲突enabled需要服务最新读回/明确来源，不偷偷择真。

没有raw id的CLI remote项不能靠name猜服务id。HTTP失败可保留原CLI条目并标服务状态未取得；服务单独条目不能写入configuredMarketplaces或参与本地市场移除。服务list和CLI list的计数应在去重后计算，搜索不影响tabCount。

## 4. enable / disable / uninstall 请求与空正文

initial dqr:4809139、mqr:4812482：POST固定路径 `/ps/plugins/{plugin_id}/enable`、`/disable`、`/uninstall`，**无requestBody**。path优先remotePluginId（卸载还有已证requestPluginId对应真实id），不使用UI复合id。headers LO()默认 **OAI-Product-Sku=CONNECTOR_SETTING**；这是mutation与库存CODEX双SKU区别，不能统一替换。认证仍由固定宿主transport提供。

官方mutation consumer不消费返回body。现已进一步证实initial **fetchJson:1761951**：status204不读body，返回body=null；其它status读取text，**空字符串也返回null**，非空执行JSON.parse，失败invalid_json_response。因此200空和204空均是合法写响应；不是必须`{enabled:true}`，也不能容忍非空垃圾JSON。

宿主应仅对这几个写operation允许上述空体→Null，库存GET继续严格JSON/分页校验；不要全局放宽decode_response。HTTP成功后只进入已提交状态，后续GET真实读回证明结果。超时/取消/网络断开/5xx可能写已应用，标结果未知并先读，不盲目再POST；401刷新只在相同身份与现有IP限制规则下处理。

## 5. 身份、准入与own权限边界

真实服务host DA分支捕获account并在发送前重核当前account；本项目也应核user/generation和多页/读回全程一致。profile的expectedIdentity模式可复用，不能只在前端检查一次。

卡片启禁拒availability=DISABLED_BY_ADMIN及pending/uninstalling；不因INSTALLED_BY_DEFAULT禁启禁。卸载只对remote且installed且INSTALLED_BY_DEFAULT禁用；保留真实installPolicySource说明。scope/workspaceId/creatorAccountUserId不直接等于can_edit：固定consumer**没有creator必须等当前user的通用检查**，不要加假own门槛。服务端403仍是最终拒绝，身份是必须条件不是拥有权限的充分条件。

全局plugins能力来自experimentalFeature/list，不由accountType猜。remote_plugin目录能力是另一条来源资格；不能强开gate。插件服务缺少某种account能力时保留受限错误，不能本地config覆盖替代。

## 6. service host 与本地remote source的刷新差异

- serviceHost：mutation后在分支内return，settled `gz(...,true)`失效plugins、apps、system hints等服务cache，重新读真实服务库存；不发送本地config/batchWrite。
- 非serviceHost但plugin.source=remote：POST远程服务成功后还执行 `wqr`→`cqr`，刷新本地插件/技能运行时；settled `gz(...,false)`还失效MCP/skills/config。保存与运行时刷新分开。
- uninstall本地执行侧还刷新app安装状态和技能/建议目录；不能只从DOM删除一行。
- wqr:4821408捕获技能目录刷新失败，显示持续warning+真实刷新动作，不把已完成服务变更回滚成失败，也不假称工具已可用。

读回确认：enable/disable全部分页中同raw id且enabled等于请求；uninstall仅在**完整成功库存**不含目标才确认，未知/403/分页失败不证明已卸载。读回滞后可显示已提交/待同步，提供只读检查；写锁覆盖写与确认过程，防重复写，其他插件独立。

## 7. 现有宿主可复用点与最小新边界

`chatgpt_service.rs` 已有ServiceIdentity/generation、Registration取消、prepare token刷新、固定route/profile、网络策略、workspace路由、bounded响应、脱敏ServiceError与header白名单；profile_http已示范PATCH成功空正文→Null、后GET验证。应复用这些基础，不复制凭证系统。

现 `ServiceOperation` 没有remote plugin库存；decode_response对2xx统一from_slice会拒空；profile_http是私有profile合同，不能随意扩成前端任意method/path。建议新增固定remote-plugin read与mutation类型：库存只接pageToken/includeExtensions等白名单；mutation只接raw plugin id、enable|disable|uninstall枚举、expectedIdentity，host固定真实服务路径。前端不要提供URL、headers或token。

复用生产SkillsMcpView加载代次/connectionIdentity、plugin写锁、现有本地启禁与市场管理；新增服务适配与合并函数，避免复制整个列表/详情。返回真实body/verification confirmed|pending|unknown及读回事实，不以本地布尔替代远端状态。

## 8. 修改前验证目标

覆盖完整分页/重复cursor/坏JSON/空库存；raw id与复合id、同id CLI重复与同名不同id；双SKU、无POST body；200空/204空/合法JSON/非空坏JSON；禁启禁与默认卸载限制；401/IP拒绝/403/429/5xx/取消/旧身份；写成功但GET失败/滞后；uninstall缺页不假确认；local runtime刷新失败保留服务事实；账号切换清缓存但不删除CLI本地事实。

受控transport只证明本项目合同；真实账号授权、服务最终响应样本、原生交互和配对像素需另验。无真实账号条件不自动POST、安装或卸载；阶段可交受控自验，但不能写远程服务已实测通过。

## 9. 开发时快速补证：固定来源与缺失语义

**remoteMarketplaceName精确为 `openai-curated-remote`。** EA的lo由initial导入shared.dSt，shared `iet:1693301` 初始化该字面量；不是根据raw.name、account或当前市场推测。UI复合id=`raw.name@openai-curated-remote`，remotePluginId=raw.id，service投影shareContext固定null。primary **vgn:1488127**去重优先级为 `remotePluginId ?? shareContext?.remotePluginId`，只在两者均nullish时改用本地marketplace+plugin.id；不得以空字符串当合法远程身份，也不得按显示名合并。

EA缺失边界的原始表达式是 `n="enabled" in raw; installed=n; enabled=n&&raw.enabled`。因此enabled属性缺失会映射installed=false/false；属性为null会映射installed=true、enabled=null；非bool原mapper没有显式验证，不能据JavaScript truthy推断有效服务授权。本项目应将null/字符串/数字/坏结构视为unknown或invalid_response，禁止这类row的状态变更，不能静默变成true。

`authentication_policy ?? "ON_USE"`、`installation_policy ?? "AVAILABLE"` **只对nullish缺失回退**；未知非空字符串原样透传。官方mapper不证明未知policy可编辑/卸载。本项目应保留未知原值并明确受限/解析错，不改写成已知开放策略。缺字段采用已证fallback时也不表示服务权限已全部确认；明确DISABLED_BY_ADMIN仍高优先级拒变更。未知raw.status被EA映射AVAILABLE是消费容错，不证明所有未来status都可放权。

### remote_plugin 与当前CLI如何表达资格

initial **UJn:3714569**原链：pg目录数据未取得→undefined；找到name===remote_plugin→返回该条enabled；缺条目时，仅 `!get(Eg,"4218407052")` 才返回真实Statsig Tg同gate，否则undefined。`Eg`条件不能无证解释成账号类型；这里未恢复其完整适用性，不擅自强开。现CLI可据完整 `experimentalFeature/list` 中真实remote_plugin.enabled得到已知值；没有条目且无可信Statsig evaluator，状态为unknown，不能由ChatGPT/API账号类型补true或false。

这与sA总plugins开关不同：总plugins缺条目默认true；remote_plugin没有同样默认。HJn在OA本地库存select里用于过滤旧`openai-curated`来源；serviceHost分支d固定true。因此它也**不是已证远程HTTP endpoint通用授权开关**。不能把缺remote_plugin条目自动说成服务403或把所有已知remote库存标未登录。目录资格、宿主认证、真实row availability、HTTP拒绝分别处理，读取与变更资格不得混成一个accountType布尔。
