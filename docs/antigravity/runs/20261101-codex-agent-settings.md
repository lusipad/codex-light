# 2026-11-01 — 16.06A 本地用户配置保存纠偏

范围：兼容agent入口的本地用户配置，官方Work偏好仍未接入。不把本地表单当官方远程页面。

## 来源与合同

固定asar沿用16.05证据，SHA-256复测记录见本批reference-asar-hash.json。固定包包含codex-offline补丁标记，正式发行包可信度与官方运行时缺口保留。Work panel使用/wham/work/settings，受账号/能力gate限制；本地合同采用当前CLI真实config/read、configRequirements/read、config/batchWrite及schema，不混用两个数据源。详见[修改前规格](../specs/16-06-agent-settings.md)。

## 实现与简化

- 新增AgentSettings，复用既有config协议与模型能力函数；撤下旧agent表单、三组自创预设、协议失败转本地写入的入口和共享跨分区保存按钮。没有新增依赖。
- 读取无cwd的用户配置层，生效值独立展示；显式区分user/profile/disabled，不把项目有效配置回填全局。
- 保存只提交变化字段、文件路径与加载版本；服务拒绝直接报错，草稿保留。granular等对象审批不自动归一化。
- 保存后重新读取用户层核对值，读回异常明确“写入已成功但核验失败”；托管覆盖单独报告。配置刷新失败与写入失败区分。
- 同步ref防重复写入，卸载/StrictMode生命周期的旧操作不改新状态。推理候选来自选中模型能力，现存未知值保留可见；留空恢复默认。
- SettingsView仅更换agent内容及该页公共保存入口，其他分区公共保存的历史风险不在本轮冒然改写。

## 验证

AS01–AS06直接运行生产helper和JSX回调，覆盖层作用域、最小写入、对象策略保留、expectedVersion、覆盖与读回失败、重复点击、草稿及卸载。隔离真实CLI 0.159.2往返证明：user层、版本变化、旧版本拒绝、null移除；无认证、无模型轮次，未修改真实用户配置。

完整标准检查退出0，原生Release/MSI/NSIS构建退出0；229项所选源码/验证输入指纹保持一致，产物已归档，见[核验记录](../../../.ref/parity/16.06/verification.md)。

## 限制

本地表单尚无官方相同模式/身份/gate可见性与视觉对应证据；Work远程设置未实现。没有原生焦点、退出重启、多窗口实测或像素对照。模型候选仍由主应用当前有效提供商目录提供；切换其他提供商、完整profile/上下文/联网子配置仍待后续合同。本轮不新增提供商切换入口，不把schema枚举等同账号模型能力。

visual-verdict缺配对图，不执行评分；没有用户验收，未提交推送。下一分区16.07先调查个性化指令与真实消费链，避免desktopPreferences被当服务端能力。

本批[EXE](../../../dist-artifacts/16-06-agent-settings-20261101/CodexNative.exe)：14,231,552 bytes，SHA-256 `BDC6FD8AC5847337E3C3A5C4BBE7ABDA6BD172CF5C5627121C06595404A80487`。下一单元已有[只读调查](../specs/16-07-personalization.md)，没有提前修改其产品代码。
