# 16.16B 指令自动保存增量

## 开发依据与范围

依据 [固定版本合同](specs/16-16B-next-closure.md) 第 4 节及 CRB03/CRB04。保持本阶段整体未完成；链接偏好 enum/default/通用路由、provider/实例、身份隔离订阅和远程私人 PR 审查仍按原合同继续推进。

初始指令增量不改 Rust；本轮继续修正 state.rs 的官方链接 enum/default与配置存在性读回，持久文件/atom key不变。不新增依赖或重构其他设置页。沿用已有偏好更新及真实写后读回，输入原文不 trim。

## 实现与回归

- 偏好 hook 以快照串行执行 update→get→比对；同一在途 patch 复用 Promise，不再因 busy 丢弃新草稿。组件卸载后的旧结果不更新状态。
- 指令 rows=10；保存中允许输入，草稿 revision 区分“相同文字但不同编辑”；旧成功不清新草稿、不误显已保存。
- 3000ms 静置保存；Save/Ctrl或Cmd+S 立即保存且保留 IME guard；失败不无限自动重试，显式保存可重试；离页提交最新草稿。
- 保存成功的当前草稿显示 aria-live polite 的“已保存”3000ms。移除无官方依据的常驻重新读取控件，仅初次加载失败保留重试入口。
- 修改前新增回归在 Promise 身份断言失败：旧实现重复提交返回 false。修改后覆盖 A 在途/B 继续输入、串行写读、失败保草稿与重试、保存反馈、离页 flush。

证据目录：`.ref/parity/16.16/actual/16-16B-instructions/`。定向 `verify-review-preferences.mjs`、`verify-git-preferences.mjs`、TypeScript 已通过；上一轮标准 Fast 检查已退出0（`16-16B-instructions/verify-fast.log/.exit`），其后新增订阅走单独的定向验证，不能用旧整套结果覆盖新源码。Fast 跳过协议探针，不代表协议验证通过。

## 未验证与后续

无同基准官方截图，未执行 visual-verdict 图片评分；不臆造分数。rows=10 是静态合同，不能证明布局/像素一致。本增量未重建原生 EXE，旧阶段构建不可用于验收这次源码。真实 Chrome 已在生产组件/hook与隔离 IPC 夹具上验证 A 保存中编辑 B、A 完成不清 B、B 保存读回、失败保草稿；发现并用既有 form-field 样式修复输入框 UA 白底，实测背景 rgb(22,22,22)/白字。截图见同级证据目录 `16-16B-instructions-ui/`。原生 GUI/IME、跨窗口与真实账号集成仍待验。私人 PR helper 已禁止本地同名分支回退并给出明确未接入错误；真实选定账号与远程 exact comparison仍待实现。code-review-tab 目前仍打开既有PR详情弹窗，不等价官方专用审查tab，明确留差距，不把这一分支测试当官方等价证明。

## 通用链接补证与下一修改合同

已补存 `16-16B-research/generic-link-routing.json`，沿用固定包共享 chunk 的 SHA-256与UTF-16锚点。`gX` 明确配置类，通用目标取 `desktop.open-link-in-target-preference`，默认 `in-app-browser`；`Qit/$it` 先按 browserPaneEnabled 判断，能力不可用时即使偏好为 in-app-browser 也返回 external-browser。此配置不是审查 atom，不能混写。

本项目 DiffDrawer 只有 iframe 预览，没有官方独立原生浏览器 tab/连接能力。本轮不将 iframe 宣称为 browserPaneEnabled。通用链接消费者读取真实配置后使用“当前原生浏览器面板不可用”的外部分流；这证明可用回退路径，不证明官方账号浏览器能力或应用内渲染已复刻。未知通用配置值须报错，不静默当默认。审查默认修正为 github、保留 configured/missing区别，未知旧值不重写；远程gate未接，不能宣称 effective gate默认已经一致。

PR审查入口尚无官方provider/account及exact base/head/merge-base输入与完整远程服务。下一修改先禁止旧本地同名branch回退，并明确告知不可用，保留其他真实本地审查入口；这是消除错误行为，不代表远程私人审查完成。回归须证明不读取本地head分支、不启动模型轮次。

## 本轮链接与错误入口修正结果

- state.rs 默认 github，配置响应新增只读 configuredGithubLinkTarget（未配置 null）；可写 enum 只允许 github/code-review-tab。未知旧值原样保留，保存指令不覆盖它，独立磁盘反序列化读回覆盖中文前后空白及换行。
- 新通用 webLinks 复用 configRead→真实 app-server config/read。遵循 desktop.open-link-in-target-preference；真实原生浏览器面板当前不可用，按已证 Qit 走外部回退；配置未知/读取失败不会假装成功，切换scope后的晚返回不打开链接，URL须HTTPS且无凭据。
- Follow Browser Settings 使用包内英文 defaultMessage，因为固定中文资源缺该ID；不是宣称已验证官方中文运行时 fallback。
- PR入口显示未接入并返回明确错误，不调用本地branch审查或模型；其他本地review保持。此处是纠正错误语义，完整远程私人审查仍是后续工作。
- 定向审查偏好、Code Review工作面及TypeScript均通过。标准运行日志内审查专项通过，Rust review_preferences 2项通过；该整套Fast现已退出0；后续跨窗订阅增量另行验证，不宣称旧检查包含之后的变更。标准是在开发期间运行，不宣称冻结输入或整页交付。
- 生产React/hook Chrome隔离夹具已验证默认Follow Browser Settings、tab→github切换及个人指令保存。截图 `16-16B-instructions-ui/link-default-updated.png`；无官方配对图，不评分、不宣称像素一致。临时页面与14918服务器已关闭。

## 跨窗口同步增量与验证

- 写入持久文件成功后，原生宿主只通知本进程其他窗口重新读取；不把私有指令放进广播payload，当前源窗口继续以写后读回确认结果。关闭窗口导致通知失败不把已落盘的写入报告为失败。
- 前端先订阅，订阅就绪后补读以弥合注册窗口；远程读取使用版本票据，新的本地保存使旧读取失效。空闲编辑器跟随已保存更新，本地未保存草稿不被覆盖；写入/读取期间合并通知，完成后重新读取。
- 订阅失败独立可见并提供“重试同步”，不丢已读偏好或禁用本地保存；晚注册在卸载后立即释放，旧回调不再更新UI。
- 新订阅回归修改前因缺少effect失败。修改后生产hook回放验证干净/脏草稿、晚读对新写、卸载清理、晚注册释放与显式恢复。`16-16B-subscription/` 下审查/Git回归、TypeScript/前端构建、cargo check、Rust偏好2项均退出0。保留已有cancel_owner dead_code与Vite大chunk警告；未配置独立lint。
- 本增量尚未验证真实Tauri多窗口事件投递、原生GUI/IME或官方配对截图；hook回放不能当成原生多窗口通过。未重新构建原生安装包，不以16.15B旧EXE验收当前源码。
- 提供商实例补证新增GitHub gate 223049465、身份预期headers，以及GitLab模板/授权/管理员交叉过滤，已补回修改前合同；没有伪造运行时gate或服务列表。
- 独立审核复现并闭合P2：链接保存读回并发远程指令时，旧pristine草稿不得变成dirty并自动写回。保存前比较旧baseline，同步真正未编辑草稿，保留已编辑草稿；新增clean/dirty两种交错用例。原失败日志退出1保留在 `concurrent-link-save-initial-fail.*`，修复后 `review-preferences-final.*` 退出0，独立复核确认闭环；前端构建使用 `frontend-build-final.*`，Rust源码在此前专项通过后未再改。

## 真实能力读取开发合同（2026-11-03）

复用现有 `share_thread_access → /wham/statsig/bootstrap` 的真实宿主上下文和身份绑定，新增独立代码审查消费，不复用分享gate值。固定SDK `_DJB2` 按UTF-16、seed0、h*31累加取u32，原名或该十进制hash查找。V1 gate.value/layer.value；V2 gate.v，layer.v须索引payload.values，不能把v直接当对象。新增 `provider-gate-decoding.json` 保存原始SDK定位与SHA。

仅接受匹配account/user的完整init-v1/init-v2快照；拒delta/live-overlay/未知格式。缺gate/层或enabled不明保持unknown，绝不默认为true。读取github企业连接前要求223049465明确true；不满足时不查询该端点。查询固定GET `/wham/github/connections`，15秒、无自动retry，原生追加实际身份的两项X-Codex-Expected头，尊重网络策略；响应必须验证hostname/name/connection两个身份字段及唯一性。未执行真实账号请求，夹具不等于运行时gate通过。

先闭合真实能力与连接读取，再将已验证能力接入提供商选择/实例写入，所有写入仍需宿主重新核gate及真实连接成员资格，不信任渲染层传来的enabled或伪连接。

## 提供商真实能力读取后端（当时尚未接入设置UI，后续接线见下节）

- 新增原生命令 `code_review_provider_read` 与专用 `review_provider.rs`，复用真实宿主bootstrap；只返回校验后的能力值和真实企业连接，不向前端暴露token或bootstrap伴随私有字段。缺gate/层维持null，与false分开。
- 固定包SDK隔离纯函数输出黄金hash：223049465→504780497，2247892263→2243148289，2115119119→1134546883。支持完整has_updates=true的V1与V2；V2层v经values表取对象。账号不符、delta、live-overlay及未知格式拒绝。
- GithubConnections固定只读路由支持真实期望账号/用户headers、网络策略与15秒限时。仅企业gate明确true时由新命令查询；bootstrap/连接两阶段复用requestId，取消间隙由既有cancel-before-start保护；已知403不重试。连接响应验证主机、身份字段和重复项，不将字段不全当可用连接。
- `chatgptService.ts`新增绑定身份的客户端读取函数，保留取消、空列表与未知能力状态；**尚未接入设置UI，也未实施提供商/实例持久写入**，下轮必须继续真实消费者，不把后端完成当页面完成。
- 证据 `16-16B-providers/`：gate专项2项、连接transport专项2项、共享账号服务85项均通过；客户端与已有审查回归通过；TypeScript已通过。标准入口新增gate专项。当前未重跑整套、未生成原生安装包、未执行真实账号查询或官方/原生GUI实测。

## 提供商设置UI与宿主验证写入

- `ReviewProviderSettings` 已接入设置页，以账号/连接scope隔离读取、保存及事件；scope变化立即遮蔽旧快照，晚响应失效，注册失败可重试，卸载释放监听。仅明确true的gate允许GitLab及GitHub企业实例；已存GitLab但gate不可用时仅effective回退，不重写原值。
- 实例来自真实账号连接读取；真实空列表、读取失败和已存连接失效分别呈现。GitHub实例查询失败仅禁用实例控件，不阻断提供商偏好；保存无乐观成功，失败保留当前选择并提供重试/重新读取。
- 新原生命令保存前重新读取能力与连接列表，非null GitHub连接按hostname/connectorId/accountLinkId三字段核成员资格。provider三项使用原atom，单字段merge；同锁expectedValue检查防跨窗旧值覆盖，落盘失败不更新内存，成功后通知其他窗口重读。通用审查偏好命令不接受这些字段，不能绕过能力检查。
- GitLab目前只有gitlab.com默认项与已存失效项；企业授权列表未接，宿主拒绝非null connector写入。provider偏好尚未接入真实远程审查消费者，不能把选择保存当作已可使用该账号审查。
- `16-16B-provider-ui/` 最新定向验证：UI生产组件VM、客户端、指令回归、TypeScript、前端构建退出0；Rust provider/持久化4项及cargo check退出0。受控Chrome验证企业实例选择、注入保存失败不变更选中值、显式重试成功；截图 `browser/provider-current.png`。夹具不是账号服务实测，临时页面/服务器已关闭。
- 最新完整标准（非Fast）及原生构建进入最终归档，结果另见[阶段验收记录](acceptance/16-16B-local.md)，不沿用开发早期Fast结果。官方配对截图、原生GUI/IME、真实多窗及真实账号仍未验；没有视觉评分或像素通过声明。
- 独立审核发现并修复第二处P2：同身份跨窗广播无条件刷新会静默取消本窗口在途保存。修改前回归退出1已留证；现将通知合并排队，保存结束后重读并保留失败/重试；身份、连接变化仍立即取消，卸载清空队列。新增成功/失败/双广播用例退出0，独立复核确认修复，无新增有证据P1/P2。
- 最终非Fast完整标准退出0（含隔离协议），随后当前源码EXE/MSI/NSIS退出0；297项冻结产品输入在构建前后哈希一致，8项产物含5个许可已归档。见[本地增量验收表](acceptance/16-16B-local.md)。未另跑全Rust，不将专项组合写成全库通过；本地限定增量待用户验收，整16.16和全App目标继续active。

## 2026-11-04 GitLab企业实例继续开发

依据固定合同第9节，现已接模板GET与accessible links POST的真实服务路径、CODEX SKU/other surface、真实账号header和固定读取body；首个匹配授权link再做资格过滤，详情403/404忽略单项，其他错误独立返回gitlabInstancesError。详情按官方EXr严格验证原始URL、模板/service、管理员标记与hostname，不用URL规范化绕过。保存非null connector在宿主重新枚举真实成员后才CAS落盘。

前端已接真实列表、hostname.localeCompare排序、默认与显式默认connector等价显示、已存失效项保留、独立失败/重试、保存失败不冒成功；客户端拒绝gate未知却带列表、无效项与重复connectorId。新增UI回归修改前退出1、修复后退出0，原有账号scope/跨窗/取消回归保留。Chrome生产组件与隔离IPC验证实例选择、失败保原值和显式重试，证据 `16-16B-gitlab/browser/`；临时tab/服务器已关闭，无真实账号请求、原生或官方配对像素结论。

Rust初轮网络策略测试夹具路径错误已修复，review_专项13项及cargo check退出0；父线程复核补查JSON读取POST的Content-Type，专项和共享服务回归继续。前端UI/客户端/指令与TypeScript已通过，尚未运行本增量最终完整标准或重建原生包。07d98eb的旧构建不可用于验收本轮。后续主线是账号绑定PR工作面及精确远程比较，不能将实例保存当作已接远程审查。

后续Content-Type断言先复现失败、补JSON header后共享服务88项通过；malformed实例name过滤为宿主边界增强。此后已转到[16.16C PR阅读工作面](acceptance/16-16C.md)，新增真实account和PR消费者；共享服务最终95项、provider5项及跨层返回解析通过。300项产品输入冻结后最终标准/原生包另行归档，不复用07d98eb构建。GitLab实例不再是仅默认/未接列表，但GitLab MR阅读和完整私人审查仍未完成。
- 16.16C最终结果：完整标准非Fast退出0；其后默认账号响应connection兼容修复另经共享服务96项/provider5项及跨层解析通过。最终原生EXE/MSI/NSIS退出0、300项输入稳定、8项产物归档；以16.16C验收记录为准，不沿用上文开发中快照。
