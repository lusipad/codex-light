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
