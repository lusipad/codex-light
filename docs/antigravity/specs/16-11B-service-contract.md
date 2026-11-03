# 16.11B 组合管理资格、来源与远程服务补证

2026-11-03。固定Store `26.1027.3384.0`，asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。只读补证，**没有实施本文件、没有真实账号HTTP或远程变更验收**。原文/资源hash沿 `.ref/parity/16.11/actual/16-11B-research/`；本次新增plugins-cards-grid与plugin-card-status-action，逐个核asar integrity；定位为0-based UTF-16。

## 1. showNonMcpTabs 不来自账号类型

plugins-settings-13da7ceae7e2.js `$a`：F=`yt({hostId:N})`；yt来自initial导出DNn，即 **sA:3661683**。它读取host对应pg目录，find name===plugins，返回 `inputEnabled && (row?.enabled ?? true)`。pg→bct:1656566，真实协议 **experimentalFeature/list {cursor,limit:100}**，读完整nextCursor。durable专用host返回空数组，不能由此推所有远程host都关闭。

因此现协议可以读取{name:"plugins",enabled:boolean}，不必用account.type、plan或臆测Statsig gate。官方缺该条目/尚无data时按空数组处理，默认true；明确false才仅MCP。这个默认不意味着读取异常是“账号无资格”；失败仍需独立可见，不能将网络失败解释成false。

tabCounts来自**搜索前**真实数据：plugins=合并后的installed wr.length；apps=app/list中isAccessible分组installedApps.length；skills=Be.length；mcps=配置servers key数；marketplace=配置marketplaces名称去内建项后的数量。search只过滤内容，不改变tabCount。当前tab加载时保留，否则count0按plugins/apps/mcps/skills/marketplace顺序fallback；mcps始终可见，其它资格true且count>0才出现。

remote_plugin是另一目录/来源能力：initial UJn约3714k读取experimentalFeature/list name remote_plugin；若存在用其enabled，否则特定Statsig4218407052回退。**不等于plugins总开关**，也不能用ChatGPT登录猜remote marketplace支持。

## 2. 卡片 enabled / availability / installPolicy 是三件事

plugins-cards-grid-c1a60accd312.js约19300 toggle分支：checked=plugin.enabled，disabled=`disabledByAdmin || isUpdating || isUninstalling`。disabledByAdmin来自实际availability/阻塞原因；primary `$K:1485305` 检查 `availability==="DISABLED_BY_ADMIN"`。服务raw status同值时EA将其映射为该availability，disabled_reason保留。

卸载限制primary **jmn:1464896**：`source.type==="remote" && installed && installPolicy==="INSTALLED_BY_DEFAULT"`。这不等于禁止启禁，不应把默认安装policy复用成toggle disabled。NOT_AVAILABLE的未安装项是installation-unavailable；已安装与禁用状态独立。缺availability不捏造AVAILABLE来覆盖真实未知字段，服务拒绝仍必须显示；已知管理员禁用不可绕过。

卡片详情/分享/试用按真实来源、remotePluginId、local executor、gate1064857188等分别决定，不把所有source=remote插件统一视作用户拥有。安装资格/账号授权与启禁协议成功不是同一层。

## 3. 市场来源与枚举的准确字段

selectors z/B/V/H/U：

- configuredMarketplaceNames=`Object.keys(config.marketplaces)`，要求marketplaces为object。
- configuredGitNames只收对应配置`source_type==="git" && typeof source==="string" && source.length>0`。
- 可管理列表：`!marketplace.isBuiltIn && configuredNames.has(marketplace.name)`；市场显示名不作身份key，path可null，不把service远程目录当用户Git目录。

市场移除query plugins `Za`（Qa约59723）读取 **tYn(Qjn)**，initial kA:3721029中的query：`plugin/installed`，roots非空时 `{cwds:roots}`，否则`{}`，priority background。结果含marketplaces，先找marketplaceLoadErrors中marketplacePath===target.path；有错误即阻塞。然后`marketplaces.filter(m=>m.name===target.name)`，dJn投影插件，再oJn补完整信息；不是把plugin/list所有可安装项当需要卸载项。

界面市场列表另有plugin/list目录读取，但移除依赖必须用上述installed库存。source/configured/builtIn资格与host/roots都应绑定；路径或错误丢失不得当空列表继续删。marketplace/load失败不自动靠name猜其它来源。

### isBuiltIn 的准确来源

**它是前端mapper生成，不是已证RPC字段。** initial `aJn`（`isBuiltIn:`偏移3707264）把RPC市场映射为 `{displayName,isBuiltIn:iJn(name),name,path,pluginCount}`；去重身份为name+NUL+(path或空)。`rJn`先 `trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")`，`iJn`判断规范化名是否存在wJn。initial:3710406 wJn最终五名为 **codex-official、openai-bundled、openai-curated、openai-curated-remote、openai-primary-runtime**。

导入字面量链：initial f来自shared.$Ct→gJ=`openai-bundled`（shared:1676234）；PCe来自shared.uSt→ret=`openai-curated`（1693280）；lo来自shared.dSt→iet=`openai-curated-remote`（1693301）。同包shared为app-shared-b9a49a97ca55.js。该分类**没有path规则**，也不等同config中是否configured。CLI不提供isBuiltIn时仍须计算；不能只检查不存在的可选RPC字段就声称滤除了内建市场。额外RPC显式true可保守拒绝，但不替代固定名分类。

## 4. Remote enable/disable 的真实请求

initial **dqr:4809139**：

```ts
if (serviceHost || plugin?.source.type === "remote") {
  await M_.safePost(enabled
    ? "/ps/plugins/{plugin_id}/enable"
    : "/ps/plugins/{plugin_id}/disable", {
      surface: "other",
      parameters: {path: {plugin_id: plugin?.remotePluginId ?? pluginId}},
      additionalHeaders: LO()
  });
  if (serviceHost) return;
} else {
  // 本地 user file/version 的 config/batchWrite，reloadUserConfig=true
}
// 非serviceHost还刷新本地插件/技能运行时
```

**没有requestBody**，也没有在该consumer读取返回body。不能虚构响应 `{enabled:true}`、status枚举或request body `{enabled}`；HTTP成功只证明请求层成功，需真实库存GET读回确认状态。M_.safePost的共享transport解析及空body兼容性仍须按既有实现核对，本次未实测，不因consumer忽略body就声称204一定支持。

LO:3497445 只增加 **OAI-Product-Sku**：默认catalog→CONNECTOR_SETTING；显式codex→CODEX，chatgpt→PROMPT_TEXT_AREA，tpp→TPP。**该mutation调用LO()不传codex，固定包这里为CONNECTOR_SETTING**；不能因当前app是Codex就改值。底层授权与backend前缀复用已有M_ transport，物理路径沿固定 `/backend-api/ps/plugins/...`，workspace origin路由保path。LO不是Authorization，不包含token。

真实鉴权必须由现有宿主凭证/账号上下文添加Bearer、ChatGPT-Account-ID和服务generation保护，禁止向前端导出token、任意URL或任意plugin动作。原serviceHost分支捕获accountId并在发送前检查当前account未变；非serviceHost remote branch该局部函数没相同显式检查，不能据此说不存在其它默认transport保护。本项目应继续用已实现的前后身份/generation检查，迟到响应不更新新账号。

本次静态调用未额外提供expectedErrorStatuses/重试策略，不能猜400/403/404是可忽略成功。未知HTTP/解析/权限错误留真实语义；401刷新遵循现有身份服务规则，不盲重放跨身份写。禁用不会删除插件，卸载独立POST `/ps/plugins/{plugin_id}/uninstall`。

## 5. 远程库存、原始结果与读回

initial **XJn:3717279**：GET `/ps/plugins/installed`，query `{limit:1000,pageToken,includeExtensions}`；直到`pagination.next_page_token`为空。headers显式accountId时ChatGPT-Account-ID，再LO(productContext)、surface header；productContext缺省codex时LO(codex)=CODEX。**库存读取和toggle mutation的SKU不同**，不能统一替换。

已证原始最低消费字段：`plugins[]`；每项id、name、release（interface、display_name、description、version等），installed实例含enabled/status/installed_at/disabled_skill_names；installation_policy/installation_policy_source、disabled_reason、scope/workspace_id/creator_account_user_id可能有值。完整schema未恢复，不把这些消费字段冒充全部必需字段。

EA投影：`plugin.remotePluginId=raw.id`，`source={type:"remote"}`，`plugin.id=raw.name+"@"+remoteMarketplaceName`；enabled为raw具有enabled属性且值为true，installed为是否存在enabled属性；status DISABLED_BY_ADMIN→availability DISABLED_BY_ADMIN，否则AVAILABLE；policy来自installation_policy（缺省AVAILABLE），policySource保留。服务raw id与UI复合id不同，HTTP必须用remotePluginId，不能把name@marketplace发成远程id。

确认toggle成功需相同身份、全部分页中找到同raw.id且真实enabled等于请求；找不到、列表受限/错误、未知enabled不能假确认。服务HTTP200但目录尚未同步可显示“操作已提交，状态待确认”，允许只读重查，不自动重复写。status管理员禁用即使raw.enabled=true也不能给可用工具结论。

当前app-server plugin/installed可能已返回remote source，但不表示本地config能代替远程服务，也不表示有完整ChatGPT服务授权。权限边界仍由真实status/availability/HTTP响应和账号环境决定。

## 6. 后续服务阶段的可验合同

1. 固定remote enable/disable宿主operation，只接真实库存身份的raw id与boolean，不暴露任意路径；保存前重核installed/availability，避免旧卡片变更。
2. mutation无body、精确默认SKU、真实auth与身份前后检查；响应错误不吞，raw body不凭空反推状态。
3. 全分页installed读回、raw id映射、不同account/host、不同SKU、晚到/401重试、管理员禁用、缺字段/未知响应/服务成功但读回失败分别测试。
4. 本轮UI/client可先消费真实experimentalFeature/list和configured/availability字段；不能以accountType猜资格，不能用remote HTTP受控fixture冒充真实账号通过。

本次只读取证，无产品或测试修改，无Cargo，无真实账号HTTP写入/登录/插件操作。原生/像素、真实服务响应样本与账号权限仍未验。
