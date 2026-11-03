# 16.11B 插件与技能设置收尾：下一阶段合同

2026-11-03。只读准备，**本合同尚未实施**，不属于16.10B MCP CRUD交付，不代表插件/技能整页或严格1:1已验。固定 Store `26.1027.3384.0`，asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`（同次16.10B已重新实测）；本次9个资源直接从该包只读提取，逐个校验archive integrity。证据 `.ref/parity/16.11/actual/16-11B-research/{manifest.json,anchors.json,raw/}`，定位为0-based UTF-16。

## 1. 现状与不重复范围

已读16.11A合同/待验表、12B安装后连接准备、13B推荐技能安装和当前 `SkillsMcpView.tsx/src/plugins.ts`。16.11A撤下无消费者策略表单、挂组合管理器，12A/B已有插件安装/卸载锁与连接准备，13A/B已有技能内容编辑/启停/推荐目录安装，16.10B正闭合独立MCP CRUD。下阶段不重做这些主链。

当前仍可观察差距：

- 插件卡仅显示enabled状态，无真正启禁动作，而固定Store设置管理卡明确使用toggle。
- manageOnly硬编码插件/技能/MCP三标签，未对应固定Store动态资格、count与fallback；应用/市场在设置管理模式中缺失。
- `handleRemoveMarketplace` 直接confirm→marketplace/remove，没有官方先枚举并卸载该市场插件、可重试部分进度的流程。
- 当前插件详情偏目录信息/安装准备，不是官方可路由的设置详情及账号权限；不能以已有详情组件称完整设置完成。
- 旧16.11A/12B/13B部分来源为offline补丁候选包，其证据可保历史，以下用干净固定Store纠偏，不能自动继承旧像素/运行时通过。

## 2. 固定Store组合设置页面

`plugins-settings-a90b0f90bd8a.js`只导出共享 `plugins-settings-13da7ceae7e2.js`。后者 `_o`（末段）渲染标题、副标题“管理插件、技能和 MCP”、浏览目录、添加菜单与manageOnly管理器。设置不是独立一套registry/沙盒策略表单。

共享 `uo` 选项顺序为 **plugins/apps/mcps/skills/marketplace**，中文“插件/应用/MCP/技能/市场”，aria“管理扩展程序”。mcps始终保留；其它只在showNonMcpTabs资格为真且count>0时显示。`plugins-page-selectors-de91d5f31a99.js y`：管理模式当前tab加载时保留；无内容则按固定顺序挑第一个非空，全部空落mcps。不能把动态隐藏标签当读取失败后全清空；count必须来自实际列表，不用演示计数。

host选取由显式hostId、导航state、当前远程/项目等实际来源决定，读取与mutation带host；本项目只支持local时应明确，不伪造远程选择器。浏览目录跳`/plugins`，技能当前tab带initialTab=skills，其余plugins，携带initialHostId和settings入口来源。

管理插件列表采用settings presentation，installedStateAction=toggle，紧凑空态，支持详情、卸载、启禁、复制/共享资格分支。技能使用单列compact真实skill entries，不能把plugin提供技能投影成可编辑用户文件；来源路径/作用域保留。已有13B文件安装与协议发现逻辑继续复用。

## 3. 优先闭合：插件启禁与真实运行时刷新

initial=`app-initial-4267e52fe5b0.js`。`dqr:4809139` 是setPluginEnabled，按host/source分支：

1. **本地非remote插件**：`CNn`读取user config filePath/version；`config/batchWrite {edits:[{keyPath:"plugins.<pluginId>.enabled",value:boolean,mergeStrategy:"upsert"}],filePath,expectedVersion,reloadUserConfig:true}`。单字段，不能重写整个plugins表。SKr:4791141仅生成该edit。
2. **远程source或服务host**：真实POST `/ps/plugins/{plugin_id}/enable` 或 `/disable`，path优先plugin.remotePluginId；服务host在发送前核account仍一致，不能把服务插件当本地config写了就说远程已生效。
3. 非服务分支写后 `wqr` 调真实插件/技能刷新；optimistic cache失败回滚，settled失效目录/config。成功toast与运行时目录刷新失败是不同事实，后者明确“插件已改变，但技能无法刷新；新建聊天前重载技能”。

本项目需对production client添加真实启禁闭环，复用安装/卸载同plugin写锁；写后重新读插件enabled及skills forceReload，不由本地setState假确认。CAS冲突、服务失败、读取失败分别显示；确认前不显示成功。preserve用户其它plugin字段/managed约束/账号与host generation。

remote HTTP需要固定路由、身份绑定宿主桥与真实资格，不能从浏览器直接拿token或随意fetch。尚未具备服务桥时可以先交本地路径，但必须显式列remote启禁未完，不用本地写冒充；下一子单元继续真实服务。安装策略INSTALLED_BY_DEFAULT的卸载限制沿用已有真实policy，不能推导成所有启禁也禁用；启禁的准入需追实际policy分支，不自行加“管理员默认必不能禁用”规则。

## 4. 卸载与市场来源的依赖流程

initial `mqr:4812482`：本地 `plugin/uninstall {pluginId:requestPluginId??id}`；服务host则POST `/ps/plugins/{plugin_id}/uninstall`并核account。本地卸载后刷新技能、应用目录及runtime cache；bundled某些插件先记录禁自动安装，防立即复活。具体bundled策略是专用分支，不能全局禁所有内建功能。

固定Store市场页只列 **非builtIn且确实配置过的市场**（selectors V/H/U），不是把service远程目录全部当用户可移除Git市场。Git配置source_type=git单独判定，用于升级资格；展示目录不意味着有本地path。

plugins `qa:50642` 市场移除弹层：先读取该marketplace完整插件及load errors，再逐个await uninstallPlugin；保留completedCount。只有全部卸载成功后才marketplace/remove。失败保留真实已完成进度与错误，重试从剩余项继续；Abort/关闭不回滚已完成卸载，也不能继续删除整个市场。目录读取失败不当作空插件。既有市场按钮直接remove应纠偏为此主链，真实动作只在用户明确移除后执行；自动验证仅隔离测试市场。

市场升级与移除不是同一权限；需要保留用户configured/builtIn/source_type、真实marketplaceName/path、host/workspace roots。readback确认目录/插件事实，不能靠本地filter保证消失。管理员默认不可卸载项如果出现在市场移除列表，应在执行前明确阻塞，不能卸载部分后才误判市场已移除。

## 5. 真正设置详情与权限边界

`plugin-detail-settings-enabled-de6c510c546f.js`读取gate **1064857188**；不能因路由chunk存在强开。`routes-eb7781dc3283.js` 注册：

- `hosts/:hostId/plugins/:pluginId`；`:pluginId`。
- 全局`permissions`、`apps/:appId`。
- `:pluginId/permissions`、`/sync`、`/skills/:skillName`、`/apps/:appId`与该app的permissions/sync。

这不是一个通用“允许联网/文件写入”本地表单。全局权限页 qi:21996 需当前account匹配personal且有适用servicePlugin；加载失败可重试，资格不符返回列表。Yi读取真实user settings.apps_privacy_control，默认review_important_actions；修改Zi为PATCH `/settings/account_user_setting?feature=apps_privacy_control&value=...`。全局菜单明确过滤full_access，仅连接账号层可以出现相应高风险选项，不能擅自统一开放。

关联账号权限有always_ask/ask_before_writes/review_important_actions/full_access、继承默认/null、多账号mixed、owner/editable、REAUTH_REQUIRED等独立事实。当前只完成静态入口取证，完整GET/账号PATCH/headers/重连合同还待专门补证；**本阶段不得先造权限表单或把通用config审批当账号服务权限**。可提供真实已接通的基础详情和明确未实现范围，权限完整闭环继续后续有界单元。

中文已从同包语言资源核实：插件已启用/禁用toast分别`{pluginName} 插件已启用`/`{pluginName} 插件已禁用`；toggleError“插件更新失败”；权限标题“权限”；详情账号权限状态“始终询问/只读/允许低风险操作/全部允许/多种权限”。原生焦点、实际gate返回与像素仍未验。

## 6. 建议下一大阶段范围

1. 将设置管理器从固定三标签纠偏为真实数据/资格驱动的组合列表和来源；复用独立MCP组件，不复制16.10B CRUD。
2. 完成本地插件启禁→config CAS→enabled读回→技能/runtime刷新→失败可恢复；remote固定服务桥若具备条件并入，否则独立明确后续，不假装全覆盖。
3. 修市场移除完整依赖流程、部分失败/重试进度/只读来源；保留12A/B安装准备与管理员policy回归。
4. 详情入口/基础内容按真实plugin identity；gate、远程账号权限/共享、sync、完整file-type-handlers/添加菜单、remote生命周期留独立后续合同。不能把基础详情路由存在称整页完成。

## 7. 修改前验收合同

- AC11-B01：管理tabs count=0/加载/失败/资格关闭、默认tab fallback、当前tab变空、导航返回/host切换；不丢搜索/错误或虚增count。
- AC11-B02：本地plugin启禁单字段、包含点/引号的ID路径、user CAS冲突、project/managed优先级、未知字段保留，读取错误不假成功。
- AC11-B03：启禁/安装/卸载同plugin并发锁、A→B→A、身份与host变化/服务重启、晚回不污染；不同插件的并行不误锁全页面。
- AC11-B04：写成功但skills/runtime刷新失败，保留写入事实并显示重试；正常重读真实enabled与工具/技能可用性，不用固定timeout冒充刷新。
- AC11-B05：市场configured/nonbuiltIn/git资格，插件枚举失败、管理员不可卸载、途中第N项失败、关闭/重试只继续剩余、最后才marketplace/remove。
- AC11-B06：技能user/repo/system/plugin来源、同名不同path、推荐已安装去重、原13B安装发现与编辑保护回归；不全靠显示名合并身份。
- AC11-B07：remote服务真实HTTP/账号资格未提供时标未验证；权限gate缺失不强开，低层本地config不能替代remote授权。
- AC11-B08：隔离CODEX_HOME临时市场+真实plugin与skills探针；功能专项、tsc、完整标准及同源码原生构建；配对像素/原生/远程账号缺口单列，阶段提交不等于用户验收。

本次未修改产品或测试，未运行Cargo，未执行真实插件安装/卸载/市场移除/账号服务操作；仅准备下一阶段合同。

## 本阶段实施注记

上述为修改前合同。本地组合管理/启禁与市场依赖移除现已实施，生产专项、双CLI隔离协议与受控Chrome、全Rust336通过；完整标准/原生构建和全部边界见[16.11B阶段待验](../acceptance/16-11B.md)。远程HTTP链只取证未实施，不将本地结果计为远程通过。
