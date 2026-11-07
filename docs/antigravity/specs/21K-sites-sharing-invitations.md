# 21K Sites 共享邀请：开发前规格

2026-11-07。本文先完成目录与团队静态调研，再执行邀请开发。现状态：**成员/群组/团队/外部邮箱邀请有限本地自验完成，整页仍开发中；真实服务、正常共享原生、像素与用户验收待做**。承接[21J](21J-sites-sharing-members.md)，已有参与者管理不能代替完整邀请；本阶段范围与实际结果见[21K阶段记录](../acceptance/21K-sites-sharing-invitations.md)。

## 目录与团队

### 基准与证据

固定官方 Windows Store `26.1027.3384.0`，asar SHA256沿用21E的 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`，本次未重新整包hash。证据目录 `.ref/parity/21/actual/21K-sites-sharing-invitations/reference/`：`directory-contract.json`、`directory-manifest.json`、`directory-anchors.json`、`directory-self-check.json` 和可重复 `extract-directory.cjs`。沿用21E raw并逐文件重算hash/entry integrity；新提取host provider时重算asar header，匹配 `58b11f647e1119b429ae364292977cf86fe116de3987265ccd2a265991fb9d85`。原始偏移均为0-based UTF-16、右端不含。没有HTTP、官方GUI或产品构建，不将静态分支称为账号已可用。

### 已证查询和返回消费合同

|来源|固定GET与参数|取消/时序|分页与消费字段|
|---|---|---|---|
|成员|`/accounts/{account_id}/users`；limit10、offset0、trim(query)、include_profile_photos=false；include_total未指定|150ms debounce；非空trim与debounce一致才启用；query signal与15秒timeout合并；retry=false|仅首10条；读取body.items；消费account_user_id、email、name、id；不恢复未见的完整schema|
|群组|`/accounts/{account_id}/groups`；limit10、offset0、trim(query)、include_member_counts=true、include_total=false|与成员同150ms/15秒/retry=false；Sites仅workspace&&Og(plan)&&owner传非空query|仅首10条；body.items；消费id、name、num_members；size取num_members??0|
|团队|`/accounts/{account_id}/teams`；limit100，offset依次0/100/200…；无服务端query|每页前throwIfAborted并重新检查团队资格；源码没有该链15秒timeout；自定义retry详下|合并所有items，has_more为假结束；按workspace_id筛当前workspace；消费id、name、workspace_id、avatar；nn候选size固定0，不虚构真实人数|

成员/群组hook支持chatgpt或chatgptAuthTokens、accountId存在、`networkMode:always`、一分钟stale、reconnect refetch。Sites实际团队资格只接受后述chatgpt allowed链。成员底层另有`/spaces/people`再404 fallback的函数，但Sites直接引用h，不走该Spaces分支。

团队`uEt`最多重试3次：408/425/429/5xx或无numeric status；其他status不重试。一次query retry从整条分页开头重跑。`kEt`未配置retryDelay；bundle query-core `L$e`默认 `min(1000*2**failureCount,30000)`，对应前三次1/2/4秒。尚未证明更高层query defaults不存在覆盖，不能把默认值描述为官方运行时测量。团队建议引用`tb=kEt('always')`，一分钟stale，mount always；不套用成员/群组15秒超时。

完整锚点链：`appgen-share-dialog:Y` → `use-workspace-users:h/g/v` 或 `workspace-team-recipient-suggestions:u` → initial导出`Mir=tb / jir=$y / mir=zEt` → `kEt/bEt/Qy/uEt`。每个export和函数在证据JSON中有精确偏移，不以同名混淆符跨文件推断。

### 团队资格、账户载入与平台支持

真实`$y`条件为：853110088 && ev.status为allowed && accountLoading=false && structure=workspace && selectedAccountId=queryAccountId && authenticatedAccountId=queryAccountId。853110088须来自完整user/account绑定Statsig快照，缺失false，不开启gate。

`ev`的正常链来自`Odt`：supportedSurface未知则loading；不支持则denied；正常需要chatgpt认证、非空且相同的认证/选中账户、计划位于Adt28。调试override确有静态分支，但不能作为真实资格。Adt28与外部邀请权限Og/Olt19及Sites入口gate是不同合同；完整计划表在directory-contract.json，包含team，排除未列的usage-based计划。

本轮补齐平台来源：`initialize-app-host-services-949d83ec96b3.js` SHA256 `3e6585bbbe3223fe0f99ba53cb413e7a7a0cc601740b1e0dc879499491c4b17b` 的完整`zy`函数，在真实host provider传入 `supportedSurface:true`；不是网络接口返回，也不等于Sites access。`zy`经initial导出Scr对应`e_t`写入x_；Wlr对应x_的导入也已留证。accountLoading为`m&&accountsQuery.isPending || accountInfoLoading`，authLoading为auth.isLoading。`Gy`按raw账户列表匹配account.account_id，拒绝session access=false与停用账户。

本项目可明确采用Windows Tauri等价host surface=true适配，在account/read与raw账户完整读取成功后计算allowed，保认证routing/ServiceIdentity匹配、Adt28、workspace、853110088和最终identity复核。不得用API读完前假定accountLoading=false、以Sites enabled代allowed、用另一个GPT页面seat规则替代或强开未知gate。

### 候选、去重与呈现

源分组顺序：你的团队 → 群组 → 用户。团队可在空query获得焦点时显示；群组/用户须非空搜索。团队和群组均以name的localeLowerCase包含trim query的localeLowerCase过滤；先排除policy已有group id，再让群组排除同id团队候选。团队与群组共同target.kind=group，但source须分别teams/groups，不能把groups GET当团队替代。

用户经dialog-utils排除当前account_user_id、已有viewer/editor的account_user_id和已选成员ID，Sites sn还排除email==null。用户label为name??email??id，不虚构ID；email展示保原文本。外部邮箱另按Y trim/lower和精确schema验证，排除当前/已有/搜索用户同邮箱；不能按显示名合并不同身份。源未声明对任意重复服务items全局去重，不能擅自扩大为不同语义。

真实中文：`yourTeams=你的团队`、`groups=群组`、`people=用户`；团队可用时placeholder为“添加成员或团队”，否则“添加用户或群组”；无结果为“没有匹配的用户或群组”。成员/群组/团队错误和loading分别保留，不能把失败当空结果；群组独立Retry调用refetch。UI外观、焦点与运行时状态时序仍待实测。

### 宿主复用与最先可开发闭环

复用ServiceIdentity/profile请求envelope、取消、accountRead、selectedServiceAccount、shareAccessBootstrap完整快照与读前后identity复核。现generic share_users/share_groups缺Sites专属读守卫，且generic groups固定member_counts=false；21K规划专用`sites_users`、`sites_groups`、`sites_teams`，由宿主绑定账户固定路由，不接受任意URL/caller account。团队offset整数、limit固定100；用户/群组参数由宿主固定。

最先完整闭环是：真实资格→三条独立目录读取→原始消费字段解析/候选过滤→owner邀请入口→真实PATCH及严格ACK→GET权限读回。不能止于搜索列表或把ACK当邀请已稳定落库。150ms与一分钟cache由UI/controller维护；users/groups15秒由client取消，teams保完整分页及独立retry。身份/取消晚到不得跨账户回填；unknown写不自动重发。

待证/未完成：服务完整schema、真实账号目录资格与跨页服务异常、官方实际网络时序/自定义query defaults、原生输入法/焦点、宽窄像素配对及用户验收。后续实现需更新阶段记录；本节不宣称这些已通过。

## 邀请整合动作与验证合同

UI、邮箱的完整来源见[独立补证](21K-sites-sharing-invitation-ui.md)，宿主固定路径与显式 viewer 操作见本阶段 `reference/host-contract.json`。先写真实缺失功能/差异回归，再实现；不自动向真实邮箱、成员或团队发送邀请。

1. 所有者与来源 `qt` 决定输入可见；共享保存中仍保留禁用输入，不用“已有外部访问者可管理”推导“可发新邀请”。选择候选先清 raw query，再提交一次 viewer；Enter/IME/Tab/Escape 不得绕过选项、权限或表单边界。
2. 三类目录状态独立：用户/群组 150ms debounce、15秒取消、一分钟查询缓存；团队按完整资格和固定100条分页，按来源独立重试。旧 query、账号代次、权限变化或卸载后的响应不得回填。外点关闭保留 query，Escape 清空；不制造成功计时器。
3. 当前成员、已有 viewer/editor、已共享群组及重复团队/群组按真实身份排除；候选次序 teams→groups→users/external。候选只是目录结果，未执行 share_access 和实际读回前不得显示成已共享。
4. 邀请与既有角色/移除/链接模式共用同一个共享写锁与状态；目标重复、权限过期或 admins_only 必须写前拒绝。邮箱先 Y trim/lower，再采用恢复的实际默认 schema 规则，不增加 source 未有的长度或 RFC 约束。
5. Clone 沿用21J额外 GET 适配：raw ACK 留存，读回实际成员/邮箱/群组且非 pending 才确认；未知或未收敛仅允许显式 GET，不重发邀请。跨关闭/重开仍可恢复，不把 profile、首次发布或所有权转让包含进本次已实现声明。
6. 优先聚焦回归与独立复核，再冻结全产品跑完整检查和对应原生构建；不在最终完整检查执行中修改产品。宽窄浏览器只是明确离线 bridge；正常共享原生、官方配对像素、真实服务和用户验收分别记录。

已有21J群组菜单差异另有先红后绿：owner+editable 的群组即使无移除回调，也保留仅当前查看者菜单；可打开不等于可写。对这一变化扩展2048来源权限向量与实际JSX回归，不开放 admins_only 写路径。
