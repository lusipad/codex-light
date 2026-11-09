# 07J 打开终端与底部面板命令

固定官方 Windows Store 26.1103.4239.0，安装包 SHA-256 为 `fb47d6491dc3006b708cb1e14de479b882bf50f88b7daa81818f154c253266aa`。偏移使用 UTF-16，从 0 开始。

- `early-bootstrap-339-ce026819bf837ba7.js` 68251 和 68917 注册 Ctrl+J 与 Ctrl+`，菜单分别显示底部面板显隐和打开终端。
- `early-bootstrap-199-e3316cddb4ea6a6b.js` 4942226 和 4942447 分别向窗口发送 `toggle-bottom-panel` 与 `toggle-terminal`。
- `602117.ae4416017a.js` 29486、29638 和 32508 记录 Windows 菜单事件的分流。底部显隐保留标签，底部为空且终端可用时新建。打开终端调用 `launchTerminal`。同一包还存在单独的 WebView 命令 `toggleTerminalPanel`。
- `852040.93e317b7d0.js` 的 `s5y5` 模块优先复用目标面板内的活动终端或同面板既有终端，再选择新建。配置 schema `11951.da263ae686.js` 28287 指定默认底部，并允许配置为右侧。

本轮对齐 Windows 菜单及默认快捷键下的默认底部路径。验收要求 Ctrl+J 只影响底部，右侧终端持续运行。打开终端恢复或聚焦现有普通终端，重复打开保持可见。底部为空时新建，已有终端的恢复不重启 PTY，也不激活环境操作标签。右侧默认位置的偏好入口、混合面板标签及官方独立 WebView 命令另行验证。

取证清单保存在 `.ref/parity/07/actual/07J-terminal-commands/` 下的 `module-anchors.json`、`registry-anchors.json` 和 `native-menu-anchors.json`。

## 实现和回归

- 标题栏、原生菜单和快捷键设置注册两条独立命令，统一交给 App 的现有快捷键去重逻辑。终端面板继续复用已有的标签选中、恢复和创建路径。
- 首轮 Windows 构建从 xterm 输入区按 Ctrl+J 时，PowerShell 收到该按键。修正为只在 xterm 区域提前匹配应用快捷键。回归覆盖匹配按键阻断、普通字符、禁用绑定、输入法组合保护和监听清理。
- 终端命令回归覆盖底部独立显隐、空目标创建、重复请求去重、复用普通终端和聚焦。

## 最终验证

- 隔离 Windows 构建中，Ctrl+J 首次打开底部终端。把首个终端移到右侧，再按 Ctrl+J 会在底部创建第二个终端。从底部 PowerShell 输入焦点按 Ctrl+J，只收起底部。Ctrl+反引号恢复并聚焦原会话，重复按仍保持可见。菜单的两项分别实测，恢复后标签 ID 和两个 PowerShell PID 保持一致，底部提示行未出现首轮的续行状态。
- 发布元数据、117 项前端回归、722 项 Rust 全库测试、通知适配器和 EXE/MSI/NSIS 打包通过。最终产物哈希与进程号对照保存在证据目录的 `final/`。两次隔离窗口均通过标题栏关闭，模拟 Alt+F4 的结果待人工复核。
- 同环境官方配对像素、原生中文输入法、右侧默认位置偏好与用户验收待验证。最新远端 [Windows CI](https://github.com/lusipad/codex-desktop-native/actions/runs/42511523252) 的账单或额度限制仍使作业在执行前停止。
