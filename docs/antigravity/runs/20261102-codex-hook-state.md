# 16.12A Hooks状态变更

先追固定原包nNo config/batchWrite写入及okOverridden分支，真实隔离0.159.2服务验证后开发。新增hookState.ts与HooksSettings.tsx，保留原始hash，写前重读并校验托管/定义，用户层版本锁写入，写后有效状态读回。

SettingsView接入独立组件，工作区key重新挂载，单飞与卸载代次保护；撤下假总开关和全局运行记录订阅，并移除本次产生的未使用状态/辅助函数。hooksClient保留currentHash且拒绝顶层非法响应，旧偏好数据无迁移删除。

HK01–HK04和真实隔离探针通过，完整检查/原生打包退出码与产物见.ref/parity/16.12/verification.md；无新增依赖、无Rust改动。原包来源抽屉/插件详情/主机/真实运行历史及原生像素仍待验，不能将限定增量当整页通过。

[待验](../acceptance/16-12A.md) · [合同](../specs/16-12-hooks-settings.md)。未提交推送。下一16.13 Git设置先追官方持久化与实际消费者，不能把旧GPG/Conventional表单当功能。
