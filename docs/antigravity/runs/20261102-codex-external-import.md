# 2026-11-02 外部导入真实链

从原包ImportSettings追到主进程detect/import/completion；先写合同并运行隔离真实CLAUDE.md→AGENTS.md探针，再替换旧UI。

[规格](../specs/16-17-import-settings.md) / [待验](../acceptance/16-17A.md) / [证据](../../../.ref/parity/16.17/verification.md)。

复用现有app-server、Tauri通知与fsClient，无新依赖。取消选择不写，源变化拒绝，后台任务按ID归并并逐目标读回，App级跟踪和不确定结果重试保护。移除整份desktopPreferences覆盖及伪成功控件，旧数据不迁移不清理。

官方子项/会话选择、项目注册/历史/同步、Cowork与原生像素未完成。下一16.18存储：先核官方类别/真实清理边界，并处理自定义worktree root未纳入统计的已知缺口。

2026-11-03更新：16.17最终完整检查/构建退出0，155项冻结输入一致，见build-manifest。下一16.18实证为云端配额，上述本地统计计划已由16-18-storage-settings.md纠正。
