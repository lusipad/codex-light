# 09K 计划任务的活动身份数据

依据[开发前规格](../specs/09K-scheduled-run-identity.md)，调度器在取得真实聊天 ID 后，把运行身份写入既有原子状态文件。保留最近 200 次，开始和终态用任务 ID 与认领时间去重，状态查询返回仍存在的本地任务对应的聊天 ID。客户端区分缺字段和权威空列表。

- 旧版状态可导入每个任务最后一个已知聊天。此前已被覆盖的聊天无法从旧文件恢复。测试覆盖同一任务的两次运行、关联任务重复聊天、迟到旧记录、已移除任务和私有状态序列化读回。
- Windows 原生定时任务页手动触发同一隔离任务两次。真实 Tauri 调度器向私有传输夹具各发出一次 `thread/start` 与 `turn/start`，收到两个不同的聊天 ID 和终态。状态文件保留两条身份，最新运行计数为 2。测试没有调用真实模型，窗口已退出。
- 724 项 Rust 全库、117 项前端回放、TypeScript 以及 Windows EXE、MSI、NSIS 打包通过。原生 EXE SHA-256 为 `a67edfb481dfa37c4ba8f93a3122ba272a9df0c5023b3a78f7eb7f16041cda25`。证据位于 `.ref/parity/09/actual/09K-activity-scheduled/`。

活动菜单筛选、独立未读运行回执、跨账号作用域和官方同环境对照待继续推进。当前阶段未运行完整协议探针。GitHub Windows 作业仍因账户付款或支出上限未启动，版本发布等待对应提交的远端 CI 成功。[作业记录](https://github.com/lusipad/codex-desktop-native/actions/runs/42511523252)
