# 07A 终端视图资源释放合同

日期：2026-11-01，修改前建立。范围仅为渲染视图及订阅生命周期。

固定原包 SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`；提取清单在 `.ref/parity/07/runs/20261101-codex-terminal-lifecycle/reference/manifest.json`。`xterm-output-panel-23a952a4e018.js` UTF-16 偏移约 2815–3000 明确在 effect 清理中取消帧、断开 observer、释放回调与 xterm。`terminal-panel-c0ca9a862516.js` 只是加载 stub，不能证明交互 PTY 逻辑。后台 terminal tab 是只读输出面板，不能当成交互式 shell 的完整依据。

| ID | 操作/时序 | 预期 |
|---|---|---|
| TL01 | 监听注册 Promise 在卸载后成功 | 立即调用返回的 unlisten，不遗留订阅 |
| TL02 | 监听已注册后卸载 | 释放两个订阅及所有 xterm/DOM 实例，清空视图 map |
| TL03 | 卸载后迟到事件或 PTY attach 成功/失败 | 不向已销毁 xterm 写入 |
| TL04 | 快速切标签或卸载 | 清理本轮 fit 计时器、resize observer 和 window 监听 |

后端 PTY 的关闭/保留策略未由本轮官方证据确定。本轮只释放视图，保留现有后台 attach 行为，不把卸载视图等同终止 shell。固定延迟命令派发、初始事件/回放去重、标签恢复、真实多窗口身份、键盘与布局继续登记待做，不能声称整页完成。
