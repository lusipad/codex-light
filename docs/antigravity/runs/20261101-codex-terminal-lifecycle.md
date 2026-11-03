# 07A 终端渲染资源生命周期

日期：2026-11-01。状态：专项、完整检查和原生打包通过；07 整页未验收。

## 官方依据

修改前建立 [TL01–TL04](../specs/07-terminal-lifecycle.md)。固定原包 SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`，四项资源完整性见 [manifest](../../../.ref/parity/07/runs/20261101-codex-terminal-lifecycle/reference/manifest.json)。

`xterm-output-panel-23a952a4e018.js` 的 effect 清理包含取消帧、observer disconnect、回调释放和 `i.dispose()`；位置约为从文件头计的 0-based UTF-16 偏移 2815–3000。terminal-panel chunk 是 stub；background-terminal-tab 是只读执行输出，不将这两项当成交互式 shell 的完整实现依据。未操作官方窗口，不推断官方隐藏面板时终止 shell。

## 最小修复

- `TerminalDock.tsx` 注册回调检查卸载标记；迟到的注册结果立即 unlisten。
- 卸载释放两个订阅、xterm 实例与其 DOM，并清空 map；事件入口检查卸载状态。
- PTY attach 成功/失败按 map 内 xterm 身份校验，关闭后迟到结果不再写销毁实例，活着的其他标签仍可接收自身回放。
- fit 计时器纳入当前 effect 清理，继续复用现有 observer/window resize 清理。

没有新增依赖、后端命令或样式；删除原先从不更新的局部 disposed 变量。释放视图与后台进程分开：没有增加卸载时 terminal_close，保留既有后台会话行为。

## 验证

`verify-terminal-lifecycle.mjs` 执行生产 effect，验证迟到注册、已完成注册、卸载后数据/退出/attach 成功与失败、标签切换和定时器/observer/window 监听释放。`verify-terminal-layout.mjs` 保留原布局回归。专项、TypeScript 与空白检查退出 0。

完整标准检查、Release/MSI/NSIS 日志及构建身份保存在 [actual](../../../.ref/parity/07/runs/20261101-codex-terminal-lifecycle/actual)。本轮没有运行 shell 命令、创建真实 PTY 或操作原生终端；确定性 IO 测试不能替代这些验收。项目没有配置独立 lint 命令，不报告 lint 通过。

- `pwsh -NoProfile -File scripts/verify-all.ps1`：退出 0，含隔离协议探针；[日志](../../../.ref/parity/07/runs/20261101-codex-terminal-lifecycle/actual/verify-all.log)。
- `npm run tauri build`：退出 0，Release/MSI/NSIS 均生成；原有 chunk 大小警告保留。
- 三项绑定输入前后哈希一致；[构建身份](../../../.ref/parity/07/runs/20261101-codex-terminal-lifecycle/actual/build-manifest.json)包含 HEAD、dirty 清单与输入哈希。
- [最新 EXE](../../../dist-artifacts/07-terminal-lifecycle-20261101/CodexNative.exe)：14,037,504 bytes，SHA-256 `11DEABCAEE48F511077718911224A4367089F56D99049D0A5AC30F167D433240`，包含 06A Git 增量。

## 保留差距

固定 180ms 命令派发与失败重试、初始事件/回放边界、关闭重开后的标签恢复、多窗口 session 身份、拖拽中卸载监听清理、监听注册失败提示、完整终端键盘和布局均需继续处理。未确定官方交互 shell 生命周期，不能将只读输出组件的行为直接扩展为完整 PTY 合同。

无官方/当前配对截图，本批没有视觉修改，不评分或声明像素一致。原生和用户验收待执行；历史 07 报告仅保留历史证明范围。
