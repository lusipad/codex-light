# 03C MCP 原始输出与普通结果合同

日期：2026-11-01，修改产品前建立。固定原包 SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`；本轮 reference 清单重新核验 03A 已通过 archive integrity 的三项资源哈希，片段偏移为 0-based UTF-16。

官方证据：mcp-tool-item-content 的 Yn=false、rawOutputTriggerTooltip、rawOutputHeading、Gi；app-shared 的 h_r、yjn、Wq；实际中文语言包。原始输出仅打开时生成，内容为 `{callId, invocation, durationMs, result}`。h_r 将协议 server/tool/arguments 映射 invocation；yjn 区分 protocol error、failed 的工具错误及 success；Wq 还识别 codex_apps 的结构化错误封装。

| ID | 操作/输入 | 预期 |
|---|---|---|
| MC01 | 普通 MCP 卡首次展示 | 原始 JSON 弹窗未挂载；有“显示原始工具调用输出”入口 |
| MC02 | 打开原始输出 | 标题“原始 server.tool 工具调用输出”；字段来自真实 item，参数、内容、metadata 保留 |
| MC03 | 流更新时弹窗保持打开 | 输出更新，不关闭或换到另一卡；不同卡状态隔离 |
| MC04 | Escape/关闭按钮/背景关闭 | 关闭弹窗，焦点返回入口；Tab 留在模态框内；全局快捷键不透传 |
| MC05 | error 或 status=failed | 展示真实错误，不显示完成；codex_apps 已证实的结构错误不能显示成功 |
| MC06 | text/structuredContent/空结果 | 文本与结构数据完整保留；completed 空内容显示“工具未返回任何内容”，运行中不提前显示空结果 |
| MC07 | 卡片位于交错 timeline | 保持原 item 位置与 ID，现有进度、错误及文件/命令行为回归 |

原生 dialog 用于等价模态交互，官方焦点与 Escape 运行时仍需对照；不以静态代码证明物理键盘行为。widget、远端资源和专用 app UI 不在本单元，不宣称全部 MCP 对齐。普通图片/音频/资源按类型处理，其官方像素、metadata 展示仍待验。
