# 07E 交互终端阶段自验

日期2026-11-06。开发分支中的前端增量；不是官方像素、原生验收或整页完成。

## 实际变更

- `TerminalDock.tsx`：保留真实 PTY、已有标签/环境动作/隐藏恢复。标签可由方向键/Home/End 导航和 Delete 关闭，IME 组合保护；现有 Shell、字号、中断、清空控件收拢至可显式展开的兼容操作区，Escape 返回触发器。目录来自当前标签而不是新的全局 cwd。
- `TerminalDock.css`：局部覆盖硬编码暗背景；内容16/8/12 CSS px内边距，flex/min-height 防止内容挤出；标签行可横向滚动。操作区是本项目兼容功能，不宣称官方存在同形态控件。
- xterm 使用当前应用外观代码字体、字号、文字/背景/光标/选择色。监听外观及字体加载变动，更新现有 renderer、fit 后通知同一个真实 session；不重建 shell、不回写偏好。
- 回放输入分为用户键入/DOM input/paste 与自动输入。attach 前禁止写；attach 已成功而历史仍解析时保留明确用户输入，过滤自动 ANSI 应答；解析后恢复正常应答。关闭/替换/卸载释放输入监听。

## 已执行检查

以下命令均退出0，未运行 Cargo/真实 shell 命令/模型调用：

```text
node scripts/verify-terminal-ui.mjs
node scripts/verify-terminal-lifecycle.mjs
node scripts/verify-terminal-output.mjs
node scripts/verify-terminal-command.mjs
node scripts/verify-terminal-layout.mjs
node scripts/verify-environment-terminal-c.mjs
node scripts/verify-general-open.mjs
npx tsc --noEmit
git diff --check -- <本单元文件>
```

`verify-terminal-ui`执行生产键盘回调，覆盖循环导航、Home/End、Delete、组合输入不执行、操作区 Escape/焦点返回以及实际外观 token 读取。既有生命周期回归扩充TU04：附着前明确用户输入拒绝、附着后回放中用户键入保留、自动应答过滤、用户标记只消费一次、live 应答与销毁保护。原输出/命令/环境动作回归保留原有断言，只补 renderer/DOM 测试替身的新 API。

## 发布前审查修复

两项新用例先红后绿：

- TU04 ignored-input→ANSI：原布尔标记在已安装 xterm 忽略输入后残留，专项退出1，`2 !== 1`（多出一次写入）。改为 DOM Event 同步派发范围内归因，onKey 匹配确切 key 并消费。回归直接执行 node_modules 当前 xterm 的 `_inputEvent` 生产方法与 Clipboard 生产函数，覆盖非 insertText、已处理 keypress、composed/keyDown拒绝路径、实际中文/emoji输入、无数据paste、真实换行规范化与bracketed paste；过滤后续自动回答且保留真正输入。
- TU03 8px A-：原 `Math.max(10, f - 1)` 导致反向放大，专项退出1，`10 !== 8`；24px A+同样会反向缩小。统一当前外观允许的8–24px并在边界禁用。生产点击回调在8/10/12/20/24逐个验证单调方向和禁用表达式。

修复后上述两项脚本、所有本页原有回归和类型检查均退出0。DOM事件相位测试使用明确的捕获→目标→结束序列和当前xterm真实方法，仍不能替代Windows物理输入法/系统粘贴实测。

最终复核还发现 xterm CompositionHelper 的真实异步路径：同步DOM派发结束后，`_finalizeComposition(true)`的0ms回调才发出中文，原同步判定会丢弃。新增直接执行当前安装包CompositionHelper start/end/finalize生产方法的回归，先退出1（`undefined !== '中文'`），再修为有时限且与textarea实际组合段完全匹配、单次消费的凭证，退出0。覆盖等待期间ANSI不放行、旧组合未回调即开始新组合时两段不覆盖、取消后到期即使同文也不再放行；卸载取消到期timer。该修复不是长期用户输入布尔开关。无compositionstart的229键位旁路及物理IME仍未测。

## 仍未证明

- 没有官方同客户区/DPI/主题图；视觉评分为空，不能声称1px或90分通过。
- 当前底部 dock 尚未接入官方可移动、恢复的 left/right/bottom 工作面标签框架；本轮没有捏造默认位置。
- 真实 Windows 输入法、系统剪贴板、ANSI 会话、原生键盘焦点与多窗口仍需当前构建验证。回调替身证明事件合同，不能代表真实 PTY 或原生实测。
- 使用现有主题别名等价接入，尚未建立官方完整16色 ANSI palette 的配对结果。
- 原生打包、完整标准检查及用户验收由主线程集成阶段执行；本记录不预填通过。

## 主线程集成结果

本单元已合入E阶段：完整非Fast标准372项/32协议探针、独立全库474 Rust和最终原生EXE/MSI/NSIS构建均退出0。部分原生/宽窄隔离组件结果及未验项见[集成记录](ALL-PAGES-E-20261106.md)。原文中的“由主线程继续”是子任务交付时状态，以集成记录为最新检查范围；不扩大为整页像素或用户验收通过。
