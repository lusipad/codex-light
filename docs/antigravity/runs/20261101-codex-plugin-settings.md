# 16.11A 插件设置组合管理

2026-11-01。先追原包真实PluginsSettings导出，发现注册表component为图标；真正页面为组合管理器，见[合同](../specs/16-11-plugins-settings.md)。固定asar哈希本轮重新确认，仍包含历史离线补丁，不能宣称正式发行基准闭环。

SettingsView撤下无消费者表单及吞错误列表，复用SkillsMcpView。共享组件增加manageOnly与目录初始模式，设置保留三个管理标签，浏览目录随当前标签跳转。App负责目录模式入口，旧偏好数据保留，不增加依赖。

专项PS01–PS04、PA01–PA06、PC01–PC04、SA01–SA06、AS01–AS06及TypeScript已通过；完整检查和原生打包结果归档于.ref/parity/16.11/actual，最终见.ref/parity/16.11/verification.md。未增加Rust改动。

[待验清单](../acceptance/16-11A.md)。官方添加菜单/文件类型/主机与gate、远程服务、原生交互及像素未完成。下一16.12 Hooks先研究来源与真实写合同。未提交推送。
