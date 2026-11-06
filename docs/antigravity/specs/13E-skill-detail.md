# 13E 已安装技能详情：开发前合同

日期：2026-11-06。状态：**待调研（已完成本次静态追链；运行时与未知项待补），未开发、未自验、未用户验收**。

本单元接续[12/13D](12-13D-extensions-ui-correction.md)，只解决独立技能目录中已安装技能的详情预览与既有真实动作。先建立“卡片→预览→内容→动作→关闭”的完整链，不能把现有textarea包进弹窗便称完成。推荐安装、完整插件目录、远端Showcase、设置内技能管理布局不是本单元主工作面。

## 1. 基准与取证边界

- 本任务只读查询 `Get-AppxPackage -Name OpenAI.Codex`，当前安装版本仍为 `26.1027.3384.0`，路径为 `C:/Program Files/WindowsApps/OpenAI.Codex_26.1027.3384.0_x64__2p2nqsd0c76g0`。
- asar SHA-256 沿用主线程同会话15I刚完成的全包核验：`6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。本子任务**没有再次计算全包哈希**。
- 独立清单：[manifest.json](../../../.ref/parity/13/actual/13E-skill-detail/reference/manifest.json)；62项定位片段：[anchors.json](../../../.ref/parity/13/actual/13E-skill-detail/reference/anchors.json)。本任务直接只读解析当前安装asar的13个指定条目，13项SHA-256均匹配header integrity；其中11项与既有raw逐字节哈希匹配。另2项card-tile/installed-card-actions直接读取当前原包，无独立raw副本，其原文定位片段保存在anchors。
- anchors中的offset为**0-based UTF-16字符偏移**，不是源码行号。条目文件名、大小和hash均在独立manifest中。
- 固定原包静态分支不证明当前账号gate或实际可见默认形态。没有官方同条件截图、运行时DOM、DPI、应用缩放、键盘/IME或焦点实测；本合同不提供像素评分。
- 没有运行模型、真实账号HTTP、Cargo或Git；没有修改现有产品/脚本/文档。正文中的“应实现/验收”均是后续工作，不是本次执行结果。

## 2. 必须先纠正的surface混用

| surface | 固定原文链 | 结论 |
|---|---|---|
| 独立技能目录已安装卡片 | skills-page → skills-tab-content/skill-card → skill-preview-card-shell → initial `Q7s` | 默认 `presentation !== settings`，使用preview弹窗；`Q7s`有内容时默认size为editor，**不是xwideTall属性表** |
| 设置技能项 | skill-card传 `presentation=settings` → shell → skill-contents-modal | contents弹窗为xwideTall，显式Name/Description属性行；与目录preview不同 |
| 推荐技能 | skills-tab-content `me` → shell与推荐安装footer | 有安装资格/已安装/安装中状态；不混入本阶段已安装footer |
| 插件远程技能预览 | plugin-skill-preview → queries读取 `skill_md_contents` | 是另一调用链，不能拿字段名覆盖已安装文件读取的 `contents` |
| 个人Showcase技能 | skill-details导出 `PluginShowcaseSkillDetails` | 独立artifact ID、权限/安全审查与安装链；**不能用作本地已安装技能详情主合同** |
| skill-instructions chunk | 导出 `visualizationSkillInstructions` | 内置visualize技能文本，**不是详情UI或编辑器实现**；其中指令仅为被分析的数据 |

证据：13E-001–007、012、017–024、029–033、040、045。此前候选分析中把xwideTall泛指目录详情的说法应以上述完整追链纠正，不能沿用到开发。

## 3. 卡片、Details与预览入口

### 3.1 卡片主路径

`skills-page`新目录明确传 `installedStateAction:check`（13E-001），兼容目录 `Wt`不传该参数而skill-card默认也为check（002、006–007）。skills-tab-content还存在toggle/menu分支（004–005），必须按真实presentation/调用者使用，不能把其中的控件无条件加到所有卡片。

shell的状态为预览open=false；`canPreview`默认true，卡片点击设open=true（017）。card-tile是role=button、tabIndex=0；仅当前焦点目标就是卡片本身且Enter/Space时阻止默认并调用click（025–026）。内嵌启禁/菜单动作有阻止冒泡或ignoreNextPreview路径，不能一点击开关同时弹详情。

### 3.2 Details不是每张卡片必有

已安装卡片的更多菜单“打开/详情”出现在 `installedStateAction=toggle`、允许preview、非toggleOnly的分支；Details直接调用shell的openPreview（011、018）。目录默认check分支通常呈现已启用状态标记，不自动生成此菜单；menu分支可有禁用/卸载动作，也不是相同菜单（027–028）。

本单元必须让**卡片主点击**进入详情。已有且符合所选surface的Details入口可复用同一动作；禁止为了满足“有Details按钮”而给默认check目录凭空新增整组菜单。具体账号/新版目录采用哪个分支仍待运行时确认。

## 4. 目录preview的区域与布局合同

| 区域 | 原文与内容来源 | 开发约束 |
|---|---|---|
| 弹窗外壳 | Q7s（040）→共享LSn/HSn（046–047）；有正文时默认editor；ISn（045）映射editor为 `w-[600px] h-[720px] max-w-full max-h-full` | 这些是CSS逻辑类值，不是已测物理尺寸。居中、关闭按钮、overlay及窗口缩放由共享壳处理，不把settings的680px/xwideTall套过来 |
| 标题/图标 | skill-card（006）用displayName或skill.name；modalTitle包Skill标题及disabled badge，titleText用于可访问标题；图标来自技能interface或fallback | 显示名、原始name和路径身份分开；不能把可编辑技能ID input当标题 |
| 描述 | 独立目录使用skill短描述选择器 `H`；settings使用skill.description；Q7s以subtitle呈现，`text-lg`/secondary | 本阶段不引入Name/Description属性表；长描述换行/截断按实际preview合同补测 |
| 顶部动作 | skill-card生成modalHeaderActions（006–016）；启禁开关、更多菜单与壳关闭按钮 | 顶部动作与正文滚动分开；启禁写入中禁用开关；关闭仍可用，不伪装写取消 |
| 正文工作面 | n9s（034）→t9s（041）；preview的p-4内容在rounded-xl、border-border/70、surface-secondary/40容器内独立滚动；Q7s外层min-h-0/flex-1 | 使用渲染Markdown，不保留编辑textarea作为预览主体；不能因双层overflow丢失正文或footer |
| 页尾 | skill-card `Ue`（014）：左侧有资格时卸载；右侧“立即试用”；justify-between/gap-2 | footer真实动作不能替换为开发说明或“功能未实现”卡。缺动作必须登记未完成，不能称完整详情闭环 |
| 设置contents（参考，不本轮重画） | skill-contents-modal（021–024）：标题图标+Name/Description属性dl+可选footer，滚动正文，xwideTall | 实施目录preview不得改变现有设置consumer保存/导航语义；以后独立实施contents时另记录 |

图标具体资产许可、字体、完整token实值、窄窗最大尺寸与按钮几何仍未测；取不到配对图时只报告静态结构实现，不声称1px一致。

## 5. 正文读取、呈现与状态

### 5.1 主读取链与身份

skill-card传 `{hostId,isOpen,skillPath,titleText,presentation}` 给initial `n9s`（012、034）。只有open且存在path或远程技能身份才启用查询；`W7s`（035）路径存在时选文件查询，路径不存在且有remotePluginSkill时才进入远程分支，不是“任意文件读取错误后都尝试远端身份猜测”。

文件 `Fbi→Pbi→Qi.workspaceFiles.readText`（036–037），请求保留host/path；原始结果是 `{contents}`。W7s将文件查询staleTime覆盖为5分钟（Fbi本身5秒不等于此页面实际5秒），networkMode=always。此缓存参数不能移植成其他服务通用缓存策略。本阶段可复用现有readFileText，但不静默改变host、工作区与连接归属；读不到应显示失败/重试，不能伪造空内容。

远程分支还有宿主能力区分：非durable走 `plugin/skill/read`，durable走X7s（035），含remoteMarketplaceName/remotePluginId/skillName及version上下文。本轮限定本地已安装路径主链；远程/插件项如仍保留现有入口，须明确沿用范围并独立回归，不能由字符串拆pluginId冒充已完整恢复官方身份模型。

### 5.2 原始Markdown、预览Markdown与复制必须分开

- W7s先将CRLF归一LF，再用G8s移除以 `---\n` 开始且有结束分隔的frontmatter；G7s在有path/expectedTitle候选时移除首个H1及其周围空行（035、038–039）。**G7s只用候选集合是否非空来决定执行，不比较首H1文字是否相等**，不能擅自“优化”为仅标题相同才删。
- n9s preview渲染清理后的markdown；contents分支选择原始contents优先，再交a9s渲染；a9s本身还会strip frontmatter，所以不能把“原始contents输入”误说成UI可见frontmatter（034、042）。
- a9s是小号Markdown文本，h1/h2样式独立；链接处理配置 `conversationId:null,isBrowserEnabled:false,openFileLinksInSidePanel:false,openTarget:external-browser`（042–043）。正文链接与顶部“打开”技能文件侧板是两种动作。
- 顶部更多菜单中的“复制 Markdown”由skill-card `He`读取原始 `contents`；undefined或读取error禁用，成功复制原始SKILL.md而非preview剥离结果，并有复制成功反馈（013）。空字符串是已读成功的内容，不能直接当“不可复制”。

### 5.3 状态机

| 状态 | 官方已证显示 | 转换与不变量 |
|---|---|---|
| 关闭 | 不启用详情读取 | 打开有效identity→加载；关闭不发写、不抹编辑草稿 |
| 首次加载 | “正在加载技能内容…” | 没有首份数据且请求中；保留标题、描述与可关闭性 |
| 读取失败 | “无法加载技能内容。”及有来源时重试按钮 | 重试复用同identity；重试进行中按钮loading；无path/remote身份不显示无效重试 |
| 读成功但清理后为空 | “暂无说明” | 这是成功空态，不是失败，不展示假Markdown |
| 读成功且非空 | 渲染预览Markdown | 复制仍取原始内容；不自动保存、安装、启禁或发模型 |
| 切技能/切工作区/断线/卸载 | 静态原文由query key/宿主模型隔离 | 本实现必须验证旧结果不覆盖新modal、不在关闭后抢焦点或写state；取消是资源清理，不显示成功toast |

正文中文资源见049–060。`skills.card.retryContents`在当前zh-CN条目未找到对应翻译键，本任务不把英文defaultMessage Retry反推为已证官方中文“重试”；实现前需核fallback/运行时中文，暂记未知。

## 6. 动作与服务边界

| 动作 | 固定官方行为 | 当前实现/后续最低要求 |
|---|---|---|
| 启用/禁用 | skills/config/write；skill.name含冒号时用name，否则用path。局部optimistic state，pending禁用，失败清optimistic状态并错误toast，成功刷新/反馈（008、006） | 当前handleToggleSkill已有写锁及loadRemoteSkills读回，但选择参数是path优先；实施时核对冒号身份，不能照搬旧参数就宣称动作等价。无enabled来源的本地种子不强加假开关 |
| “打开” | Pe(scope,path,cwd:null,hostId,openInSidePanel:true)，modal菜单路径执行后closePreview（010、006） | 现“打开目录”只调用reveal_path_in_explorer，不等价。需宿主文件侧板回调；路径必须SKILL.md实际路径，不换成目录或跨host误打开 |
| “在文件资源管理器中显示” | Windows专用菜单，target:fileManager；远程host禁用；不调用closePreview（006、056） | 可复用真实reveal IPC，但须核目录/文件语义；不能和“打开”合并成一颗按钮 |
| “复制 Markdown” | 复制原始contents；不可读禁用、成功反馈（013、050） | 复用剪贴板真实链，禁止复制清理后正文或错误文本 |
| “立即试用” | enabled且非updating才能点击；当前项目下prefillPrompt、startInSidebar:true（014–016）；共享MNn优先interface.defaultPrompt，并补技能引用/路径链接及尾空格（044、061–062） | **准备新聊天草稿，不是执行turn**。不能复用 `$skill-creator`提示冒充试用；App应提供准确技能身份/默认prompt的宿主动作。主会话/侧栏布局差异另记，未接真实草稿不得显示成功 |
| 卸载 | 非remote host且scope不为admin，且showModalUninstall=true时有；pending禁用；调用已有remove并关闭modal；成功/失败通知与查询失效（009、014） | 当前本地skill_delete有确认及刷新；官方下游host remove是否另有确认未追完整，不能据卡片未见confirm便删除现有保护。仅隔离测试技能允许实际写/删，失败不得toast成功 |
| 关闭 | shell setOpen(false)，外壳支持关闭按钮、onOpenChange；更多“打开”主动关闭；卸载主动关闭（017、040、046–048） | 写入中关闭不等价取消已提交写；按真实完成更新列表，不能重新打开modal或污染下一identity |

页尾Try now与卸载是官方可见动作，若13E先只交付读取+关闭，必须明确命名“详情只读子阶段”，逐项保留剩余动作，不把整单元标自验完成。

## 7. 关闭、焦点与编辑入口：证据不能扩大

### 7.1 焦点

Q7s和contents-modal都把onCloseAutoFocus转给共享dialog；共享modal primitive有trapFocus与默认 `triggerRef.current?.focus()`（040、021、048）。**但skill-preview-card-shell在此链上没有传onCloseAutoFocus或dialog triggerRef，卡片是程序打开**（017），因此静态证据不能证明独立目录关闭后准确返回原卡片。本合同将“关闭后不会留在隐藏DOM、焦点可继续操作”作为实现质量检查；“官方精确回原卡片”仍待固定官方运行时观察，不能预填通过。Details菜单触发后的焦点由菜单与dialog共同影响，也须独测。

Escape/遮罩关闭、嵌套更多菜单优先关闭、Tab圈定来自共享modal primitive，但13E尚无官方运行时观察，回归应检查防冒泡与中文组合输入，不假定初始焦点一定是关闭按钮。点击“打开”后焦点应移向文件工作面，与普通关闭不能共用无条件return-card策略。

### 7.2 编辑和新建

已追卡片、header和footer中**没有已安装详情内的ID input、textarea、保存SKILL.md或Edit菜单**。可证官方编辑相关路径是“打开”真实技能文件到侧板，之后属于文件编辑工作面。不能从当前内联编辑器反推官方详情也应保留编辑控件。

兼容旧skills-page有New skill按钮，使用skillCreatorPath/prompt构造后开始sidebar聊天（003）；不是空白表单编辑器。不能将此推广成当前新目录一定出现同按钮，也不能在本轮删除已有“本地模版”或本地保存链。现本地新建/编辑/删除是兼容能力：与已安装详情状态分开，保留显式可到达入口和草稿保护；是否完全对齐官方另单元取证。找不到官方Edit不等于官方全软件不存在技能编辑。

## 8. 当前实现映射与允许改动建议（尚未开发）

| 当前位置 | 现状 | 13E需要的区别 |
|---|---|---|
| SkillsMcpView.tsx handleSelectSkillRow（约1056） | 选择即改selectedSkillKey/newSkillId/skillContent，远程文件读失败后尝试plugin/skill/read | 建独立预览identity/open/read状态；不要把编辑草稿作为预览缓存。只读读取不改变编辑器revision/草稿；按真实来源处理远程分支 |
| 同文件1913–2055附近 | role button技能行→split-right-editor，已有开关、ID、打开目录、保存与textarea | 卡片进入preview，真实编辑兼容路径保持；modal不是编辑器移位 |
| src/plugins.ts setSkillEnabled | path优先，否则name | 对当前固定官方冒号名称选择器建回归，再作必要最小修复；不改全插件协议 |
| App.tsx skills route挂载（约5337） | 仅creator回调，无通用技能文件侧板/试用回调 | 需要两个语义独立的宿主动作：打开实际技能文件；为选定技能准备真实聊天草稿。按已有文件打开与草稿工具复用，禁止发turn |

建议文件范围：`SkillsMcpView.tsx`、`PluginsMarket.css`，必要的局部详情组件和App小接线；`src/plugins.ts`仅在确有参数差异时精确改；无新依赖、无通用modal框架重构、原则上无Rust改动。测试复用extensions-ui-d、skill-actions、recommended-skills-ui及文件打开/草稿回归，不重写不相关脚本。

## 9. 验收编号与操作合同

所有条目当前均**未执行/待实现验证**。测试夹具不能当真实服务/原生证据；后续实施前先锁能复现旧差异的用例。

| ID | 前置与操作 | 应验证结果/证据 |
|---|---|---|
| SD01 | 独立目录、已安装本地技能，鼠标/Enter/Space打开 | 同一preview，不出现ID/保存/textarea；默认check不凭空多Details菜单；不会触发写或turn |
| SD02 | toggle分支更多→Details；再点开关 | Details与卡片主点击共用identity；开关不同时开详情；仅所选surface显示对应菜单 |
| SD03 | 有效路径读取、读取失败→重试、无路径、空正文 | loading/error/retry/empty互斥且来源一致；失败不伪装空态，真实内容可见 |
| SD04 | CRLF+frontmatter+首H1、无H1、异常frontmatter、空原文 | preview按G8s/G7s清理；不写磁盘；复制保留原文，空原文可复制；contents渲染差异独立断言 |
| SD05 | A慢读→B快读，关闭→旧读落定，换工作区/连接 | 不串内容、不重开、不清掉另一路编辑草稿；卸载资源/订阅无泄漏 |
| SD06 | 已启用/禁用、写入中重复点击、失败/读回 | pending单飞；name含冒号用name，否则path；失败不成功，列表与modal终态收敛 |
| SD07 | modal更多→打开真实SKILL.md；远程host | 本地文件工作面显示正确磁盘内容，modal关闭且焦点给工作面；远程禁用不发本地IPC；脏稿保护仍生效 |
| SD08 | Windows更多→在文件资源管理器中显示 | 调真实file-manager链，不等于打开侧板；不擅自关闭modal；不扩展目录/host权限 |
| SD09 | Try now：有/无defaultPrompt、已有技能链接、禁用/pending | 正确准备带技能身份的草稿；遵循enabled限制；不安装、不发模型turn、不冒充执行成功；side/main布局差异单列 |
| SD10 | 可移除本地技能/admin/remote，取消/失败/成功 | 仅资格成立有卸载；隔离副本实际删后读回/列表移除，取消不改数据、失败不成功；确认层下游未知项补证 |
| SD11 | 关闭按钮/Escape/遮罩/更多菜单中Escape、Tab/IME | modal层级正确，无双重关闭/误执行；焦点不落隐藏节点；精确官方回返目标待运行时对照，不预填回卡片通过 |
| SD12 | 新建本地模版→输入草稿→预览已安装→关闭/导航 | 编辑状态与preview隔离，草稿/ID清空保护保留；写入未完成不被预览晚到覆盖 |
| SD13 | 宽窗/窄窗、长标题/描述/Markdown/错误 | 标题/动作/正文/footer结构完整，无横向溢出、footer不挤没；保存当前截图/几何；无官方配对时score=null |
| SD14 | 当前源码Tauri、独立CODEX_HOME/工作区 | 真实本地技能只读→文件侧板→关闭/重开、焦点/窗口/IME适用验证；构建输入与EXE绑定；真实账号/远程未测另记 |

## 10. 开发前待补与交付门槛

1. 选定固定官方目录运行时分支，确认check/toggle及实际header/footer可见；补同客户区/中文/主题/DPI/缩放的官方图与DOM。可先开发明确静态主路径，但缺证项不能算已验收。
2. 补当前原包Retry中文fallback、精确关闭焦点、Try now侧栏布局、宿主remove确认/反馈下游。现有保护不因静态未见而删除。
3. 本地已安装主链、纯远程插件技能、设置contents、Showcase各自记录；不拿不同surface的加载字段、权限、布局互相证明。
4. 功能、结构/交互、配对像素、原生与用户验收分别记录。部署一个modal或通过回调测试不等于整页完成；本文件现在只是开发前合同。
