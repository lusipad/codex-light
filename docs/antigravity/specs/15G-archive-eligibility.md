# 15G 归档资格：可信输入与可落地分支

2026-11-06，承接15F。第1–6节记录静态研究及独立复核纠正，第7节为开发前合同；当前实施与检查状态另见验收记录。所有source fixtures均为隔离样本，无真实账号HTTP，本文不覆盖15E-A已交付状态。

## 证据与本次突破

固定Store `26.1027.3384.0`，asar SHA `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。初次研究从该包重新只读提取8个entry，随后补入Electron认证来源，当前manifest共9项，记录大小、SHA和asar绝对byte位置，内容均与entry integrity匹配。15G开发阶段已重新核验整包，结果见 `.ref/parity/15/actual/15G-conversations/official-baseline.json`。原始提取位于相邻 `15G-archive-eligibility/reference/raw/`；定位均为0-based UTF-16字符偏移。

**宿主surface不是永久未知**：`initialize-app-host-services-949d83ec96b3.js:46351/46749` 明确把ChatGPT账户输入的supportedSurface及Codex访问输入的supportedSurface/workCloudSupportedSurface设为true。这是同版Windows宿主初始化事实，可以实现固定桌面surface合同，不接收renderer自行声明true或仿造debug override。

Rust已有 `/backend-api/wham/statsig/bootstrap` 的身份绑定、可信宿主上下文读取（`share_access_bootstrap_with`）；frontend的shareAccess/libraryClient已有完整V1/V2 snapshot解析先例。现有ShareAccounts和通知resolver使用另一条`/wham/accounts/check`，不能据此猜归档宿主的原始账号格式。归档真实输入是下述versioned accounts endpoint，需要专用读取。

本轮源链纠正：前稿把`/wham`、旧替代归一化函数h_t与归档宿主Gy混为一条链，错误要求role/is_zdr等额外字段，并要求RPC plan与inventory相等。完整追踪zy→lv→Gy→Ao/e_t→x_→Odt后已纠正；以下合同及新实现使用真实versioned来源，不将既有测试夹具当HTTP证据。纠正片段另存15G reference证据目录。

第二次独立审查又证实必须保留两种计划来源：**Odt使用inventory plan；Codex访问vv/W_t/xv使用当前认证JWT的chatgpt_plan_type**。不能因为移除两者相等要求，就把后者也换成inventory plan；RPC planType也不在这条源链上。独立来源及224组真实函数推导保存在`token-plan-source-correction.json`与`token-plan-derivation.json`。旧13项绿灯中交叉计划预期因此被推翻，旧标准检查已主动停止并保留superseded日志，不能作为最终检查。

## 1. Odt基础资格：无需rollout gate

`app-initial-4267e52fe5b0.js:1766302` Odt输入：accountId、accountLoading、accountStructure、authLoading、authMethod、authenticatedAccountId、plan、supportedSurface。顺序为：

1. surface尚未确定→loading；不支持→denied。
2. authLoading且authMethod=null→loading；authMethod必须严格chatgpt，否则denied。
3. accountLoading且accountId或plan缺失→loading。
4. authenticatedAccountId或accountId缺失→denied；两者不同→denied。
5. plan属于Adt精确集合→allowed，否则denied。**accountStructure只随allowed结果输出，不要求personal。**

Adt/kdt精确集合已存在于 `account_notifications.rs:notification_plan` 与 `libraryClient.ts:supportedPlans`。可提取/复用同一纯判断；不得复用通知独有的personal账户过滤，也不得通过调用通知设置API间接取资格。

官方宿主`zy@42379`用`lv@1858485`（导出tcr）读取账号：固定`/accounts/check/{version}`，`bdt@1763452`为`v4-2023-04-27`，请求头ChatGPT-Account-ID为当前账号，带signal，无额外query。对应服务路径为`/backend-api/accounts/check/v4-2023-04-27`。响应直接交给`Gy@49640`，不经过h_t。Gy按account_ordering依次取entry，null跳过，按inner account.account_id匹配目标，跳过session_access===false与deactivated真值，返回首个可用account。Ao/e_t@1853486把该账号plan_type/structure等与认证状态写入x_，Odt消费此x_。独立authenticatedAccountId来自真实auth，不从renderer提供。

现有Rust可复用getAuthStatus的account/user解析、account/read的认证type/workspaceRouting、credentials generation与身份核对。**资格plan只来自当前versioned inventory，不能用account/read plan替代，也不额外要求两者plan相等**：CLI plan不在该官方Odt输入链上，旧缓存或不同命名不能误拒当前真实成员资格。认证、账号路由和generation不一致仍必须拒绝。

原始versioned inventory的`accounts`是key索引对象，`account_ordering`是key数组，entry含account字段；ordering key不必等于inner account_id。Gy/Odt不要求account_user_role、is_zdr或account_user_id；这些无关字段缺失不能挡住当前目标，也不能强校验非目标所有字段。缺必要envelope或所选plan仍是unknown/error。h_t@1857693虽检查所有entry六字段非null，但仅适用于A_t旧替代分支；当前O_t恒true不能证明归档经过它。`/wham` normalized数组只是另一消费者的静态形状推断，未经真实HTTP确认；归档不兼容猜测形状，也不顺手修改其他页面。

## 2. includeWorkCloud=dvt完整必要条件

静态链：data-controls `ut`←app-initial `jsr`导出←`dvt@1870565`←`xv.status===allowed`；`xv@1868329`、`W_t@1864695`、`w_t@1861195`定义条件。

固定桌面宿主当前 `hv=false`（代码初始化常量），不采用官方debug overrides。W_t的workCloud基础访问使用workCloudSupportedSurface、auth/accountInfo状态、plan及workspace `admin_work_mode_enabled`；local基础访问使用supportedSurface和`beta_settings.wham_local_access`。这里的plan来自宿主`accountInfo.plan`：Zy→GNn/lGn/dGn→Qi.accountInfo.readAccountInfo→Electron Al.readAccountInfo→Eg；Eg调用本地连接getAuthToken(refreshToken:false)，解当前JWT并取`claims['https://api.openai.com/auth'].chatgpt_plan_type`，仅保留原始string，其余为null，不映射大小写或别名。raw Electron entry已对固定asar逐字节和integrity核验。

`xv`的正式顺序：

1. hv为true则denied（固定版初始化false）；auth不是chatgpt时使用W_t结果，W_t会把非ChatGPT的workCloud allowed转换unsupported-auth。
2. 官方debug override分支存在，但本项目不读取/注入它。
3. 个人计划T_t（free/go/plus/prolite/pro/promax）：先检查W_t.workCloud，非allowed直接返回；否则gate `1625797156`不为true时denied。
4. 最后若supportedSurface且gate `1463309241`不为true，使用local基础访问；否则使用workCloud基础访问。

组织基础访问的settings loading/error不能当false；w_t要求该选中分支的明确boolean true才allowed。源码缺失字段是denied，不等于客户端无法读取该字段时也可默认为denied；传输/decoder缺数据应保持error/unknown。

### 对稳定输入的等价简化（可执行）

在当前auth=chatgpt、token账号/plan已稳定、surface=true、无debug override前提下，以下计划均指JWT计划，独立于Odt的inventory计划：

| 计划 | includeWorkCloud最小输入 | 结论 |
|---|---|---|
| 缺失 / 非字符串 / null | 无额外gate或workspace设置 | false。真实accountInfo读取成功但plan为null，w_t返回missing-account denied；不是借缺失gate默认false |
| free / go | 无额外gate或workspace设置 | false。W_t先因free/go拒绝workCloud，xv提前返回 |
| plus / prolite / pro / promax | 当前身份完整bootstrap的gate1625797156 | gate值即includeWorkCloud；gate1463309241不影响，因为后续local/workCloud两支均allowed |
| 其他任意字符串（含未知计划） | workspace admin_work_mode_enabled和beta_settings.wham_local_access；gate1463309241 | gate=false用wham_local_access，gate=true用admin_work_mode_enabled；两字段同为明确boolean且相等时，结果不依赖gate。不能将Odt的Adt集合套在JWT计划上自动拒绝 |

因此在Odt已allowed的前提下，JWT free/go分支明确exclude tpp，JWT个人付费读取一个已证gate；两种计划无需相同。例如inventory=plus、JWT=free必须exclude，inventory=free、JWT=plus则按162读取范围。组织分支只在选中字段/必要gate缺失时停unknown；若两分支同结论，可据等价性判定，不能故意要求无关输入阻塞。

本次在隔离VM执行固定源中的w_t、W_t与xv函数体，stub仅用于无关voice及“无debug override”；112组计划/gates/workspace布尔组合全部验证上述简化，保存 `15G-archive-eligibility/derivation.json`。这证明静态函数等价，不证明当前账号gate值或HTTP可用性。

## 3. 具体可读输入和剩余最小扩展

| 输入 | 已证来源/现有能力 | 最小下一步 |
|---|---|---|
| 稳定account/user/generation与chatgpt认证 | getAuthStatus、ServiceIdentity、prepare/install_parsed、account/read | 复用现有身份/取消；读取前后核对，监听建立后再读 |
| Odt plan、structure、session access | host lv固定GET `/backend-api/accounts/check/v4-2023-04-27`→Gy，当前账号header | 新归档专用读取及必要字段decoder，按ordering选首个可用inner账号；不要求personal或无关membership字段 |
| vv/W_t/xv的Codex计划 | 同一宿主已验证认证token的原始chatgpt_plan_type；Electron Eg读取来源已证 | 后端私有解析，string原样或null，不暴露token、不以inventory/RPC plan替换；刷新导致claim变化应中断旧范围读取 |
| surface | host初始化明确true/true | 后端当前桌面固定合同；不从renderer接受任意override |
| gate1625797156 / gate1463309241 | 现有可信宿主上下文的 `/backend-api/wham/statsig/bootstrap` 返回statsigPayload | 复用传输与完整snapshot校验，新增专用纯gate解码；不能使用share gate或library gate代替 |
| workspace组织字段 | app-initial `j_t@1862463`：GET `/accounts/{account_id}/settings`，有accessInputs时走同账号readWorkspaceSettings | 现仓库尚无暴露这两个字段的固定只读operation；新增 `/backend-api/accounts/<validated-current-account>/settings`，只返回必要布尔/状态，不允许renderer传另一账号 |

组织需要的原始字段精确为 `admin_work_mode_enabled` 和 `beta_settings.wham_local_access`。`admin_work_local_enabled`用于另一workLocal分支，但不是dvt本次必要条件；permissions/work-only-mode gate也不应被无关地加入当前includeWorkCloud判断。读取settings失败、401/403/404、缺关键字段要分别记录；不可用CloudAccess个人分支替代。

bootstrap是**语义只读的POST**，现有share_access_bootstrap已有这条查询链；本合同禁止账号/归档mutation，不应把“任何POST都禁止”的字面规则误用于已经证实的bootstrap读取。15F数据列表仍只用GET。现有请求宿主context使用本产品实际version/brand/build/system/window，不能冒用官方brand制造同一个targeting结果；响应必须为当前身份，最终资格只能代表本请求上下文。与官方固定client targeting是否等价保留为运行时待证项。

完整snapshot校验沿现有libraryClient先例：user.userID、customIDs.account_id、完整V1/V2格式、非delta、无live_overlay、布尔gate；处理numeric key/hash-key和V2 v字段，缺gate为unknown，不默认false。其他customIDs是独立targeting字段，官方SDK不要求它们都等于account_id；不额外强制workspace_id或chatgpt_account_id相等。仅使用已签身份返回的有效full snapshot，不能从用户配置/过时cache/任意Statsig override读取。完整Statsig实时SDK语义尚未实现；超出当前snapshot可证格式继续unknown并有错误出口。

可执行分期：先实现Odt+free/go分支；再加个人付费gate读取；再加组织workspace只读settings和必要gate。每期都扩展真实可支持账号集合，不能用“未知”永远跳过，也不能强开缺失gate。无需调用模型或写任何归档。

## 4. cloud task行供UI对照

`data-controls-805edc0381e3.js:hn@2155`（以实际function定位为准）、`gn@8567`及 `app-primary:_Dn@1714706`：

- 字段：真实id、title、created_at、updated_at、task_status_display.environment_label。标题经过同版title清理函数后trim，无标题用语言包 `untitled`。task标题为span；ChatGPT conversation标题才是链接，不能互套点击行为。
- 日期：gn用updated_at??created_at；number按秒、string按Date解析；所选值无效则日期不显示（不能与local行“无效更新时间退创建日期”混淆）。locale年月日、hour/minute。仅无项目组头时附environment_label.trim；有组头不重复。
- 官方control有取消归档、Delete文字按钮与cloud图标。mutation有独立recover/删除task链，本只读阶段未实现，必须明确禁用与说明；不能把ID交本地thread API。
- source复合key为cloud:<taskId>、chatgpt:<conversationId>、local:<hostId>:<threadId>，即使原始ID相同也不合并。source discriminator必须从解码来源保留，不靠把不同响应混合后猜字段。
- cloud task项目：projectless覆盖assignment；否则只取显式assignment，按projectKind/projectId/remote host匹配，不以environment_label、标题或cwd猜项目。ChatGPT conversation另按gizmo_id匹配local项目；无匹配filterGroup=special:none、projectGroup=null。两类同属cloud筛选但保留不同源身份。

## 5. 必须新增的可验证合同

1. 用官方Odt函数的受控样本对照本地decoder：个人/组织精确计划、账号不匹配、加载、缺account、API key/chatgptAuthTokens不得误放行；Odt不要求personal。
2. 用固定函数派生表验证free/go无需gate、个人付费只需162、组织146分支以及两支相等优化；缺失/类型错误不变为false，HTTP错误不变为denied。
3. bootstrap full V1/V2、identity mismatch、delta/live overlay、缺gate、false/true、不同generation；组织settings当前账号路径、必要字段、额外敏感字段不跨IPC。
4. 资格读取与列表读取间账号/host切换、断连/重连/取消，旧gate/plan/settings不得拼成新快照。资格unknown→known应可重试真实恢复，不用刷新整个App。
5. 全部fixture先用隔离transport/RPC，零真实HTTP；确认合同后再单独做授权只读账号观察。当前未取得账号live gate/组织settings样本、targeting等价、原生/像素证据，不宣称这些已经验证。

## 6. Conversation列表、项目与标题路由专项

### envelope与分页

`NAr@4487139`只包history-list读取上下文；`PAr@4487258` GET `/conversations`，返回`{...u,items:u.items?.filter(qI)??[]}`，qI仅检查`typeof item.id === string`。原始envelope至少消费items、offset、limit、total；不能把task的cursor响应套上来。`z0i@5906558`计算响应`offset+limit`，小于响应total才作为nextOffset，否则null。下一页不是上次请求offset固定加20，不是items.length判断。当前正常请求limit20、offset初始0；expand默认false、hide_snorlax=false、is_archived=true、order=updated。

includeWorkCloud=false时请求`exclude_conversation_origin=tpp`，true时省略该query；没有把includeWorkCloud作为额外未知query传给服务。此条件影响读取范围，不是读取全部后在前端凭origin过滤。官方PAr对items格式的宽松处理不证明坏offset/limit/total可以默默截断；本地受控decoder与无进展保护应将坏envelope明确报错，登记为健壮性边界。

### 字段、排序与显示

`app-primary:_Dn@1714706`对conversation：title清理后trim；create_time/update_time使用Date.parse后除1000得到排序秒值；各自非有限值通过OJ回退另一值，再归零。searchValues为标题和项目label。组内排序仍按CDn@1718294：updated或created降序，平局标题；字母标题升序，同标题更新时间降序。

`data-controls:hn@2155/gn@8567`：conversation没有task的`archived`判别字段；描述选`update_time ?? create_time`，number按秒转Date，string直接Date解析。该选中值无效即不显示日期，不再回退另一个字段；因此排序的OJ回退与行日期显示不能混成同一算法。日期/时间用locale年月日及hour/minute。conversation无environment_label展示；空title用语言包“无标题聊天”。不要为兼容新统一模型给原始conversation任意加`archived`属性，官方hn用属性存在性选择task分支，false也会改变分支。

### gizmo_id归属

`_Dn`只做`projects.find(projectKind===local && projectId===conversation.gizmo_id)`；不是assignment、serverProjectId、cwd或label匹配。项目来源链`EOi@5436307`明确将官方LOCAL_PROJECTS实体`e.id`赋给group.projectId；data-controls再保留该projectId进入归档project字典。

本项目`SidebarLocalProject`当前只有id/name/rootPaths/createdAt/serverProjectId，没有gizmo字段。结构上id可以作为精确匹配键，但**尚不能证明当前native实体id或CLI serverProjectId就是ChatGPT gizmo ID**。只允许已确认的同ID匹配或后续真实数据提供的明确映射；不能自行把serverProjectId当gizmo_id，也不能按同名/路径制造关系。无可信匹配时保持无项目是诚实投影，不代表完整ChatGPT项目镜像能力已实现。新增gizmo关联需要独立真实读取/持久化来源合同，不能只加类型字段后填猜测值。

### 标题点击不是系统浏览器动作

hn对conversation渲染React Router Link，`to:re(id)`，没有gizmoId参数、target或自定义openExternal。re来自app-shared `_ct`导出的`gTt@2001887`，生成`/c/${encodeURIComponent(id)}`；虽函数支持`/g/<gizmo>/c/<id>`，此行没有使用该分支。

app-shared Link实现`oJ@1665931`处理内部路由；`app-runtime-e4b4e09bd942.js:87656`把会话route挂到sA→yM；`66897`懒载`chatgpt-conversation-page-7b67c4fbd155.js`，wrapper最终指向`chatgpt-conversation-page-98065d9a2c1f.js:cy@101548`，该组件内部渲染ChatGPT conversation工作面uy。已证普通点击为应用内会话导航；没有证据支持此行直接开系统浏览器，也不应推断所有修饰键/宿主拦截的原生行为已测。

Tauri当前缺该完整内部ChatGPT会话工作面时，不能调用Codex selectThread(id)冒充打开。若提供明确标注的“在浏览器打开”适配动作，需登记与官方内部导航不同；若本阶段尚无明确适配合同就保持不可用并说明原因。不能把浏览器已启动等同聊天已成功加载。

### 最小来源推导fixture

`.ref/parity/15/actual/15G-archive-eligibility/conversation-source-derived-fixture.json`保存一份仅据上述字段读取推导的合成fixture（items/offset/limit/total、id/title/create_time/update_time/gizmo_id），带明确provenance。它**不是实际HTTP捕获、不是账号样本、不是后端schema完整证明**；只用于实施前锁住投影和请求形状。另需覆盖无title、坏时间、无匹配gizmo、其他来源同ID、空items但仍有nextOffset及envelope不前进样本。当前没有执行真实conversation HTTP或标题导航。

## 7. 15G-A 开发前执行合同

本轮同时落实所有已证个人及组织分支，不以只支持free/go代替该目标。新增专用宿主`archive_conversations_read`，请求仅requestId、expectedIdentity、真实ServiceProfile和非负安全整数offset；禁止URL、account、includeWorkCloud、gate或额外字段。响应为requestId、identity、access（status:allowed/denied，includeWorkCloud:boolean/null）和body（allowed为真实分页JSON，denied为null）。资格无法确定或读取失败是错误，不能denied/空成功。

每页在宿主当前身份范围内按Odt读取原始账号inventory，必要时读取可信本产品宿主bootstrap及当前账号workspace settings，再决定是否发固定GET conversations。不得由renderer强开includeWorkCloud。先按每次请求重新判定实现；不新增可被伪造的renderer资格缓存。分页间资格范围变化时前端清旧分页并要求从首页重读，不能把exclude tpp和include tpp的页拼接成完整列表。

复用现有网络、session、refresh、bounded transport及取消，所有HTTP前后和锁等待期间维持identity/generation检查。Statsig仅语义只读POST，不执行归档恢复/删除或模型。仅返回页面必要数据，不将token/完整账户或bootstrap原文暴露到归档IPC。三条监听及账号/连接/host作用域遵15F；会话与任务独立分页/错误/重试，source+id跨源隔离，local/global不互套。功能和当前静态证据支持的呈现同步实现，真实云端及官方配对像素另验。

新增回归必须覆盖原始账户字典/组织不误拒、精确计划/身份/认证、full V1/V2 gate、缺失/坏数据未知、组织必要分支、固定请求/只读、401/403/404仍报错误、网络/IP/429/5xx、请求前/锁等待/HTTP后取消及换号；前端测offset前进/失败保留/资格变化清旧页、同ID三来源及只读控件。全部先隔离transport/RPC，页面生产组件再宽窄及原生限定验证。

生命周期复用计划：先以现有15F任务回放锁定行为，再提取两来源共用的账户归档监听/epoch小hook。
保留各来源decoder、分页与状态独立，不改任务API、不引入查询框架或新依赖。
验证：任务既有回归与新增conversation分页/资格/身份竞态回放均通过，随后类型检查。
