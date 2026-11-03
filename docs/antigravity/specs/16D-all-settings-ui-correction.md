# 16D：全设置分区界面纠偏合同

2026-11-04，开发前合同；承接[全页面推进](../ALL-PAGES-PROGRESS-20261104.md)。本轮修复公共设置外壳造成的全部分区错误，另对常规与外观恢复有来源的结构，不将所有服务缺口伪装为正常页面。

## 固定来源及边界

Store `26.1027.3384.0`，asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。本轮从明确Store绝对路径重新提取11个原始entry，全部与archive entry integrity匹配；完整包SHA沿用05D/10C已核验记录，本轮未重复计算整包。见 `.ref/parity/16/actual/16D-ui-correction/reference/manifest.json` 和 `raw/`。偏移为0-based UTF-16字符，不是行号。语言、主题、DPI、缩放、运行时gate和官方同尺寸截图未知，不给像素分。

- `settings-page-19ad78df2b6f.js` @41710后 `Ei`：个人/集成/编码三组；agent属个人，插件和设备能力属集成，Hooks/连接/云偏好/Git/环境/Worktrees属编码。其Ti与Ei还含更多服务/条件项，当前保留已有25项入口，不据静态目录强开其他gate。
- `zh-CN-88ebb426d686.js` @1908514起官方导航翻译：个人/集成/编码、常规、通知、导入、外观、个性化、虚拟宠物、语音、Git、环境、连接、云端偏好设置；`settings.nav.worktrees.v2`真实值为英文Worktrees，不能自译为工作树策略。标题存储空间与导航存储有独立文案。
- `appearance-settings-a3f999ee8fe4.js`：只包settings内容布局与general导出外观组件。general @118523起 `Nc` 是视觉风格、模式/主题与高级折叠；没有第二套四变量旧主题格及整页保存。
- `general-settings-5e6e6ad31bf0.js` @109000起 `Ec/Dc/Oc`：常规按General/Composer分组，默认打开目标与Windows Shell在General，发送快捷键属于Composer；`fl`逐项保存composerEnterBehavior（16E复核更正：@153811 `al`实际为跟进消息queue/steer），@164261 `pl`在Windows直接return null。完整一般设置仍有条件行未恢复，不能以目前两类控件声称整页完成。
- `settings-content-layout-268f5398cbba.js`：默认内容`max-w-3xl`（48rem），section gap spacing(10)，标题与section分别组织。只采用静态宽度上限和结构，不称物理像素已测。`settings-group-b4dc2379b608.js`证实section flex-col无card边框，Content gap-1.5。常规行左右布局与窄屏680px折行是当前适配值，非官方物理测量；完整row样式仍待配对。
- 当前专用组件各自保存/刷新、作用域和失败处理已有回归；旧wrapper通用保存调用config/batchWrite写模型/权限/指令等无关数据，旧外观还写colorTheme；worktrees/code-review旧local-only说明与已有真实执行消费者冲突。删除这些wrapper路径，保留专用组件，不清空任何用户存储。

## 修改前回归合同

| 用例 | 生产行为与预期 |
|---|---|
| SC01 | 挂载任一现有分区，wrapper不读取/批写CLI配置、旧colorTheme或desktopPreferences；不显示通用保存/放弃，原专用组件持有真实state和callback |
| SC02 | 外观只有一个AppearanceSettings；旧主题格不渲染，保存交给appearanceState；切设置页不会重新应用legacy palette |
| SC03 | 常规保留真实GeneralOpenPreferences、Enter三值和保存错误；Enter变更准确回调，不批写其他设置；无连接诊断和恢复出厂常驻卡 |
| SC04 | 导航使用当前语言包文案与三组归属；搜索/分区切换有效，providers-models/experimental旧别名仍进入agent/general；不丢现有25入口 |
| SC05 | 个性化/账户/资料/MCP/插件/环境子组件注册的导航保护继续阻止有草稿时离页；无需统一“保存”改变即时设置语义 |
| SC07 | 官方grouped导航ArrowDown/ArrowUp聚焦并激活相邻可见项；首尾不循环，草稿guard仍生效；来源settings-page @30000 |
| SC06 | 工作树及代码审查不再显示整页“未接执行器”错误概括；其专用真实控件、服务scope和回调保留 |

实现前先执行新的生产TSX回归记录失败，再修改并运行直接受影响的既有回归。不跑真实HTTP、模型或Cargo。公共App旧theme启动和快捷键消费由主代理单独集成，主代理完成旧消费者移除后删去孤立旧主题常量/导出，不动用户数据。

## 全分区盘点及本轮范围

仓库当前25个导航入口，加个性化内部记忆工作面，共26个工作面；另2个兼容别名不是独立页面。并非26个slug都已按当前账号可见性验收。

| 分区 | 当前合同/专用实现 | 本轮可做/差距 |
|---|---|---|
| 常规 | 本合同+16-01/16-01C | 取掉调试首屏/出厂/通用保存，分开常规与编辑器；语言、WSL、跟进行为等完整官方行仍缺 |
| 外观 | 本合同+16-02-next-closure | 移除旧主题双层和保存；高级/真实预设及双variant继续既有实现，图标和像素未验 |
| 账户 | 16-08-account/AccountSettings | 保留认证服务与导航保护，享受外壳纠偏；登录态/账号gate待官方配对 |
| 个人资料 | 16-09B/ProfileSettings | 保留真实编辑和放弃保护；头像/编辑dialog像素未验 |
| 使用与计费 | 16-08B/UsageSettings | 保留限额读取；账单/升级等能力未恢复，不加假购买按钮 |
| 通知 | 16-04B/NotificationSettings | 去误导性通用保存，保留即时保存/声音/系统权限；完整行视觉未验 |
| 个性化 | 16-07C/PersonalizationSettings | 保留编辑器/离页保护及账户作用域；source/preview等当前gate未证 |
| 记忆（个性化内部） | MemorySettings+memoryPreferences | 保留真实读写/reset保护；入口gate/同条件视觉待证，不新增导航 |
| 快捷键 | 16-03B/KeyboardShortcutsSettings | 去公共保存，保留录键/清除/reset；官方模态/密度未验 |
| 虚拟宠物 | 16-25/PetsSettings | 导航文案纠偏；目前应用内消费者不等官方独立overlay，不重画假资源 |
| 语音 | 16-21/VoiceSettings | 导航文案纠偏；服务说明页仍非官方完整声音/设备工作面 |
| 归档 | 16-19/ArchiveView | 保留独立真实组件；删除/搜索结构由项目组修复，共享容器待原生 |
| 存储 | 16-18B/C/StorageSettings | 导航/标题区分；保留真实quota与cleanup入口，不捏造breakdown |
| 导入 | 16-17/ImportSettings | 导航改官方导入；保留真实探测/确认/报告，步骤呈现仍待配对 |
| 配置 | 16-06B/AgentSettings | 归属改个人；保留权限/网络/回答真实作用域即时设置，不用通用保存 |
| 代码审查 | 16-16B/D/CodeReviewSettings | 移除错误local-only，保留provider/指令，完整私有审查未完成 |
| Git | 16-13B/GitSettings | 官方导航Git；真实偏好保留，展开编辑外观未验 |
| Worktrees | 16-15B/WorktreeSettings | 移除错误local-only，官方导航Worktrees；创建/清理真实消费者保留，英文说明/目录区域仍待当前包核对 |
| 本地环境 | 16-14C/LocalEnvironmentSettings | 官方导航环境；保留项目/详情/编辑/终端工作流及guard |
| Hooks | 16-12B/HooksSettings | 导航官方钩子；真实列表/抽屉保留，密度/滚动未配对 |
| 插件 | 16-11C/SkillsMcpView manageOnly | 归属集成+官方插件文案；真实安装/管理不改，插件组独占纠偏 |
| 连接 | 16-10B/McpSettings | 归属编码+官方连接文案；保留作用域/详情/失败边界，不擅自合并MCP新路由 |
| 电脑操控 | 16.22/ComputerUseSettings | 归属集成+官方中文；当前仅服务说明，缺真实权限/设备工作面 |
| 应用快照 | 16.23/AppshotsSettings | 归属集成+官方中文；当前仅说明，捕获/权限页未恢复 |
| 浏览器 | BrowserUseSettings | 归属集成+官方中文；当前仅说明，历史/站点权限工作面未恢复 |
| 云偏好 | 16-26/CloudPreferencesSettings | 归属编码+官方云端偏好设置；仍服务未接，不把本地输入伪作云写入 |

## 未验收边界

所有26工作面的官方可见gate、配对截图、原生GUI/IME、DPI/缩放与用户验收均未闭环。覆盖表是逐分区当前进展记录，不是所有页面复刻完成证明。已有纯说明页继续明确未完成；本轮不靠隐藏入口掩盖服务缺口。
