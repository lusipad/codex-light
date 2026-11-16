# 12 插件整页执行记录

2026-11-16。**整页开发中，未验收**。[修改前合同](../specs/12-whole-plugins.md)及[总计划](../../FULL-REPLICA-PLAN.md)R0/R1→R2。当前只是可回退开发节点，不是完整插件页交付或1:1通过。

## 已执行取证

主线程读取当前Store版本并重算app.asar SHA-256，仍为26.1103.4239.0 / `fb47d6491dc3006b708cb1e14de479b882bf50f88b7daa81818f154c253266aa`。同版143资源、19区域/动作锚点及补充10个schema锚点在`.ref/parity/12/whole-page/reference/r0-20261116/`。远端home扁平listing与完整库存/详情对象不同，不能送现有mapRemotePlugins；库存未就绪与已读无匹配的安装状态也不同。

三桌面能力研究另见[宿主矩阵](../../research/desktop-host-feasibility-20261116.md)，只证明静态依赖和资源存在，未执行官方helper、修改真实配置或强开gate。没有因此把三个说明页改标可用。

## 当前产品改动

- 目录保留已安装卡片，增加真实库存图标区；目录按已有category字段组织，不将市场名或混合默认响应命名为公开目录。
- 卡片改为logo占位、名称/单行描述与独立状态/图标动作；已装不再显示重复安装。真实logo与安装图形最终轮廓尚未校准，当前Boxes/Download沿用现有图标作为开发占位。
- 列表点击进入独立详情工作面，返回保留搜索；不在原卡内展开ID/认证/路径表。详情当前是已有能力的初步组织，完整markdown/提示词/信息/法律链接/深链尚未完成。
- 目录搜索自动聚焦；刷新读真实目录而非只读库存；从技能切入目录亦可加载。外部管理变更/窗口聚焦刷新目录及已打开详情，修正卸载后卡片仍“管理”的问题。
- 安装图标阻止卡片导航并复用同步单飞、策略、准备/不确定结果核验；未重写安装/启禁/卸载、账号或MCP链路，未新增依赖。设置管理面的完整纠偏仍在R2队列。

## 回归与构建

证据根`.ref/parity/12/whole-page/actual/r0-20261116/`：

- 私有真实`verify-plugin-management-b.mjs`、`verify-plugin-preparation.mjs`均退出0，安装/详情与库存独立读回、启禁CAS、冲突、卸载及市场移除成功，0模型turn，未动真实HOME或账号。
- `verify-plugin-directory.mjs`在旧实现真实失败，新增目录/图标动作/独立详情/返回、技能切入、连点安装和focus/事件卸载传播后通过。最后事件缺陷由独立只读复审发现并先红后绿。
- 首次前端总入口因旧`verify-plugin-settings`片段VM缺新ref退出1，保留`frontend.log/.exit`；补夹具后140项总入口退出0，见`frontend-recheck.log/.exit`。最后事件刷新补丁之后另跑生产目录/管理专项、TypeScript及plugins/actions/catalog检查均0；没有把总入口说成以该最后补丁完整复跑。
- 候选`npm run tauri build -- --ci`退出0，EXE/MSI/NSIS完成，`build-candidate.log/.exit`。本轮没有运行完整非Fast标准或全量Rust，没有改Rust产品代码；尚非页面最终交付。
- 候选EXE SHA-256 `6a30b66db309aa974d59108429df373cb12946bd689e7946aa119d158f0ab710`。437个产品输入记录于`product-inputs-candidate.json`，构建/原生后重算无变化。`native-fixture.json`及私有`verification/launch.json`记录CLI0.159.2、环境与运行hash，不把旧EXE当当前源码。

## 候选原生观察

测试使用私有CODEX_HOME/AppData/WebView和本地文字插件，两个可发现插件中一个已由真实app-server安装，另一个未装。没有通过GUI安装外部插件、登录、发送模型或改变用户配置。该私有app-server默认目录还返回可读取的curated条目，不称其为已登录远端home。

| 操作 | 实际结果 |
|---|---|
| 打开目录后直接输入private- | 搜索得到两个私有条目，已安装项为管理，未装项为图标安装；`candidate-private-search` |
| 打开未安装卡片 | 原生显示独立详情、真实description/版本及安装入口；`candidate-private-detail`，未在GUI执行安装 |
| 返回插件 | 搜索private-与两项状态保留；`candidate-private-detail-back` |
| 缩至窄窗 | 单列，两项与操作可见，页头换行；`candidate-narrow-directory` |

图片为JPEG，窗口捕获1435×900、957×679，不是已标定CSS客户区。UIA焦点字段只暴露文档层，自动搜索/返回后的输入以实际文本和可见界面作有限证据；物理IME与完整原生焦点序列未验。官方配对图缺失，score=null。

## 下一步与未完成

### R2-C 完整详情集成中（晚于68afa2a）

同版补证后新增`PluginDirectoryDetail`、`PluginDirectoryIncluded`、`PluginDirectoryLegal`与共享`PluginLogo`，复用Markdown、技能预览、真实fs协议及原生链接命令；没有新依赖。父层与App接真实安装/启用读回、准确plugin mention及首页草稿，不发送模型。新增生产专项覆盖字段优先级、15/3显示行测量、身份隔离、技能匹配/只读、法律原文、资产及父/App接线。

独立复审和主线程补回归分别复现并修复：本机CLI远端来源被误分流HTTP；真实service启用成功但未返回确认实体导致首轮试用仍失败。两项均先红后绿，pending与runtime刷新失败仍禁止起草。详情外链也补先红回归后接真实`review_link_open`，不让空点击冒充打开。

私有CLI0.159.2探针已返回真实interface（中文标题、两条提示词、28段长说明、信息字段及绝对logo路径）、一个技能，并独立确认安装与skills/list；证据`.ref/parity/12/whole-page/actual/detail-r2c-20261116/fixture.json/.log/.exit`，0模型turn。154前端总入口退出0，新EXE/MSI/NSIS首轮构建退出0。该首轮447输入之后，官方补证改变ON_USE前置条件并确认搜索须替换普通首页区域，只有SkillsMcpView一个产品输入变化，两项回归先红后绿。补丁后154完整前端、末次TypeScript、新原生重建均退出0（`frontend-final`、`typescript-final`、`native-build-final`）；`product-inputs-final.json`在最终构建/原生后0变化。

非Fast标准退出0，实际包含32个原有真实协议探针；标准进程启动后才登记的`verify-plugin-detail.mjs`另行执行退出0，新增真实fs图标字节与已装技能内容检查。共33种探针有本轮结果，不把新探针写成已包含于该次旧脚本执行。84个Rust产品输入与前轮745全库测试对应输入一致，未重复跑新一轮全库，证据`rust-input-equivalence.json`；本轮标准中的Rust过滤组不能冒充另一次745全量。

首轮原生EXE `8865ff9932b29eca44a7ec21ad081155ffa6ba5ccc0981adfbb83a7ac11f6a3e`验证：真实logo、标题/提示词/说明；展开至第28段再收起；技能预览真实内容与Escape关闭可见焦点回原技能；信息dl；已安装prompt真实预填完整plugin mention且不发送；未装技能只读无启禁/试用；窄窗957×679（窗口捕获）标题与提示词可见。证据`native-*.jpg/.txt`。UIA输入/焦点字段不足以证明物理IME，JPEG和缺官方配对图不能证明像素一致；首轮EXE不代表后续ON_USE补丁。

最终[CodexNative.exe](../../../dist-artifacts/plugins-r2-detail-20261116/CodexNative.exe) SHA-256 `407d6e83cbd9f59a9d235159f5faa150895e039646b767b7fdd7296e65e50300`（同目录MSI/NSIS）。新窗口另验：重启保留上一草稿；搜索detail-只显示真实结果，没有普通首页图标条/登录提示；打开对应完整详情；点击第二条prompt得到准确的第二条原文和完整plugin mention。`native-final-*.jpg/.txt`、`native-launch-first.json`与`native-launch.json`分别标识两轮；最终窗口已关闭，未GUI安装/卸载或发送模型。`candidate-result.json`记录447输入、三产物hash及各检查退出码。

仍有明确限制：ON_INSTALL/显式setup完成后的提示词恢复、账户/模板/调度/依赖服务、来源tabs/图标条溢出与完整管理、官方配对图和物理IME。ON_USE普通提示词已允许先起草，不永久禁用。logo本地支持PNG/JPEG/GIF/WebP，其他格式未支持；HTTPS远端由浏览器加载，未核远端字节/MIME。rem候选/标题cascade及背景资产许可未核，score保持null。后续来源/图标条合同已补27原始锚点，继续R2而不转页。

### R2在途集成更新（晚于上述候选构建）

以下是晚于首批候选的集成改动，已使用下节新构建验证本地链路，不能沿用上述首批候选hash作为这些改动的证据：

- 增加typed flat首页/分类解析、资格与身份隔离、只读home/detail/category传输；主目录使用真实CLI搜索及200ms debounce，仅缺方法允许完整本地目录回退。私有CLI搜索探针已取得真实响应，HTTP传输仅注入测试，未实测账号。
- 接入分类分页、来源读回后的安装引用、独立详情URL与真实前后退。显式非空hostId拒绝，不默认为本机；未知库存状态不提前开放安装。
- 官方ACK补证区分安装、库存刷新和连接授权。安装ACK后库存失败/缺目标/部分市场加载失败保留待确认，禁止重复写；显式完整刷新可恢复。作用域journal覆盖组件存续中的账号/项目A→B→A，尚非跨组件卸载的持久记录，也未声称完整复制官方异常恢复。
- 独立复审复现两个P2后补回归修复：完整来源深链拒绝异实体详情；显式刷新重搜当前关键词。搜索循环游标保留已有结果并提示不完整，而非静默当末页；重试重新搜索。
- 新增搜索/URL/App历史/复审用例接入两个标准入口。初次前端集成在旧技能动作VM缺`unsupportedDirectoryHost`处退出1，补夹具后该专项及148项完整前端重跑退出0（`frontend-recheck.log/.exit`），TypeScript退出0。后端全量745项通过，0失败/忽略/过滤（`rust-full.log/.exit`）；HTTP使用注入transport，不能称745项真实服务验证。证据根`.ref/parity/12/whole-page/actual/remote-home-20261116/`。非Fast标准及32项真实协议探针退出0（`standard.log/.exit`），新EXE/MSI/NSIS构建退出0（`native-build.log/.exit`）；构建/原生后441个产品输入均无变化，`candidate-result.json`记录三产物hash及范围。
- 最后独立复审重跑目录与深链专项均退出0，另实测安装pending时显式完整空库存刷新再重复触发、ACK后仍缺目标均只发一次install；未发现新的确定重复写/跨身份污染。组件卸载后journal不持久的限制保留。

### 当前源码的新原生观察

产物[CodexNative.exe](../../../dist-artifacts/plugins-r2-directory-20261116/CodexNative.exe)，SHA-256 `7d8e88cda1272b5a6ef2e856350fc8607d7faf3dee3e973b6a35077653029afe`；同目录有MSI/NSIS。私有home沿用两个本地文字插件，AppData/WebView另建`r2-run`，未登录、未发送模型、未在GUI安装或卸载插件，测试后窗口已关闭。

| 操作 | 新构建实际观察/证据 |
|---|---|
| 未登录打开目录 | remote gate为真时明确要求ChatGPT登录；真实已安装private-first仍可见，未伪造远端首页 |
| 搜索private- | 真实CLI搜索返回private-first和private-second，已装/未装动作不同；`native-private-search.jpg/.txt` |
| 打开private-second | 独立详情读取真实description/version，URL含准确pluginId、pluginName、marketplacePath和search；`native-private-detail` |
| 标题栏返回/前进 | 返回保留private-和两个结果，前进重新读取正确详情；`native-history-back/forward` |
| 窄窗及刷新 | 957×679窗口下目录单列、页头换行；刷新保留query和两条结果，详情安装入口可见；`native-search-narrow`、`native-refresh-narrow`、`native-detail-narrow` |

宽窗捕获1435×900，尺寸是窗口而非标定CSS客户区。图片为JPEG。输入由UIA set_value执行，不能算物理键盘或中文IME验收；官方同条件配对图仍缺，视觉score=null。当前只是R2-A/B集成节点，完整详情、管理及整页验收继续进行。

继续R2，不因本节点转页：先完成当前目录/搜索/分类/深链的统一标准与新原生验证，再按已补`detail-contract.md`完成详情/提示词/资产、目录来源tabs和管理面联合纠偏，最后整页官方配对与用户验收。本地降级分支须明确标明来源，不能把默认plugin/list直接当官方HTTP目录。

尚未完成：真实账号远端HTTP、官方配对像素、物理IME、完整独立详情内容、来源tabs、图标条溢出组合、官方logo/安装轮廓、完整设置管理流程。分类首6/更多有生产回归，真实远端分类原生未测；本地搜索与详情历史有上述新原生证据。现有候选不用于发布；本轮重新读取最新远端run42644930892及job129255526818，仍为原来的未启动失败，注解为付款/支出上限；未重跑或更改账单，不能当当前源码CI通过。
## R2-C 来源与图标条整合检查点（2026-11-16，阶段自验）

本节是当前未提交源码的增量记录，不覆盖此前候选的证据，也不构成整页验收。

- 已接线：真实账号来源资格、Public/Workspace/Personal标签、Workspace分页与跨页模板过滤、Personal摘要/完整分类及Created双游标、本地OS home归属与原始市场身份、测宽44px已装条及真实详情链接。未知Teams gate未强开。
- 复审已修：账号错误遮挡本地个人内容、Workspace误接管公开/本地分类、重复返回按钮、本地加载误报空及重试未实际读取、刷新未刷新来源、已装入口未校验详情返回实体。对应生产组件回归先失败后修复；旧失败日志保留。
- 当前通过：160项完整前端回归、749项全Rust测试（0失败/忽略/过滤）、TypeScript及相关专项；非Fast标准退出0，33个隔离真实协议探针通过，无失败步骤。标准检查后仅改同名市场标题helper及专项两文件，补丁后定向检查和完整160项前端重跑均退出0；Rust输入未变。最终816个验证输入与新EXE/MSI/NSIS构建前后相同。
- 私有新夹具：25个真实已装文字插件、1个未装项，真实CLI安装/库存读回，0模型turn；用于后续新构建GUI观察，不能据此称官方界面一致。
- 新原生候选：`dist-artifacts/plugins-r2-origins-20261116/CodexNative.exe`，SHA-256 `4844ab3bf37e24eb932ce2b47957230e135e410c5ae8999d2861eedec7d9de5b`；EXE/MSI/NSIS构建退出0。1435×900窗口观察到20个已装入口与剩余5个；957×679个人目录因滚动条占宽显示9个入口与剩余16个。两者计数守恒，缩放后实测重算。
- 原生已观察：未登录Public保留登录提示、Personal真实市场首页6项/完整分类26项；Home与Left环绕自动切来源、焦点环；分类与详情历史返回保留来源；图标读取真实详情；溢出跳真实设置插件管理；搜索`strip-24`显示真实结果且隐藏首页条和来源tabs。截图是JPEG窗口捕获，不是已标定CSS客户区或无损像素证据。
- 关闭复核：根进程退出，首次仍见1个关联conhost；首次快照46.03秒后复查，记录的10个后代均不在运行，未强制终止。该间隔不证明具体退出时刻，也不是所有关闭组合的验收。
- 证据：`.ref/parity/12/whole-page/actual/origins-r2c-20261116/`；`frontend-integration-red.*`保留整合失败，`frontend-post-titles.*`为最终160项结果，`rust-full.*`为749项全库结果，`standard.*`为非Fast/33探针，`product-inputs-final.json`与`candidate-result.json`登记最终输入及产物，`native-*.jpg/.txt`记录观察。真实账号HTTP、OAuth恢复、Teams门控、官方配对像素及物理IME仍未放行。
- 明确残项：旧设置管理面重复大标题、957px窗下内容拥挤已实际观察，进入同版管理合同下一包；不因管理跳转可用声明管理整页完成。OAuth补证新增6项同版资源后参考manifest共152项，另登记AppxManifest；官方回调由官方Store的`codex`协议所有，服务是否允许本软件回调/客户端身份仍无证据，不能占用该协议冒充实现。
- CI：本轮只读刷新，最新远端run仍为`42644930892`、旧HEAD `6eebc537`；注解说明账单/支出上限阻止作业启动。当前源码没有同提交CI成功记录，未推送或发布；本地通过不替代托管CI。
- 提交前空白检查修正来源UI专项脚本的尾部空行并重跑该专项退出0；`commit-inputs.json`记录唯一变化的验证脚本，产品源码仍与原生构建输入一致，不宣称所有验证脚本字节始终未变。


## R2-D 管理工作面增量（2026-11-16，开发/整合自验中）

本节对应`fca4c15`之后的未提交工作，不能使用此前EXE验收。

- 当前接线：单管理页头、真实动态分类/搜索前计数、紧凑插件行、MCP嵌入草稿保护、管理深链/历史、来源校验和不支持host隔离；卸载结果不确定时保持只读恢复，不重放写入。
- 首个市场入口已从依赖非空分类的inline表单改为独立弹层。按当前26.1111合同提供三个初始空字段、参数解析、单飞、pending锁/加载、取消、错误匹配保值与scope隔离；使用现有marketplace/add并读回。
- 新增父级专项已验证：精确参数、服务真实name、写失败抛回弹层、ACK后管理/库存失败及partial库存警告、不重复add、旧账号晚回不导航/刷新。成功与刷新警告使用App级toast并显式success/error，不随目录切换丢失。
- 管理详情PMD01–09、管理宿主导航、MCP与弹层专项、远端插件RPC-UI01–09、TypeScript及空白检查已有通过结果。完整169脚本收集曾为168通过/1失败（技能refresh fixture缺loadManagementRecommended）；该fixture补齐后专项0，随后最终完整统一169项重跑退出0，证据frontend-final.log/exit。
- 非Fast标准仍在运行。已观察旧目录/远端UI/个性化导航三项测试环境或旧界面断言失败，修复后各专项0；原始失败日志保留，标准最终结果尚不能报告通过。证据位于`.ref/parity/12/whole-page/actual/management-r2d-20261116/`。
- 尚未完成本次源码的新原生候选、宽窄/弹层GUI、官方配对像素、物理IME、真实账号/OAuth或用户验收。完整管理详情区域/权限及服务契约另按当前版`management-detail-contract.md`继续；没有将旧元数据详情视作完成。


### 管理详情区域接线检查点

- 新`PluginManagementDetail`复用Logo和实测展开hook（3行），单标题、真实About provenance、安全链接与错误生命周期；父级把真实Apps/MCP/Skills/Hooks传入已有包含项组件，以settings呈现，不再堆原始ID/authPolicy卡。查看详情在本机来源完整时由App守卫原子跳真实目录，缺远端ID不猜名称。
- PMD01–10与父级/展示专项通过；PMD10先红后绿，修正本机默认策略被误当远端管理员策略，以及本机额外确认框。远端RPC-UI01–09管理员/取消/未知结果隔离仍通过。包含技能目录/管理两种呈现回归通过。
- 当前完整171项前端重跑退出0（frontend-detail-final.log/exit）。输入清单838项；其后只将查看详情按钮不存在的CSS类改为现有secondary-btn-sm，并补跑真实展示组件专项0；新输入快照保存于inputs-before-native.json。84项native/Rust输入与前一全Rust阶段相同，不能把旧749测试说成当前新跑全库。
- 非Fast标准重跑进行中；原先三项夹具问题未再失败。新增发现verify-plugins.mjs仍强制旧列表“目录”按钮；按当前About来源合同修正为执行真实展示组件回归，专项0。该轮标准原始失败日志保留，不提前称退出0。
- 当前新版原生候选/GUI/官方配对图/物理IME仍未验。MCP精确映射与开关、Apps完整管理、自定义Settings/Meetings、准备状态完整consumer和模板资格仍是整页残项；后台raw DTO存在与当前计划hook为空的事实分别记录，没有将未知数据造成功能。


## R2管理阶段最终候选（2026-11-16；覆盖前述本阶段“进行中”检查状态）

本候选基于`fca4c15`后的本阶段源码；对应提交见Git阶段记录。插件整页仍开发中，未获用户验收。

| 维度 | 本阶段结论与证据 |
|---|---|
| 功能 | 管理壳/动态分类/独立详情、真实包含技能与About、首市场弹层、受保护目录跳转、未知卸载只读恢复；PMD01–12及来源/父级/展示/MCP/远端专项通过。ID相同但市场来源不同也拒绝，缺来源名称不猜；Win lexical别名与POSIX大小写分开，8.3/symlink未推断 |
| 自动检查 | 非Fast标准`standard-layout-final.exit=0`，33真实隔离协议探针；其相关步骤执行后的最终来源校验补丁另经专项及完整172前端`frontend-final-172.exit=0`重验。TypeScript、最终EXE/MSI/NSIS构建退出0；没有把早期退出1改成通过，旧失败/红绿日志保留 |
| 构建一致性 | `inputs-final.json`记录839个验证输入，均未在最终构建开始后修改；84 native/Rust输入与前一全Rust阶段相同，本阶段不是重新跑749全库的声明 |
| 原生 | 私有CODEX_HOME/AppData/WebView、25个真实已装插件，0模型操作。最终构建1435×900与955×678窗口：真实来源详情、About、居中弹层、正反向Tab首尾环绕、Escape及可见归焦；内容预览无试用footer，窄窗技能行开关完整。前序同阶段构建另验证长描述3行/展开收起、目录同实体跳转与Alt+Left、MCP空草稿打开/取消并保留MCP0；各构建hash分开保存 |
| 视觉/用户 | 截图为原始JPEG，窗口尺寸不等于已核CSS客户区；官方同环境配对图、DPI/App缩放、逐像素差异、物理中文IME、真实账号/OAuth与用户验收未完成，score=null，不能称1:1 |

最终产物：`dist-artifacts/plugins-r2-management-20261116/CodexNative.exe`，SHA-256 `098f95163ed5998860e2d5a766030d0c3b0206e94f42752f80097aa6f705f9e9`；MSI/NSIS的hash见`candidate-artifacts.json`。核心证据根`.ref/parity/12/whole-page/actual/management-r2d-20261116/`。

原生与独立复审实际找出并修复：多余disabled Try、显式local host被误拦、添加弹层左上角/宽度、窄窗技能行溢出、breadcrumb误用history/host、Tab离开弹层、同ID不同来源被接受；分别保留缺陷截图或先红后绿日志。不是仅凭传入props或构建结果宣称呈现通过。GUI未执行安装/卸载/授权写入；真实隔离协议探针与生产组件故障回放分开记录。长描述夹具已恢复原字节。

最新可见远端仍是run42644930892（旧提交）的账单阻止启动注解，不代表本候选CI成功，也不能据此断言账户当前账单状态。本阶段本地提交、不推送/发布。

下一同页工作包：补typed模板/Apps资格、MCP映射与真实开关、插件提供的Settings/Meetings及适用权限/sync；OAuth自有callback资格与Teams门控继续保留具体依赖。当前R3新版宿主研究仅为只读资料，不计能力已实现。
## MCP接线继续开发（2026-11-16，非新原生候选）

管理阶段已本地提交`fcb4a8a`，未推送。提交前复核839输入与三产物hash无变，记录的11个原生进程均退出。其后开始MCP接线，以下结果不能沿用上一候选EXE。

- 新增同版映射helper、生产状态hook和管理MCP区；真实配置键、完整应用目录优先、manifest版本/空Map、管理员、单飞、乐观状态、写后读回、未知结果只读恢复与scope/ABA隔离均有回归。复用config客户端和现有包含项行/开关，不新增依赖；目录模式未接该管理消费者。
- `node scripts/verify-ui-parity-release.mjs`：175项、exit0。运行期间有应用目录来源与文案补正；最后对新映射/hook/UI、包含项、管理详情父级、插件设置六项重新验证，均exit0。不能描述为同一冻结输入跑完全部175。
- `npx tsc --noEmit`与最终`npm run build`均exit0；大chunk为构建警告。真实私有CODEX_HOME的`verify-mcp-settings-b.mjs` exit0，补验默认用户文件的config/value/write、upsert及含点/引号/反斜线literal key读回；零模型turn，MCP服务器保持禁用。
- 证据：`.ref/parity/12/whole-page/actual/management-mcp-r2-20261116/`。此包未重跑非Fast全标准、全Rust或新原生打包/GUI，也未推送托管CI，不能引用上一包结果覆盖。
- App映射行尚未接完整App管理/连接/权限导航，明确静态展示，不造MCP开关或跳错分区；Apps、权限/sync、自定义Settings、授权消费者及整页原生/像素/用户验收仍未完成。

## R2权限与普通MCP设置阶段候选（2026-11-16）

这是MCP接线后的新阶段结果，整页仍开发中，未用户验收。来源固定Store26.1111.2228.0；35份资源和本包47个原始锚点已独立核hash/header integrity，完整snapshot包hash亦复核一致。主线继续第02批，没有转入R3或声明全部插件设置完成。

| 层面 | 已执行与边界 |
|---|---|
| 功能 | 本机MCP配置首匹配/manifest版本与空Map、实际key启禁/读回；慢应用目录不阻塞本地配置。真实普通MCP声明→工具发现→专用ephemeral上下文→bool/enum/text/number/integer表单→单字段set→成功/失败后readback；无参action使用真实工具与结果。全局权限typed宿主、独立URL及四值读取/三值写入已接，真实账号HTTP未验 |
| 自动 | 最终183项前端exit0；修正账户生产合同后全Rust763项、0失败/忽略/过滤，exit0。CLI0.165.0非Fast检查34个真实私有协议探针均通过。该标准整轮exit1：执行中草案测试的借用错误曾编译失败；最终完整Rust已覆盖并关闭该失败，不把原exit1改写为整轮0 |
| 构建 | 最终EXE/MSI/NSIS构建exit0；865产品/验证输入在构建后hash复核无变。提交前仅清四文件EOF空白，三项受影响回归及前端构建再验0，三份前端产物逐字节相同，证据eof-build-equivalence.json；不为无产物变化重复原生打包 |
| 原生 | 私有无账号新fixture。首候选902ca5…验证开关、中文值失焦保存、枚举键盘、整数1.5被拒且磁盘不变/3读回、真实action计数。最终8c90ef…补验普通菜单项无radio勾选、Escape→Down重开→Return选择首项、模式balanced↔precise真实读回、MCP箭头及enum右对齐、949×654返回图下菜单向上展开/内容可滚动，真实action描述和计数。两候选的结果分开保存，不拿旧图当新源码 |
| 视觉/用户 | 原始JPEG返回图，宽图1435×900与窄图949×654记录的是工具返回尺寸，非已测CSS客户区或物理像素基准。无官方配对图、DPI/缩放、像素diff、物理IME或用户验收；score=null。action仍为原生title候选，工具提示形态/延迟/键盘呈现待对照，不宣称1:1 |

独立复核修正了P1：旧模块raw map假设不适用于当前`/wham/accounts/check`。当前宿主返回accounts[]，OAko.YL先取account_ordering[0]对应id，页面再核当前账号与personal；缺可选数据无资格，错误DTO为读取失败。当前回归夹具已改真实数组及首项选择，不声称抓取了真实账号响应。旧通知/用量同类假设列入后续分区复核，本包未顺手修改。

最终产物：`dist-artifacts/plugins-r2-settings-20261116/CodexNative.exe`，27,525,120字节，SHA-256 `8c90efd9c1a53ceef20aae97702e8a55b551e22dbab13cff771fb8e06cabc31c`；MSI与NSIS见candidate-artifacts.json。证据根`.ref/parity/12/whole-page/actual/plugin-settings-r2-20261116/`。首轮11个相关进程已退出；最终原始12项统计含一个早于父进程创建的vctip PID重用关联，按创建时序剔除后11个真实进程均退出，未终止该无关编译器进程。

未推送/发布，无当前阶段托管CI结果。仍缺：Apps详情/连接/同步与关联账户权限、全局权限可见入口的官方正证据、codex_apps/hosted及HTML/MCP App设置宿主、设备访问、自有OAuth回调资格、Transport closed自动恢复及官方30秒创建超时、跨窗失效同步与完整原生/配对视觉验收。下一包继续这些同页消费者，不把本阶段候选算作插件整页完成。
## R2应用详情只读链开发检查点（9661cf0之后）

本检查点是第02批的继续开发，未完成App页面或用户验收。`9661cf0`为此前权限/普通MCP设置阶段的本地提交，没有推送。本包来源为同版`app-detail-contract.md`及20精确锚点，6资源hash/大小主线程复核通过。

- 新增固定`plugin_app_details_read`及生产IPC/客户端。service插件详情严格核ID及materialized app归属；不把installed库存作为可读详情前提。metadata裸对象、CODEX SKU及settings/other surface按来源区分。
- 宿主白名单和前端严格解码；其他应用links与原始actions/token不返回。metadata失败不当空；links读取失败保留metadata并返回独立错误。前端选中遵循真实multi资格、hidden/implicit及指定/健康/首项顺序。
- 新专项先红后绿，TypeScript exit0；Rust新增专项9通过、0失败/忽略、763过滤，exit0（不是全量772）。完整前端184项exit0，null字段对齐专项另重验0；证据见`.ref/parity/12/whole-page/actual/plugin-app-details-r2-20261116/frontend-all.{log,exit}`。未重跑非Fast标准、全Rust或新原生打包。
- **未验及下一步**：尚未将客户端挂到完整App路由/UI；继续接页状态、区域、账户选择，然后补权限/sync消费者。无新原生产物、无真实账号HTTP/OAuth、无官方配对像素/物理IME/用户验收，不用此前EXE覆盖本包；本包尚未阶段提交或推送，无托管CI结果。
## R2应用独立入口与只读详情接线（2026-11-16，开发检查点）

在`9661cf0`之后继续第02批，没有转页。本包已接管理包含项及MCP映射App行→独立入口→真实canonical关联；有pluginId则replace所属详情并再次核归属，明确null才走durable hosted内容与独立metadata。三段插件/App面包屑、真实身份/昵称的只读行、加载/错误/重试及scope/ABA隔离已接。独立无插件页不借完整连接/权限树，也没有假管理写控件。

| 检查 | 实际结果及限制 |
|---|---|
| 来源 | 36个manifest资源；本包AD/AC/AS/FB共50个源码锚点已核精确片段，新增hczB资源从snapshot校header integrity后登记。DBCl.iwv=durable，batch用CONNECTOR_SETTING，metadata用CODEX/settings；没有用CLI目录冒充hosted结果 |
| 前端 | 189项完整回放exit0；随后复审归属跳转补丁的10项相关回归及最终TypeScript/Vite构建均exit0。完整回放与最终补丁执行范围分开，不称原生/像素通过 |
| Rust | 最终22个plugin_app_details专项通过，0失败/忽略、763过滤，exit0；没有宣称全量785已跑。保留早期alias误比21过1失败、Map行为先红后绿及归属状态红回归；最终以rust-entry-reviewed.log/exit为准 |
| 复审 | P2归属失效错停403页已闭环：专用结果→身份后验→清旧snapshot→当前路由replace；真实403仍显示错误。独立只读复核未发现新增确定P1/P2 |
| 未验 | 未重跑非Fast标准/协议探针、全Rust或新原生打包；无真实账号服务/OAuth、物理IME、官方配对像素及用户验收。上轮GUI工具因无法确认浏览器URL停止，无截图；隔离预览服务已关闭，创建的浏览器窗口未用其他方式绕过限制清理 |

证据根仍为`.ref/parity/12/whole-page/actual/plugin-app-details-r2-20261116/`，最终检查与构建日志包含`reviewed-*.log`、`frontend-entry-reviewed-build.log`、`entry-code-review.md`。本包是只读开发检查点，不提供旧EXE当作新源码候选；完整Manage app、账户选择/持久化与重命名/关联、权限/sync及hosted主详情字段/认证资格继续同页开发。未推送，无本包托管CI结果。
## R2账户动作阶段记录（2026-11-16，36e222d之后）

本阶段继续总计划第02批，范围为实际关联账户的重命名、选中导航和持久化；不转入R3，不代表完整App管理或插件整页验收。依据同版`app-account-actions-contract.md`及13个精确UTF-16锚点，5个相关资源大小与SHA-256重新核验，证据为`.ref/parity/12/whole-page/actual/plugin-account-actions-r2-20261116/reference-audit.json`。

- 功能：保留原始provider ID，仅在归属比较时规范化；按实际multi资格和默认认证显示账户动作。昵称只写真实`link.name`，JS trim及1–64个Unicode码点；固定PATCH目标和CODEX/settings上下文，fresh归属/唯一账户检查，写后真实读取确认。超时或未知交付只读恢复，不自动重发；真实403不当成功或无归属跳转。
- 交互：多账户行选择并打开rename，其他适用账户选择仅replace当前linkId并保留query；身份三元组使用实际metadata.id，null删除、最近写入尾插并限100项。弹层单飞、IME保护、Escape/外点/焦点返回及旧scope/ABA隔离；confirmed后才关闭并发“账户已重命名”，未知结果保留草稿。
- 已验证：191项完整前端回放exit0；最后成功通知接线后生产页面专项及TypeScript再验0。全Rust799项通过，0失败/忽略/过滤，122.49秒。独立有界复核未发现证据充分的新增P1/P2。red日志保留旧弹层回调、关闭渲染时序、同值空白、null multi选择、implicit前缀和raw link ID六类实际回归，不是CI失败。随后PAA09补核官方中文与可访问行命名，先红复现昵称遗漏，再绿验证重命名/选择名称、昵称及认证警告关联；新增4段来源锚点，不宣称原生屏幕阅读器实测。
- 统一检查：非Fast `scripts/verify-all.ps1`整轮exit0，34个真实隔离协议探针通过；覆盖最终可访问语义补丁、TypeScript及Vite构建，不以Rust过滤组冒充全库799项。EXE/MSI/NSIS构建exit0，493个产品输入前后稳定；本包新增源文件亦在输入清单中，不使用旧阶段EXE。
- 未验/未接：真实账号HTTP写入、原生GUI/物理IME、官方同环境配对图、用户验收；完整More菜单、关联/断开/重新授权、权限/sync、current-user身份fallback、hosted详情完整区域与跨窗持久同步仍未收口。本项目仅读恢复及写入单飞为恢复措施，不宣称是官方完全相同的忙状态UI。

本阶段无新依赖、无真实账户写入、无推送/发布，也没有当前提交托管CI成功结论。详细PAA01–PAA09合同在规格末节，完整日志和独立复核在上述证据目录。

候选：`dist-artifacts/plugins-r2-accounts-20261116/CodexNative.exe`，28,139,008字节，SHA-256 `d03f44308b237283a40ce3e3c353798d057c76968df093b47e594a892857d12d`。MSI/NSIS路径、大小和哈希见证据`candidate-artifacts.json`。产品输入清单SHA-256 `396c239e13123c74449cda29fc1c643e5e4861527de9bc23e3a8bb60459ad67e`，基于36e222d后的本阶段工作树；构建后重新逐文件核验。构建完成不等于原生GUI、安装/升级、账户服务或像素验收。

复现入口：打开具备真实关联插件的App详情，实际multi资格账户行打开昵称编辑；检查初始昵称、空白和65码点报错、取消/焦点返回；经授权的真实写入须核保存后读取的实际link.name。未知结果仅点读取重试，不重复提交；切账号/离页的晚回不得提示成功。当前没有自动执行这组真实账号操作。下一继续More菜单/断开链，输入合同已补13个源码锚点和10个真实中文键；reconnect/OAuth资格仍按独立合同处理。
## R2账户菜单与断开阶段（2026-11-16，08e6d9e之后）

继续第02批。依据同版`app-account-disconnect-contract.md`的13个精确锚点及10个中文键，5资源大小与SHA-256已核；只接EF5T共享账户菜单，不把独立ManageApp的connector删除或tB普通fallback最后项限制混入此路径。资料与全部日志位于`.ref/parity/12/whole-page/actual/plugin-account-disconnect-r2-20261116/`。

- 功能：fresh插件/实际App/唯一可见link→先接受URL选择→固定bodyless DELETE、CODEX/settings→完整真实links回验。支持空204，最后一项和非multi账户可断开；不加owner/personal/admin/reauth状态门禁。超时/408/5xx未知交付只读恢复，隐藏仍存在、links:null或目标仍在不当删除成功。真实403保留旧数据。
- 状态/交互：rename与disconnect共用单飞/账号/路由ABA/取消保护；部分列表读取不能解除未知写保护。确认后按同App首个非reauth、首项、null回退；父级按实时URL的expectedLinkId判断，不覆盖较新显式选择。未知结果显式完整读取可恢复，不再次DELETE；last空列表不卸载、不跳根。更多菜单有rename资格及危险断开，键盘、IME、焦点、外点/滚动定位和旧handler隔离有生产组件回归。
- 真正后续读取：确认后先提示“账户已断开连接”，再并发刷新真实runtime应用/技能/MCP/安装库存和service插件；刷新失败单独提示“账户已更新，但无法刷新账户列表”，不改成DELETE失败或重发。旧App/账号的晚刷新不提示新页。复用既有读取和菜单样式，没有新依赖。
- 验证：10项Rust transport专项通过后，全库809项通过，0失败/忽略/过滤，125.02秒。193项完整前端回放exit0；随后断开错误文案按官方中文收敛为“无法断开账户连接”，不拼原始服务诊断，hook专项先红后绿。实际client、hook、菜单、页面及父级回归通过；client缺实现、页面缺菜单、成功后未刷新等红阶段保留。最后发现重叠刷新会误发旧失败toast，runtime/service代次保护先红后绿，6个受影响流程及TypeScript再验0。非Fast标准整轮exit0、34真实隔离探针通过；其前端步骤在末次重叠补丁之前，不能冒称最后补丁后整套重跑。最终原生构建包含当前TypeScript/Vite，exit0。独立复审及两次增量补核未发现确定新增P1/P2。
- 仍缺：reconnect/新增账户的真实授权消费者，因此当前菜单缺官方适用reconnect项；准确glyph和xs宽度未证，候选复用lucide与既有220px菜单，不计像素一致。官方先ACK/cache成功再独立刷新的时序，与本项目先真实回验再成功的更严格恢复策略有差异，保留待校准。真实账号DELETE、原生GUI/物理IME/Tab跨portal焦点、同环境官方像素、用户验收和托管CI未验。

本包不能升级整页G5，不能用08e6d9e的候选验收新菜单。未执行真实账户写入，无推送/发布。下一仍在本页接关联账户权限/sync及适用App管理、授权残项，保持总计划顺序。

最终候选：`dist-artifacts/plugins-r2-disconnect-20261116/CodexNative.exe`，28,337,152字节，SHA256 `78f40f74c19a4d93c8f7243c90c52f67716bb1f82b84db94093331ff2e1be587`。MSI/NSIS实际路径、大小与哈希见`candidate-artifacts.json`，496产品输入构建前后稳定，输入清单SHA256 `e37eb1422baf58dedbc71a6116b97b7a0ca45d6d359ae3cdfdfb14ba1c07ef4e`。验证时序与末补丁范围另存`verification-summary.json`；候选构建不是原生GUI或安装升级通过。

操作入口：具备真实归属和可见账户的插件App详情→账户右侧More→rename或断开。经授权的真实账号验证应确认目标先选中、服务实际删除、兄弟回退/最后一项null、错误和只读恢复；不能只看toast。浏览器回归仅操作隔离桥/transport夹具，未替代这组真实账号或物理输入操作。
## R2关联账户权限深链阶段（2026-11-16，90b045d之后）

范围为普通service插件的显式App与隐式canonical权限深链。先核当前同版`app-link-permissions-contract.md`/30片段、26条简中文案、7来源哈希与大小；父权限摘要函数实际null、权限页detailTo实际undefined，未添加父入口或查看详情按钮。隐式解析不是首app，而是pS唯一候选、完整service库存canonical归属与必要反向association；显式也fresh核真实成员。

- 后端：新的固定read与逐link write；复用wham首账号personal校验、真实插件/App/links投影及默认GET。权限editable要求USER owner等于实际认证user、非REAUTH_REQUIRED；不借rename资格，也不把全局三值规则套本页。四值含full_access，reset必须显式null，缺value拒绝。只对raw override相同不PATCH，继承默认时点击checked仍写显式override。ACK保持pending，整批客户端重新读取确认；不是服务回空响应就标已保存。
- 页面/状态：uniform默认四radio，mixed默认账户列表；统一switch仅本地模式，不写配置。精确URL linkId，未知ID为空目标禁写，返回只replace清linkId并保持权限页列表模式。失败ID-only重试，已成功项不重写；unknown/default或links部分读取仅重新读取，未确认结果明确提示。切目标/模式清旧失败重试意图，未知写锁不被清掉。默认读取失败仅同identity保留旧值显示，仍禁写，属于更严格安全边界。
- 导航：权限reader独占该service深链，未启动竞争CLI详情；根/插件面包屑、无资格回对应详情、成员失效回插件，replace避免坏深链循环。父scope/host及ABA保护，任意独立App或SSH不能获得通用权限编辑器。
- 验证：实际domain/bridge、hook、生产Page及parent/URL回归通过，旧全局权限三值写入等回归保留。全Rust827项通过，0失败/忽略/过滤，123.13秒，包含最终18项新模块用例；旧15专项仅历史日志。197完整前端回放exit0后，头像新URL重建和access未知不渲染编辑区两处末补丁专项再验0。非Fast标准与最终候选结果见本节末收口记录。
- 复审：两项P2已修——release.requires_local_executor字段层级，以及clearErrors未清旧failed/retry导致切B后重试A。后者真实hook先红后绿，前者源级用例后由全827验证。未知结果UI两种组合、头像失败恢复及资格不完整均有生产组件回归；独立修后复核未发现确定新增P1/P2。
- 未验/差异：真实账户HTTP接受性、原生GUI/radio方向键/焦点/IME、多窗、官方配对像素、托管CI和用户验收。头像32px、lucide箭头与CSS为候选，不宣称官方矢量/token物理尺寸一致。unknown提示与严格读回/默认错禁写是项目保障，不称官方原文/时序。隐式requires-local返回专门unsupported_host，native Meetings专用宿主仍缺；labels非string wire未证，不放宽后开放权限。

本阶段无新依赖、无真实账户写入、无推送/发布，不升整页G5。统一证据根`.ref/parity/12/whole-page/actual/plugin-app-link-permissions-r2-20261116/`，不能用上一阶段EXE验收新权限页。下一仍在第02批同步及App管理/授权残项。
最终收口：隐式canonical App发生A→B→A时，按实际App身份重置状态、废弃旧回调并重建article控件子树，避免旧手势沿用新App输入DOM；同App刷新保持模式。该风险有源码及回归证据，未做物理鼠标复现。完整197前端及非Fast标准/34隔离探针在最后前端补丁之前通过；最后9个受影响流程再验exit0，随后当前TypeScript/Vite、EXE/MSI/NSIS构建exit0。全Rust827项exit0后未改Rust。501项产品输入构建前后稳定。

候选：`dist-artifacts/plugins-r2-link-permissions-20261116/CodexNative.exe`，28,771,840字节，SHA256 `38651579b5adc081e00723a2f326991c4a1bcff97d8370a0881fcab311822feb`。输入清单SHA256 `a1bdec7cb11774a8fcb23947408a70dce0896e85e90f346d1607d77a0fdae972`；三产物哈希与准确执行时序见本阶段证据的`candidate-artifacts.json`及`verification-summary.json`。此为普通插件权限深链阶段候选；无新增可见父入口，真实账户HTTP、原生GUI/IME、官方配对像素、托管CI及用户验收均未验。下一接同步、App管理及授权残项，不升整页G5。

## R2同步子链进行中（2026-11-16，4c39fdd之后）

开发前重核固定参考5资源哈希/大小及19个UTF16原始片段。新增生产纯函数锁定所选账户匹配、单账户URL规则、4项管理员映射、DWD资格、Gmail/Outlook legacy限制、摘要状态优先级及停止按钮资格；复用selectPluginAppLinks及canonicalMcpAppId，没有另造账户选择规则。生产函数回归先因缺实现失败，再通过；额外覆盖multi多账户禁止legacy借用。已接入两处标准回归入口，TypeScript exit0。

本阶段尚未接同步GET/POST、页面/确认弹层和写后读回，Github仓库配置仍为独立子单元；不能演示真实同步或报告同步功能完成。无网络调用、真实账号变更、新候选、原生/像素或托管CI结论。证据位于`.ref/parity/12/whole-page/actual/plugin-app-sync-r2-20261116/`。下一在此合同上接真实读取、确认停止与只读恢复，再整合详情入口和深链。

### 普通同步链集成记录（进行中）

已接两个固定IPC、通用认证headers的真实同步GET与两种停止POST；后端fresh核wham、插件/App归属、所选link和唯一connection/backing pair，管理员仅可读。ACK/unknown返回pending不合成成功，客户端重新读取原canonical路由与当下所选范围；仅同实际App/所选账户且目标不再匹配才确认，读失败或目标仍在只读恢复。取消/账号generation变更不宣称已发POST撤销。共享canonical解析从权限模块提取复用，保持原权限读取顺序及回归。

显式App详情接有真实状态才可见的同步入口，单账户忽略外来URL而使用实际fD选择；同步导航只构造当前linkId，丢弃旧query/hash。显式/隐式同步深链均由独占reader解析，不竞争CLI详情；旧link/账号/ABA回调不能重定向新页。Page仅展示真实状态、full优先delta时间、管理员只读和必须勾选的停止确认；未知交付只读恢复，不补开始同步按钮。App、实际identity及link变更更换控件DOM。

77项plugin_app Rust组通过后，全库840项通过，0失败/忽略/过滤，126.54秒；完整203前端回放exit0。随后说明/locale、Entry实际identity DOM和确认后真实runtime/service刷新末补丁，8受影响流程及TypeScript再验0；旧全套不能冒称全部在最终补丁后重跑。非Fast标准与候选结果待本节末追加。实际App详情旧harness因新增Entry import报错已修正stub并重验，不削旧断言。独立源码复核未发现确定新增P1/P2。

差异/未验：采用严格读回再关闭而非官方ACK即关闭；pending期间锁checkbox，unknown提示与恢复为项目保障；弹层520px、徽章和图标等仍为候选，无官方配对像素。普通sync不包含GitHub仓库配置，隐式canonical插件根完整App管理面及其可见入口仍待整合。真实账号HTTP、原生GUI/物理键鼠/IME、多窗、安装升级、托管CI和用户验收未验。
最终验证与候选：840全Rust（0失败/忽略/过滤，126.54秒）、203前端回放、非Fast标准整轮/34真实隔离探针均exit0。完整前端在最后呈现/刷新补丁之前；最后8受影响流程（含真实runtime/service刷新、旧刷新代次隔离及IPC注册）和TypeScript另验exit0，当前原生构建含最终TypeScript/Vite且exit0。507产品输入前后稳定；没有用旧EXE验收新源码。

候选`dist-artifacts/plugins-r2-sync-20261116/CodexNative.exe`，29,210,112字节，SHA256 `b346c249b21e58808e3414ba29c969b7ce66757516adfe6f08b546912abe19ed`。输入清单SHA256 `fa476a900fdff67c26d9f456f12982537922e8c3a95b51c7e55f102a4f106cc3`；MSI/NSIS大小与哈希、准确检查范围在证据`candidate-artifacts.json`与`verification-summary.json`。代码来源为4c39fdd后的本阶段工作树，阶段提交后补sourceCommit。实际Tauri GUI、物理输入/IME、真实账号HTTP、同环境官方像素、托管CI和用户验收仍未验。

可复现入口：插件管理的真实App详情，有匹配状态才显示“同步”→状态行“禁用同步”→勾选前不可提交、取消应无写入。真实停止会移除同步内容，仅在已有授权场景验证，本轮没有执行。确认读回后才刷新runtime/service库存；该刷新失败单独提示，不重发停止请求。库/系统提示等跨页及多窗消费者仍在整页回归范围，不以当前两个库存刷新声称完整复制官方Zi失效集合。

下一仍为第02批：GitHub仓库配置（新typed合同13片段/11中文键已备）、隐式canonical根完整App管理面、reconnect/OAuth和HTML/特殊宿主残项，再第03批整页候选。本阶段本地提交，无推送发布；普通同步候选不是整页G5或1:1验收。

## R2 GitHub同步仓库配置阶段（2026-11-16，338eb92之后，验证中）

开发前核固定26.1111的`app-github-sync-contract.md`与13精确UTF16片段、11简中键及4资源哈希。metadata仅扩sync_metadata.user_allowed_to_sync boolean/null白名单；固定Github App、当前实际所选link及唯一github connection共同决定配置区域，不加owner/personal或user_connected配置门禁。新三个固定IPC分别读配置、提交搜索和保存；配置CA请求generic headers，搜索单独settings/CONNECTOR_SETTING。前后端都核真实scope/identity，写前fresh读配置，新ID通过对应query/pageToken重新搜索证明，最多5组，不建跨请求ledger或任意URL入口。

页面：初始读配置+空查询，手动提交搜索；空query补已配仓库、搜索优先去重、服务器基准已选优先排序；跨query/分页保草稿及来源，最多5项仍可取消已选。dirty取消零写，非空保存才POST extension；ACK/unknown以真实GET精确Set回验，旧值/读取失败保持desired/只读恢复，不重放保存。分页空token保留，重复cursor禁止循环，专门重试重读配置+当前query首页；普通加载更多可重试当前分页。

跨组件P2已复现并修正：GitHub空Save可经父Z进入admin匹配状态的确认，普通行user_connected门禁不适用。Page先false/expectedtrue红后绿；后端新增来源DTO的真实serde红为0通过/3失败（unknown githubEmptySelection），随后新增默认false及fresh GitHub特例：固定App、strict metadata、所选可见link、knowledge及唯一connection/backing、当前wham账号均核定才允许；普通admin行/默认请求仍只读，非Github来源标记不能扩权。空保存没有配置POST，仍需父弹层必勾确认；路由沿现有personal/backing分支。配置操作本身没有新增个人/owner门禁。

支持边界与差异：配置ID接受Rust JSON整数字面量或digits整数串，搜索仅JSON整数字面量，0至MAX_SAFE_INTEGER；float/scientific数值与非整数/溢出/不支持字符串显式拒绝，不将坏已配值变空。此比原Number转换窄，不是官方wire schema。额外fresh来源重查、严格读回与busy锁是项目实现差异；真实服务接受性、当前gate、原生GUI/IME、配对像素、托管CI和用户验收未验。读回未匹配时不会宣称已保存。下一canonical根合同已用5来源/28片段核实RequiresLocal宿主helper常false（import→调用→返回均有证据），pS/Ok自身没有该门禁；当前共享解析的unsupported_host属于待纠偏差异，将在根管理面单元修正，未以本阶段通过消除此缺口。

验证：旧134项plugin_组通过后，GitHub空选择修正后的138项组通过（719 filtered，不能称全库）。生产domain/桥、hook、Panel及普通Page父确认有回归；metadata/普通同步既有回归通过。独立初审遗漏空Save/admin路径后已补正为确定P2并复核修复，不用早期“无P1/P2”掩盖后续发现。随后全库857项通过（0失败/忽略/过滤，129.11秒）、完整206前端回放exit0，512产品输入不变；非Fast标准及新候选结果见本节末。全部证据位于`.ref/parity/12/whole-page/actual/plugin-github-sync-r2-20261116/`。

### GitHub子单元用例索引（隔离回归，不是真实账号/原生验收）

| ID | 同版预期及操作 | 当前证据/结论 |
|---|---|---|
| GH01 | metadata严格true+固定App+当前可见link+唯一github connection才出现配置；假门控不开放 | domain、metadata与Rust scope用例通过 |
| GH02 | 缺optional配置数组为空；畸形/不支持已配ID报错，不能清空；字符串配置ID与搜索ID分开 | Rust配置/ID白名单及domain回归通过；浮点/科学计数支持边界保留 |
| GH03 | 输入不查询，提交trim值后读取；opaque空cursor可继续，重复cursor不循环 | Panel/hook/domain/transport回归通过；真实服务及物理IME未验 |
| GH04 | 搜索项优先去重，空query补基准，按服务器已选优先；跨搜索保留草稿和proof | pure/hook回归通过 |
| GH05 | 满5禁新增但可取消；取消回基准，零写；已配超5可减至5 | Panel/hook/后端数量用例通过 |
| GH06 | 非空dirty保存：fresh配置/新ID搜索证明→一次POST→真实GET相同Set才确认 | transport/domain/hook回归通过；HTTP接受性未验 |
| GH07 | 空Save只开父确认，勾选前不写/取消零写；匹配admin GitHub特例可确认，普通admin仍只读 | Page/domain红后绿、后端3项红后绿及默认false回归通过 |
| GH08 | ACK/未知但读旧值保持desired只读；重新读取命中目标Set才解除；不重放POST | domain/hook/Panel回归通过 |
| GH09 | 切query/App/account/link/connection、ABA或卸载后旧响应/按钮不能影响新scope | hook/组件/identity回归通过 |
| GH10 | 相同新源码打包、宽窄/Tab/Escape/焦点/物理IME及官方配对像素 | 新候选构建exit0；原生GUI及视觉未验，不由206前端回放替代 |
最终验证与候选：当前512项冻结产品输入下，全Rust857项（0失败/忽略/过滤，129.11秒）、206完整前端回放、非Fast标准整轮/34真实隔离协议探针及当前TypeScript/Vite/原生EXE+MSI+NSIS均exit0；没有最终源码补丁绕过验证或使用上一阶段EXE。

候选`dist-artifacts/plugins-r2-github-sync-20261116/CodexNative.exe`，30,173,696字节，SHA256 `d3620c6b06077b868c9c0dce8b4d66ed19b64e50884c727b13d36d20b94a4129`；输入清单SHA256 `d906f102901803772376ddc32a03dde9f356d4e82abacf18bd5f613267a2d4b6`。三产物大小/哈希与准确执行范围见本阶段证据`candidate-artifacts.json`/`verification-summary.json`。构建对应338eb92之后本阶段工作树，提交后补sourceCommit；安装/升级、真实GUI/IME、多窗、真实账号HTTP、官方同环境像素、托管CI与用户验收均未验。

本阶段复用原同步snapshot、HTTP传输、实际账户选择及父确认，不新增依赖或跨请求ledger；新增选择仅在当前写请求内按query/cursor分组重读来源。源码可演示入口是具备真实Github资格的插件App详情→同步→已同步的代码仓库；本轮未执行真实配置写入/停止或OAuth。零选择移除内容仅在已有授权场景确认，不应以toast替代结果。

下一仍在第02批：隐式canonical根App管理面（先纠正已证的常false宿主helper被误用为门禁及generic回退），再独立管理应用/授权/特殊宿主残项和第03批整页候选。阶段本地提交，无推送或发布，不升整页G5；剩余wire支持边界、严格读回/缓存时序和原生像素待验继续保留。

## 2026-11-16 R2 canonical根分派与管理头部阶段（4219f89之后）

本单元仍属于第02批，不能据此宣布完整App管理或插件整页完成。同版静态来源为8文件/59个0-based UTF-16锚点/37中文键；实际重新核对提取文件大小、SHA-256和全部片段一致，未重新计算整包hash，也未作官方运行时对照。原始合同/锚点见reference的app-canonical-root-*；本轮证据为`.ref/parity/12/whole-page/actual/plugin-canonical-root-r2-20261116/`。

本轮接通固定IPC、白名单DTO、前后账号/用户/代次与routing核验、根读取组件和父页面。主详情/完整durable库存失败保持错误/重试；候选无解或reverse失败/null/mismatch才同URL回普通详情，权限/sync子页仍保持既有membership语义。RequiresLocal辅助函数在本固定构建常false，原错误unsupported_host已由真实红测复现并纠偏；这不授予本机执行资格。完整库存复用实际HTTP分页，不引入renderer hidden IDs或虚构native布尔值。

canonical头部使用实际App名称、服务插件双色图标和官方描述优先级；根面包屑不增加插件祖先，显式App仍保留原模式。复用现有实际账户、改名/断开、选择持久化和同步链；旧scope/ABA/晚回及旧动作失效。普通回退保留真实旧PluginManagementDetail及包含项，尚未改成完整service详情adapter。

根卸载复用真实服务写入/读回和未知结果journal，新增HTML确认，按可见账户数量选择源文案。真实confirmed后replace管理root；unknown不报成功，禁重复写，提供只读核验。保留管理员和账户加载/系统账户门禁。根“查看详情”已使用真实raw ID与官方durable/chatgpt-workspace/pluginName路由，不添加breadcrumb=settings；当前durable目录消费者仍拒不支持主机，下一单元必须接正确服务adapter，不能为了链接能打开而退到本机CLI。

| 用例 | 官方预期与关键不变量 | 当前证据 |
|---|---|---|
| CR01 | 主读取/完整库存失败不是generic成功；取消/身份变化不能回退 | Rust root及domain回归 |
| CR02 | canonical唯一/模板/库存首owner与reverse归属；RequiresLocal不错误拒绝 | 10项root、18项shared，错误门禁先红后绿 |
| CR03 | generic保留同URL实际旧详情；canonical传真实App/header | root生产组件回放 |
| CR04 | 标题/描述/双色资产/根及显式面包屑分开 | App生产组件回放；几何/像素未验 |
| CR05 | 账户选择只改linkId；旧选择不能进入sync；离页旧动作不执行 | 路由及PMB08 |
| CR06 | 多账户卸载警告、取消零写、fresh guard/单飞/IME/焦点 | 新确认组件回放；真实物理IME未验 |
| CR07 | confirmed离开旧详情；unknown只读核验，绝不第二次卸载 | PMB09生产父页面四场景 |
| CR08 | 查看详情精确durable服务身份；不得擅自执行本机路径 | App生产回调测试；目标目录能力仍缺失 |

未验与边界：真实HTTP/OAuth、原生GUI/物理IME/多窗、同环境官方配对像素、托管CI及用户验收均未完成。nativeEligibility明确unverified，Meetings真实宿主/entrypoint/cache未接；完整App About、H-only管理、hosted tools/provider设置及授权恢复仍在返回队列。hosted内容读取失败时保留独立错误并回退实际connector展示，未提供单独hosted重试提示；不能当hosted读取成功。安装时间仅支持RFC3339/RFC2822/纯日期，无时区ISO datetime等完整JS Date.parse兼容尚未实现，没有实际wire样本证明出现。上述缺口不以阶段测试数量消除。

本阶段最终检查：867项全Rust（0失败/忽略/过滤，131.19秒）；209组完整前端回放；末次卸载未知结果补丁另跑7个直接相关脚本及TypeScript；非Fast标准整轮及34个隔离协议探针；最终TypeScript/Vite/原生EXE、MSI、NSIS构建均exit0。516项产品输入在最终冻结与构建后逐项大小/hash一致；没有用测试数量升级整页验收。标准脚本的Rust过滤组不冒充全库，完整867结果另存rust-all.log。

候选：`dist-artifacts/plugins-r2-canonical-root-20261116/CodexNative.exe`，30,257,664字节，SHA256 `4fb2a3b6f3c6ee009f3f45ca3ca4fd2db50c9d2ea98f39dac501c5a26e078ca9`。输入清单SHA256 `9c9b3fc58ffe9f8ec8bb0a2f063afac04d12e21c944edcae29695a8345e39a7f`。MSI/NSIS和详细检查范围见本阶段candidate-artifacts.json及verification-summary.json；源码由4219f89之后本阶段工作树生成，提交后在证据中补sourceCommit。真实HTTP、原生GUI/IME、多窗、配对像素、托管CI及用户验收均未验，visual-verdict保持score=null。

本轮复用现有App账户/同步、真实服务变更及未知结果journal、PluginLogo/展开状态和弹窗样式，未新增依赖或替代执行器。本地阶段提交、不推送发布。下一仍为02.3：按已补durable目录合同接真实目录消费者与service详情转换，继而补普通根完整内容和独立App/授权/宿主；本阶段不是插件整页或全App的1:1完成声明。

## 2026-11-16 R2 durable目录详情读取基础（9f6c229之后）

当前仍为第02批开发/自验阶段，不是目录往返、插件整页或用户验收通过。基准仍是26.1111.2228.0/package26.1111.21308。上一阶段准备的6来源/16锚点合同，本轮扩为8来源/23锚点/7中文键，并另补browse合同8来源/34锚点；两组资源有重叠，不相加为独立文件数。主线程已逐文件核大小/SHA-256及UTF-16精确片段；未重算整包hash、未实测官方当前账号。证据位于`.ref/parity/12/whole-page/actual/plugin-durable-detail-r2-20261116/`。

已接目录专用固定GET：详情CONNECTOR_SETTING/other，完整库存CODEX/other且不发includeExtensions；旧管理/root/settings/home/list用途保持。主线程真实复现2项CODEX与CONNECTOR_SETTING断言失败（exit101），修正后31项remote_plugin_专项通过；完整Rust874项通过（0失败/忽略/过滤，130.46秒）。catalog分页允许next字段缺失/null结束、空token继续，重复/畸形/错误/取消不能返回partial库存。固定IPC不允许renderer覆盖URL、SKU或extensions。原token/总量边界是传输支持限制，不称完整官方wire schema。

W/Y域转换复用mapRemotePlugins并局部补齐源字段：真实匹配库存决定summary/disabled技能，raw详情决定正文/USER实例及模板；onboarding依enabled和技能名，服务技能path=null，App ID规范化去重、名字优先级、can_setup和shareUrl均保来源，不造本地文件或假URL。并发详情/库存前后核账号、用户、代次、routing与取消；库存失败不是未安装成功，也不降本机读取。

精确durable、raw pluginName/path ID与chatgpt-workspace组合进入独立服务详情；其它旧unsupported guard保留，旧CLI loader不会因加durable页面而放行。页面复用现Detail/Included/CSS，真实概要、标题生命周期、读取失败/重试、scope/ABA/晚回和清理有生产回放；已装可管理真实raw根，已装启用且资格可确认时只交现有草稿回调，不发模型。Included不传本机技能、fs、MCP/Hook配置写或技能正文回调。服务安装、技能正文、模板setup、native/OAuth仍未接，禁用按钮不代表这些功能已完成。

返回链新事实：实际目录presenter为t_→Hi2y.eY→PluginDetailEmptyState，目录中文“插件”/“无法加载插件”不是browserPluginSettings.loadError；breadcrumb是真实链接，当前根入口返回`/plugins?hostId=durable`，不能清host变本机目录。该目标的browse依赖NbOT/fHlE实际宿主集合及readiness、远端feature/gate4218407052、IVVU.Lq过滤。项目尚无这些完整producer，不能假定ready=[]、强开gate、恒pending或转CLI。当前保正确URL并显示既有不支持状态；**完整列表→详情→返回没有闭环**。详情reader自身explicitHost/query/local规则已证，但路由lazy外层是否显式覆盖host的完整调用锚点及真实GUI可达性仍待验证。上述实现只证明当前逻辑durable分支可读取，不证明官方当前账号必走它。

| 用例 | 核心结果 | 当前证据/缺口 |
|---|---|---|
| DD01 | 正确固定详情/库存headers，保旧用途；401/IP/取消/身份隔离 | header先红后绿、31 Rust transport专项 |
| DD02 | 全分页含空cursor；畸形/重复/失败不当partial成功 | catalog transport与bridge回归 |
| DD03 | W/Y完整转换、库存状态与正文来源、USER模板、onboarding/path=null | 生产domain专项 |
| DD04 | actual Detail/Included委派，错误净化/retry、scope/ABA/取消/卸载/title | 生产Page专项；GUI/像素未验 |
| DD05 | raw管理身份与导航guard，不按名称猜；prompt索引/文字匹配、single-flight/false | App/父Page及新Page专项；只填草稿 |
| DD06 | 精确durable delegate，错误host/selector不读CLI | PMB10及旧目录回归更新；保其余原断言 |
| DD07 | breadcrumb保host，缺browse adapter不转CLI | URL/父Page回归；目标列表仍不可用，不计往返通过 |

完整前端初次回放在旧“所有durable都应unsupported”断言失败，原始日志/exit保留为frontend-obsolete-host-assertion-red.*；已更新为精确受支持详情delegate，并保arbitrary host/错pluginName拒绝、零本机元数据/安装断言。这个失败属于过期测试预期，不能冒充生产错误复现。真正SKU生产红测另有catalog-header-red.*。后续完整检查与候选结果另附，不用当前单项绿替代。

剩余：browse的宿主/gate/隐藏项消费者、详情外层host可达性、未装安装与授权准备、服务技能正文、模板setup、App metadata预取/完整法律内容、native/OAuth、真实HTTP、原生GUI/物理IME/多窗、配对像素、托管CI和用户验收均未完成。视觉score=null。继续独立generic service根DTO/呈现合同，并将browse producer依赖保留至共享宿主工作包，不因本次源代码或fixture宣称整个目录完成。

本阶段最终验证：874项全Rust（0失败/忽略/过滤，130.46秒）、211组完整前端回放、非Fast标准整轮及34个隔离协议探针、最终TypeScript/Vite/原生EXE+MSI+NSIS均exit0；518项最终产品输入在构建后大小/hash一致。初次过期host断言失败日志仍保留，最终未跳过该回归或余下检查。完整结果见本阶段verification-summary.json；标准Rust过滤组不冒充全库。

基础候选`dist-artifacts/plugins-r2-durable-detail-20261116/CodexNative.exe`，30,311,936字节，SHA256 `2a3c9bbb07c4307862757f808420cbd1e95a05349429dcea5ce3023b2bec9568`；输入清单SHA256 `9e4a47ac086a9089c8139b67258cbc019e5e08aa4bf51ae17a2c6d09d70f483c`。MSI/NSIS哈希见candidate-artifacts.json。构建对应9f6c229之后当前阶段工作树，提交后补sourceCommit。没有启动真实GUI、实际账号HTTP或模型调用，没有推送、发布或托管CI成功结论；像素和用户验收仍未完成。

复用现有HTTP会话/网络限制、mapRemotePlugins、App ID规范化、Detail/Included及CSS，没有新增依赖或通用JSON框架。已交付的仅是服务详情读取基础和正确导航身份；返回列表仍因实际宿主/gate producer缺口不可用，不把这个基础候选当完整目录往返。下一独立工作包为generic service根：复用root同次真实数据和纯W/Y，隔离本机MCP、ProvidedSettings与技能文件effect；“使用”另按pS合同，不从目录W.apps反推。

### 普通服务插件根管理进行中（c1a5b02之后，2026-11-16）

承诺范围为服务根数据/真实使用应用与已有管理动作接线。7资源/45原文锚点重新核验通过；13项canonical根Rust定向用例通过。根生产页、usage hook、通用服务页面、App详情decoder和父管理页定向回归通过，TypeScript检查退出0。父级新增用例先红复现全局库存不可用时卸载入口消失，再绿覆盖generic成功、未知结果只读恢复、默认安装限制和退役路由；恢复路径无本机plugin/read。完整前端和全Rust仍在运行，尚不能作为本阶段通过或提交依据。

证据根`.ref/parity/12/whole-page/actual/plugin-generic-root-r2-20261116/`。技能正文/写链、模板setup、hosted设置与图标等缺口保持；未执行真实服务、原生GUI/IME或官方配对像素验证，尚无同提交托管CI结果。本段是进行中检查点，不是整页或用户验收结论。

本包后续验证检查点：完整前端213项回放退出0；全Rust885通过、0失败/忽略/过滤（132.70秒）退出0；521项产品输入前后hash稳定。上述两个首轮失败未删除，修正后的完整重跑分别保留frontend-release-green、rust-full-green日志及exit。非Fast标准检查现以进程内固定CLI0.165.0启动并在运行（session24633），未完成，不提前报告协议探针或原生构建通过；未提交/未推送、没有本提交CI结论。

### 普通服务插件根管理阶段候选（2026-11-16）

本阶段统一验证已完成：885项全Rust（0失败/忽略/过滤，132.70秒）、213项前端生产回放、非Fast标准检查/34隔离协议探针、EXE/MSI/NSIS构建均退出0；冻结前后521项产品输入hash完全一致。固定CLI0.165.0仅作用于验证子进程。首轮测试失败及修正后的完整重跑日志均保留，不以定向重跑替代最终完整结果。

候选位于`dist-artifacts/plugins-r2-generic-root-20261116/`：CodexNative.exe 30,660,096字节、SHA-256 `3ad7c56441e58c9c4c5df3773a7d704d6a551b01fcd00c6d4fa76462dffebe50`；MSI 9,883,648字节、`db6ea8ba057d336dc37fcad7968970fc695685c6a4edab1c64ad93aa59c104dc`；NSIS 6,649,397字节、`f9a0320d44360262fd5d41ec1a72b1dda1e1e42587dd59dc6fcf2b9d1cc1d391`。输入manifest SHA-256 `73900199a750349b6be95bf2a7ee756f1a56563afe7c6cbf8c1163d9b71c0229`；准确产物/检查与源码提交绑定见本包candidate-artifacts.json、verification-summary.json。

可核路径：服务插件根→真实头/关于与pS使用应用→应用metadata及重新关联提示→同插件App深链；卸载确认→写后读回或未知结果仅读恢复；全局库存失败不掩盖已核验根操作；focus/插件变更刷新退休旧根。共享父壳仍有本机库存/技能/config读取，但该服务详情不恢复本机plugin/read、不挂本机详情/MCP设置消费者。验证基于生产组件/客户端与隔离transport，未执行真实账号HTTP/授权。

视觉score=null；没有当前构建的原生GUI/物理IME或官方同环境配对像素结论，没有托管CI或用户验收。本阶段只本地提交、不推送发布；技能正文/启禁、模板setup、hosted设置/图标及授权残项仍在第02批队列。下一包使用已核6资源/35锚点技能合同，不能把本候选当整页或最终1:1。

### 技能正文与直接启禁阶段：统一检查中（cd40823之后，2026-11-16）

本阶段已接正文固定PROMPT_TEXT_AREA/settings GET、严格白名单和missing/null/空串三态、xwideTall内容弹层、技能行及精确深链；行与弹层共享同一开关、写锁和可见反馈。启禁fresh核真实detail技能唯一归属、完整库存enabled字段存在性、disabled名单、admin及pS/fD关联资格；不按personal/owner/default安装/插件整体enabled真假扩大门禁。启用需关联时本阶段明确不启动未接OAuth；已启用关闭不因links失败锁死。

结果区分accepted/unknown/not_sent/rejected：发送前读失败或资格拒绝明确未写；已知同值仅在fresh目标读回后确认无需写；明确4xx拒绝与408/5xx/传输未知分开，拒绝不自动重试且允许下一新显式动作。ACK/未知仅完整库存读回确认，客户端再次校验安装/名单已知/精确目标，不信单一成功标签；未知只读恢复复用既有根读取，不新增每行库存API。正文关闭不取消同row启禁；root/账号/旧动作票据仍隔离。整row/page真正卸载后pending ref不持久化，重进先读根数据、没有自动重放；不冒称跨组件/跨重启的未知意图恢复。

22项技能Rust专项（8正文+14启禁）、10组定向前端脚本、TypeScript均退出0；not_sent同值、rejected误unknown、缺enabled安装存在性、缺名单不永久锁死、深链关闭写scope稳定与焦点问题均有定向先红后绿。当前529产品输入已冻结，完整前端与全Rust仍运行，尚无本阶段完整标准/原生产物/提交或CI结果。

官方7资源/53锚点已重新核大小/hash和严格UTF-16起止/原文；SK12/SK17历史越EOF终点保留修正记录。source确认技能row没有图标槽，生成glyph仅contents弹层；default开关32×20/thumb16（官方根16px）、主题switch token及RTL偏移有依据。生成glyph/主题预设的全局token消费者仍有差距。CUA浏览器工具初始化两次均失败（kernel assets路径缺失），本轮没有宽窄截图、原生GUI/IME或配对像素；score=null。证据根`.ref/parity/12/whole-page/actual/plugin-skill-contents-r2-20261116/`。

技能包后续完整检查点：907项全Rust、0失败/忽略/过滤（132.96秒）退出0；217项完整前端回放退出0；529项产品输入再次hash稳定。非Fast标准检查已用固定CLI0.165.0启动，当前进程20702仍运行。尚未本包原生构建/提交；不把上一cd40823产物作为新技能代码验收。下一独立管理应用合同已产出，需先核资格/DTO再开发；徽标运行时gate未证实不能默认开启。

### 服务技能正文与直接启禁阶段候选（2026-11-16）

统一检查已结束：907全Rust（0失败/忽略/过滤，132.96秒）、217前端生产回放、非Fast标准/34真实隔离协议探针、EXE/MSI/NSIS原生构建均退出0。529项产品输入从冻结至产物收集hash不变；input manifest SHA-256 `c69058b0112d808c263210048eccac65589b2b7ef7d9cd9ef6173f6b02f473df`。不同于此前22专项通过，本段记录完整检查终态。

候选`dist-artifacts/plugins-r2-service-skills-20261116/`：EXE 31,030,784字节、SHA-256 `4b87362834f320c4c3a518eec213d1b91bca9048328db04702842eceace4ddbb`；MSI 9,977,856字节、`ad60c942e61548d3245063e103f85fa44fb5b5a6cdbb9998fa602256f65b2e1f`；NSIS 6,708,195字节、`633d38611901c769b40b9625cb5b3d19dfea5b8814ca33ee9347601ecbc4ac7d`。三项mtime均晚于本轮冻结；源码绑定见本包candidate-artifacts.json/verification-summary.json的sourceCommit。

可复现范围：generic服务根技能行→原始Markdown内容/权限status/正文失败重试→同一row与modal header开关；正文关闭保同row写入；未装/管理员/缺名单/pS普通、系统、reauth/关联失败的精确资格；直接enable/disable后实际完整库存读回、明确拒绝与未知只读恢复；skill深链关闭replace根，canonical分派保留及账户选择/sync路径分别正确。所有服务写验证为隔离transport，不执行真实账号操作；登录状态只读确认配置CLI为ChatGPT，没有记录原输出/令牌，不能据此宣称私有服务实际授权通过。

CUA缺kernel assets路径，两次初始化失败，本阶段无新浏览器图/原生GUI/物理IME或官方配对像素，visual score=null；OAuth/hosted连接分支、模板setup、生成glyph、完整主题switch token消费者、跨整row/page卸载的pending持久化仍未收口。该候选不是整页、用户验收或1:1完成。

远端已只读刷新：最新可见run42644930892仍为2026-11-09的旧push，check129255526818注释为账单/支出限制导致job未启动；没有更新的run，当前账户限制是否恢复未验证，不将旧失败当当前源码失败或当前账单状态。本阶段仅本地提交，不推送/发布，不报告同提交托管CI通过。下一独立App管理合同的4资源/15代码锚点/20中文定位已核，先接fresh资格与name/description，再按各自gate处理删除/发布；徽标gate未知不能默认放行。

收尾补丁验证范围：完整907 Rust/217前端/非Fast34探针之后，删除本轮迁移产生的未使用servicePluginManagementRootId，仅src/pluginManagementLocation.ts一项产品输入变化，所有Rust输入hash未变。补跑5组路由/父页/根组件回归及TypeScript退出0，重新冻结529输入并重建EXE/MSI/NSISexit0；本节上列hash已更新为最终候选。初版输入/产物元数据保留*-pre-helper-removal.json，补丁范围见post-check-patch.json；不将原217前端报告成补丁后再跑217。没有新增行为或测试绕过。

### 独立App名称/描述阶段候选（2026-11-16）

已按v1.8总计划接独立App管理：fresh明确null关联→真实metadata→规范化wham当前账户，分别判断名称/描述；typed PATCH使用fresh实际metadata.id；名称按ECMAScript trim且无昵称64字符限制，描述保持原样（包括空串）。新增管理区与source medium编辑器，pending禁取消/关闭/重复保存，拒绝保草稿，未知仅读核验；值确认后真实重读hosted标题/描述，刷新失败只刷新、不再PATCH。未增加账户菜单、权限、刷新工具或未证实Logo gate入口。

验证：112相关Rust随后扩大929全Rust（0失败/忽略/过滤，133.94秒），219前端回放退出0。完整前端后又按MC02–04修正冷资格读取时不显示额外heading/loading，实际组件先红后绿，补跑2项受影响UI及TypeScript退出0；另补source已有row查询容器，CSS和该section TSX是原始冻结后仅有产品变化，所有Rust输入hash未变。非Fast标准/34隔离协议探针、最终EXE/MSI/NSIS均退出0。最终536输入从重新冻结至打包收集稳定；不将219报告成冷态补丁后再跑219，准确范围见本包post-check-patch.json。

来源复核4资源/15代码/20中文，另8资源/32编辑器锚点均严格hash/范围通过；独立代码复审核所有权、描述三态、写后刷新及退休回调。其后追加source审查发现冷态额外section，已按上述先红后绿修正。浏览器/原生GUI/物理IME、真实HTTP及账号写入、官方同环境配对像素、同提交托管CI和用户验收均未执行；visual score=null。shadow/backdrop/关闭控件及短窗滚动近似仍登记，未知意图只在同section生命周期内保留，不能宣称跨整页卸载/重启恢复。

候选目录`dist-artifacts/plugins-r2-app-management-20261116/`：

| 产物 | 字节数 | SHA-256 |
|---|---:|---|
| CodexNative.exe | 31,429,120 | c31422741b2beaed46a8c510c13891dad72cb1bbaa50d3397420661888304230 |
| Codex Native_0.2.0_x64_en-US.msi | 10,059,776 | 8599e7a256330670af9b46d39eca6ed2cd1774ea0c6120d1cbf153e40dc6f70b |
| Codex Native_0.2.0_x64-setup.exe | 6,755,729 | 1b4e2feaaab9804dff4885a8b364bf7e4a25dcf1ecd1c70cc4b3f084a88b154a |

输入manifest SHA-256 `2a0d3a8e06e6d1809d6f6fecd7654892d7b4d4912d674618a4bcc1c36dce6bd1`。证据`.ref/parity/12/whole-page/actual/app-management-r2-20261116/`；本地Lore提交后由candidate-artifacts.json/verification-summary.json绑定准确sourceCommit。没有推送、发布或宣称远端CI通过。

用户验收路径：登录具备服务资格的账户→插件设置→真实无所属plugin的自有App→按实际独立资格打开名称/描述编辑→检查初始保存禁用、取消零写、名称空白/描述空串、等待时关闭保护、失败保稿及刷新后结果。无资格时不显示对应控件；服务不可用或账号条件缺失须记未验，不能当通过。下一工作包是独立App删除/发布（各自资格及tenant catalog限制），再处理授权恢复与特殊宿主；Logo gate尚未知，R2整页和全软件目标均未完成。

### 独立App删除/发布与共享按钮纠偏阶段候选（2026-11-16）

已接MCP owner独立删除资格、workspace目录禁删、读取未知的显式禁用/重试，以及非personal当前admin的独立发布资格。typed DELETE使用fresh真实metadata.id、CODEX/settings和空body；之后同身份只读核验，403/错误不当不存在，unknown不自动重DELETE。新增default520CSSpx确认modal，pending X保留但不能关闭、取消禁用/单飞；确认后根Apps真实app/list(forceRefetch)刷新前后核account/user/generation和route，成功replace固定管理根，失败仅重刷。发布只固定官方外部管理URL，无发布mutation或成功toast。

本包先118相关Rust通过；DELETE与status专项真实stub/缺陷红后绿为9项。新增status HTTP前必须App/meta canonical同实体，防请求错误目标后404误归属；只有同账户精确目标metadata GET明确404为not_found，不把此观察写成服务端连接级联审计或动作归因。独立审查除这项已修问题外无确定P1/P2；没有执行真实账号删除或发布。

完整944 Rust（0失败/忽略/过滤、137.43秒）、222前端回放、非Fast标准/34隔离协议探针退出0。随后定向asar找到两份Sm6l factory并核对应值一致，新增2来源/24锚点、3组原始双factory独立比对通过，主chunk登记manifest；修正此前实心红按钮为danger-soft、medium横16/纵6/透明border1、14默认字号/18行高、条件10/12.5 superellipse圆角、disabled .4、12px loading和reduced-motion。保留真实palette/app主题token覆盖。

上述末补丁仅2 CSS及DeleteDialog的loading JSX；Rust源码/本机构建脚本与业务逻辑未变。补跑2项受影响UI及TypeScript退出0，再重新冻结540输入并最终原生构建退出0。不能报告222前端为按钮末补丁后重新跑222；准确范围见post-check-patch.json及原始冻结快照。shadow/部分spacing、完整主题producer覆盖、精确spinner图形/速率/可见性暂停、原生焦点/IME和配对物理像素仍未验；本轮CUA再次getState因kernel assets缺路径/os error3失败，visual score=null。unknown意图只在同Section生命周期内保留。

候选`dist-artifacts/plugins-r2-app-delete-publish-20261116/`：

| 产物 | 字节数 | SHA-256 |
|---|---:|---|
| CodexNative.exe | 31,911,936 | 990c5b3ccdd1fb4aeffe8b4f4699087e523a14e41680d869aebcda843d9b6652 |
| Codex Native_0.2.0_x64_en-US.msi | 10,190,848 | 91f5d687ab64646b4a6eff4edcf999584173e096ac752487fd7872bc5728dc76 |
| Codex Native_0.2.0_x64-setup.exe | 6,823,419 | a3ea9189e899168339e38d6b39db6286d5de1f2b69bce5db7b899b65ba52dd28 |

最终输入manifest SHA-256 `ec132d26b0caf4ec2feb5c6a5c4f39ac8a1cc77cccc7073d970bb86325c150a9`，证据`.ref/parity/12/whole-page/actual/app-delete-publish-r2-20261116/`；本地提交后外部candidate/summary元数据绑定准确sourceCommit。未推送/发布，同提交托管CI和用户验收未执行。

用户验收路径：有实际资格的独立App→检查删除row/tenant禁用→打开确认但不提交→核标题、真实metadata.name及取消零写；真实账号删除须由用户自行选择适当对象并确认，不能把fixture误当真实服务成功。非personal当前admin检查外部发布URL与真实浏览器打开，不能仅凭打开即认定发布。下一完整工作包采用当前26.1111授权最终校验合同（4资源18初始锚点，后续producer补证见原始JSON），接原flow一次性草稿恢复；自有原生callback许可、Logo gate、模板及codex_apps/HTML宿主继续返回队列。R2整页及全软件目标没有因此完成。

### R2 当前版连接最终校验与原草稿接续（2026-11-16）

开工源码`aaba977da436bb760656077b685bd3fe20aa90e1`；固定Store26.1111.2228.0/package26.1111.21308，snapshot SHA256沿总计划。本包6资源/34授权锚点、2资源/8默认header片段均由主线程逐hash/UTF-16核验。完整native OAuth未实现，现有“检查连接状态”是项目手动适配，不宣称该入口外观为官方同名按钮。

| 范围 | 当前可操作与证据 | 状态边界 |
|---|---|---|
| 最终只读验证 | 固定typed IPC；原setup/target缺省零目标HTTP；metadata/link真实并发；仅link按原错误分类250ms一次重读；GitHub精确分支与raw detail union | 10项Rust专项通过；FakeTransport证明消费者，不是真实账号HTTP |
| 原flow绑定 | ACK required apps、精确来源/host/workspace/account/request/attempt、原prompt保留；真实已装启用和身份再次读取后才交付 | flow及实际parent/panel回放通过；未知安装不恢复，普通ON_USE保留 |
| 交付与取消 | 最多一次接受的原草稿、零turn；导航拒绝使旧handoff失效且可重试；详情/Tab/同key reload取消原signal，账号/上下文/ABA退休 | 实际App/parent callback回归；末补丁6个生命周期用例含5个真实红，修后全绿；原生焦点/IME未验 |
| 浏览器准备 | 四个精确name/ID前缀的ON_INSTALL分支按fresh同来源installed local判断；目录git→installed local不漏，实际非local不永久拦 | 本软件无真实扩展probe，适用分支仍未完成；不能用空apps跳过 |

两处关键纠偏：固定路径link缺connector_id按官方原auth_status语义接受，显式坏类型/foreign仍拒；new helper局部使用Desktop originator，GitHub不套metadata/link专用SKU/surface，未改全局旧header。metadata.id额外typed校验和本机超时/transport分类是项目边界，不冒称原TZ9K完整逐字段逻辑或全FetchError等价。

验证及准确范围：

- 初始9专项通过后，新增缺connector_id用例真实红→修后10专项通过。原App旧callback取消用例先红后绿。
- 全量954 Rust（0失败/忽略/过滤，132.86秒）退出0。完整前端首次失败是旧harness缺新真实模块依赖；原失败日志保留，两个测试脚本补接依赖/异步协议边界后完整225通过，未删除原断言。
- 非Fast标准退出0，含34个隔离协议探针，实际使用环境配置的CLI0.159.2。另以进程级CODEX_CLI_PATH显式指定CLI0.165.0重跑同34探针，全部退出0；未修改用户全局配置，两个运行版本不混写。
- 全量后末补丁仅src/components/SkillsMcpView.tsx：快路径第三参guard及commit-time退休取消。Rust源码/构建脚本不变，保存前后输入清单与post-check-patch.json；补丁后再次完整225前端退出0，再由同一冻结源码生成最终EXE/MSI/NSIS，均退出0。原生构建含TypeScript/Vite检查。
- 最终543产品输入稳定；manifest SHA256 d5d2215ceb7711de642325b997a75cc8b3338d5a22734cc80781a829e4aada38。证据根.ref/parity/12/whole-page/actual/auth-final-r2-20261116/。未配置独立lint命令，没有编造lint通过。

候选dist-artifacts/plugins-r2-auth-final-20261116/：

| 产物 | 字节数 | SHA-256 |
|---|---:|---|
| CodexNative.exe | 32,009,216 | 6cf9aede15b93c66a9f99aaa8df830628e1df703540b46e6f7f611297d70a5cc |
| Codex Native_0.2.0_x64_en-US.msi | 10,231,808 | dc5024e5382f33683c8afb48c6ddd58a38d4b07c9fe223037204c08c9c206402 |
| Codex Native_0.2.0_x64-setup.exe | 6,862,821 | b5ee1c0cd7131a31b4e395f398bc82deeac525fa0effa38480a5bbd42cd4f5b2 |

用户复核场景：使用具有真实required apps的私有插件，从原默认prompt启动安装；未完成连接时保持等待，网页打开不算成功；人工完成实际连接后检查，全部适用依赖满足才恢复原准确插件草稿，不发送。重复检查、取消/换详情/换账号不得再恢复旧草稿；导航拒绝后可重新操作。浏览器专属ON_INSTALL扩展未验保持未完成，普通ON_USE不误锁。真实账号操作未由本轮自动执行，不能把上述操作说明当通过证据。

功能状态为阶段自验候选；视觉、原生GUI/物理IME、真实账号HTTP、完整native OAuth、浏览器扩展、自有callback许可、配对像素、同提交托管CI与用户验收均未验或未完成，score=null。本轮未重新尝试GUI工具，也没有新截图，不沿用旧EXE观察。较大阶段本地提交后candidate元数据绑定sourceCommit；未推送/发布，未升级整页G5。

下一本机模板工作包已取当前版7资源/29锚点并经主线程核验，文案为“管理应用”；本机外部入口与服务创建表单/连接sheet分别处理。该合同目前implemented=false。Logo gate、native OAuth许可、扩展probe与codex_apps/HTML宿主保留具体返回条件，R2整页和全软件目标继续进行。
### R2 本机App模板资格、管理与读回（2026-11-16，本地阶段候选）

开工提交`424144674ff26c6ef373c475b6581f1a0757c069`，基准仍为Store26.1111.2228.0/package26.1111.21308。原始证据位于`.ref/parity/12/whole-page/actual/template-setup-r2-20261116/`。本单元属于第02批增量，不能据此放行插件整页。

| 范围 | 实现与可验证结果 | 边界 |
|---|---|---|
| 真实模板 | `plugins.ts`严格解码实际CLI的必需appTemplates数组；metadata按真实ID完整分批读取，只有明确unsupported才回退完整app/list | 不按名称匹配、不把坏响应变空；内部服务详情的raw边界保留 |
| 资格与身份 | 新`plugin_template_setup.rs`固定只读GET，解析真实release.app_templates中严格can_setup===true；client核账户、路由与代次 | FakeTransport不是账号HTTP成功；不套相邻version gate、不把缺字段当false |
| 呈现 | `LocalPluginApps`与`PluginTemplateRows`保原始顺序及真实materialized IDs；generic Header无数字badge；加载、读取错误位于Uses前且保raw行 | “正在加载设置…”、“无法加载插件设置”、“重试”；初始资格未就绪没有可用管理链接 |
| 管理动作 | 点击前fresh同身份资格；保原remote ID生成固定外部URL，单模板hash按全部模板数判断 | bridge ACK只证明外部打开请求，不能视为已连接、已创建或已materialize |
| 返回读回 | 外部打开ACK后第一次focus委托原父页同source `plugin/read(reload)`，失败只读重试 | 项目一致性适配，尚无官方专用focus producer证明；不伪造web callback或计时成功 |
| 生命周期 | 详情、来源、账号、视图、取消/卸载和blocked变化使旧请求退休；false→true→false不得恢复旧管理动作 | 禁用竞态内存真实复现外链1次，纳入scope后原用例与新尝试均通过；未实际打开外链 |

当前已核：主合同11资源45锚点、metadata/ID合同5资源22锚点、行样式16片段及额外3条Header/loading CSS声明。严格文件hash/UTF-16原文核验通过，共15个唯一资源；未重算整包hash。

检查范围与阶段状态：

- 5项模板Rust专项及全量959 Rust通过（0失败/忽略/过滤，138.80秒）。之后只改`LocalPluginApps.tsx`和Included CSS，Rust输入未变。
- required DTO、原ID边界、标题计数/语义、loading/raw行、禁用状态竞态均保存真实红与绿。早期只检查字符串的计数断言漏掉数字节点，已补实际badge节点断言，原漏检记录保留。
- 环境配置CLI0.159.2的隔离plugin/read样本经真实生产解码器通过；非Fast标准显式指定进程级CLI0.165.0，34个隔离协议探针及完整标准退出0，未改全局配置。CLI路径、版本和hash单独留证。
- blocked补丁仅2行TSX scope；标准与一轮229前端开始于补丁前，准确输入差异单独保存。补丁后定向回归、TSC和完整229前端通过；标准后续TSC/生产构建与新EXE/MSI/NSIS均在补丁后完成且退出0。548最终产品输入在原生构建前后稳定，Rust输入未变，不称959 Rust在TSX补丁后重跑。

本阶段候选`dist-artifacts/plugins-r2-template-setup-20261116/`：

| 产物 | 字节 | SHA-256 |
|---|---:|---|
| CodexNative.exe | 32,148,480 | `33a6e48e7812fe54bc90c731c52db48108192724dc482b4375d32d4e7140738c` |
| Codex Native_0.2.0_x64_en-US.msi | 10,268,672 | `568486f66498ab3aeebcbcda8d79fd8546b86df58f5f9b5464516c8391a2a37d` |
| Codex Native_0.2.0_x64-setup.exe | 6,881,162 | `74f8f760bab249d1cfada4651cbad8aa2b7fb3161490a80c9b57bb44b9124ae8` |

输入清单SHA-256 `6a6ee3e8517ff0119f205156d046be8a180d7acbeca3cb8ac44604af09276702`；源码绑定、检查范围及原始日志见该证据根的candidate-artifacts/verification-summary/post-check-patch。构建含现有dead_code警告，不将其写成零警告。阶段仅本地提交，不推送/发布；没有同提交托管CI结果。

功能回放/协议与真实HTTP、视觉和原生验收分开。没有真实账号模板GET、网页创建/返回传播、native OAuth、官方配对图、物理IME、原生GUI、同提交托管CI或用户验收。score=null。环形loading使用代码几何，动画CSS取同版声明；原生可见性暂停生命周期、精确glyph/ghost/图标/阴影及物理像素仍未验。可选metadata失败提示是恢复适配，不冒称官方页面原文。

通用服务模板的创建表单/连接sheet、callback许可、扩展probe、Logo gate及codex_apps/HTML宿主留R2返回队列；本机管理外链不能替代这些分支。

返回队列的下一步已做有界取证，不继续以解除禁用代替主链：

| 未完成分支 | 缺少条件与恢复入口 |
|---|---|
| 通用服务模板/OAuth | 真实typed创建响应、连接sheet消费者、自有callback/client许可和凭据生命周期；按模板合同恢复完整创建→认证→读回，不能只instantiate留下假成功 |
| 本机codex_apps设置 | 真实mcpServerCapabilities、gate2155714554运行值、精确owner/target；恢复后完成发现→读取→单字段写→finally读回→释放。现CLI schema能表达toolListMeta不等于当前账号具备能力 |
| hosted结构化设置 | 专用认证MCP transport和view/真实link producer；不能猜HTTP端点或借本机CLI代替 |
| HTML/设备权限 | 资源、初始化/消息方向、origin/CSP/sandbox与permission持久化及生命周期完整合同/宿主；不能以普通iframe或系统权限flag替代 |
| 扩展和Logo | 真实扩展probe及Logo门控producer；不能用空apps或默认true强开 |

特殊宿主证据`r2-special-host-next-contract.md/anchors.json`另核4资源15原文片段通过。以上输入未具备时保持未实现/未验并进入第03批集成候选，保留返回队列，不以同一依赖无限拖延后续桌面能力和Sites调研。
