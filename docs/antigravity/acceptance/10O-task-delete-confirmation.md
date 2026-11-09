# 10O 定时任务删除确认自验

按[开发前规格](../specs/10O-task-delete-confirmation.md)，定时任务详情将系统确认框换为带任务名的应用内弹层，复用原有 Tauri 删除、列表回读与调度刷新。取消动作不会调用删除。提交期间只允许一个删除请求，失败显示在弹层内，可对同一任务重试。

- 生产 JSX 回放覆盖取消按钮、关闭图标、Escape、外点、IME 事件、重复提交、写入失败及重试。沿用现有任务动作测试与发布前端回放。
- 隔离 Tauri EXE 在 1442×914、949×866 两种窗口下显示完整弹层。宽窗中 Enter 执行默认取消，Escape 关闭弹层，两条路径的焦点均返回任务菜单，任务配置哈希一致。窄窗中点击确认后列表更新，隔离配置目录移除。无模型轮次。
- 已验证 EXE SHA-256 为 `a3d152c832ed3f75bb5dd12fdbfa319467c85a47a319e17cbe4a9b93f1693433`。宽窄窗 JPEG、启动记录、取消哈希和删除结果位于 `.ref/parity/10/actual/10O-delete-confirm/`。

类型检查、定时任务专项、123 项发布前端回放、发布元数据、Windows 原生通知适配器与 728 项 Rust 单测均通过。本地 `npm run tauri build -- --ci` 退出 0，生成 EXE、MSI 和 NSIS 安装包。完整标准脚本和协议探针本轮未重跑。

官方静态资料支持结构和文案对照。本项目采用原生 dialog 与项目样式，提交时禁用操作，官方静态组件另外声明加载态。官方配对截图、逐像素对照、原生中文 IME、会话侧入口和故障注入仍待验证。

GitHub 最新 Windows 作业因付款或支出上限未启动。发布等待目标提交在远端通过完整 CI。[GitHub Actions 作业](https://github.com/lusipad/codex-desktop-native/actions/runs/42511523252)
