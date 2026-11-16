# 12 插件整页合同与R0/R1执行

2026-11-16，开发前记录。整页状态为调研/开发中，未通过官方运行时、像素或用户验收。[总计划](../../FULL-REPLICA-PLAN.md)R0/R1→R2，旧12-13D的26.1027位置不沿用。

## 基准与证据

本轮读取Store版本26.1103.4239.0，重新计算app.asar SHA-256为`fb47d6491dc3006b708cb1e14de479b882bf50f88b7daa81818f154c253266aa`。当前固定版目录/管理证据位于`.ref/parity/12/whole-page/reference/r0-20261116/`：report、manifest（补证后143条目integrity/大小/hash）、anchors（补证后19关键UTF-16锚点）、zh-copy及home/schema/install/directory-search补充合同。数字不是物理行号。

当前官方文档：[技能与插件](https://learn.chatgpt.com/docs/skills-and-plugins)、[插件开发](https://developers.openai.com/plugins)支持插件可组合技能/MCP及共享目录；具体界面与门控以固定包为准。当前文档不替代旧版运行时证据。

## 来源结论与区域树

普通Codex目录：页面头/副标题及管理→插件/技能入口→目录来源tabs及搜索→已安装图标条→分类卡组→独立详情。紧凑壳另有sticky/search分支，不能与普通版混用。

- `514115.8fbb427cba.js`：普通页头inset/page/medium，搜索autoFocus、id=`plugins-store-page-search`，query保留；真实已安装图标条。公开/工作空间/团队/个人根据账号与内容门控，不强开。
- `772864.6475793667.js`：远端开关优先feature列表`remote_plugin`，缺项才读Statsig4218407052。真时ChatGPT资格下GET `/ps/plugins/home`的sections；假时`plugin/list {marketplaceKinds:["local"],cwds:resolvedRoots}`本地分类。undefined是加载/未知，不能当false。远端首页不混入本地市场分组。
- `704837.a97a7a5782.js`：目录卡包含已安装，36px logo、标题/单行描述、条件来源；未装icon安装按钮，已装状态/管理。点击进入独立详情，安装stopPropagation。普通卡无版本/认证/路径metadata表。
- `565116.d530028e70.js`：目录grid默认单列，容器581CSS px双列，横gap24/纵gap8。
- `548929.7a0b4cbb28.js`：管理候选plugins/apps/mcps/skills/marketplace；MCP常驻，其他按真实计数/宿主能力。不是固定删为三tab。保留已接通的管理链路。

## 动作及修改前验收预期

| ID | 动作 | 可观察预期/真实结果 |
|---|---|---|
| P01 | 打开插件目录 | 聚焦搜索、读真实目录与已安装；目录不是安装管理面板 |
| P02 | 搜索/清除 | 不过滤已安装；卡片与已安装状态一致；原始目录和作用域不变 |
| P03 | 打开已安装项 | 进入对应详情/管理，不触发安装；同名不同market身份不合并 |
| P04 | 点击目录卡/键盘Enter或Space | 独立详情工作面，列表不再内联metadata；返回保留搜索与可见列表 |
| P05 | 图标安装 | 可访问名称“安装 {name}”；只安装一次，不同时打开详情；既有权限/准备/读回继续生效 |
| P06 | 已安装状态 | 不显示再次安装；以真实installed/readback决定，不以点击或toast冒充 |
| P07 | 刷新目录 | 强制重读当前目录和库存；错误保留可见重试，不仅刷新库存而留下旧目录 |
| P08 | 账号/工作区变化/离页 | 旧目录、详情、错误与晚到安装结果不能污染新身份；关闭后释放监听 |
| P09 | 目录/设置管理互跳 | 管理只导航；既有启禁/卸载及动态tab保留；不多一层installed/browse目录开关 |
| P10 | 宽窄/长描述 | 源断点、logo、单行描述与层级正确；真正像素需配对图 |
| P11 | 远端资格/目录切换 | 仅真实gate和账号支持才读相应HTTP；未知不伪造公开/工作区目录 |
| P12 | 安装失败/授权等待/未知结果 | 真实结果读回；不把打开OAuth外链当已连接；取消不重复写 |

## 实施边界与依赖

已证实的本地目录/已安装呈现、卡片动作和列表→详情→返回可先开发，复用现有协议/锁/身份保护。远端home schema、分类分页及详情精确URL模板已在下节补证，官方焦点仍待取证，不能因局部可开发而放行完整R2。不得将默认混合plugin/list强命名为公开，也不删除已有远端能力来伪装完整。

### 后续取证后的可开发合同

- 首页GET `/ps/plugins/home`无query/body，使用CONNECTOR_SETTING/plugin_directory。flat listing不是完整inventory/release；同id栏目合并，首页仅展示前六，不能以此小集合代替全目录搜索。未就绪库存不默认未安装，未知安装策略不默认AVAILABLE。
- 主目录搜索trim并200ms debounce；本机`plugin/search {searchTerm,cwds?,cursor,limit:50}`，此调用点省略scope。仅精确缺方法允许完整本地目录回退，权限或网络错误不得降级。真实私有CLI0.159.2探针返回搜索实体，未发送模型turn。
- 分类GET `/ps/plugin-categories/{slug}/plugins`，scope=GLOBAL、limit=50，可选q/pageToken；解析flat plugin和pagination.next_page_token。分页失败保留已读结果，作用域改变拒绝晚回，不无限追逐循环游标。
- flat row首次详情ref使用raw ID和`chatgpt-workspace`；完整详情读回后使用其真实marketplaceName/path安装。有path使用本地name，无path使用remotePluginId，不能以display_name替代。
- 完整HTTP metadata为GET `/ps/plugins/{raw_id}`直接plugin body；hosted安装只适用durable，其他本机走CLI，不能按requiresLocalExecutor猜host。当前入口缺host选择合同，显式非空hostId深链拒绝，不悄悄落本机。
- 详情URL为`/plugins/{encodeURIComponent(pluginId).replaceAll("%40","@")}`，pluginId与read参数pluginName分别验证；来源/query经过URLSearchParams序列化。保留browse状态与真实前后退，不让旧详情晚回替换新路由。

来源索引：同证据目录的`home-schema.md`、`install-contract.md`、`directory-search-contract.md`及对应锚点。HTTP只读传输的注入测试、CLI私有探针和真实账号请求分开记录；前两者不能证明真实账号远端链成功。

R1三桌面能力同版资料在`.ref/parity/16/whole-page/reference/host-r1-20261116/`。Computer Use Windows使用实际allow-list配置；Appshots需要helper protocolVersion=1/windows_appshots_v2及目标/捕获/文本/热键消费者，双Alt和60秒路由均有源。浏览器需要原生session服务。仅静态可行性，不依赖复制官方binary、未运行helper或修改用户配置。

## 本轮真实探针

`verify-plugin-management-b.mjs`与`verify-plugin-preparation.mjs`在私有CODEX_HOME/目录分别退出0，安装/独立详情及installed读回、启禁CAS/冲突、卸载与市场移除读回均有结果，0模型turn。证据`.ref/parity/12/whole-page/actual/r0-20261116/`。本地夹具验证协议消费者，不等于远端账号或官方页面通过。

首批合同发布时的剩余：远端首页/分类/来源tabs、完整独立详情及深链、官方资产与精确呈现、原生正常链路、同条件图/物理IME和用户验收。后续已执行结果在整页验收记录续写，不把此历史清单当当前全部未实现项。

## R2-C 详情、技能预览与草稿的开发合同

在首批目录集成之后补证，不沿用首批候选的界面判断。固定包定向追加3个shared布局/token资源，manifest共146项；新增`detail-contract.md`（PD01–PD24）、`detail-composer-contract.md`、`detail-style-contract.md`、`legal-contract.md`及原始锚点。原始中文来自同版1561语言包，不能把英文defaultMessage直接翻成自定文案。

- **显示顺序**：header → 真实starter prompts/非重复长说明 → included → Information → legal；没有内容tabs。长说明优先interface.longDescription、detail.description、shortDescription；tagline优先shortDescription、description、longDescription。相同内容不重复。
- **展开**：说明按真实渲染高度折叠到15显示行，能力文本3行；aria-controls/expanded对应正文。尺寸/字体变化重测，切实体及卸载清理观察器；未知动画曲线不自定180ms当官方时序。
- **提示词**：完整summary.id生成`[@displayName](plugin://summary.id) prompt`，只到真实首页草稿，保留项目与导航守卫，不自动调用模型。未安装先安装并确认，已禁用先启用并确认。远端目录来源不是HTTP执行宿主，只有真实service实体走其变更链；读回/运行时失败、身份或详情变化不得起草。
- **技能**：先真实path、再限定协议名、最后唯一标准化候选匹配。详情技能列表不等于已安装；无匹配只读预览，已装且非admin才开放真实metadata开关，试用另要求实际enabled与路径。内容按已装路径/详情真实路径读取；无路径仅真实remotePluginId与真实market名称读取，不拆猜插件ID。
- **included**：当前可接Apps、MCP、Skills、Hooks，保持此相对顺序；不以MCP字符串造开关、不以hooks数量造信任状态。复用真实设置导航及既有安装响应驱动的连接准备；账户、模板管理、调度和依赖服务仍须独立补齐。
- **信息与法律**：Information要求interface存在且至少有真实信息，使用有序dl；网站缺失显示不可用，其他空字段隐藏。legal按实际apps及严格验证的未配置模板计数，使用同版中文和真实帮助URL；Google仅精确应用ID或对应应用真实branding.developer。不从名称或插件开发者推断。
- **资产与布局**：header图标框硬值60px、信息标签列120px已核；共享图标从HTTPS或真实本地路径读取，不能用路径直接当img URL。字体/间距/容器的rem静态来源没有固定根字号，当前局部R=16换算为候选（内容768px、容器384px等），标题18px亦待最终cascade实测，不能称1px通过。背景PNG路径已找到，许可未知，未复制或自造渐变冒充。
- **错误状态**：loading优先；真实error显示“无法加载插件”，独立详情EmptyState没有额外Retry；missing显示“未找到插件”。`missing_plugin_path`只是遥测分类，不把网络或权限错误改判不存在。保留返回后重新进入读取，管理面旧重试单独处理。

ON_USE且无显式app setup的普通提示词可先起草，不把有apps本身当授权前置。ON_INSTALL/显式要求setup的分支，当前没有足够真实授权完成证据，不能因catalog可访问或runtime callable就宣称OAuth完成并自动跳转；必须保留待准备状态，后续按`connection-completion-contract.md`接真实callback交换与最终link验证。模板字段无法验证时不当作未配置模板；因此部分legal计数仍可能受缺数据限制。上述均是整页残项，不降低最终复刻要求。

## R2-C 来源标签、Personal与已安装图标条合同

仍使用同版146项资源，原始补证为`directory-tabs-strip-contract.md`、`directory-origin-contract.md`、`personal-groups-tabs-contract.md`及其锚点。以下是开发输入，不代表真实账号或像素验收通过。

- **来源资格**：公开始终存在；工作空间由真实选中账号structure决定，使用真实名称。Personal在分组确定为空且未显式选择时隐藏；加载/错误不是空。Teams必须另有真实gate及团队分组证据，目前不强开。
- **导航**：`directoryTab=openai|workspace|teams|personal`；切换只改此query，保留pathname、其余query和hash，push历史。分类使用`plugins-created-by-you`、`plugins-shared-with-you`或`plugins-marketplace-${encodeURIComponent(realMarketplaceIdentity)}`；标签role/selected/roving焦点、方向键环绕、RTL、Home/End按同版合同。
- **数据**：Public首页flat结构与来源完整release结构分开。Workspace50分页，跨已载页收集template引用再过滤；Personal首页USER9、workspace-created9、workspace-shared50，完整Created以USER和workspace-created双游标独立推进，已结束流不得重读。身份变化、离页取消与晚回不能覆盖新来源；失败不伪装空页或回退到另一个账号。
- **本地分组**：真实OS home下`.agents/plugins/marketplace.json`对应市场归Created，不用CODEX_HOME或当前项目替代。路径比较只做官方扩展路径前缀、slash与lowercase处理；分组身份仍保留原始path或`remote:<name>`，同名异path不合并。其他市场各组显示；首页每组最多6项，分类展示完整结果。
- **已安装条**：44px槽、36px图块、溢出槽包含剩余前四缩略图及剩余计数。依实际宽度测量，宽度未知不伪造容量；loading/error/空分别处理。链接使用真实详情来源，普通主键点击在当前窗口打开；修饰键/中键保留a默认处理，不编造原生新窗口IPC。测宽监听及resize观察器卸载清理。
- **详情读回**：已安装入口与深链同样核返回summary实体，使用读回marketplace更新详情操作上下文；错实体显示读取错误，不开放安装或管理错误实体。目录元数据不赋予安装、启禁或HTTP服务管理权限。

验收至少覆盖来源资格、Personal确定空/加载/失败/显式深链、本地home归属与市场ID、摘要6项、双游标和跨页模板、分页单飞/失败重试/循环标记、账号切换晚回、标签键盘、已装宽窄及溢出、修饰链接和错实体拒绝。真实账号HTTP、官方配对图、原生GUI/物理IME与Teams gate分别记录，不用离线回放代替。

同名本地市场使用精确label分组，标题为`label · subLabel`，其中subLabel采用全重名组可唯一识别的最短路径后缀；显示路径保留大小写，不能复用home匹配的lowercase。来源身份仍用原始path。官方别名及排序有同版锚点，不能从任意包含OpenAI的名字推断官方身份或权限。

后续授权补证将同版参考manifest扩至152项，另有AppxManifest记录。`oauth-initiation-contract.md`和`native-callback-host-contract.md`确认begin请求、服务返回state、窗口归属与官方`codex://connector/oauth_callback`链；该协议归官方Store应用。本软件自有callback/client资格尚无服务证据，不能注册/占用官方scheme或以installUrl、账号登录事件冒充授权完成。管理面下一包使用新`management-contract.md`及其同版锚点，不能把目录tablist语义套到设置管理segmented控件。

## R2 管理工作面本批开工合同

依据`management-contract.md`、25段原始锚点与241条同版中文，先修一次页头、管理分段分类/计数、1024px搜索断点、紧凑行及管理详情返回；保留真实启禁、未知结果核验、市场移除和MCP草稿保护。其余Apps/Skills/市场表单与宿主分支按合同继续补，不以此批布局修正代表整页完成。

- 只保留一个可见“插件”页头，副标题“管理插件、技能和 MCP”，动作是浏览目录/按能力添加。嵌入管理体不再绘第二个可见标题或固定窄内容列。
- 分类为group/aria-pressed普通按钮，计数在搜索前取得；MCP永远可选，当前MCP不能因数量为0自动跳走；插件feature显式false才只留MCP。窄窗直接不渲染搜索，宽窗根据分类显示对应中文。
- 插件紧凑行36尺寸logo、可收缩文本列、单行描述、独立开关和右箭头；不再默认堆放版本/ID/目录路径和卸载按钮。来源及完整信息留管理详情；toggle不导航，不可用/admin/写入中按真实状态禁用。
- 管理详情采用独立管理路由与来源读回；不能把目录详情路径直接套用。返回保留host与真实上下文；卸载只有真实确认且仍同一详情时才返回，重复/晚到写不能切走新页面。
- 修改前用生产函数/组件回归锁定MCP默认保留、分段语义、搜索断点与跨分类草稿、紧凑行开关独立、详情身份/返回和卸载守卫；随后宽窄原生观察。缺官方配对图仍score=null，物理IME另验。


### 当前26.1111基准与首市场添加

本批官方已升级为Store `26.1111.2228.0`（package `26.1111.21308`）。独立只读快照与manifest位于`.ref/parity/12/whole-page/reference/r1-20261116-current/`，asar SHA256为`2551cba1057a05cdc5cf5d75b146fac4092bff4ce77a10c43e3286c88d24c82d`。旧26.1103证据保留，不自动升级为当前版验收。管理基础规则逐项对照见`management-behavior-compat.md`，添加弹层见`add-marketplace-contract.md`与原始锚点。

- 添加市场弹层独立于分类和库存数量，初始空值；来源、Git引用、稀疏路径三个字段从打开起可见。来源必填；解析只trim，稀疏路径按逗号/换行拆分去空，保顺序与重复。
- 普通状态可关闭、取消和外点，提交中隐藏X并禁关闭/重复提交；失败保留值，只有当前解析参数与失败参数相同时呈现该错误。成功reset并关闭；账号/项目/host变化清空，不接旧请求结果。
- 添加写入ACK后真实刷新库存与管理；刷新失败独立提示“市场已配置，但刷新插件列表失败”，不把已确认添加当写入失败，不重复写。服务返回的marketplaceName交给App受导航草稿guard保护的回调。
- 官方Add写`directory=personal`与主目录正文读`directoryTab`存在静态不一致，真实落地选中仍待官方实测；不擅自补双query或宣称Personal正文已验证。
- 此次父子回归验证独立弹层入口、精确请求参数、写失败抛回弹层、ACK后刷新失败和账号晚回隔离；独立弹层专项验证提交/关闭/错误状态。生产浏览器/原生宽窄、官方配对图及物理IME另验，不由回放替代。


### 当前版管理详情接线与未接区域

当前合同为r1基准`management-detail-contract.md`（22锚点）与`management-mcp-contract.md`（9锚点），模板原始DTO及消费者另见`template-dto-contract.md`。本轮接独立header/面包屑、复用实测三行展开、真实包含项和末尾About，替换旧原始ID/认证策略信息卡。已有目录技能归属、真实内容读取、启禁与admin保护复用；管理预览不附目录Try和单独卸载所属技能动作。设置内Hooks/MCP入口接已有带草稿保护的分区导航。

本机“查看详情”按当前CL来源生成真实ID、host、marketplacePath或remoteMarketplaceName及读取名称，缺无path远端ID时不猜名字；守卫接受后才一次push，离页/换实体后的晚确认不能抢回导航。service无host路由的完整header跳转另待合同，不以本机路径替代。

卸载按当前执行Host与service分支区分：执行Host不额外弹确认；默认安装保护条件为remote source，不能把所有local默认策略一律解释为管理员安装。service真实库存与管理员策略、确认/取消继续独立处理。已有ACK后完整库存读回、未知结果只读恢复、scope与route ABA隔离保留；新PMD10先失败后修复。

未接区域明确保留：Apps完整管理/权限与sync、自定义插件Settings工具视图、Meetings专用设置、准备状态完整consumer、MCP app/config精确映射与toggle、未实例化模板资格及服务CTA。当前CLI0.165生成schema证实AppTemplateSummary/ScheduledTaskSummary可补类型，但raw没有canSetup/rrule/group；当前包计划group hook为空，不按猜测填模板或造启用动作。没有这些区域的typed消费者不等于官方不存在，也不计本轮完整通过。

### 管理MCP接线补证与开发中结果

上述MCP残项已开始接线，尚未进入新原生候选验收。开工合同见当前固定基准的`management-mcp-supplement.md`；新增976185资源已核snapshot header integrity，manifest现25项。DBCl.ycq→ZRtB.yc只取host根列表第一项，无根则null；hOO0.$只转换大小写精确的`asdk_app_`前缀。np传给nh的是KtvL的完整`directoryApps`，不是应用包含区的nj投影，也不是detail.apps子集。

- 本机管理详情复用真实config/read与app/list全分页；按同版manifest版本资格、空Map与首匹配顺序生成App或config行。配置首匹配不证明插件ownership，同名碰撞必须保留原对象顺序和实际key。
- 只有真实configKey才有开关，管理员禁用、pending与结果未知时不能再写。复用config/value/write的默认用户文件、null版本与upsert；含点/引号/反斜线的key沿既有quoted path语义，不能点拆成另一服务器。
- 点击后显示乐观状态，随后读取真实配置；失败采用实际读回状态，读回失败只读恢复，不重复写。连接、来源、详情变化及A→B→A不接旧回调。
- 完整应用目录读取失败仍可显示真实config匹配，独立提示目录失败；配置读取失败不是空列表。被识别为App的行不生成generic开关；完整App导航、连接与权限消费者仍待下一包，不能错接MCP设置冒充。
- 目录模式沿用既有包含项显示，本次只接settings管理模式。设置向下传host根列表，MCP读取第一根而非活动编辑目录。

映射、生产hook、生产组件及父子接线回归和真实隔离协议探针已执行，详细范围见验收记录最新条目。新接线的原生GUI、物理IME、官方配对像素及真实账号仍未验；上一管理阶段EXE不能覆盖这些新源码。

### 全局插件权限与结构化设置的下一包合同

开发前补证文件为当前固定ref目录的`permissions-write-contract-v2.md`（20锚点）和`plugin-provided-settings-contract.md`（18锚点）。全局权限必须真实personal账户且完整service库存有CV1W.D5合格对象；模板instances空数组不等于null。无资格replace管理root，读取失败显示重试，不能以错误冒充无资格。GET settings/user读取默认，nullish使用review_important_actions；全局仅前三种权限可写，full_access仅允许显示已有值。PATCH account_user_setting固定feature/value query无body；同值/pending不写，真实读回后更新，结果未知先只读恢复。关联账户权限有独立链接owner/身份和PATCH body合同，不用全局endpoint替代。

结构化设置只消费真实serverCapabilities声明及工具目录，installed且归属当前插件才显示；普通server与codex_apps/hosted分开。read({})获得严格schema/values/layout，update({set:{单字段}})成功或失败后均readback。用专用ephemeral工具上下文，不借聊天thread、不发turn；官方permissions/threadSource创建参数须先通过私有CLI探针。标量控件/菜单/blur或IME保护Enter按原始合同实现，不做任意JSON编辑器。HTML/MCP App资源设置和设备访问宿主另有依赖，不用普通iframe或假camera/mic开关替代。

两项均须生产client/hook/控件回归、scope/晚回/未知结果保护和私有真实协议/离线HTTP探针。上述是本包开工预期，不表示产品已完成、当前账号服务可用或原生/像素通过。

复核纠正：当前宿主`M8/readAccounts`的`/wham/accounts/check`直接返回标准化`accounts[]`，不能复用旧模块的raw map夹具。OAko.YL先按`account_ordering[0]`查数组中的`id`，页面再要求其id等于当前账号且structure=personal；缺合法可选数组/排序只代表无资格，错误类型才是读取错误。不展开“default”别名，不从其他排序账户借资格。P21–P23原始宿主/消费者锚点已补入合同；当前manifest35资源、47段本包新锚点及header integrity重新核验。旧通知/用量模块的类似假设留R5按各自真实生产链复核，本包不顺手修改。

结构化设置已接普通本机MCP分支：完整状态分页发现→真实归属/能力/工具→共享ephemeral工具上下文→严格标量表单→单字段set→成功或失败后读取；菜单、IME保护Enter、原生输入约束和无参action已接线。带UI资源的action、codex_apps/hosted、MCP App宿主、设备权限、自动Transport closed恢复仍未接完。工具关闭后不冒称已取消服务器执行，在途请求结束后才释放临时线程；桥当前没有单请求30秒timeout，不冒称实现了官方timeout。

全局权限已接独立管理URL及typed本机宿主读写，保留四值读取/三值写入和真实读回；完整账号/link权限未接。`permission-entry-contract.md`未找到root可见权限入口的正证据，因此未添加自造header按钮；这不是完整UI入口闭环或真实账号通过。

### 第02批应用详情只读链开工合同（9661cf0之后）

固定同版来源继续使用，不新增猜测页面。337381的B→z→K分支先为独立`/apps/:appId`查真实关联插件，有归属才replace到`/:pluginId/apps/:appId`；无归属走独立Manage app，不套完整连接详情。完整连接/权限/sync属于tB分支，先接有真实service插件归属的只读数据，独立管理、连接及权限写入另行收口。

- 宿主按当前身份读取真实service插件详情，以精确plugin.id及release.app_ids/模板materialized_app_ids核应用归属；不以installed库存限制可读详情，不对未安装插件自造拒绝条件。只对精确`asdk_app_`前缀规范化，不接受renderer提供的归属结论或任意URL。
- metadata固定GET `/aip/connectors/{id}?include_actions=true`，返回裸connector；234277的查询select才包装`{connector,isTemplateInstance}`，不能要求服务返回`.connector`。metadata用settings surface，应用links固定BLOCKING POST、other surface及CODEX SKU。
- 返回仅保留详情/权限消费者已证实需要的字段及当前应用links，不把其他应用账户、凭据、原始actions搬入renderer。身份变化、取消、无归属、格式错误和读取失败不能变为空列表成功。
- CV1W.fD先按canonical connector_id匹配，再去HIDDEN/implicit_link；指定linkId命中优先，否则首个非REAUTH_REQUIRED，再否则首项。多账户资格由connector.enable_multi_links严格true决定，不按账户数量猜。
- 读取可编辑账户不代表已经授权写入。后续权限仍须当前personal账户、USER owner与真实userId、非REAUTH_REQUIRED及label资格；本包不开放任意link PATCH。

只读链回归PAD01–PAD06分别覆盖：真实插件/应用归属与未安装可读分支；canonical前缀及同名不同ID；裸metadata与固定请求上下文；只返回当前应用必要字段；账号切换/取消/错误；可见账户筛选和指定/健康/首项选中顺序。PAD用例与原始AD来源锚点分别编号，避免将取证片段当测试执行。真实账号HTTP、完整App UI、sync/OAuth、原生及官方配对像素均保持未验，不以只读宿主通过升级整页状态。

### 独立应用入口、账户身份与导航补证

新增同版`app-account-contract.md`、`app-association-contract.md`、`app-entry-fallback-contract.md`。自定义昵称来自`link.name`，provider身份依次取profile.email/name/nickname；多账户整行点击是rename而非选择radio。普通fallback和共享账户组件的最后账户断开限制、中文文案不同，不混为通用动作。

独立`apps/:appId`只将明确`plugin_id:null`视为无关联；缺字段、读取错误不走fallback。有真实pluginId使用replace进入所属详情，由详情再次验证materialized app归属。hczB.Fw仅作nullish分支，不证明归属。详情面包屑为管理根/真实插件名/当前App；detailTo仅是额外“查看详情”入口。

补证纠正早期资料中的“本机目录”称谓：**DBCl.iwv是durable**。明确无关联后BQbE.KA走hosted `POST /ps/apps/batch`，原请求ID单项数组、include_tools=false、SKU=CONNECTOR_SETTING、账号及locale；该调用未显式surface，不能套元数据settings值或用CLI app/list替代。snake_case apps按canonical ID精确匹配后保原请求ID；缺目标进入读取错误，额外应用不返回。随后metadata以原请求ID查询、CODEX/settings。此分支仅管理应用，不渲染完整插件连接/权限/sync树。

PAD07–PAD12新增验收：association的string/null/missing/error；原始ID编码和请求上下文；durable内容投影与图标fallback/其他应用隔离；元数据失败保header；replace导航及账号/路由ABA；包含项与MCP映射App行走独立入口且管理员禁用。完整Manage app写控件、账户重命名/关联、当前用户身份fallback、hosted主详情数据及区域资格仍须后续同页收口，不能以只读首包算完整App详情。

独立复审补正PAD01：materialized归属失效使用专用`app_not_in_plugin`结果，客户端先后验当前账户/用户/generation，状态层清旧快照，仅当前plugin/app/detail及无host路由才replace回对应插件详情；真实HTTP403、网络错误不能触发该跳转。手动点击插件祖先仍push。hosted重复canonical ID按BQbE.w的Map语义保留最后项，不能自造“歧义”拒绝；原始metadata请求ID与canonical身份比较分别处理。

### 账户重命名与选择工作包（36e222d之后）

开工依据为`app-account-actions-contract.md`及13个同版源码锚点。rename仅以实际多账户资格开启，不添加personal、owner、email、管理员或REAUTH_REQUIRED门禁；实际连接/断开进行中的忙状态在对应消费者接通后合并。本包不造OAuth或断开菜单成功。默认认证及精确provider特例按NT/H9核：NONE/API_KEY且无真实可重新认证link时隐藏账户区；supported_auth缺失不能默认OAuth。

后端单注册、fresh插件归属/metadata/完整links→真实同App可见非implicit目标→`PATCH /ps/v2/links/{link_id}`，仅写trim后的name、Unicode码点1–64、CODEX/settings；同值不PATCH。ACK/未知交付均只读回验，不能靠缓存补丁或空ACK宣称名称已保存。回验失败/不同保持pending，仅显式读取恢复；同一scope写入单飞，取消/换账号/晚回不污染新页。

账户行多账户点击先选择并打开rename；非rename且兄弟多于一项时是选择按钮。URL只replace linkId，保留其他query，路由拒绝旧回调后不持久化。选中record按`[accountId,userId,实际metadata.id]`原值分区，null删除，最近写入移末尾并限100项，不把规范化身份比较误当所有原始ID都可覆盖。外层单账户详情fallback与共享账户区显式选择分别处理。

弹层字段/关闭/焦点/IME/校验按原eo；本项目增加的未知结果仅读重试单列为恢复差异。PAA01–PAA08覆盖真实请求与读回、资格/隐藏条件、空白/64–65码点/同值、单飞及结果未知、scope/ABA/旧finally、URL与100项持久化、弹层关闭渲染时序、真实403与归属失效。真实账号HTTP、原生IME、官方同环境像素及完整More菜单/关联/断开/权限/sync仍未验或未接，不升级整页状态。

补核同版中文和el行语义：rename可访问名为“重命名 {identity}（{nickname}）”，仅实际不同昵称存在时加括号；选择按钮为“选择 {identity}”，不同昵称通过自引用按钮id和昵称id的aria-labelledby合并。非选择身份区域是group，认证过期说明通过aria-describedby关联；不是仅放一个无归属sr-only文本。PAA09先红复现遗漏昵称，再绿验证真实生产JSX。四个精确来源片段在本包证据`account-accessible-label-anchors.json`，此项不证明屏幕阅读器原生实测或视觉一致。

下一同页工作包输入是`app-account-disconnect-contract.md`与13个源码锚点/10个中文键。共享账户More依次为适用rename、适用reconnect、危险色断开，align=end/contentWidth=xs；断开先选中实际link，再直接调用DELETE `/aip/connectors/links/{link_id}`，无body、settings/CODEX、204允许空响应，无确认层。成功后的选择回退、账户变更成功提示与独立刷新失败分别处理。EF5T共享区允许最后一项断开，tB普通fallback限制最后一项，独立ManageApp没有此link入口；不能混成一个通用last-account规则。本项目仍保留强身份及未知交付仅读恢复。准确图标矢量、真实账号服务和原生/像素尚未证实；该合同是下一包开发输入，不表示断开消费者已实现。

断开包开工：仅接EF5T共享账户区，菜单rename/断开与现有真实重命名共用账户身份；reconnect尚无完整自有授权消费者，继续明确缺控件，不造不可执行的成功路径。DELETE前先接受受保护的URL选择；backend fresh归属/唯一link确认，不按multi或owner限制断开最后账户。完整真实links中目标消失才返回confirmed；隐藏目标不算消失，partial读取不解锁未知写入。确认后同App按首个非reauth/首项/null回退，last空列表只刷新本App数据，不导航、不卸载。DC-T01–10对应后端transport、实际client/hook、生产菜单/页面/父级回归；真实账号、原生和像素分别保留未验。阶段先定向回归，集成稳定后统一检查/构建，不逐菜单项反复跑全套。

关联权限下一包补证纠正：`app-link-permissions-contract.md`的22片段/26简中文案/6资源已核，337381的e$权限摘要组件实际`return null`；父条件分支和onClick存在不能证明有可见入口，旧app-detail文字中的可见摘要推断以此纠正，禁止造按钮。深链eq仍完整可开发：四radio含full_access、继承默认可写显式override、reset写null、mixed多账户列表与uniform统一模式、URL未知linkId空targets禁写不fallback。返回清linkId是否留当前页由实际K决定。此为下一包输入，不表示权限消费者或真实服务已实现。

关联权限包开工：补证现为7资源/30精确片段，隐式App严格按pS唯一候选→CV1W.Ok完整库存归属→必要canonical-app反向核验，不能取首app。显式路由仍fresh成员核验。新typed读保personal/可见账户/默认值独立错误；逐link PATCH仅四值或显式null，backend ACK不当保存，client整批settled后统一fresh读取确认。明确拒绝只重试失败ID，未知交付先只读恢复，成功项不重写。页面按LP-T01–13完成mixed列表/统一radio/指定linkId及同有效值的显式override动作；父summary与查看详情实际都未传递可见结果，不造入口/按钮。requires-local隐式宿主资格尚缺真实消费者，返回专门未支持错误而不猜支持；labels缺boolean wire证据不擅自放宽。真实账号、原生、像素及用户验收分别保留未验。
