# 10N 调度状态版本兼容

按[开发前规格](../specs/10N-run-history-compatibility.md)，磁盘仍用 `activityRuns` 存放带聊天 ID 的记录，无聊天终态通过可选的 `unlinkedRuns` 保存。新版读取时合并两个集合，继续使用原有 200 条上限和原子写入。10M 旧混合格式在调度器首次写事务时转换，正常启动的恢复事务也会触发。

专项回归先用旧版字段类型读到 `missing field threadId`，修复后同一测试读回任务计数、状态、单次计划消费标记和已读时间。新版也能读回无聊天错误，并验证 10M 混合输入与新格式的状态等价。

原生 10N 启动时迁移 10M 隔离文件，详情保留成功及无聊天失败。使用 10L EXE 读取迁移后的副本，任务详情显示上次成功和查看会话，状态计数、聊天身份与已读时间一致。两次启动均无模型轮次。10N EXE SHA-256 为 `78ee6dcbbfc3f853f5a9ba7a2d4a38ada43b2dec7d9fb343138c9285f26eded1`。

728 项 Rust 测试、123 项发布前端回放和 Windows EXE、MSI、NSIS 打包通过。完整标准脚本与协议探针本轮未重跑。

旧版可读取任务和关联聊天。若旧版重写文件，其未知的无聊天历史字段可能被移除。取证目录为 `.ref/parity/10/actual/10N-history-compat/`。本轮没有界面改动。GitHub Windows 作业因付款或支出上限未启动，发布等待对应提交通过远端 CI。[作业记录](https://github.com/lusipad/codex-desktop-native/actions/runs/42511523252)
