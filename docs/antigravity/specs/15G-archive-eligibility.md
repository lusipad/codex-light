# 15G 归档资格：可信输入与可落地分支

2026-11-06，只读研究附页，承接15F；未改产品、未调用真实HTTP、未操作账号、未构建或提交。本文不表示15F实现完成，也不覆盖15E-A已交付状态。

## 证据与本次突破

固定Store `26.1027.3384.0`，asar SHA沿既有固定基准 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。本次从该包重新只读提取4个entry到 `.ref/parity/15/actual/15G-archive-eligibility/reference/raw/`，manifest记录大小、SHA和asar绝对byte位置，内容均与entry integrity匹配；没有再次整包hash。定位均为0-based UTF-16字符偏移。

**宿主surface不是永久未知**：`initialize-app-host-services-949d83ec96b3.js:46351/46749` 明确把ChatGPT账户输入的supportedSurface及Codex访问输入的supportedSurface/workCloudSupportedSurface设为true。这是同版Windows宿主初始化事实，可以实现固定桌面surface合同，不接收renderer自行声明true或仿造debug override。

Rust已有 `/backend-api/wham/statsig/bootstrap` 的身份绑定、可信宿主上下文读取（`share_access_bootstrap_with`）；已有 `/backend-api/wham/accounts/check` 固定读取（ShareAccounts和通知resolver）；frontend的shareAccess/libraryClient已有完整V1/V2 snapshot解析先例。这些不是归档资格现成结果，但给出了可以实施的数据来源，不能继续笼统以“资格未知”停滞。

## 1. Odt基础资格：无需rollout gate

`app-initial-4267e52fe5b0.js:1766302` Odt输入：accountId、accountLoading、accountStructure、authLoading、authMethod、authenticatedAccountId、plan、supportedSurface。顺序为：

1. surface尚未确定→loading；不支持→denied。
2. authLoading且authMethod=null→loading；authMethod必须严格chatgpt，否则denied。
3. accountLoading且accountId或plan缺失→loading。
4. authenticatedAccountId或accountId缺失→denied；两者不同→denied。
5. plan属于Adt精确集合→allowed，否则denied。**accountStructure只随allowed结果输出，不要求personal。**

Adt/kdt精确集合已存在于 `account_notifications.rs:notification_plan` 与 `libraryClient.ts:supportedPlans`。可提取/复用同一纯判断；不得复用通知独有的personal账户过滤，也不得通过调用通知设置API间接取资格。

官方宿主 `zy@42379`附近的x_输入来自真实auth + `/wham/accounts/check`当前可用账户。`Gy@49640`按account_ordering依次查accounts entry，要求account.account_id等于当前目标ID、can_access_with_session不为false、is_deactivated不为true；输出account.plan_type、structure、account_user_id。独立authenticatedAccountId来自当前auth/账户信息，不从renderer提供。

现有Rust可用：getAuthStatus token解析得到account/user、account/read得到type/planType/workspaceRouting、现有credentials generation与路由匹配、accounts/check原始inventory解析。**account/read plan不是可以替代inventory plan的通行证**：Odt主账户plan按当前可用inventory解析；不一致时重新resolve/报不完整，不能拼接两代账号数据放行。

原始inventory合同应沿host Gy和通知resolver真实object形状：`accounts`是以key索引的对象，`account_ordering`是key数组，entry含account字段。不要照某些旧frontend fixtures的normalized accounts数组猜当前HTTP返回；至少应有同版原始/脱敏样本锁定decoder，支持不同形状须有实际证据。此处只补归档decoder，不顺手改其他页面。

## 2. includeWorkCloud=dvt完整必要条件

静态链：data-controls `ut`←app-initial `jsr`导出←`dvt@1870565`←`xv.status===allowed`；`xv@1868329`、`W_t@1864695`、`w_t@1861195`定义条件。

固定桌面宿主当前 `hv=false`（代码初始化常量），不采用官方debug overrides。W_t的workCloud基础访问使用workCloudSupportedSurface、auth/accountInfo状态、plan及workspace `admin_work_mode_enabled`；local基础访问使用supportedSurface和`beta_settings.wham_local_access`。

`xv`的正式顺序：

1. hv为true则denied（固定版初始化false）；auth不是chatgpt时使用W_t结果，W_t会把非ChatGPT的workCloud allowed转换unsupported-auth。
2. 官方debug override分支存在，但本项目不读取/注入它。
3. 个人计划T_t（free/go/plus/prolite/pro/promax）：先检查W_t.workCloud，非allowed直接返回；否则gate `1625797156`不为true时denied。
4. 最后若supportedSurface且gate `1463309241`不为true，使用local基础访问；否则使用workCloud基础访问。

组织基础访问的settings loading/error不能当false；w_t要求该选中分支的明确boolean true才allowed。源码缺失字段是denied，不等于客户端无法读取该字段时也可默认为denied；传输/decoder缺数据应保持error/unknown。

### 对稳定输入的等价简化（可执行）

在当前auth=chatgpt、账号/plan已稳定、surface=true、无debug override前提下：

| 计划 | includeWorkCloud最小输入 | 结论 |
|---|---|---|
| free / go | 无额外gate或workspace设置 | false。W_t先因free/go拒绝workCloud，xv提前返回 |
| plus / prolite / pro / promax | 当前身份完整bootstrap的gate1625797156 | gate值即includeWorkCloud；gate1463309241不影响，因为后续local/workCloud两支均allowed |
| 其他组织计划 | workspace admin_work_mode_enabled和beta_settings.wham_local_access；gate1463309241 | gate=false用wham_local_access，gate=true用admin_work_mode_enabled；两字段同为明确boolean且相等时，结果不依赖gate |

因此可以完整支持free/go的ChatGPT conversation归档（明确exclude tpp），个人付费计划读取一个已证gate即可，不应全部长期unknown。组织计划只在必要字段/分支gate缺失时停unknown；若两分支已得到同一结论，可据等价性判定，不能故意要求无关gate阻塞。

本次在隔离VM执行固定源中的w_t、W_t与xv函数体，stub仅用于无关voice及“无debug override”；112组计划/gates/workspace布尔组合全部验证上述简化，保存 `15G-archive-eligibility/derivation.json`。这证明静态函数等价，不证明当前账号gate值或HTTP可用性。

## 3. 具体可读输入和剩余最小扩展

| 输入 | 已证来源/现有能力 | 最小下一步 |
|---|---|---|
| 稳定account/user/generation与chatgpt认证 | getAuthStatus、ServiceIdentity、prepare/install_parsed、account/read | 复用现有身份/取消；读取前后核对，监听建立后再读 |
| Odt plan、structure、session access | GET `/backend-api/wham/accounts/check`，host Gy；现有ShareAccounts/notification_http | 新归档只读decoder按真实当前entry解析，保留加载/错误/失配；不要求personal |
| surface | host初始化明确true/true | 后端当前桌面固定合同；不从renderer接受任意override |
| gate1625797156 / gate1463309241 | 现有可信宿主上下文的 `/backend-api/wham/statsig/bootstrap` 返回statsigPayload | 复用传输与完整snapshot校验，新增专用纯gate解码；不能使用share gate或library gate代替 |
| workspace组织字段 | app-initial `j_t@1862463`：GET `/accounts/{account_id}/settings`，有accessInputs时走同账号readWorkspaceSettings | 现仓库尚无暴露这两个字段的固定只读operation；新增 `/backend-api/accounts/<validated-current-account>/settings`，只返回必要布尔/状态，不允许renderer传另一账号 |

组织需要的原始字段精确为 `admin_work_mode_enabled` 和 `beta_settings.wham_local_access`。`admin_work_local_enabled`用于另一workLocal分支，但不是dvt本次必要条件；permissions/work-only-mode gate也不应被无关地加入当前includeWorkCloud判断。读取settings失败、401/403/404、缺关键字段要分别记录；不可用CloudAccess个人分支替代。

bootstrap是**语义只读的POST**，现有share_access_bootstrap已有这条查询链；本合同禁止账号/归档mutation，不应把“任何POST都禁止”的字面规则误用于已经证实的bootstrap读取。15F数据列表仍只用GET。现有请求宿主context使用本产品实际version/brand/build/system/window，不能冒用官方brand制造同一个targeting结果；响应必须为当前身份，最终资格只能代表本请求上下文。与官方固定client targeting是否等价保留为运行时待证项。

完整snapshot校验沿现有libraryClient先例：user.userID、customIDs.account_id（工作区ID若参与targeting需同时核对）、完整V1/V2格式、非delta、无live_overlay、布尔gate；处理numeric key/hash-key和V2 v字段，缺gate为unknown，不默认false。仅使用已签身份返回的有效full snapshot，不能从用户配置/过时cache/任意Statsig override读取。完整Statsig实时SDK语义尚未实现；超出当前snapshot可证格式继续unknown并有错误出口。

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
