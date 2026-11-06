# 22E Codex 云端环境：固定发行包重新取证与逐动作合同

2026-11-06。**调研完成，尚未实施22E；没有真实账号HTTP、官方GUI、同环境像素或用户验收。** 按当前 `PAGE-PARITY-PLAN`，21是Sites、22是Cloud Environments；本单元不改Sites资料。当前 `CloudEnvironmentsView` 已有真实ASB双scope全分页、详情、仓库名解析和取消隔离，不是占位页；应保留真实闭环，纠正资料/能力/布局差距。

## 基准与可复查资料

- 只读固定 Store `26.1027.3384.0`：`C:/Program Files/WindowsApps/OpenAI.Codex_26.1027.3384.0_x64__2p2nqsd0c76g0/app/resources/app.asar`。
- 包SHA256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`：明确复用19E于 `2026-11-06T22:24:08.9404008+08:00` 的完整测量；本单元未重新整包hash。独立重读header，SHA256 `58b11f647e1119b429ae364292977cf86fe116de3987265ccd2a265991fb9d85`。
- `.ref/parity/22/actual/22E-cloud-environments/reference/manifest.json` 登记 **55份fresh原始文件**，完整hash/大小均与独立header entry integrity核对；包含新ASB页面、Legacy页和原生服务/schema。
- `anchors.json` 保存 **74项完整函数或明确有界片段**；位置全部是 **0-based UTF-16 code units**，不是行号/字节。`translations.json` 保存本页用到的75项真实中文；missing里3项是控件ID，另1项为实际缺失locale键，不据英文猜中文。
- `literal-inventory.json` 是对同包 **16072份JS、459470860字节**的精确字面量检索地图，不是每个文件的独立行为验收。`self-check.json` 证明55文件hash、74锚点往返；另有2项原始纯函数离线样本，仅名称trim行为，不能代替UI或集成验证。
- `implementation-baseline.json` 保存本轮读到的4份当前产品源码hash；其他代理正在开发GPT，故不把仓库当冻结提交。
- Windows DPI、App缩放、官方窗口客户区、真实gate/账户均未实测；像素分数=null。只读提取，不复制原包资源到产品。

旧22规格基于已打offline补丁的另一包，不能继承其chunk/hash/offset。**本版新页面仍存在但已改名**：`settings-fdb8fcb12a91.js` 导出 `CodexCloudSettings`；`settings-configs-4974c326ee94.js` 是全分页query；`create-route-cb58a6c3d2c1.js` 是创建路由。初步仅按旧chunk名搜索会误判不存在，全entry检索已纠正此初判。Legacy `cloud-environments-settings-page-c0c7bd1e0217.js` 是另一套界面，不与新系统混用。

## 来源导航

|职责|fresh来源与锚点|
|---|---|
|新设置路由|`settings-lazy-routes-1c307af3cdd3.js` → `route-new-settings`，实际导入 `settings-fdb8fcb12a91.js`|
|Legacy独立路由|同lazy表 → `route-legacy-settings`，对应`/settings/cloud-environments`|
|新页门槛/目录/详情/行|`settings-fdb8fcb12a91.js:Qn/er/tr/Ln/nr/rr/ir/En`完整函数|
|设置目录全分页|`settings-configs-4974c326ee94.js:p`|
|标题/说明/搜索/页签|`toolbar-fe812df26c2c.js:P`及其他完整函数；`settings-content-layout-268f5398cbba.js:b`|
|创建路由/任务|`create-route-cb58a6c3d2c1.js:ie`；`pending-onboarding-actions-7d6b6829d4a2.js`|
|cloudAccess|initial → `cloud-access-svt`、`cloud-access-Tv`；新页Qn读取Tv，不用Legacy旧hook替代|
|ASB origin/header/双scope/API|native491 → `native-fixed-http`、`native-list`、`native-request`|
|原始schema|native133 module74460 → `schema-environment-configs`，native491以`FF=r(74460)`引用|
|中文|`zh-CN-88ebb426d686.js` → translations.json|

## 门槛：直接页面、管理与旧Cloud要分开

新设置Qn先查 initial `Tv`，即 `svt?.cloudAccess===true`；不允许直接用375130565或legacy access hook替代。`svt`：

1. gate3769444934为false：cloudAccess=true；管理权限另算。
2. true：加载为undefined；非ChatGPT/ChatGPTAuthTokens、资料失败、缺账户/plan为null；个人精确六计划 free/go/plus/prolite/pro/promax → cloudAccess=true、manage=false。
3. 其他计划等Statsig/workspace settings：gate1355972088=true用 `permissions` 的 `chatgpt.workspace.feature.allow-codex-access.access`；false用 `beta_settings.wham_access===true`。
4. 管理能力还查 `codex-manage-workspace-environments.access`，不能把只读成功等同编辑/删除权限。新行 `Ot(environment,rbac)` 再决定编辑权限；删除在RBAC关闭时 owner===false 禁用，开启时按编辑能力禁用。

当前桥仅六个人计划推导自动读取；其他计划标incomplete但保留手动读按钮，**未复刻完整cloudAccess**，不能写为官方已允许。下一实现应复用身份绑定完整Statsig/工作区读取，拒绝未知快照放行；不因读取ASB成功升级门槛。当前 `use-codex-cloud-access` hook是Legacy onboarding/wham链，存在不代表新页用它。

## 页面如何呈现

- 新页面是**设置内容工作面**，标题用官方slug `codex-cloud`；说明为“设置云端环境，为 Codex 在你的项目中开展工作提供所需的代码仓库、工具和设置”。上方“环境 / 个人保险库”页签，URL `tab=personal-vault`切换；normal环境页不能常驻工程实现说明。
- 环境页stickyControls包含真实搜索（label“搜索环境”、placeholder“搜索”、maxLength128）及“创建环境”。创建按钮宽度 `w-full @md:w-auto`，带真实图标。不可做无执行器可点击假创建；未接时应清楚记录能力缺口。
- 列表复用settings-row，不是dashboard卡片或裸HTML table。列头“环境 / 共享”；共享列宽 `w-32`，在 `@lg/settings-row`以上显示列头并横排，窄时每行改纵排。右侧菜单占`w-8`。具体container阈值/token需沿公共CSS同环境测量，不能把13px根字号下的rem当官方16px效果。
- 名称、可选真实description、仓库行依次显示。多仓库只显示首项及真实“+N个仓库”悬浮信息；仓库名加载用w32骨架+accessible status，失败中性“未知代码仓库”。不能把opaque仓库ID当正常展示名。
- versionRevision===1显示“未发布”，tooltip“发布后即可使用”。当前summary丢version_revision/description，无法展示这些真实状态。
- 共享中文精确四分支：private→“私有”；workspace且owner未知→“共享”；owner=true→“由你共享”；owner=false→“与你共享”。当前仅“私密/工作区”不一致。
- 点击行/查看后，`er`保存选中身份配置，**同一设置工作面替换成tr/Ln表单**，而非原生dialog；取消恢复列表。`tr`重新GET config，loading/error有独立“取消/重试”。`draft??config`有效值、名称/description、共享、仓库、network、runtime/secrets/portals等都来自真实schema。
- Ln包含名称内联编辑（max128，Enter/Escape结束编辑态）、验证、脏状态/保存互斥。权限/服务不可用不该出现假成功；整套写链未接不能把只读dl宣称同一表单。

## 动作与状态合同

|ID|动作/条件|官方静态预期与验收|
|---|---|---|
|CE-E01|打开新云设置|cloudAccess严格true才页面；身份不全显示“登录以加载已保存的环境”；loading、失败、空目录独立，不从错误变空|
|CE-E02|加载目录|query按account/user，staleTime0/gcTime0/refetchOnMount always/retry false；循环每页，Map按ID合并；所有页完成才成功；切号取消晚到|
|CE-E03|搜索|本地trim/toLocaleLowerCase按name和真实仓库名过滤，max128；不是虚构服务搜索参数|
|CE-E04|无匹配300ms|同一稳定query、已有身份、未加载/错误/刷新时才真实刷新query；加载显示saved loading，失败重试；刷新后仍无匹配“没有匹配的环境”|
|CE-E05|共享/草稿|四种共享中文与revision1 badge；真实description、仓库别名，不能固定“已运行”|
|CE-E06|打开配置|行内切换到设置工作面；GET ID绑定，取draft有效值，加载/失败/重试/取消，取消返回原列表焦点待原生验证|
|CE-E07|菜单编辑|权限允许才编辑，revision1文案“继续设置”，普通“编辑”；createDraft+cloud task，pending“正在创建草稿…”；结果未知禁止重复POST，提示检查聊天列表|
|CE-E08|保存|真实name/description/sharing PATCH或draft PATCH、revision/base_version冲突，成功读回并refetch；保留错误和未保存值，不本地伪保存|
|CE-E09|删除|真实确认“删除{名称}？”、影响描述；pending禁重复/关闭；permission denied、请求错误、重试分别处理；仅成功后清账户范围缓存并移除|
|CE-E10|创建|路由校验search/hash、账户/宿主/启动状态，仓库选择，创建setup聊天；不是普通本地thread/start或名称prompt|
|CE-E11|保险库|独立tab及lazy加载/错误，不预取secret真实值；类型筛选/搜索/添加/导入按独立完整合同实现，当前不具备|
|CE-E12|卸载/切号|旧catalog/detail/repo响应不得回写，新身份不复用旧草稿/秘密；订阅建立失败也要可见且不读取无确认数据|

错误/空态实际中文包括“正在加载已保存的环境…”、“无法加载已保存的环境”、“暂无已保存的环境”、“未能加载环境”、“正在载入环境…”、“重试”、“取消”。具体key/原文/offset在translations.json。

## API与真实数据边界

native AF从固定 `wss://codex-cloud-backend.chatgpt.com/`派生HTTP `https://codex-cloud-backend.chatgpt.com`，没有backend-api前缀；请求只接受同origin绝对根path，redirect:error、cache:no-store、默认30秒，Content-Type JSON及X-OpenAI-Product-Sku:codex，再附真实desktop认证。不能使用ChatGPT workspaceRouting改写ASB，或接收renderer任意URL/header/token。

|操作|真实API与重要参数/返回|
|---|---|
|完整list|并行GET `/v1/environment-configs?scope=user&limit=100&omitDraft=true` 和workspace；每scope独立cursor，已结束scope不再读；native错误整体非ok，设置query不把部分页当完整成功|
|list原shape|`data:[{id,name,description?,is_owner?,share_settings,repositories:[{repository_id,ref}],version_id,thread_id?,version_revision?}],next_cursor`；native转camelCase并加status ready（配置状态，不是运行容器）|
|detail/draft|GET `/v1/environment-configs/{configId}` 或 `/drafts/{draftId}`；直接config对象，ID正则A-Za-z0-9_~-；核请求ID和draftId|
|仓库名|独立ChatGPT backend `/wham/github/repositories/{id}`，真实full_name，401/403/404中性unknown|
|create|POST `/v1/environment-configs`；真实repositories/ref、network、private、start_onboarding，后续onboarding/cloud任务；Legacy迁移body不同|
|metadata|PATCH config允许name/description/share_settings至少一项（fresh schema已含description）|
|draft|POST `/{id}/drafts`；PATCH `/{id}/draft`或`/drafts/{draftId}`带base_version_id/expected_revision及最小变更|
|approve|`approve/begin`→operation轮询→approve/complete，revision/idempotency/threadID不是随意参数|
|delete|DELETE `/{id}`；读取与管理权限不能混淆|
|vault/VPN|`/v1/personal-secrets`、`/v1/personal-environment-variables/{id}/value`、config/vpn；值必须显式操作，目录不读值|

fresh schema额外确认 description、portals（ssh/http_ports避免22重复）、runtime_requirements、outbound_identity_requirements、vpn/tcp等，当前parser只保存有限字段；未知字段不要因当前UI没用就宣称服务不支持。secret只有名称/来源/目标/错误元数据，无明文value。新页没有Legacy reset-cache合同，禁止把旧HTTP/按钮搬过来。

## 当前差距与下一真实实施顺序

1. **先资格与模型**：以fresh svt链补工作区cloudAccess，不回归成永久占位；summary保留description/versionRevision/isOwner等所需字段，配官方shape fixture。检查listener失败和身份变化从订阅确认到最终响应的边界。
2. **列表对齐**：复用既有设置布局/行/搜索/菜单，四种共享、description、未发布badge、仓库骨架和多仓库展示，替代裸table；保持真实双scope分页，但登记当前“部分scope结果+错误”的适配与官方native整体非ok差异。
3. **配置工作面**：撤dialog差异，按tr/Ln恢复同页配置显示/取消/重试、真实字段与权限；键盘、inert移除后focus、窄屏不溢出。有实际保存链后才启用保存与编辑。
4. **真实写链**：createDraft/cloud setup→保存/冲突读回→delete确认与缓存一致性→创建仓库选择；每步先离线失败回归再隔离真实服务验证，结果未知不重发POST。
5. **保险库/网络扩展**：独立敏感值动作/类型筛选/导入、VPN/runtime/身份连接，再Legacy迁移；这些仍属整页目标，不能因只读切片推进省略。

逐阶段验收至少覆盖：个人/enterprise允许/禁用/未知gate；双scope二页失败/空页cursor/重复cursor/重复ID；真实字段四分支；300ms无匹配只刷新；详情错ID/draft优先/取消重试；POST结果未知/冲突/权限拒绝；真实保存再读；640与1280宽界面、菜单与长仓库名、Tab/Escape/焦点、中文IME、对应当前Tauri构建；最终同环境官方截图叠加/差异锚点≤1物理像素。缺官方配对、HTTP或原生条件都标未验证，阶段交付不得标整页1:1或用户已验收。
