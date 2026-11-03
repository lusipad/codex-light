# 16.16B 代码审查设置：固定版本取证与修改前合同

2026-11-03，只读调研。未修改产品、执行 Cargo、访问账号服务、启动真实审查或模型轮次。本文不放行整页“已验收”，不以历史测试通过替代本轮官方对照。

## 1. 基准与证据边界

固定 Windows Store **26.1027.3384.0**，重新读取实际安装目录 `C:/Program Files/WindowsApps/OpenAI.Codex_26.1027.3384.0_x64__2p2nqsd0c76g0/app/resources/app.asar`；整包 SHA-256：`6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。

- [manifest](../../../.ref/parity/16.16/actual/16-16B-research/manifest.json)：27 项直接从固定包提取的资源，逐一匹配 asar integrity 与 SHA-256/大小。
- [anchors](../../../.ref/parity/16.16/actual/16-16B-research/anchors.json)：29 项原文锚点。start/end 均为 **0-based UTF-16 code units，end exclusive**，不是混淆后单行的行号。
- [zh-copy](../../../.ref/parity/16.16/actual/16-16B-research/zh-copy.json)：117 项代码审查/共享自动保存中文资源原文。
- [缺失中文与 defaultMessage](../../../.ref/parity/16.16/actual/16-16B-research/zh-missing-and-defaults.json)：11 项当前使用的 message ID 在固定 zh-CN 资源中不存在；不能将自行翻译当作官方中文。
- [当前实现摘要](../../../.ref/parity/16.16/actual/16-16B-research/product-map.json)：8 份产品/现有测试源码哈希；这是本轮读取快照，后续开发变更需重取。

这里证明固定包内实现。**官方当前账号 gate、服务返回、实际语言 fallback、DPI/缩放、原生焦点与像素均未实测**；不从 schema 或英文 defaultMessage 推断运行时已显示什么。

## 2. 入口、权限与页面结构

实际 `/settings/code-review` 组件为 **`settings-1a50888ca48b.js → CodeReviewAppSettings (Vr/Hr/ir)`**。`code-review-settings-11fb26211e73.js` 导出的是 **UsageCodeReviewSettings**，属于使用情况统计，不可当作本页控件依据。

`code-review-access-fbd472296285.js` 返回 app/cloud 各自的 visible/pending/error。app 需本地审查能力允许且未启用 runCodexInWsl；所追 auth 分支拒绝非 chatgpt/chatgptAuthTokens 身份。cloud 走独立 Codex Cloud access/账号能力。包内分支存在不表示当前账号可用，禁止强开 gate。

两分区均可见时才显示“**偏好设置** / **审查智能体**” tabs，URL `tab=app` 指定偏好；默认在 cloud 可见且没有 tab=app 时选 cloud。单分区可见时不造第二个空 tab。两分区均不可见且访问查询失败时显示真实访问错误。仓库详情路由 `/settings/code-review/repositories/:repositoryId` 只有 cloud 可见时进入；返回保留 search/provider。参见 `settings-tabs-and-routing`。

偏好页顺序（`app-preferences-render`）：

1. 应用偏好组：审查链接去向、代码审查提供商、对应提供商实例/连接管理。
2. 个人审查指令组：标题、范围说明、输入框与自动保存反馈。

当前组件仅“链接下拉 + 指令”，缺访问分区、provider/实例与官方保存呈现；不能因此直接补一套自拟云端设置。

## 3. 本地配置合同与真实消费者

这些项均经官方 `vX` 定义为 **hostStorage.kind=persisted-atom**，由宿主 `settings.readAll/read/write/subscribe` 承载，不是仓库 config.toml、AGENTS.md 或云端用户偏好。宿主 atom 同步使用 `electron-persisted-atom-state`；具体账户/宿主更换的运行时行为仍须隔离验证。

| 配置 key | schema / 默认 | 应用与写入边界 |
|---|---|---|
| `code-review-github-link-target` | enum `code-review-tab` / `github`；default **github** | 显式 configured 优先；未配置还受 `2247892263` gate 的 effective 默认影响，不能把缺失和已选 github 合并。agentAccess hidden。 |
| `code-review-local-instructions` | string；default 空串 | 适用于 Code Review 发起的私人审查、所有仓库；agentAccess read-only，用户界面仍可写。保持原文，不任意 trim 保存值。 |
| `code-review-git-hosting-provider` | github / gitlab；default github | GitLab 取 layer `2115119119.enabled`，默认 false；读到已存 gitlab 但 gate 不允许时 effective 回退 github，**不能改写原存值**；新写 gitlab 被拒。 |
| `code-review-github-connection` | null 或 `{hostname,connectorId,accountLinkId}`，三字段非空 string；default null | null 对应 github.com；真实连接查询失败/已选连接消失独立呈现，不伪造列表。 |
| `code-review-gitlab-connector-id` | trim 后非空 string 或 null；default null | null 对应 gitlab.com 默认 connector；只有 gate 允许才展示 GitLab 选择能力。 |

注册表还含 sidebar sections/layout 等代码审查工作面设置，**本设置分区没有对应控件，本阶段不顺带新增**。host 设置写路径有 optimistic cache 与逐 key 回滚及 subscribe 更新（`optimistic-revision-write-rollback`、`host-settings-write`）；我们的持久写读回可以更严，但不能失败后丢草稿、跨窗覆盖新值或宣称已保存。

### 2026-11-03 实例入口补证

补证见 `.ref/parity/16.16/actual/16-16B-research/provider-connections-supplement.json`（两份固定资源SHA与UTF-16锚点）。GitHub实例与管理入口还受 **223049465** 控制：`settings → yr → br/ur`，gate未启用时整个实例/管理区域返回null，不应凭默认github.com补一套常驻选择器。

GitHub连接查询为 `app-initial → mk`：GET `/wham/github/connections`，query key含 userId/accountId，需gate及两项身份就绪，15秒限时、5分钟缓存、refetchOnMount、无自动retry。附加 `X-Codex-Expected-User-Id / X-Codex-Expected-Account-Id`；`ck`在请求前/响应使用前核当前会话与连接身份版本。**现有普通GitHub仓库API成功不等于此服务或gate可用**。

GitLab实例为 `wXr`：按CODEX产品读取 `/ps/connectors/by-template`，与当前身份的连接授权记录交叉核对；逐项查询 `/aip/connectors/{connector_id}`，排除管理员禁用、模板不符、无真实授权与403/404，最后解析hostname并排序。不能将原始connector列表直接当可用实例。GitLab gate、GitHub企业实例gate均未取得当前账号运行时证据，后续实现需保留能力未证边界，不能以固定布尔值或伪列表放行。

### 链接打开不是固定外部浏览器

`github` 选项的 defaultMessage 是 **Follow Browser Settings**。`link-preference` 先取 configured，缺失才按 gate/default resolve；`link-click-bridge`、`open-task-tab` 区分普通 task link、显式 context-menu 打开 Code Review、task PR 入口及账户/连接能力。普通链接尊重偏好；显式“Code review”菜单带 respectLinkPreference=false；不支持/无可用连接有不同 fallback/unavailable 结果。非 review-tab 分支委托通用链接路由，不等于无条件 ShellExecute 外部浏览器。

当前 `openReviewLink` 只检查这两个自建值：code-review-tab→本页详情，external-browser→`review_link_open`。两者都不足以证明官方完整“Code Review tab / 通用浏览器设置”行为。修正前先核可复用的通用链接入口；不能仅将 external-browser 字符串改名 github 后继续宣称逻辑一致。原存未知/旧值保留并提示用户明确选择，不自动覆盖用户配置。

### 个人指令消费者不是本地分支审查

官方 `app-primary → yQn → RZn` 在真实 provider/account/request 和 **固定 exact base/head/merge-base comparison** 上创建/复用专用私人审查会话，读取最新个人指令；turnTrigger=code_review。提示要求远程源码工具核账号、分页完整 diff、重命名/二进制/缺块，私人只读，不改文件、不发表评论；无法核账号/完整比较必须报告未完成。

当前 `runPullRequestReview` 把 PR head_ref_name 交 `onStartReview(kind=branch)`，最终进入本地分支审查，并仅拼接 title/number/个人指令。**无法用本地同名分支代替官方选中账号与固定远程 PR 比较**。本阶段可锁定指令读取/传递合同，但真实远程服务消费者缺口必须登记；若未具备准确输入与服务能力，应明确不可用，不能通过夹具假装已实现私人 PR 审查。普通本地 diff/commit review 是否消费此偏好没有本轮证据，不扩大作用域。

## 4. 指令编辑与保存状态机

共享 `autosaving-instructions-settings-group-cc32d53e6624.js`：

- review 输入 **rows=10**；默认共享组件 rows=6 不适用于此处。scope=`autosaving-instructions-code-review-local-instructions`。
- 新输入成为带身份的 draft；静置 **3000ms** flush；离开组件也 flush 当前未提交 draft；CmdOrCtrl+S 与 Save 立即 flush。
- 同一 draft 的在途 flush 共用结果，重复点击不重复写；scope mutation 串行。较旧保存成功只在 draft identity 仍匹配时清 draft，不能擦除保存期间输入的新内容。
- idle / dirty / saving / saved；dirty 或 saving 显示 Save（saving 禁用并 loading），saved 显示 aria-live polite 的 Saved 状态 **3000ms**，再归 idle。
- 失败 toast，draft 保留；显式 flush 可重试同一失败 draft。输入框本身没有按 saving 禁用；不能因保存中禁打字来替代乱序正确性。
- `discard` 清当前 draft 并重置 mutation；具体页面未把它做成额外“重新读取”按钮。当前自加“重新读取 + confirm”不能当官方既有控件。

现有 `CodeReviewSettings` 虽有3秒 timer、卸载保存和Ctrl/Cmd+S，但 textarea rows=6、busy禁输入、没有saved三秒反馈/逐draft串行合并、加载错误处理与刷新按钮均与上面不同。可参考当前 GitSettings 已实现的 draft/pending/timer模式，先锁回归，再最小修改；不要为两组字段建立新通用框架。

## 5. 中文与视觉不得猜测

固定资源中已证中文含“偏好设置”“审查智能体”“代码审查提供商”“{provider} 实例”“个人偏好”“自动代码审查”等，原文见 zh-copy。

**appPreferences.title、githubLinks.label/codeReviewTab/saveError、reviewLinks.followBrowserSettings、localInstructions.title/description/placeholder 等 ID 均不在固定 zh-CN 资源中。** 原始英文 defaultMessage 已单独保存；“遵循浏览器设置”等人工直译不是官方中文证据。实际官方可能显示 fallback，必须运行时采证后决定文案，不能武断改为猜译中文或宣称已证英文渲染。

视觉修改前要采同场景官方宽/窄窗、菜单打开、编辑dirty/saving/saved/error、provider加载/失效状态；固定客户区、DPI、主题、语言、缩放。当前无这些截图/DOM边界，不能给1px通过。静态结构只约束组顺序、rows=10、settings row/popover RadioGroup、共享Header/Content与文本层级；缺精确CSS/token对应时继续取证，不拍脑袋给尺寸。

## 6. cloud/仓库设置是独立后续单元

`settings ar` 的 cloud个人项来自账号服务，GET `/wham/settings/user` 与 `/wham/settings/configs/user-preferences`；PATCH `/wham/settings/user` 带 expectedIdentity(accountId,userId)，查询按身份分离，mutation失败提示。schema以真实服务响应为准，本轮只证控件与payload，不声称已经恢复完整服务schema。

已证：自动代码审查写 code_review_preference=always/repo_default；触发策略 pr_open/every_push/smart_detect（缺失显示 pr_open）；exhaustive_code_review boolean；allow_credits_for_code_reviews 仅canManageCreditSettings；security_review非空才有安全审查组，额度仍有能力条件。**额度开关有真实收费含义，下一开发不自动开启或真实测试写入。**

仓库/连接列表有 loading/error/retry/empty、搜索/分页和选中 provider/connection；仓库详情还含自动审查/作用范围、code/security触发、严重性、路径规则、威胁模型与额度/管理员条件。这些不能塞到本地偏好存储，也不能用固定列表/开关冒成功。本阶段只登记，下阶段补独立服务与权限合同后推进。

## 7. 修改前用例与成功判定

| ID | 前置与操作 | 必须核对的结果/证据 |
|---|---|---|
| CRB01 | 私有state无key、显式github、显式tab、未知值；gate开/关 | configured与effective区别、默认github和gate默认tab，不写回；未知原值保留；跨窗订阅实回放。 |
| CRB02 | 切链接位置，注入写失败/读回不一致/旧响应 | 只改目标key，失败可见且不误报成功，其他atom保留，重启读取；真实目标入口按链接类型、能力和通用浏览器策略分流。 |
| CRB03 | 指令输入A，3秒前输入B；立即Save/CmdCtrl+S多次 | 只保存最新draft一次；3000ms debounce、同draft去重、真实原文和三秒saved反馈；IME选字不误保存。 |
| CRB04 | A保存中继续输入B，A成功/失败、B继续保存；卸载 | 输入可用；A不能清B；作用域串行与幂等，失败draft可重试；卸载flush不把晚结果写进新scope。 |
| CRB05 | 修改→离开→重开→新进程，保存失败重开 | 私有CODEX_HOME真实持久写/readback，无用户配置副作用；不要仅测mock save promise。 |
| CRB06 | 相同/不同账号、host、断连、旧读写晚到 | 不跨身份混合；stale结果无新UI/新任务副作用；失败不能默认成成功能力。 |
| CRB07 | GitLab gate关读已存gitlab；用户新选gitlab | effective fallback不重写；新选拒绝；只有允许的真实provider可写；连接缺失独立错误。 |
| CRB08 | 实例查询loading/error/empty，已存连接消失，保存失败 | 保留真实选择与失效信息，不自动换账号/connector；null默认实例与真实企业实例对象区分。 |
| CRB09 | 官方入口开启个人指令编辑后发起私人PR审查 | 保存成功后消费最新指令；核provider、账号、exact comparison、完整分页、只读边界；不支持时真实不可用，禁止本地同名branch替代。 |
| CRB10 | app/cloud权限四态、tab/app URL、仓库详情/返回 | 仅呈现允许分区，pending/error独立；URL与焦点行为对照；cloud未实现不标通过。 |
| CRB11 | 宽/窄窗与菜单、长文本、dirty/saving/saved/error | 官方与本地同基准截图/锚点/差异，关键物理像素≤1px；原生输入法、Tab/Escape/焦点另验。 |

自动夹具仅证明所回放行为；不替代账号集成、收费设置授权、官方GUI或原生/像素证据。旧 verify-review-preferences 已保护的读回/失败/旧响应/原文用例保留，修正其过时enum/default预期时应先加入官方黄金合同，不能删断言凑绿。

## 8. 下一开发最小闭环及门槛

先做 **16.16B 本地app偏好与个人指令**：纠正官方key/schema/default及configured/effective；补实际可用的通用链接分流；按官方draft状态机实现指令编辑/自动保存/订阅与重启；真实provider能力可证后再接实例选择。同步修复私人PR入口的语义误报，不能继续把本地branch review标作远程私人审查。

开发前先落 CRB01–CRB05、CRB09 的回归及明确的服务不可用边界；随后最小实现、跑既有review偏好/本地review工作面回归、私有state Rust测试、类型检查与标准检查。涉及共享自动保存模式需回归GitSettings。代码外部链接/任务启动须核当前scope，不用旧设置异步结果发起新任务。

cloud个人/仓库/安全审查与真实远程私人审查可分后续合同执行，未完成部分留明确差距。交付口径只能是“本单元自验/待用户验收”；未有官方运行时、当前源码原生构建及像素对照，**整页16.16仍不能标为1:1完成**。

## 9. GitLab企业实例后续开发合同（只读取证，未实现）

固定 `app-initial-4267e52fe5b0.js`，SHA-256 `ba06de8c5418586b49ca7d639ea5ad2af531c1037454ec69b10b9ea11e00992e`。下列范围均为0-based UTF-16、end exclusive：wXr 4894675–4895816，TXr 4895816–4895974，EXr 4895974–4896712，Ek 3584749–3585226，LVn 3584568–3584604，kjn 3434570–3434687。

- gate明确true后，并行GET `/ps/connectors/by-template?template_id=templated_apps_GitLab`（取connectors）和POST `/aip/connectors/links/list_accessible`（取links）；后者body为 `{"principals":[],"link_refresh_strategy":"BLOCKING"}`，是读取而非修改。使用 `X-Codex-Surface: other`、`OAI-Product-Sku: CODEX`，links请求带真实 `ChatGPT-Account-Id`。不得复用固定CONNECTOR_SETTING SKU的插件POST变更分支。
- 候选须匹配template且未被管理员禁用；授权link须connector_id匹配、id非空、auth_status非REAUTH_REQUIRED、unavailable_reason为空、connector_status非DISABLED_BY_ADMIN。再GET `/aip/connectors/{connector_id}?include_actions=false`；403/404只忽略该候选，其他错误使本次实例查询失败，不能伪造空列表。
- 详情id须匹配；默认connector为 `connector_0c9786b2f41f41558056126bdb46c9bd`。service为gitlab，企业项也允许 `templated_apps_GitLab:{自身id}`，非默认项须匹配template；拒绝管理员禁用/admin_only_connector="true"。
- base_url须HTTPS、无端口/凭据/query/hash，路径仅/api/v4或末尾/；原始串须严格等于 `https://{hostname}/api/v4` 或加/，不接受URL规范化绕过。hostname≤253、至少两段，每段符合DNS小写字母数字及内部连字符规则；拒绝纯数字分段主机与.localhost。默认仅gitlab.com，企业拒绝gitlab.com及其子域。
- 输出connectorId/hostname/name，按官方hostname.localeCompare排序。复用真实服务身份/网络策略/取消，返回前重核身份；独立gitlabInstancesError不覆盖偏好。非null写入时宿主重新枚举授权成员后再CAS/落盘，不信任UI成员资格。真实服务schema与官方运行时仍待实测。
