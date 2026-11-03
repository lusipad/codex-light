# 16.05B：模型选择、实际参数与持久化主要闭环

后续实施结果见 [16.05B 待验表](../acceptance/16-05B.md)。下文保留修改前调研时点的状态与合同，不表示当前产品尚未开始开发；也不表示官方或用户已验收。

2026-11-03。状态：**修改前只读调研完成，产品未开发，官方 GUI / 原生 / 像素未验收。** 承接 [16.05A 合同](16-05-model-catalog.md) 与 [16.05A 待验](../acceptance/16-05A.md)。下一阶段应同时贯通目录能力、Composer 菜单、当前会话/新会话默认、真实请求参数和最近使用，不能仅增加一个 fast 开关或重新做 Provider 表单。

## 范围与基准

16.05 是本项目的工作单元，**不是经证实存在的独立“模型目录”官方设置页面**。新候选 settings 注册仍无 `providers-models`；`agent` 有独立访问资格，且当前提取的 `panel-e921be19ab4d.js` 是 Work 偏好消费者。Composer 的本地 Codex 选择与 Work/ChatGPT 账户模型链必须分别处理。16.06 再承担智能体设置完整页面与权限字段，不把它们强合为同一配置表单。

本次独立只读来源：Store `OpenAI.Codex_26.1027.3384.0_x64__2p2nqsd0c76g0`，原包 `app/resources/app.asar`，674296148 bytes，SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。本次重新计算原包哈希，各提取 entry 分别匹配 asar integrity；[manifest.json](../../../.ref/parity/16.05/actual/16-05B-research/manifest.json) 登记路径/字节数/SHA-256。其官方签名与 BlockMap 独立事实见 [16.04B 来源](16-04-next-closure.md)，不以签名证明模型账户能力。

本候选**不自动替换旧固定包基准**。16.05A 的旧参考含本地补丁标记，保留原记录；不得将其 ultra 补丁混入本次证据。下面所有偏移均为 **0-based UTF-16 code units**；原文片段在 [anchors.json](../../../.ref/parity/16.05/actual/16-05B-research/anchors.json)。本次未运行 GUI、模型 turn、真实账户变更或协议写入。语言/主题/DPI/App 缩放/官方菜单当前实际布局及账号 gate 均未取得运行时证据。

## 已证实静态事实

表中 `initial`=`app-initial-4267e52fe5b0.js`，`primary`=`app-primary-998934e837fc.js`，`shared`=`app-shared-b9a49a97ca55.js`；完整哈希以清单为准。

| 链路 | 原始定位 | 静态事实及开发边界 |
| --- | --- | --- |
| 设置入口 | `use-visible-settings-sections-7c15410789f4.js` @36613、@41936；panel @1201 | `agent` 检查 Codex/Work 能力与 `work.cloud-orchestration.preferences`，并有 loading/error 分支；不能无条件显示所有远程偏好。相关注册未发现 `providers-models`，不重建该独立页面。 |
| 模型目录 | initial `qko` @7816676、`Qko` @7818406、真实请求 @7819446 | 按 host/auth/provider/catalog-path/team-catalog 构造查询键；真实 `model/list` 为 `{includeHidden:true,cursor:null,limit}`（默认 limit=100），返回后再过滤。当前片段仅证明该查询首请求，**不能据此声称官方完整分页循环已恢复**；本项目保留已有完整 cursor 读取与重复 cursor 拒绝。 |
| 可见/允许模型 | initial `Rko` @7814769、`zko` @7815883 | 目录之外还有 additionalAvailableModels、auth、custom-provider、configured-catalog、hidden、available-model 集和 access-program 条件。`codex-auto-review` 普通路径被排除。隐藏项不是“永远不能成为已配置模型”；显式配置/额外允许集合有独立分支。不得仅 `!hidden` 作为全部真实资格，也不得强开 gate。 |
| 推理能力 | 同 `Rko`；primary `PH` @1077247 | 依据返回 supportedReasoningEfforts 与 enabled 集裁剪；ultra 有独立 gate，Copilot 分支收敛 medium，persistent 有特殊消费者。快捷键、slider、发送必须共享有效能力，不拿翻译字典全枚举当可选档位。 |
| 速度层 | shared `iht/aht/sht/cht` @1851391/@1851488/@1851651/@1851695；initial `Dwn` @3356131 | fast 可由 tier id/name 识别，但选择返回的是该模型真实 tier.id；不是“支持 fast 就一律发送 priority”。`default`、自定义 tier、默认 service tier、fast/ultrafast 访问资格是分开的。 |
| 账号速度资格 | initial `VAo` @7837549 | chatgpt/personalAccessToken/amazonBedrock 等 auth 分支读取 requirements，再导出 serviceTierAccess。模型宣告 tier 存在不能独自证明当前账户可使用。无法取到资格时不能伪造 enabled。 |
| 初始/默认模型 | initial `xAo` @7822687、`kAo` @7823989 | 综合 cwd/profile、本地配置、managed new-thread、Work 账户偏好、新聊天 draft、服务端目录与 loading/fallback。模型显示值、显式选择模式、默认模式不是一个 boolean 推导出的永久同一项。静态 fallback 字面量不是本项目硬编码新型号的授权。 |
| 当前会话修改 | initial `PAo` @7828465，下一轮更新调用 @7830425 | 已恢复的会话通过 `updateThreadSettingsForNextTurn` 提交 model/effort 及可选 serviceTier；操作中有 pending 状态，失败清 pending 并报告。切另一会话不能沿用前一会话的全局 React 选择。完整底层协议映射仍需当前 app-server schema/隔离探针确认，不能直接把内部方法名当协议 method。 |
| 新会话默认与配置 | initial `Mst` @1649605、`setDefaultModelConfig` 调用 @7833731、`LAo` @7835430 | 默认模型/effort 写入 config；有 profile 时写 `profiles.<profile>.model` 与对应 reasoning key，否则根键。新 draft 可 `persistAsDefault:false`；当前会话更新、新 draft 和持久默认是不同作用域。覆盖结果有独立处理，错误回滚，不以菜单高亮证明配置落盘。 |
| Work 远程默认 | initial GET @4309280、PATCH @4309773；panel @2614、@5760 | `/wham/work/settings` 携账户身份/expected_revision，冲突重新取值；模型变更同时 reasoningEffort:null，serviceTier 独立。该链不能由本地 `config.toml` 成功代替，也不能用当前 AgentSettings 本地保存当 Work 远程已实现。 |
| 最近使用存储 | `recent-model-configurations-8bb999c7ddf6.js` @2689、@3547、@3839、@3994；`renderer-app-server-managers-115e3136926e.js` @75866 | 由 `item/completed` 且 item.type=`userMessage` 触发，从真实 turn 的 model context 提取 `{model,reasoningEffort,serviceTier}`，排除 subagent、部分 side/background 来源及 reserve；按三元组去重，`default` tier 归 null、等价 fast 归并，最多 3 项，key=`composer-recent-model-configurations-v1`。不是每次点击菜单就插入，也**不等待助手整个 turn 成功结束**；后续助手失败不能据此推断要撤销已记录使用。部分来源资格函数尚未完整解释。 |
| 最近使用入口 | `composer-content-e36dff9dfe56.js` @256960、@259636、@260446 | `composer.openRecentModels` 打开 Composer 的 `model` 命令子菜单；有“最近模型”和搜索时“匹配的模型”分区。展示候选由历史+当前三元组+目录候选补齐，过滤失效 effort/tier 后最多3项；Copilot、locked/loading等有入口资格。它不是仅把普通 picker 再打开一遍，也不能把存储3项直接当最终显示3项。 |
| 真提交边界 | initial @3059045 | 真正发送 `turn/start`，提交失败区分 outcome-unknown，不假定所有失败都“未发送”。每条发送路径仍需对照真实 payload builder，不能只测 selector 回调参数。 |

### 菜单及视觉合同

primary `w6r` @4334164 将模型、power selections、有效 effort、selectionMode、service tier options、locked/disabled reason、daybreak、loading 与回调送入统一 picker；菜单视图有 `data-model-picker-view`（@3852597），默认项 @3865772、速度高级项 @3845529。它不只是“两个 select”。模型菜单存在 simple/advanced 与 power/推理组合，具体账号当前显示哪一种需官方实测，不能把 Work 显示结构强套到本地 Codex。

中文包 `zh-CN-88ebb426d686.js` 已核对：默认=`默认` @886104；说明=`推荐模型集` @886053；fast=`快速` @871044；Work medium/high 分别=`标准` @886836 / `深度` @886778；无访问权提示=`此模型不可用。请选择其他模型以继续。` @885423。不能把 Work 的“标准/深度”自动替换本地所有 effort 标签。

`59ad52d5aa88.css` @109143 的候选 dropdown：content-width=`calc(var(--spacing) * 63.5)`、gutter=0、ring 默认 .5px；起始 open 样式 opacity=0、blur(8px)、scale(.8)，结束 scale(1)，ease-out；reduced-motion 禁用 transition/animation。这里只是 CSS 声明，**未取得生效 spacing token、Windows 实际物理尺寸或动画时长**，不能直接宣布 254px 或毫秒级对齐。

视觉开发前需用同客户区/DPI/主题/语言/等价目录采官方宽窗与窄窗至少：关闭 trigger、simple、完整列表/advanced、无权限/锁定、loading/error/空、最近项。保存 AX/focus/边界与 diff；没有配对图不得生成虚假评分。重点检查 trigger 文本与 baseline、开合/切视图动画、菜单宽高、分组、滚动、提示浮层、selected/locked/disabled、Escape 后焦点及 IME。

## 当前产品确切缺口与可复用部分

本次 [product-snapshot.json](../../../.ref/parity/16.05/actual/16-05B-research/product-snapshot.json) 固定检查输入，未修改产品。

- 可复用：`modelCatalog.ts` 已 cursor 全读、校验 data、拒绝重复分页；App 已目录请求 revision 与错误显示；`modelCapabilities.ts` 已 displayName/id/model 区分及 runtime efforts；`ModelSelector` 已基础键盘/focus、compact/list、默认/模型条目与能力 slider；16.03B 已 composer 快捷键路由。保留相关回归。
- **主要缺口 1：作用域/真实保存**。App `handleSelectComposerModel` 仅改 React state，切模型一律重置默认 effort；effort/fast 也分别更新全局 state。与官方“尽量保留支持的 effort、当前会话下一轮、profile 默认、新 draft”未闭环。`AgentSettings` 是本地用户 config 表单，不能充当 Work 远程偏好界面。
- **主要缺口 2：速度与准入**。`modelSupportsFast` 只回 boolean；App 多处发送硬编码 `serviceTier:"priority"`，没有将选中 tier 的真实 id/default/账号资格接到全部路径。当前 hidden filter 简化过度，尚无完整 locked/upgrade/availability 状态；不能将目录里有模型当可执行。
- **主要缺口 3：真实最近项与恢复**。未发现 Composer 维护上述 recent 三元组及独立命令子菜单的消费者；当前 selectionMode/default boolean 无该真实使用历史链。必须从真实已确认 userMessage 的 turn context 更新，恢复后重新按目录能力核验；不记 picker 试点或未送达的尝试，不能擅自等到助手成功才更新。
- **主要缺口 4：菜单表达一致**。当前结构是固定 compact 与完整列表，fast 是单按钮、字典有全部 effort 标签；需要按真实模式/能力构造菜单、状态、说明与快捷键。先贯通真实状态，再根据实际参考校准，而不是为截图硬编码模型名/数量。

下一交付把上述四项组合闭环；完整 Work/ChatGPT 账户服务、Daybreak/Cyber 与受限 gate 不具备真实账号条件时保留明确未验，继续无依赖的本地链。不能只落一个 recent 缓存就称模型分区完成，也不能凭缺 gate 条件停住全部本地工作。

## 修改前验收表

| ID | 操作及官方预期 | 必须保存的验证证据 |
| --- | --- | --- |
| MC-B01 | 相同 host 下目录多页→刷新/账号或provider变化→空/失败/重试；旧响应不能污染新作用域 | 生产 loader/状态回放、真实0turn `model/list` shape；空清能力、失败不报成功，MC01/02旧回归保留 |
| MC-B02 | 普通hidden/auto-review、显式配置隐藏模型、locked/upgrade、API/custom/team分别按资格展示；gate未知不假放行 | 受控原始目录+真实身份/requirements样本、官方过滤函数映射；不硬编码账号样本为通用能力 |
| MC-B03 | 选模型A/high→B仍支持high则保留；不支持则按B真实默认回退；未知effort不提交 | 同一state→selector→快捷键→请求参数回放，切换加载/目录消失/空目录覆盖 |
| MC-B04 | tiers中fast实际id为fast、自定义id/name或priority，选标准/fast后发真实id；账户拒绝时不可选/不可提交 | 生产tier resolver与App所有发送路径参数断言；真实requirements/model-list读取，不把boolean代替id |
| MC-B05 | 已有会话切模型/effort/tier只影响正确会话下一轮；快速切会话、重复选择、写失败/晚返回不污染另一会话 | 真实当前协议schema及隔离thread/settings探针（0turn可行时）；生产pending/回滚回放；不能只测setState |
| MC-B06 | 新聊天显式选择与“默认”区分；profile/项目/组织默认覆盖、persistAsDefault:false、重启再读 | 隔离`config/read`/write/磁盘/版本/CAS与只改目标keys；真实作用域读回，默认不等于固定目录首项 |
| MC-B07 | 真实userMessage completed后最近项更新；相同三元组归并最多3项，picker点击/未送达尝试不插入；随后助手失败不擅自删除 | 真实turn context脱敏回放、持久化重开、默认tier与等价fast归并、subagent排除；最近命令菜单按历史/当前/目录补齐且搜索；不启动付费模型冒充验证 |
| MC-B08 | 当前模型从目录消失/权限撤销，trigger、disabled reason、发送资格及最近项同步；无可选项清能力 | 生产selector与App action回放，不能保留失效fast或抢先提交未知model |
| MC-B09 | 普通发送、运行中steer/queue、plan/default、重试/新聊天等入口使用同一model/effort/tier策略 | 逐入口捕获真实protocol builder输出；保留id≠model用例；不能只覆盖主send一处 |
| MC-B10 | Work账号偏好选择模型时清effort、保存携revision，账号切换/409重读；本地模式不调用远程Work写接口 | 有真实能力才做隔离远程验证；不可用则标未验，不能用本地config结果替代 |
| MC-B11 | Tab/方向键/Home/End/Escape/IME、选择后焦点回trigger；操作pending时防重复，错误可见 | 生产JSX/键盘回放+同源码原生构建实际操作；公共Composer快捷键回归 |
| MC-B12 | 上述菜单状态的宽/窄配对截图，控件锚点误差≤1物理像素，记录残余差异 | 官方reference/actual/overlay/diff/AX/环境，visual-verdict仅迭代辅助；无图不能判像素一致 |

## 实施顺序与交付

1. 先抽清当前 Codex 模式可得到的真实目录/账号requirements/配置作用域；形成明确的 model/effort/tier/selectionMode 结果供菜单与提交共享，复用既有工具，不新增依赖。
2. 连通当前线程下一轮更新与新聊天默认持久化/读回；保留不确定发送/覆盖语义，验证后再接真实最近三元组。队列、steer、plan和快捷键同时回归，避免各自维护能力副本。
3. 按官方实际激活的 picker 结构完成菜单与权限/错误状态；执行原生、焦点和配对视觉，再交付待用户验收。远程账户服务依赖分列，16.06智能体完整设置不在本轮冒充实现。

阶段完成后提供相关自动检查、协议探针、对应源码原生构建、功能证据与未验列表，按已授权阶段提交规则提交。该阶段提交不等于整页已验收，更不等于 App 已完成。
