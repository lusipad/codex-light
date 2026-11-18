# 10K 本地任务详情操作验收

按[开发前规格](../specs/10K-task-detail-actions.md)调整标题区。菜单使用项目已有的 `ThreadActionsMenu`，运行、暂停或继续、删除复用现有调度和任务读写。铅笔进入原编辑器。删除确认仍使用现有 WebView 确认样式，与官方弹层的视觉对照留待下一轮。

- 原生隔离 EXE 在 1442×914 和 949×866 窗口验证并列与堆叠详情布局。两种宽度都能打开操作菜单，删除文字保持单行。Escape 关闭后回到菜单触发器，Enter 可重开，方向键与 Enter 可提交暂停。继续后 TOML 回到 `ACTIVE`。
- 窄窗取消删除后文件哈希相同。铅笔可进入并关闭编辑，任务详情恢复。菜单触发一次实际本地调度，经离线协议夹具收到匹配完成事件。状态只记录一次完成，出现「查看会话」。测试使用私有任务和离线模型传输夹具。
- 专项组件、调度入口和终态回归通过。TypeScript、123 项发布前端回放、Windows EXE、MSI 和 NSIS 构建均通过。EXE SHA-256 为 `3032348be8012a18d7378dcf7c9ae186313b39e0ccf092a6bb34f6c087afefe8`。来源、构建及落盘证据在 `.ref/parity/10/actual/10K-managed-row/`。

同环境官方配对截图、原生聊天侧栏内的菜单焦点及 IME 待验。本轮运行专项、发布回放与 Windows 构建，完整标准检查沿用上轮记录。GitHub Windows 作业仍因账户付款或支出上限未启动，等待对应提交通过远端 CI 后发布。[作业记录](https://github.com/lusipad/codex-light/actions/runs/42511523252)
