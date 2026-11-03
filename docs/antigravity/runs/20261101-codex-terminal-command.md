# 07B 终端命令投递与隐藏恢复

日期：2026-11-01。TC01–TC07、原有 TL01–TL04、类型与完整标准检查通过，Release/MSI/NSIS 构建退出 0；07 整页未验收。

## 依据与实现

[修改前合同](../specs/07-terminal-command.md)记录固定原包、onAttach/isSessionStarted/releaseRenderer 定位与证明边界。新增两个交互终端资源均从原包提取并校验 integrity，见 [07 reference 清单](../../../.ref/parity/07/runs/20261101-codex-terminal-lifecycle/reference/manifest.json)。不以只读后台输出面板推断完整 shell 行为。

- `TerminalDock.tsx`：entry 保存真实 create_or_attach Promise，工具栏命令等待创建成功；删除固定 180ms 计时器。
- 未发送命令可随隐藏/切标签取消当前 effect；投递前认领 ID，成功通知 App，仅清除同 ID 的 pending，避免旧成功清掉新命令。
- 写入失败保留命令并明确“输入可能不完整”，只有用户点重试才释放认领；启动失败提示新建终端。不会自动重放失败输入。
- App 首次打开后保持组件挂载，隐藏用 display:none 保留 DOM、标签、输出和高度；最终卸载仍沿 07A 释放视图。
- session ID 改为 UUID，关闭最后标签后正确选中新 ID。工具栏命令按当前项目的启动目录选择已有标签或新建，避免直接写入另一项目的标签。
- 复用已有 PTY 命令、map、state 和 Composer 业务入口；没有新增依赖、后端命令或 shell 执行策略。

## 检查与构建

- `node scripts/verify-terminal-command.mjs`：TC01–TC07 生产回调通过，覆盖 ready 延迟、effect 取消、不重放、显式重试、隐藏后迟到错误、工作区隔离、最后标签与 App 清理身份。
- `node scripts/verify-terminal-lifecycle.mjs`、`node scripts/verify-terminal-layout.mjs`、`npx tsc --noEmit`、`git diff --check`：退出 0。
- `pwsh -NoProfile -File scripts/verify-all.ps1`：退出 0，含隔离协议探针；[日志](../../../.ref/parity/07/runs/20261101-codex-terminal-command/actual/verify-all.log)。
- Release/MSI/NSIS 退出 0；四项绑定输入前后相同。EXE、HEAD、dirty 清单及输入哈希见 [构建身份](../../../.ref/parity/07/runs/20261101-codex-terminal-command/actual/build-manifest.json)。
- [07B EXE](../../../dist-artifacts/07-terminal-command-20261101/CodexNative.exe) SHA-256 `E202653E07994D26F4F8D82528B85780F90D3A39601959D672F1C2D5A6F50CC7`，14,037,504 bytes。

## 未完成的验证与差距

浏览器 fixture 首次因测试入口直接引用 CommonJS react-dom 而失败，改用 Vite 包解析后，浏览器 CDP 观察/刷新/关闭均超时。未得到有效截图，不把浏览器回放、视觉或原生操作记为通过；本轮隐藏 Vite（PID 187428）核验 commandline 后停止。临时标签关闭请求未获确认。自动验证通过不替代此项。

缺少同条件官方截图，视觉未评分；新增错误反馈尚未做官方文案/布局对照。真实 PTY 输入、启动到首个 prompt 的差异、初始输出去重、跨应用重启标签恢复、终端内手动 cd 后目录身份、部分输入失败和键盘/拖拽等仍待验证。当前按标签**启动目录**匹配，不宣称能跟踪 shell 里的 cd。

07B 开发推进到 08 搜索/命令面板；07 未标记完成。没有提交或推送。
