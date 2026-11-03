# 2026-11-02 工作树目录真实消费

从固定原包 worktrees-settings-page-7fd919fb89de.js 的worktreesRoot mutation与绝对路径校验开始，先写16.15A合同，再实现本机配置。

[规格](../specs/16-15-worktree-settings.md) / [待验](../acceptance/16-15A.md) / [证据](../../../.ref/parity/16.15/verification.md)。

使用已有desktop state持久化与现有Git创建/列表、项目归属解析，增加独立目录键与后端校验。创建只使用当前根目录，列表/归属兼容默认根目录；不迁移现有目录。撤无消费者策略表单，保留旧偏好值。未新增依赖。

未完成：自动清理的snapshot恢复、保留数量/上游刷新、多主机、完整官方UI与原生像素。下一队列16.16代码审查设置先做只读取证；本单元不得记整页验收通过。

验证：全量Rust111通过、完整标准检查重跑退出0、Release/MSI/NSIS打包退出0、151项产品输入无漂移；首次测试目录缺失失败日志已保留。独立lint未配置，原生UI与像素未执行。
