# 16.14A 本地环境真实文件与动作

先追原包bootstrap发现/读取/schema/expectedRevision保存合同，见[规格](../specs/16-14-local-environments.md)。新增local_environment.rs，读取无副作用，官方结构校验、精确原文冲突比较、串行/临时替换/读回、平台动作校验；内部版本表示不同但比较精确，不增加哈希依赖。移除本次失去消费者的旧固定default.toml读写函数，保留现有文件。

新增LocalEnvironmentSettings生产编辑器，草稿/选择/失败/单飞/卸载保护；App复用PTY待执行队列并附带cwd，TerminalDock拒绝工作区不匹配的环境动作。手动动作不是worktree生命周期。全量Rust108通过；专项和完整标准/原生打包证据见.ref/parity/16.14/verification.md。最终队列cwd防护在完整检查运行中补入，另行补跑TC/LE/tsc并归档，原生打包在修改后进行。

[待验](../acceptance/16-14A.md)。结构化官方表单/祖先发现/选择持久化/worktree自动生命周期与变量/原生像素继续留缺口；无新增依赖，无真实项目命令执行。下一16.15工作树设置。未提交推送。
