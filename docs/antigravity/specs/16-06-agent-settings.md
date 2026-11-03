# 16.06 智能体设置修改前调查

日期：2026-11-01。状态：只读取证，未开始本单元产品代码。

## 发现的首要风险

固定包的agent panel是Work偏好分支，GET/PATCH `/wham/work/settings`，不是直接写本地config.toml。读取受work.cloud-orchestration.preferences能力、账号与用户身份、两个allowed状态约束；首次缺设置可能从本地偏好初始化，但仍带expected_revision=0写远程，409后重读。更新带当前revision并检查账号身份，串行同账号写入。

原始定位见[16.05取证](../../../.ref/parity/16.05/runs/20261101-codex-providers-research/reference/trace.json)内Vk、Kyn、Hk、zE与panel。它的模型来源为/tpp/models，不可用app-server model/list假装同一数据源。当前本项目agent是本地配置表单，并且写失败会转用原生配置文件写入；该fallback可能绕过有效配置的托管覆盖/作用域，不得无条件沿用。

## 下一步合同要求

1. 区分固定包Codex模式下可见的本地设置与Work远程偏好，继续追可见路由/gate和consumer；不直接激活未证实分支。
2. 本地路径核config/read、origins/layers、configRequirements/read与写入expectedVersion/target file，不能把项目有效值保存成全局偏好。
3. 完成model/effort选择、空值恢复默认、托管覆盖与当前provider支持能力合同；审批、沙箱、联网不能静默放宽或被失败fallback改写。
4. 实际保存必须读回，失败保留草稿、明确部分成功；重复点击、切换工作区、晚响应和重启持久化留用例。
5. 远程Work无安全账号桥时保持明确未实现，继续本地有证据的功能，不能仅存desktop_state冒充远程成功。

需补：Codex模式实际页面和控件、中文资源、Windows运行时、正式发行包基准与配对截图。本文不放行完整分区/官方像素验收。

## 16.06A 修改前限定合同（2026-11-01）

本轮仅纠正兼容入口的本地用户配置，不声称它是官方 Work 页。独立读取 config/read(includeLayers:true，无 cwd)，只编辑未禁用且无 profile 的 user 层；effective/origins 仅作生效值说明，不回填成全局值。保存仅提交变化字段，显式 filePath 与加载时 expectedVersion；协议失败不回退文件写入。保存后重新读取 user 层核验落盘值；okOverridden 与生效值不同分别提示，不冒充生效。模型和推理默认不承诺热更新已有会话。

协议依据：.ref/protocol/v2/ConfigReadResponse.json 的 ConfigLayer/ConfigLayerSource，ConfigBatchWriteParams.json 的 expectedVersion/filePath/reloadUserConfig；真实隔离探针已确认0.159.2支持user层、版本变化、旧版本拒绝和null移除。原始响应见 .ref/parity/16.06/runs/20261101-codex-agent-settings/actual/protocol-agent-settings.json。静态Work证据复用16.05原包trace；基准包可信度限制保留。

修改前用例：AS01 用户层与effective分离、profile/disabled拒绝；AS02 只写变化，复杂审批对象不被归一化；AS03 锁定版本、读回与覆盖提示；AS04 失败不fallback且草稿保留；AS05 重复点击单飞、卸载晚响应失效；AS06 推理候选仅采用当前模型能力、旧值可见；AS07 真实隔离配置往返/旧版本冲突。视觉和原生操作无配对证据，不记通过。

## 2026-11-03 路由归属纠正

上述“agent panel是Work偏好分支”是旧取证的错误归属，不能继续用作当前本地页面合同。新固定Store逐层路由证明agent→ConfigurationPanel，本地六项即时保存；work-settings另走远程面板。见[16.06B修改前合同](16-06B-next-closure.md)、[本地路由研究](16-06B-local-research.md)与[Work独立研究](16-06B-work-research.md)。保留旧记录供追溯，不将远程能力冒充本地配置。
