# 11C 工作树设置的创建与清理

2026-11-09 阶段交付记录。[开发前合同](../specs/11C-worktree-preferences.md)

- `WorktreeSettings.tsx` 将根目录移入“创建与清理”组并采用失焦和 Ctrl+S 提交，复用绝对路径校验、持久化与读回。失败保留草稿，重复触发仍只有一次写入。
- 自动清理确认采用固定版本的中文标题、正文与取消、关闭动作。恢复快照说明、保留数量和删除前询问均采用该版本中文。信息提示支持悬停、键盘焦点、点击及 Escape，卸载清理等待计时器。
- `WorktreeSettings.css` 按官方根目录输入宽度设置 288 逻辑像素，窄窗换行。没有新增依赖或 Rust 源码。

`verify-worktree-settings.mjs` 的新断言在旧组件上先失败。修正后该脚本与 `verify-worktree-preferences-ui.mjs` 通过，覆盖失焦、快捷键、空值、IME、恢复快照说明、取消、保存失败、并发和卸载。真实中文输入法选字和官方同环境配对像素仍待验证。

发布元数据检查、125 项前端发布回放、TypeScript、Vite、Windows EXE/MSI/NSIS 构建及空白检查通过。本轮未重跑 Rust 全量。

隔离 Tauri 构建的 EXE SHA-256 为 `b9a0bf31b47661f10db62276ef6007105ba8149ec7a80ba938786503ec5b5083`。1442×914 窗口先用 Ctrl+S 保存去除首尾空格的私有根目录，再用 Tab 失焦写入第二个路径。直接读取私有桌面状态文件确认两次写入，两条新目录均未创建。关闭自动清理弹层后按 Escape，偏好保持启用且开关恢复焦点。949×866 窗口通过 Shift+Tab 查看快照说明，Escape 关闭，随后确认关闭自动清理。退出并重启后，真实根目录和关闭状态读回，保留数量控件处于禁用状态。无实际工作树删除或模型调用。

记录保存在 `.ref/parity/11/actual/11C-worktree-preferences/`。宽窄窗截图为 JPEG，视觉分数为 null。设置导航和页头仍使用既有 Worktrees 名称，默认位置的宿主路径占位及官方宽窄像素对照待取证。GitHub Windows 作业无当前阶段提交的成功记录。
