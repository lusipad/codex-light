# 16 设置中心 (Settings 逐分区 16.01-16.26) 调研与实现

2026-11-01复核：下方旧“26分区完整生命周期/全量通过”主要来自字符串断言，不能证明实际生效。16.01固定原包发现Enter行为、默认打开目标、终端偏好和Windows防休眠适用性差距，见[通用设置取证与合同](../../antigravity/specs/16-01-general-settings.md)。后续逐分区开发，不整组放行；官方/原生/像素未验。

16.01A 已推进发送快捷键真实消费，详见[增量实现与验证](../../antigravity/runs/20261101-codex-general-enter.md)及[待验步骤](../../antigravity/acceptance/16-01A.md)。三模式、即时持久化和补全优先有执行回归；整个设置中心未验收。

16.01B 默认打开位置与Shell已接真实执行，自动自验通过，见[实现与缺口](../../antigravity/runs/20261101-codex-general-open.md)。16.02A 已按[模式与双字号合同](../../antigravity/specs/16-02-appearance.md)接入真实持久化、系统跟随、独立字号消费者和减少动态效果，[实现与未验项](../../antigravity/runs/20261101-codex-appearance.md)分别记录功能回放和视觉证据边界。

16.03A 续修已按追加原包合同接入keybindings.json、实际动作与原生菜单同步，补搜索/录入/清除/单项和全部恢复；KB01–KB10与完整标准检查通过。[实现与未覆盖](../../antigravity/runs/20261101-codex-shortcuts.md)明确完整命令、OS-global、序列许可与原生/像素缺口。16.04[通知修改前草案](../../antigravity/specs/16-04-notifications.md)已开始取证，未改通知代码。旧“26分区全量通过”不作为当前完成依据。

日期：2026-10-27。状态：调研完成，代码实现与全量验证通过。

## 1. 范围与证据

本单元覆盖设置中心全部 26 个分区的完整生命周期、数据源作用域与读写闭环：
- 个人分组 (Personal)：
  - 16.01 `general-settings`：启动、语言、休眠保活、默认编辑器；
  - 16.02 `appearance`：主题配色（8 套官方配色方案）、字体字号、深浅模式；
  - 16.03 `keyboard-shortcuts`：真实快捷键注册表（来自 `shortcuts.ts`）与搜索过滤；
  - 16.04 `notifications`：通知策略、系统权限、提示音音量与音效主题；
  - 16.05 `providers-models`：模型目录、提供商配置与默认模型；
  - 16.06 `agent`：智能体推理、审批策略、沙箱级别、联网开关；
  - 16.07 `personalization`：个性化提示词与自定义对话偏好；
  - 16.08 `account`：登录账号、额度、用量与使用限制；
  - 16.09 `profile`：个人资料与头像信息；
  - 16.10 `connections`：MCP 服务器状态、连接与热重载；
  - 16.11 `plugins-settings`：插件更新策略与市场配置；
  - 16.12 `hooks-settings`：生命周期挂钩真实列表（`hooks/list`）与实时运行记录；
  - 16.13 `git-settings`：Git 分支前缀、force-with-lease 策略；
  - 16.14 `local-environments`：本地环境与工作区配置；
  - 16.15 `worktrees`：隔离工作树保留与清理语义；
  - 16.16 `code-review`：审查触发时机与严重性阻断阈值；
  - 16.17 `import`：从 VSCode / Cursor / Windsurf 导入配置；
  - 16.18 `storage`：磁盘存储真实统计（`storage_stats_get`）与清理确认；
  - 16.19 `archived-chats`：与归档会话视图同构的数据管理与恢复；
  - 16.20 `experimental`：实验特性开关（`experimentalFeature/list` 与 `enablement/set`）；
  - 16.21 `voice`：语音输入设备与转写；
  - 16.22 `computer-use`：屏幕与系统操控权限说明与配置；
  - 16.23 `appshots`：应用截屏快照与快捷键；
  - 16.24 `browser-use`：无头/远程浏览器与 CDP 连接策略；
  - 16.25 `pets`：虚拟宠物伴侣状态与交互；
  - 16.26 `cloud-settings`：Codex 云端工作区与同步偏好。

### 官方基准
- 官方固定版本：`26.928.21956 / build 12404`。
- 本机 app-server 实际版本：CLI `0.159.2`。

## 2. 验证与回归设计

设计回归脚本 `scripts/verify-settings-partitions.mjs`，包含：
1. 断言 `types.ts` 中的 `SettingsSectionSlug` 覆盖全部 26 个分区；
2. 断言 `SettingsView.tsx` 中的 `SETTINGS_NAV_GROUPS` 包含全部 26 个分区且无遗漏；
3. 断言服务端配置读写（`config/read`、`config/batchWrite`、`experimentalFeature/*`）完整；
4. 断言本地偏好持久化（`desktop_state_get` / `desktop_state_set`）正确区分作用域。

## 3. 实施与验证结果

1. **测试转绿与全量验证**：
   - `node scripts/verify-settings-partitions.mjs` 全部 26 个分区及协议检查通过（退出码 0）；
   - 接入 `scripts/verify-all.ps1`，全量标准检查 PASS。

## 2026-11-01 — 16.04A 通知增量

[官方合同](../../antigravity/specs/16-04-notifications.md)先追五项schema、消费者和Windows选项过滤，再接入分类派发及独立即时保存。权限／提问不受完成off模式误抑制，发送前重查请求，完成去重，声音none不禁桌面通知。NT01–NT08、完整标准检查、104项Rust与原生构建通过。

[本批记录](../../antigravity/runs/20261101-codex-notifications.md)与[待验表](../../antigravity/acceptance/16-04A.md)说明dot来源、官方音频／导入、远程账户通知、系统权限／点击／撤回、原生重启焦点与像素缺口；本分区未验收。没有将通用构建或旧26分区声明升级成1:1完成率。

## 2026-11-01 — 16.05A 模型目录与旧页面纠偏

固定包注册未发现providers-models独立入口；旧26分区记录不能证明它存在。撤下该导航/编辑页和示例目录生成按钮，旧入口归agent，保留用户配置与backend能力。[合同](../../antigravity/specs/16-05-model-catalog.md)与[本轮记录](../../antigravity/runs/20261101-codex-model-catalog.md)记录出处、固定参考补丁标记和模式边界。

真实model/list分页、空/错/重试、乱序/卸载、隐藏/审核专用过滤、原样显示及协议model区分已接通，MC01–MC06、完整标准检查、104项Rust与Release/MSI/NSIS通过。独立只读协议探针为11页11项、无模型轮次。原生/像素和完整远程gate未验收。

下一步16.06先区分Work的/wham/work/settings远程账号偏好与Codex本地配置。当前研究不得把两者视为同一保存合同。

## 2026-11-01 — 16.06A 用户配置合同纠偏

[规格](../../antigravity/specs/16-06-agent-settings.md)与[执行记录](../../antigravity/runs/20261101-codex-agent-settings.md)：agent兼容入口独立读取用户层，生效值分离，按版本仅写改变字段并读回；不再用协议失败fallback改写文件。旧预设撤下，复杂审批对象保留，推理能力来自运行时模型。Work远程偏好未实现，其他分区旧保存路径/原生/像素仍有缺口，不记整页完成。

## 2026-11-01 — 16.07A Codex自定义指令

[规格](../../antigravity/specs/16-07-personalization.md)追到native主机Codex home/AGENTS.md和AGENTS.override.md，中文与13行编辑器来自实际原包。已实现真实读写/读回/取消/返回确认、单飞/IME与失败保稿，撤下自创语气/代码风格/角色控件。真实隔离会话证实全局/override/项目指令消费优先级，零模型轮次。完整ChatGPT和远端主机、应用级离页保护、原生/像素与用户验收仍待完成。

## 2026-11-01 — 16.08A 账号数据隔离

[合同](../../antigravity/specs/16-08-account.md)与[执行记录](../../antigravity/runs/20261101-codex-account-snapshot.md)：只读账号请求前后核身份，额度/用量部分失败、请求代次与account/updated刷新。移除该页跨分区保存按钮。账号AAA/ABA、usage无身份字段、真实登录/退出与官方UI/像素仍有缺口，不记整页完成。

## 2026-11-01 — 16.09A/16.10A

Profile真实写服务尚未桥接，撤下示例表单，以真实账号只读与缺口说明替代虚假编辑成功；完整资料未实现。MCP用定向分页mcpServerStatus/list替代HEAD/命令--help，未知状态不误报在线。专项和隔离stdio fixture证明限定协议边界；CRUD/OAuth/原生/像素继续待验。

2026-11-01：16.11A插件设置复用真实组合管理，合同与缺口见[规格](../../antigravity/specs/16-11-plugins-settings.md)，[待验](../../antigravity/acceptance/16-11A.md)。

2026-11-02：16.12A真实Hooks写入，见[合同](../../antigravity/specs/16-12-hooks-settings.md)与[待验](../../antigravity/acceptance/16-12A.md)。

2026-11-02：16.13A三个Git偏好消费见[合同](../../antigravity/specs/16-13-git-settings.md)和[待验](../../antigravity/acceptance/16-13A.md)。

2026-11-02：16.14A环境文件与动作，见[合同](../../antigravity/specs/16-14-local-environments.md)与[待验](../../antigravity/acceptance/16-14A.md)。

2026-11-02：16.15A工作树目录真实消费，见[合同](../../antigravity/specs/16-15-worktree-settings.md)和[待验](../../antigravity/acceptance/16-15A.md)。

2026-11-02：16.16A见[合同](../../antigravity/specs/16-16-code-review-settings.md)与[待验](../../antigravity/acceptance/16-16A.md)，本地偏好/消费增量，不是云端策略和整页一致性完成。

2026-11-02：16.17A外部导入，见[合同](../../antigravity/specs/16-17-import-settings.md)和[待验](../../antigravity/acceptance/16-17A.md)。

## 2026-11-03 存储语义纠正

原包storage-settings的ChatGptStorageSettings调用/files/library/storage/usage，管理云端Library/Space文件与图像。旧计划将其归为CODEX_HOME磁盘统计错误；[16.18规格](../../antigravity/specs/16-18-storage-settings.md)取代此假设。先撤销错误本地清理入口；认证桥缺失，页面未完成。

2026-11-03：16.19A[合同](../../antigravity/specs/16-19-archived-chats-settings.md)将归档设置接入独立归档页同一真实链路；撤销旧threads_meta_get列表、重复恢复/删除和通用配置按钮。共享分页/晚到隔离/写锁/恢复后查看回归复用，整页原生像素仍未验。

## 2026-11-03 — 16.01C / 16.02B下一合同

[16.01C待验表](../../antigravity/acceptance/16-01C.md)：工作区菜单改真实动态目标，查询/点击分别核最新会话工作树根，精确路径偏好执行前保存；修复未注册VS Code链与内嵌终端冒充外部目标。完整标准和全Rust库270通过，受控浏览器验证错误重试/焦点/选择读回；原生交互和官方像素未验，完整目录、remote/location、独立root服务等仍有差距。复用菜单/存储/协议桥，无新依赖。

[16.02B修改前合同](../../antigravity/specs/16-02-next-closure.md)独立提取Store14文件、47锚点，下一主要动作是浅深主题/preset/颜色编辑→真实CSS消费→持久化。宿主configuration映射、完整preset资源及跨窗时序仍待补证，不能把静态调研当产品或视觉验收。

## 2026-11-03 — 16.02B 独立主题主链

[验收记录](../../antigravity/acceptance/16-02B.md)列出真实desktop配置八键/版本/null适配、浅深独立主题、预设与颜色/字体编辑、semantic CSS消费、导入导出及精确高级恢复。公开16组/23variant资源匹配固定官方，保留完整许可；原有字号/motion与跨窗回归保留。272 Rust通过，完整标准和构建见该批清单。浏览器仅受控生产组件；私有目录、完整语法/OKLab、账户accent、字体枚举和原生像素未完成，不记整分区验收。[16.03B下一合同](../../antigravity/specs/16-03-next-closure.md)保持只读调研状态。

## 2026-11-03 — 16.03B 真实命令目录与键位存储阶段

[16.03B待验记录](../../antigravity/acceptance/16-03B.md)：从固定Store命令/中文/资格合同接会话导航、Composer/审批、Git/真实工作台标签四组消费者，编号tabs/sidebar偏好与帮助显示同步。独立keybindings文件补版本/别名读迁移、原字段保留、revision冲突拒写、Windows独占及跨窗刷新；原生菜单按窗缓存、录入暂停/释放。复用既有真实handler/表单/编辑器和现有依赖，不增加空动作或假成功。

279项Rust全量通过；首轮三旧夹具与搜索探针失败留证，夹具补状态/执行实际注册和按键逻辑后通过，搜索独立复跑通过但首败根因未定。最终完整标准含隔离协议、原生EXE/MSI/NSIS均退出0，238产品输入稳定；初始/焦点修复后快照分开保留。浏览器生产组件夹具已验证Ctrl+Alt+J改绑、焦点及编号展示，非真实宿主/原生/官方像素。OS-global/完整服务能力及全侧栏导航/官方标签模型仍有差距，整快捷键分区未验收。

旧Store安装路径已被26.1027.3384自动替换，本阶段保留固定26.1021.3705静态证据，不自动变更基准。[16.04B下一合同](../../antigravity/specs/16-04-next-closure.md)仅只读调研新候选通知点击/撤回/音频整链，版本差异与原生像素保持未验。

## 2026-11-03 — 16.04B 通知生命周期与真实音频增量

先补[Windows原生合同](../../antigravity/specs/16-04B-native.md)、[真实配置补证](../../antigravity/specs/16-04B-storage.md)及[固定48kHz音频合同](../../antigravity/specs/16-04B-audio.md)，再接稳定ID/账号epoch/请求身份、WinRT回调与精确撤回。复用既有broker与真实desktop配置版本/读回；MSVC+Windows SDK局部适配无新依赖。导入真实解码→PCM/RIFF→SHA命名副本，未复制分发官方声音；默认/经典依赖本机固定Store资源，许可及独立安装可用性未解决。

[16.04B待验记录](../../antigravity/acceptance/16-04B.md)保留PS5/并发Rust握手/旧夹具和搜索探针首败。补请求实例nonce，实际写入前拒绝旧通知；最终全Rust290（4线程）、完整标准、EXE/MSI/NSIS退出0，244产品输入及构建helper指纹稳定。搜索仅修探针对完成/最终结果顺序的误判，严格文件断言保留，两CLI实测通过。浏览器WAV真实48k重采样通过，其他宿主桥注入，非原生音响或OS验收。真实中心交互、审批先导航差异、COM冷启动、only-QuickChat/安装标识、reply、Dot/远程服务及像素仍有缺口；整分区未验收。下一[16.05B合同](../../antigravity/specs/16-05-next-closure.md)已准备。

## 2026-11-03 — 16.06B 本地配置与发送权限阶段

[16.06B合同](../../antigravity/specs/16-06B-next-closure.md)纠正旧Work路由归属；真实本地ConfigurationPanel六项、项目/用户/管理员、即时CAS写读与条件网络接通，未知/管理来源锁定。用户RPC与项目保注释文本独立，后者按双CLI真实项目拒写证据适配，无新依赖。新聊天有效config、已有thread权威权限与显式preset分开；旧resume权限覆盖P1加入真实生产回归后以revision/identity修复。见[待验表](../../antigravity/acceptance/16-06B.md)，最终结果单独登记，不以浏览器夹具或构建代替官方、原生交互与像素验收。

16.06B最终完整标准、全Rust299、原生EXE/MSI/NSIS退出0，250产品输入/helper稳定；首轮旧夹具失败与修正保留。阶段自验完成，原生交互、官方配对像素和用户验收未完成，整分区不记已验收。

## 2026-11-03 — 16.07B 本机指令与导航保护

[16.07B待验记录](../../antigravity/acceptance/16-07B.md)：本机home改由app-server用户层派生，观察context/原文CAS/路径身份/读回、跨窗事件与前端dirty保稿/全局导航/失败恢复形成真实闭环。账号指令、Memory与统一编辑器独立，不强开gate。专项及受控浏览器通过，原生/官方运行时与像素、用户验收不由构建替代。最终检查与构建证据单独记录。

16.07B最终完整标准、全Rust303、EXE/MSI/NSIS通过，251产品输入/helper稳定；焦点修复前后日志/快照独立。整分区仍待官方/原生/像素和用户验收，Memory/账号指令下一合同已准备。

## 2026-11-03 — 16.07C 记忆与账号指令宿主桥

[16.07C待验记录](../../antigravity/acceptance/16-07C.md)：记忆真实catalog、用户层关联CAS/读回、工具反值与旧键删除、确认后单次真实reset、部分成功/未知结果恢复和跨窗隔离已实现；账号指令新增固定鉴权GET/PATCH宿主桥，未开放未知gate或账号编辑器。复用现有配置、传输与导航保护，不新增依赖。

完整标准、全Rust318项与EXE/MSI/NSIS通过，255项产品输入和原生helper指纹稳定，许可五文件一致。真实隔离CLI探针验证文件/SQLite记忆删除及非memory数据保留；受控浏览器仅注入宿主，不代替真实账号或原生操作。原生/官方runtime/像素及用户验收未完成，整分区未验收。

## 2026-11-03 — 16.08B 账户与基础Usage纠偏

[16.08B待验记录](../../antigravity/acceptance/16-08B.md)：按固定官方独立页面拆开账户与使用情况，移除诊断拼接/首组额度与填零历史图；真实managed登录、取消/通知完成、API短时输入、退出读回已接通。固定wham usage服务复用身份/routing/integrity/取消/组织网络约束，个人空account须真实membership佐证；全组保留、core/Spark默认呈现，未知/单位和CLI受限来源不混淆。

生产专项、Rust服务五项与受控Chrome主要链通过；浏览器发现API取消焦点P2后单点修复并复验。旧协议探针超时首败与隔离修复单独留证，完整标准/全Rust/原生构建以阶段最终记录为准。姓名/用户名真实源和编辑、完整Usage/公开资料、官方运行时/原生/像素与用户验收仍未完成。[16.09B合同](../../antigravity/specs/16-09B-next-closure.md)仅下一阶段调研，不计本阶段实施。

16.08B最终完整标准、修复后专项、全Rust323及EXE/MSI/NSIS退出0；260项最终产品输入/helper与许可五文件稳定。保留旧协议首败、焦点修复与删除孤立模块前后快照。原生/官方运行时/像素与用户验收仍未完成，完整账户与计费不写已验收。

## 16.09B 账户字段与公开资料文本编辑增量（2026-11-03）

已按[修改前编辑合同](../../antigravity/specs/16-09B-editor-contract.md)接入独立账户与公开资料服务、姓名/用户名/显示名/简介编辑，权限预读、写后实际GET、未知送达不重放、审核保稿与身份隔离；见[阶段待验](../../antigravity/acceptance/16-09B.md)。生产专项与受控Chrome、8项新增Rust profile_及完整标准退出0，最终构建/全Rust以待验表记录为准。无新依赖，复用服务/导航/主题。

头像/贴纸/展示设置/完整统计、邮箱/年龄/政策/删除及完整计费另阶段；真实账号、原生交互、官方运行时与像素、用户验收未完成。进入下一分区开发不表示本页已验收。

## 16.10B MCP 列表与详情配置增量（2026-11-03）

固定Store调研后，已替换自创预设/常驻表单/投影整表写；独立MCP列表→详情、stdio数组/map/cwd与HTTP headers/Bearer env、只读来源、CAS定点写/实际读回、pending不重放和显式重启见[阶段待验](../../antigravity/acceptance/16-10B.md)。复用现有协议/导航/主题，无新依赖；三项复核缺陷已红绿修复。生产专项、双CLI隔离协议、受控Chrome与全Rust332通过，完整标准/原生构建以待验表最终记录为准。OAuth、远程/真实服务、官方原生像素和用户验收保留未完成；下一插件管理合同已调研。
