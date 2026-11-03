# 16.14C 本地环境剩余消费者：顶部操作与删除前 cleanup

2026-11-03，只读修改前合同。16.14B产品已冻结，本次不改产品/测试，不运行Cargo、真实脚本、删除或模型。本阶段目标是闭合**顶部环境操作菜单 → 真实独立终端动作**和**工作树恢复快照 → cleanup → 删除**，不能将B保存了cleanup字段写成生命周期已执行。

## 1. 基准、适用性和证据

本轮重新校验固定Windows Store `26.1027.3384.0` 的app.asar SHA-256：`6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。本次提取资源逐一核对asar integrity，见 [manifest](../../../.ref/parity/16.14/actual/16-14C-research/manifest.json)；[18项锚点](../../../.ref/parity/16.14/actual/16-14C-research/anchors.json) 为0-based UTF-16、end exclusive；[中文](../../../.ref/parity/16.14/actual/16-14C-research/zh-copy.json)、[共享固定资源哈希](../../../.ref/parity/16.14/actual/16-14C-research/shared-source-hashes.json)、[产品入口快照](../../../.ref/parity/16.14/actual/16-14C-research/product-map.json) 分别保留对照。

官方 `/settings/local-environments` 的gate `375130565` /codex-cloud分流仍按B合同适用限制，不强开。顶部操作消费位于 `local-conversation-thread-81abf71c800a.js`；辅助创建/上手流程还受其他gate，不把静态存在等于当前账号可见。此阶段不新增“使用Codex设置”模型轮次或远程host能力。

## 2. 顶部环境选择与操作菜单

### 真实选中配置

`OE → dE`：普通项目使用workspace+host选择；Codex worktree从真实worktree scope `codex.localEnvironmentConfigPath`读取（`__none__`代表无环境），切换也写回该scope；不得仅改全局当前workspace设置。无效/错误配置进入needsAttention，“修复本地环境”，不能悄悄执行另一个配置。

选择子菜单包含“无环境”、默认环境、其他真实环境；加载/错误/空态独立，当前项checkmark；存在配置错误时有修复入口。设置跳转带真实workspaceRoot/configPath/projectId，不把名称当身份。

### 菜单、主按钮、最近操作与快捷键

- 固定中文：菜单“操作”、主按钮“运行：{actionName}”、“更改环境”、“添加操作”、“环境设置”、“无环境”；完整key/value以zh-copy为准。菜单的真实动作区为 `max-h-40 overflow-y-auto`，非无限拉长。
- 过滤actions的platform：无platform适用全部；已知darwin/linux/win32时仅匹配当前平台，未知平台分支在官方静态函数中不排除。不能把Windows动作当所有主机通用。
- `local-env-recent-actions-by-key` 持久化最近名称列表。key由环境定义根/真实路径构成；按action.name去重前插，最近顺序优先，其余保原配置顺序；主运行按钮取最近排序首项。
- 快捷命令environmentAction1..9与命令菜单绑定的是**平台过滤后原配置索引**，不是最近排序后的索引；“最近首项主按钮”和“快捷第N动作”不得混淆。快捷键值来自现有真实可改键位表，不硬编码新组合。
- 添加动作对已存在配置先读revision、保存完整新配置、处理conflict；仅保存成功后运行新动作。不能失败后仍运行，不能直接覆盖外部变化。无需新增运行历史演示数据。

### 动作实际运行链

`OE.pe → LE → qu.runAction(sessionId,{command,cwd,title})`；cwd取repoRoot+environment.cwdRelativeToGitRoot，`.`为repoRoot，否则才回退workspaceRoot。sessionId含conversationId、定义根key、固定runId，避免跨会话/配置串台。

共享 `$1a/Q1a` 更新终端标题并在attach/renderer准备后发送队列；宿主 `TerminalManager.runAction` 校验原生window owner、按session串行，再 `restartSessionForAction` **终止旧backend及其进程树 → 创建新backend → 正确切换cwd → 写入原始命令**。因此不是把命令拼到当前随意shell或复用可能正在运行的前台进程。PS/cmd/POSIX各有正确换行/切目录语法；cd失败不执行命令。

动作输出和exit来自真实终端事件；runAction/PTY写入接受只证明已发送，不能宣称命令完成。停止/再次运行/关闭会话或窗口应按真实终端生命周期清理，终端已错误/退出/重连中不能偷偷重发旧命令。

## 3. cleanup删除链的已证顺序与失败

固定worker：`delete-worktree → scheduleWorktreeDelete → deleteWorktreeWithLimit → yv → _M → _D → __/_E`。

1. **先恢复快照，再cleanup，再Git删除，再目录清理**。yv先Sr(snapshot)，然后_M；snapshot失败仅 `settings-delete-targeted` 允许继续（明确warning），其他reason失败中止。cleanup修改的文件不是该次先前快照的一部分，不能声称快照包含cleanup后的最终状态。
2. _M按host限制并发、scheduleWorktreeDelete按host+worktree去重。默认执行_D；`force=true`仅影响Git remove，**不跳过cleanup**。另有显式 `skipCleanupScript` 参数才跳过；本次未证该跳过参数在哪些用户交互获授权，不能凭包内字段提供默认“忽略失败删除”。
3. _D从**目标工作树自身**读取worktree级选择key。无key/none直接跳；配置读取/解析返回error只记录cleanup-config-unavailable warning并继续；没有cleanup或有效脚本为空也跳。实际cleanup进程failed（非0、信号、取消或runner异常）会throw，**阻止后续git remove及目录删除**。
4. cleanup通过与setup共用的_E选择平台非空脚本/default回退，在 `targetWorktreeRoot + cwdRelativeToGitRoot` 执行，不在源码工作区执行。Windows按实际shell，其他平台bash；收stdout/stderr并等待exit，临时wrapper按finally释放。
5. `__`调用_E时未传injectedEnvironment，故**不注入setup专用CODEX_SOURCE_TREE_PATH/CODEX_WORKTREE_PATH**；不是照搬B run_setup的两个变量。cleanup分支不捕获/保存setup shellEnvironment；本轮没有证据表明它额外加载B保存的环境差量，不擅自添加并声称官方等价。
6. cleanup成功后才`git worktree remove`；非force的Git失败抛错，force分支还会继续尝试目录清理。当前项目已有更严格删除后读回，应保留，不能为模仿静态force分支掩盖真实失败。

### 取消的证据边界

_E runner支持AbortSignal、取消kill进程，但已追公开删除链 `yv → _M(..., void 0, skipCleanupScript)` **没有传入signal**；deleteWorktreeWithLimit也未转交。因此不能报告“官方运行中的cleanup取消已验证生效”。自动清理在候选之间检查signal，不等于当前脚本中途取消。若本项目为生命周期正确性加明确取消，应注明为保护增强；取消cleanup后必须保留工作树，不误报删完，不能把此设计伪装成官方运行时已证行为。

## 4. 手动、归档和默认自动清理

固定宿主491 managed-worktree服务 `deleteWorktree` 发真实worker请求，reason包括settings-delete-targeted、archive-cleanup、startup-cleanup、new-branch-cleanup、remove-workspace-root-cleanup。删除成功广播reload；失败针对settings抛具体错误，其他返回failed/unsupported，不能改成成功。

默认自动清理只在真实autoCleanupEnabled和keepCount策略满足时运行；先排除已登记workspace根、置顶会话、活跃/待创建/新生worktree和未知/读取失败的owner，再逐候选重新检查attachment generation、置顶、owner活动/其他attachment。使用reason=startup-cleanup且**未传skipCleanupScript**，所以也经相同cleanup。删除失败保留目标、汇总错误，不为凑保留数强删。

本仓库当前确定的删除链：WorktreesView.confirm → `removeWorktreeWithConversations` → delete_prepare身份校验 → 真实分页关联会话（置顶阻断）→ thread/archive并读回 → git_worktree_delete → git::delete_worktree。后端持锁校验注册身份、保存快照、再force remove与读回，尚无cleanup步骤。若cleanup失败，此前关联会话可能已归档，必须像现有错误一样明确部分结果，不擅自自动恢复。

当前针对生产入口检索未发现真正执行keepCount自动删除的调度器；旧偏好/文案不能算实现。本阶段优先让共同后端删除路径执行cleanup，不突然开启新的自动删库任务。今后自动清理应复用同一受控删除链，不能绕过cleanup；原生归档/根移除是否应自动删worktree须各自授权与合同，不顺带新增。

## 5. 最小实现边界

复用B配置发现/安全read/选择、现顶部栏/键位/PTY、B受控Job进程能力和现git::delete_worktree互斥/快照/读回。最小改动是：独立顶部动作控件消费真实选中配置；终端动作使用可识别session重建并确认附着后发送；在**后端删除同一互斥范围、快照完成后、最终删除前**接一次cleanup hook，执行结果传播到现删除UI。不要在frontend先执行脚本后另发不受锁保护的删除，避免中间身份变化/并发删除。

runner须有scriptType/mode边界：cleanup不注入setup变量、不保存env差量，绝不能用简单名字替换后直接复用B setup语义。读选中配置失效与真实脚本失败分开，前者按静态官方warning继续的事实明确呈现；若选择更严格保留，登记差异。实际脚本失败保留目录/快照/日志；不自动跳过、不自动重试、不递归删用户变更。

## 6. 修改前验收目标

| ID | 操作与可验结果 |
|---|---|
| EC01 | 普通项目/worktree切换读写正确作用域，none/默认/自定义/失效独立；host/root/连接晚到不混项。 |
| EC02 | 平台过滤、按名称最近排序/持久化、主按钮、原索引1..9命令、空/长列表和长命令按官方映射回归。 |
| EC03 | 顶部运行以定义根cwd创建/重启真实会话终端，旧后台进程树先停、attach后只发一次；输出/exit/错误实回放，已发不等于成功。 |
| EC04 | 添加动作保存冲突/读回失败不运行；保存成功后仅执行真实新动作，existing草稿/索引变化不串台。 |
| EC05 | 隔离真实worktree先snapshot→cleanup写测试marker→remove；cleanup确认目标cwd/平台回退，未注入两setup变量，不保存新env差量。 |
| EC06 | 无环境/none/缺cleanup/空脚本跳过；配置不可读/parse-error有明确warning；非0/信号/异常阻止删除，目录和快照保留。 |
| EC07 | 并发删除、脚本中切页/关闭、进程树与管道清理、取消增强均不触发late remove；cleanup结束后再次校验worktree身份。 |
| EC08 | 已归档关联会话＋cleanup失败明确部分结果；已有快照失败例外/置顶保护/删除读回回归，不自动恢复或忽略。 |
| EC09 | 自动清理如现未实现标未验，不能mock成功；已实现的未来入口必须同cleanup链并保留保护候选，不引入新自主删除策略。 |
| EC10 | 当前源码对应原生构建，顶部菜单宽窄窗/焦点/Escape/键位、终端输出、cleanup失败UI同环境视觉证据；官方原生/像素与用户验收仍独立。 |

本次仅静态证据和产品入口地图，无真实动作/cleanup/删除测试结果，所有运行时结论保持待验。
