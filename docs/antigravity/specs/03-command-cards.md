# 03 命令执行卡增量规格

日期：2026-11-01。范围：会话中的 commandExecution 摘要、折叠内容与退出结果；先按固定官方包和当前协议 schema 取证，再修改产品代码。MCP/审批/执行顺序/全量 tool cards 不属于本单元。

## 基准和官方证据

- 官方候选 26.928.21956 / build 12404；app.asar SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。
- [资源提取清单](../../../.ref/parity/03/runs/20261101-codex-execution-cards/reference/manifest.json)逐项通过 archive integrity。相关原文片段：`command-card.txt`、`command-footer.txt`、`command-state-adapter.txt`、`timeline.txt`；偏移为 0-based UTF-16。
- `sites-end-resource-cff1c624fbb8.js` 的 `DS` 默认 `collapsed`；摘要层由原生 `button` 提供 `aria-expanded` 与 toggle；正文仅展开时挂载。隐藏正文不需要 inert 补丁。
- `app-shared-a906948d8868.js` commandExecution adapter 保留 execution status 与 output/exitCode；只有 `inProgress` 为运行中。turn 被 interrupt 且 item 仍 inProgress 时适配为 interrupted；declined 的 commandActions 不套用已解析动作摘要。
- 官方 footer：进行中不显示终态结果；被中断显示“已停止”；exitCode 0 显示“成功”；其余显示“退出码 {code}”，缺少 code 显示“未知”。命令摘要“正在运行命令/已运行命令”不等同执行成功。
- 协议 `.ref/protocol/codex_app_server_protocol.v2.schemas.json`：`CommandExecutionStatus` enum 为 `inProgress/completed/failed/declined`；exitCode 是可空整数，不能以缺失当 0。
- 静态合同，官方窗口未操作。物理键盘/焦点、动画、像素与当前原生 App 仍未知。

## 修改前验收合同

| ID | 操作/输入 | 预期 |
|---|---|---|
| EC01 | 首次出现 commandExecution | 默认折叠，只显示可操作摘要；无输出可见也无隐藏焦点控件 |
| EC02 | 用鼠标/Enter/Space 激活摘要 | aria-expanded 状态同步；展开输出和结果；再次激活折叠 |
| EC03 | status=inProgress，无 exitCode | 显示运行态，不显示成功/退出结果 |
| EC04 | status=completed, exitCode=0 | 显示成功；不得仅凭 completed 表示成功 |
| EC05 | 非零 exitCode 或 failed | 显示真实退出码/失败结果，不显示成功绿态 |
| EC06 | status=declined 或 interrupted item | 不把 exitCode 缺失编码成 0；按适配后的生命周期显示未知退出结果或“已停止” |
| EC07 | status=completed 且 exitCode 缺失 | 显示“退出码 未知”，不是成功 |
| EC08 | 多个独立 command item | 折叠状态按 item ID 隔离；切换/重渲染不串项 |
| EC09 | 助手/用户 Markdown 代码执行入口 | 不受本次卡片修改影响 |

实现限制：复用实际 item/status/output，不推断服务成功，不更改工具请求、审批和协议事件；每条 command 卡仅有自己的折叠状态。工具流当前仍按类型分组显示，不在本次重写全 timeline 顺序。
