# 15E 设置归档：开发前合同与证据边界

2026-11-06，本合同先于15E-A开发建立，实施及未完成范围见[验收记录](../acceptance/15E-settings-archive.md)。固定Store26.1027.3384.0；整包基准沿当前阶段清单。下列entry已只读提取并校验SHA-256与asar integrity一致，没有修改安装包。byte位置指整包绝对字节位置；代码锚点另用0-based UTF-16字符偏移。

| asar entry（webview/assets/下） | 绝对byte位置 / 长度 | SHA-256 |
|---|---|---|
| settings-lazy-routes-1c307af3cdd3.js | 562270812 / 12617 | 6369ce4128f0760a17e8bf3dd1ea7afae24781176d1cc6802085aa95734b6834 |
| data-controls-805edc0381e3.js | 272559084 / 41258 | 6cc411eaa6d6612dc14970a3623e34fb04f107feda0b0ce88583c2d483cc0db0 |
| data-controls-settings-3b25a6ba2b0d.js | 272600342 / 47592 | 97bb0fb25a0ec01a79ce589b1b5bb215ebcb169d58b0055dee6a2e36997a757c |

## 先确认工作面，禁止直接套用

settings-lazy-routes:6909将archived-chats导向DataControlsSettings；data-controls-settings:39215的管理入口导航到/settings/archived-chats。对应本项目SettingsView的archived-chats分区。

当前App全局archive路由也共用ArchiveView；官方app-primary-998934e837fc.js:1720292却是专用归档侧栏，尚未证明与当前全页等价。因此下列设置合同不能无条件应用到两处共用组件。需要先明确设置/全局工作面的边界，再实现有完整来源的增量；本文件不要求现在增加闲置surface抽象或改变全局归档。

## 设置工作面已证静态事实

- data-controls:13798默认updated；23846的Fn组合搜索、类型/排序菜单和项目筛选。
- 25084的In在同一筛选菜单中提供类型与排序，updated / created / alphabetical，当前项有勾选；27989为bottom/end/menuNarrow。不是一个独立的官方排序按钮。
- app-primary:1718294按时间降序并以标题打破平局；按字母顺序时标题升序、同标题更新时间降序。
- app-primary:1716663默认按项目分组；项目筛选生效后为单组。平铺列表即使排序正确也不等于整页一致。
- 同版zh-CN:1843932“筛选已归档聊天”、1844109“排序方式”、1845155/1845219/1845277“按字母顺序/创建时间/更新时间”。

## 下一步与验收边界

开发前ArchiveView有搜索、服务端更新时间排序和平铺列表；没有上述设置内菜单、排序状态和分组。必须先补完整菜单条目、类型资格、项目筛选与数据来源合同，不能只截取排序三项后声称菜单一致。云端资格/服务链不能凭空补齐，不能强开gate、填模拟云端结果或静默隐藏官方项来凑页面。

来源充分后才开发：设置挂载默认更新时间；本地生产投影覆盖三种排序和平局；搜索/刷新保持选择；纯排序不增删数据、不发写请求；恢复/删除及进行中保护不回退，全部删除仍指全部本地归档。菜单需验证键盘、Escape、焦点、勾选、边界定位；全局挂载不应被此次设置改动污染。

建立合同时时点未开发、未验收；后续15E-A仅实施本文第6节的本地增量，实际结果见验收记录。账号、云端数据与官方同环境像素仍未完成取证，score=null。本单元不属于v0.2.0-preview.1功能。

## 2026-11-06 补充：完整设置工作面与资格合同

本节只读取证，不表示产品开发或验收。当前同版原始资源已保存到 `.ref/parity/15/actual/15E-settings-archive/reference/raw/`；`manifest.json` 记录11个entry的asar相对offset、整包绝对byte位置、长度及SHA-256，全部重新读取并与entry integrity匹配。整包SHA沿固定基准，本次未再次计算整包哈希。`anchors.json` 保存55个原文定位和片段；以下代码数字全部为0-based UTF-16字符偏移。不得将旧15B带离线补丁包当本节依据。

### 1. 正常页面结构和菜单

`data-controls-805edc0381e3.js` 的 `kn` 末尾把标题、全部删除action、stickyControls、分组列表、错误重试行、删除确认交给 `SettingsContentLayout`，不是额外嵌套一个自带“归档”标题/说明/总数的独立全页。`Fn@23846` 在存在entries时才提供搜索、类型/排序菜单、项目筛选工具栏。零entries没有工具栏；加载、无数据、无匹配、来源错误、部分来源错误分别处理，不能用一个“空”替代。

- `In@25084`：触发器是带图标与当前类型名称的筛选按钮，`w-[150px] md:w-36`；菜单bottom/end/menuNarrow。类型小标题→全部聊天→条件本地→云端→分隔线→排序方式→更新时间→创建时间→按字母顺序。当前类型/排序勾选。
- **全部聊天、云端条目在此函数中无条件存在**；本地条目仅 `localChatsAvailable` 为真才显示。不能因为本项目尚无云端服务就无依据隐藏云端项，也不能把缺服务转成“无匹配”。
- 默认kind=all、projectFilter=all、sort=updated（`13798`附近）。若local资格消失且当前选择local，投影使用all；失效项目筛选同样回退all。
- `Ln@28163`附近：项目按钮 `w-[180px] md:w-44`；菜单bottom/end/workspace/tall。全部项目→分隔线→实际项目→分隔线→聊天→计划任务。同名项目附区分路径tooltip，不按名称合并身份。最后两项不以是否有结果为条件消失。
- `Rn@31568`：全部项目时按项目分组，分组头有图标、名称和聊天数；无项目显示“无项目”。仅选定项目/特殊组后隐藏组头，成为单组列表。分组中的项目删除菜单只有当前host=local、项目有名称且该组存在local/local聊天时提供。
- `zn@34459`：本地行标题是非导航span；描述使用更新日期和时间，更新日期无效才退创建日期；单组模式附repo简名，分组模式不重复repo。不是当前“几分钟前 + 完整cwd”的形态。右侧本地host删除icon和取消归档按钮；durable/其他host不得显示本地永久删除入口。未命名标题使用语言包fallback。

中文资源同版 `zh-CN-88ebb426d686.js` 的 `settings.dataControls.archivedChats.*` 键为唯一中文依据：filter.all/local/cloud、filter.section.type/sort、sort.updated/created/alphabetical、projectFilter.allProjects/chats/automations、noProject、dateTime、dateTimeWithRepo、untitled。实施前将实际使用键定位加入anchors，不能自行翻译英文defaultMessage。

### 2. 资格与来源不能混淆

`bn@8941` 的 `l=ce(Xe)` 即app-initial导出的 `Ssr → uvt`，表示本地聊天可用。`uvt@1870519`附近由 `rvt.status===allowed` 得出；rvt合并local与workLocal，local依赖真实账号、workspace settings、supportedSurface，workLocal另受rollout gate/plan分支影响。`W_t@1864695`和`w_t@1861195`含具体判定：个人计划与组织workspace条件不同，API/codex token不能只按“不是ChatGPT”猜成不可用。

`E=i===local && s && authenticatedAccountId!=null` 决定是否读取ChatGPT conversation归档；s是 `vcr → sv`，由 `ev.status===allowed`，ev来源 `Odt@1766302` 的supportedSurface、ChatGPT auth、账号匹配和明确plan集合等条件（另有官方debug override，不得仿造强开）。`includeWorkCloud` 取 `jsr → dvt`，即workCloud资格，不等于s或local资格。

cloud task列表hook `kDn@1718715` 默认enabled=true，但仍要求真实账号ID存在；这是另一条链。不能把ChatGPT conversations、Codex cloud tasks、durable app-server归档统一成一个“cloud=true”。当前没有账号时hook disabled不等于HTTP请求成功空，也不证明所有账号都无云端归档。

本项目能力映射：

| 当前能力 | 可复用内容 | 不可推导内容 |
|---|---|---|
| `accountRead` / `accountSession.ts` | 真实登录类型、账号/连接生命周期 | 不包含全部官方local/workLocal/workCloud/ChatGPT归档资格 |
| `chatgptService.ts` ServiceIdentity / request cancellation / responseBody | 账号ID+用户ID+generation、取消与晚到回包隔离 | 身份有效不等于任意归档接口已授权 |
| `cloud_service_access` / `CloudAccess` | 个人计划分支证据与incomplete状态 | 它是云端环境访问合同，不能作为本地或归档聚合资格 |
| `account_notifications` resolver | 已实现Odt/Adt计划与账号验证的一部分基础材料、账号更换保护 | 通知读取结果不是通用access snapshot，不能为归档发通知请求求资格；workspace/rollout gates尚需独立证明 |
| `ServiceOperation`、`CloudOperation`白名单 | 当前已有账户/profile、云端环境读取 | 尚无归档tasks/conversations读取与恢复/删除操作；必须新增明确操作合同，不能拼任意URL |

### 3. 项目身份、分组与排序

app-primary的 `_Dn@1714706` 构造统一entry，`xDn@1717650`处理归属，`yDn@1716663`执行筛选、搜索、分组，`CDn@1718294`排序。

1. 项目ID为 `project:<projectKind>:<hostId或空>:<projectId>`，不可仅label、cwd或名称作key。当前host=local时仅本地项目；其他host取匹配host的remote项目。原始project列表来自app-initial `SAi@5461245`，由本地project metadata、workspace roots与远端分组组合；不能只取“有归档结果的项目”。
2. local entry先检查projectless集合并明确排除归属（覆盖已有assignment）；其余优先显式assignment；否则依次hint/cwd规范化后与项目path **精确相等**，只接受唯一匹配。不是最深前缀或任意第一项。ChatGPT conversation按gizmo_id匹配本地项目，cloud task按assignment。
路径规范化必须复用或等价实现官方Pa：app-primary导入`Nvt as Pa`，app-shared导出`EY as Nvt`。`EY@1729227`先将合法Windows扩展路径前缀经`Mit@1729116`剥除，再经`TY@1729073`将反斜杠转为正斜杠，随后**整条路径toLowerCase**。`C:/Foo`和`/C:/Foo`转为`/mnt/c/foo`；WSL UNC `//wsl$/发行版/Foo`或`//wsl.localhost/发行版/Foo`转为`/foo`（忽略发行版部分）。普通UNC保留双前导斜杠但小写；不resolve点路径、不解析symlink。xDn在Pa结果上另外去除尾部正斜杠。仅slash转换、去尾且保留大小写与官方不符；不能用当前sidebar norm代替全部规则。

3. automationThreadIds来自真实automation runs的automationId/threadId，filterGroup= `special:automations`；无项目filterGroup=`special:none`；显示分组projectGroup与筛选filterGroup是两个概念，不能用一个字段冒充。
4. 类型筛选中durable的local entry按cloud处理；项目筛选先按filterGroup，再搜索，再按projectGroup分组。全部项目默认groupKey=project；指定项目/聊天/计划任务后groupKey=none。
5. 时间排序降序、平局标题；字母排序标题升序，同标题更新时间降序。项目组按成员最大相应时间降序；字母模式按项目label再ID。null/非有限时间按官方OJ回退另一时间，再归零。

本地可复用 `buildSidebarProjectGroups` 的数据来源和membership快照：localProjects/rootPaths/name/serverProjectId、threadProjectAssignments、projectlessThreadIds与workspace hints。**不能直接复用 `sidebarThreadProjects` 的归属结果**：当前该函数接受cwd子目录前缀、scopeRoots owner和legacy第一项，而官方归档xDn要求精确相等唯一匹配。设置归档需一个小的专用投影，显式处理serverProjectId与本地ID映射；不要修改侧栏既有语义。`automationsClient.ts` 存在真实run的threadId资料，完整runs读取覆盖及历史分页需先确认；未知时不得凭title/cwd猜计划任务。

### 4. 搜索合同

`vDn@1716495` 使用包内Fuse形搜索库，`ignoreLocation:true, keys:[searchValues], threshold:0.4`。不是当前仅标题includes。local searchValues包含清理后的标题、项目label、cwd和rollout path各自取basename并最多前三个空白词；ChatGPT包括标题与项目label；cloud task另含environment_label。输入trim，空串返回原集合。搜索在类型/项目过滤后执行，之后分组/排序，不复用搜索库相关度作为最终默认排序。

当前项目没有该搜索库依赖，文件fuzzy协议属于文件名搜索，不能复用为归档标题搜索。不得自己写一个近似匹配器后声称Fuse一致；可先保持明确登记的子串兼容差异，完整模糊一致需单独确认实现方案/许可/依赖约束。

### 5. 真实读取与mutation链

| 来源 | 官方静态读取/动作 | 当前差距 |
|---|---|---|
| 本地/选定host | `Dn@12699`：thread/list archived=true、limit100、modelProviders:null、sortKey:updated_at、sourceKinds=[]（ue→app-shared fbt→Knt=[]，@1714318）、useStateDbOnly=true，全cursor，重复cursor抛错；host/身份隔离；durable另有连接状态与重连 | ArchiveView已有本地全分页和重复cursor；没有host选择/durable；sourceKinds=[]已静态确认，当前CLI适用性仍需真实合同回归 |
| ChatGPT conversations | app-initial `z0i@5906558`→`NAr/PAr@4487139`：GET /conversations，is_archived=true、hide_snorlax=false、order=updated、limit20、offset，includeWorkCloud=false时exclude_conversation_origin=tpp；真实total决定下一页 | 当前白名单无此读取；不能把现有thread/list返回当云端结果 |
| Codex cloud tasks | app-primary `NDn@1719430`：GET /wham/tasks/list，limit20、cursor、task_filter=archived；401/403/404明确返回空，其他错误向上抛；PDn有独立搜索/最多5页扫描，当前设置hook未传search走NDn | 当前无task list读取；“功能未实现”不得套用HTTP401/403/404空策略 |
| 本地恢复 | `kn@14220`附近调用所选host的unarchiveConversation；乐观移除，普通失败回滚；特定unarchived-conversation-load-failed只显示“已取消归档但打开失败”不回滚；成功toast含独立查看动作，最后失效归档query | App当前thread/unarchive→refreshThreads；未hydrate/open结果分类；查看为页内status，不能称toast一致 |
| 本地删除 | 单删/项目/全部独立确认；仅local host永久删除；执行真实deleteArchivedConversation(s)，成功后清缓存/刷新 | 本项目archive_delete已有重查归档身份、真实成功ID、部分失败保护；项目批量尚无前端合同。保持更真实的部分失败结果，不能照官方fallback count虚报 |
| cloud task恢复 | `hn`：POST /wham/tasks/{task_id}/recover，成功清归档cache、标记active、失效tasks；查看去/remote/:id | 当前无此mutation，也无可对照完整remote task工作面；不得将本地thread/unarchive用于task ID |
| ChatGPT恢复/删除 | `hn`调用ChatGPT恢复service i2i@5920075：PATCH /conversation/{conversation_id}，requestBody={is_archived:false}，成功更新snapshot并失效归档/history/project queries；永久删除app-initial n2i@5919273为DELETE /conversation/id/{conversation_id}，明确404 conversation_deleted分支，成功后真实缓存清理 | 当前无白名单操作/读回，不能将thread_delete_archived用于ChatGPT ID。恢复endpoint已定位；当前账号可用性、真实读回与跨surface同步仍未实测，未完全闭环 |

HTTP路径只是静态发现，不代表当前账号可调用。本节没有发真实HTTP、恢复、删除、付费模型或账号写。

### 6. 可执行的最小开发边界与测试

建议15E-A只改变设置挂载：复用现有真实本地全分页与mutation保护，接入当前项目membership/hints的只读快照，完成本地分组/筛选/排序、官方日期描述和正常设置容器。全局archive保持既有工作面，不能因共用组件被动变成设置页。所需props在设置入口真实传入，不创建闲置通用surface框架。

完整官方云端链尚不存在，必须明确区分：选择云端不显示“暂无归档”，而呈现真实“云端归档尚未实现/不可用”的兼容状态；all模式若缺可能的云端来源要明确结果来源不完整，不能称“全部聊天”的完整读取。这是**需要登记的产品差异**，不是官方错误文案。不能无依据隐藏云端菜单，也不能加定时/模拟数据制造完成。若当前阶段不能接受显式兼容状态，则先只实施设置挂载/本地结构，并保留完整菜单为待实现，不宣称正常页面完整。

| ID | 最小生产回归合同 |
|---|---|
| AE01 | Settings archived-chats使用新设置呈现；App archive保持原行为，确认/真实删与恢复保护共用能力不退化 |
| AE02 | 显式assignment优先；projectless不归组；hint/cwd精确且唯一才fallback；同根多项目/同名不同ID/remote不误并；子目录前缀不得误归属 |
| AE03 | 默认项目组；按项目/聊天/计划任务筛选后无重复组头；失效项目回all；纯筛选零写；计划任务使用真实映射且缺证不猜 |
| AE04 | 三种排序覆盖时间/标题平局、无效时间，组排序按成员最大时间；搜索/刷新保持当前筛选，数据集合不增删 |
| AE05 | 类型全部/本地/云端条目与资格分开；未实现云端明确状态，all来源不完整可见；没有伪空/伪成功；API key、签出、账号更换不偷用旧资格 |
| AE06 | 本地日期/时间和可选repo简名、未命名标题按当前中文；分组模式不重复repo，标题不擅自变点击恢复 |
| AE07 | 搜索兼容差异明确；全部删除用完整本地集合，筛选/搜索不缩小范围；单/批量/部分失败/取消与卸载保护不回退 |
| AE08 | 菜单方向键/Escape/焦点、窄窗溢出及来源错误/加载/无匹配；真实Tauri最终复验。无官方同环境配对图时score=null |

后续15E-B再独立扩展来源资格与只读cloud archive服务，需account/host/generation隔离、所有游标/offset分页、取消、来源错误与部分结果测试；15E-C才接明确授权的云端mutation和真实读回。当前阶段不得因本地回归通过宣称B/C完成，也不以此规格发布宣称已实施。
