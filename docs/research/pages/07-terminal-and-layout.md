# 07 终端与面板布局 (Terminal & Layout) 调研与实现

日期：2026-10-27。状态：调研、先红断言、最小代码实现、全量标准检查与 Release 构建完成；待原生操作体验与整页用户验收。

## 1. 范围与证据

本单元覆盖底部交互式 PTY 终端与面板布局能力：
- 真实 PTY 终端生命周期：基于 `portable_pty` 实现的原生子进程与 pseudo-terminal、`xterm.js` 前端渲染、输入输出双向流式通道（`terminal:data` 与 `terminal_write`）、进程退出状态提示（`terminal:exit`）；
- 终端多标签页管理：新建多会话标签（支持选择 PowerShell / CMD / Git Bash / WSL）、切换标签、清屏、字号缩放调整；
- 会话关闭与资源释放：关闭标签时调用 `terminal_close` 杀死后台子进程，释放 Master PTY 和读者/写者句柄，销毁 xterm 实例；
- 运行中断与停止（Stop / Interrupt）：
  - 键盘 `Ctrl+C` 信号；
  - 顶栏显式“中断运行 (Ctrl+C)”动作按钮，发送 `\x03` 信号终止失控或长时间运行的脚本；
- 面板大小调整（Resizable Dock Layout）：
  - 顶部增加拖拽调整手柄（`terminal-dock-resizer`）；
  - 鼠标拖拽平滑调节高度并在范围内约束，自适应更新 `fit.fit()` 与 `terminal_resize`；
- 全局快捷键与呼出集成：`Ctrl+J` / `Ctrl+` ` 唤起与隐藏底部终端面板。

### 官方基准与后端能力依据
- 官方固定版本：`26.928.21956 / build 12404`。
- 本机 app-server 实际版本：CLI `0.159.2`。
- Rust 后端命令（`src-tauri/src/terminal.rs` 与 `src-tauri/src/lib.rs`）：
  - `terminal_create_or_attach`: 打开 PTY 会话并启动子进程；
  - `terminal_write`: 写入终端输入数据；
  - `terminal_resize`: 调整 PTY 窗口行列尺寸；
  - `terminal_close`: 杀死子进程并注销会话。

## 2. 源码差距与问题清单

| ID | 问题描述 | 影响 | 状态 |
|---|---|---|---|
| T01 | `TerminalDock.tsx` 高度固定写死为 260px，缺少拖拽调整手柄 | 用户无法根据长输出或屏幕尺寸自由调整终端大小，不满足布局自适应要求 | 已修复 |
| T02 | `TerminalDock.tsx` 缺少一键中断/停止运行按钮 | 运行长程任务时，纯鼠标用户缺少直观的终止运行手段 | 已修复 |
| T03 | `styles.css` 缺少终端拖拽调整手柄（`terminal-dock-resizer`）样式 | 调整边界没有 `row-resize` 光标与悬浮反馈 | 已修复 |

## 3. 先红验证与回归设计

设计先红回归脚本 `scripts/verify-terminal-layout.mjs`，包含：
1. **T01 验证**：断言 `TerminalDock.tsx` 包含 `terminal-dock-resizer` 拖拽元素与动态高度状态 `dockHeight`；
2. **T02 验证**：断言 `TerminalDock.tsx` 包含中断方法（向活动会话发送 `\x03`）与操作按钮；
3. **T03 验证**：断言 `styles.css` 包含 `.terminal-dock-resizer` 样式及 `row-resize` 或 `ns-resize` 光标声明。

修改前运行结果：真实先红断言失败，保存日志至 `.ref/parity/07/terminal-layout-before.log`。

## 4. 实施与验证结果

- `src/components/TerminalDock.tsx`：
  - 新增 `dockHeight` 状态与 `handleStartResize` 鼠标拖拽平滑调整高度逻辑；
  - 新增 `interruptActiveTerminal` 中断方法并在操作栏渲染 `^C` 按钮；
  - 顶部挂载 `terminal-dock-resizer` 手柄。
- `src/styles.css`：
  - 增加 `.terminal-dock-resizer` 悬浮蓝色高亮与 `row-resize` 样式。
- `scripts/verify-all.ps1`：集成 `verify-terminal-layout.mjs`。

### 自动化测试与全量标准检查
- `node scripts/verify-terminal-layout.mjs`：5 项检查全部通过（PASS）；
- `npx tsc --noEmit`：0 错误通过；
- `pwsh -NoProfile -File scripts/verify-all.ps1`：**ALL CHECKS PASSED**，退出码 0，日志保存至 `.ref/parity/07/verify-terminal-layout-final.log`；
- Release 原生构建：退出码 0，日志保存至 `.ref/parity/07/release-terminal-layout.log`；
  - 可执行文件：`dist-artifacts/07-terminal-layout-20261027/CodexNative.exe`；
  - SHA-256 哈希：`6A74D47558118AB3BED5379B8EE64D4504E22C917403925DD9342E662F248875`；
  - 指纹记录文件：`.ref/parity/07/build-terminal-layout.json`。

## 5. 限制与待用户验收说明

- **外部依赖与环境变量**：多 Shell（PowerShell/CMD/WSL）的系统路径与编码参数目前继承父进程；
- **视觉像素对齐**：原生窗口下的终端标题栏与 xterm 渲染的字符间距在不同 DPI 缩放下的像素对比仍待进一步比对；
- **验收结论**：目前已通过先红自动化回归、全量协议探针验证及 Release 构建，处于“待用户验收”状态。未经验收前不标为“已验收”。
