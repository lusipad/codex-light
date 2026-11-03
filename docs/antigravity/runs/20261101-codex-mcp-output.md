# 03C MCP 原始输出和普通内容

日期：2026-11-01。当前为功能增量；官方运行时、Tauri 原生与像素对照、用户验收未完成。

## 调研与实现

先写 [MC01–MC07 合同](../specs/03-mcp-output.md)，再新增组件。本轮 [参考清单](../../../.ref/parity/03/runs/20261101-codex-mcp-output/reference/manifest.json)重新校验 03A 通过 archive integrity 的三项文件哈希，并保存 UTF-16 定位片段：h_r 的 invocation 映射、yjn 的 protocol/tool/success 结果适配、Wq 的 codex_apps 错误判定，以及实际中文文案。没有重新操作官方窗口。

- `McpCallCard.tsx` 取代 App 内联 MCP JSX；卡片保持原 item 位置、进度及调用结果，无新增执行请求。
- 原始 JSON 默认不挂载；打开后显示 callId、invocation、durationMs 和适配结果，raw 保留真实协议返回、metadata 和原始错误。弹窗随同一 item 更新，不使用演示数据冒充调用结果。
- 原生 dialog 提供模态语义，Escape、关闭按钮、背景点击关闭，焦点返回入口；组合输入 Escape 不关闭，Tab/Shift+Tab 首尾循环，按键不向全局冒泡。
- 失败与协议错误显示错误结果；codex_apps 已证实的结构化错误封装不会显示完成。普通文本、结构数据、图片/音频和资源分支可展示；无内容的完成态使用官方文案，运行中不显示假空结果。
- 复用现有类型、样式 token 和图标，没有依赖、权限或协议新增。每卡 rawOpen 独立，既有通知及交错顺序保留。

## 验证证据

证据目录 `.ref/parity/03/runs/20261101-codex-mcp-output/actual/`。

- MC01–MC06 实际组件回归覆盖默认不挂载、真实字段和 metadata、更新、独立状态、组合输入/Escape、Tab 循环、工具/协议/app 封装错误和空状态。`verify-tool-cards.mjs` 的原 MCP 断言继续执行生产组件；未删除原进度、错误或内容回归。
- [完整检查结果](../../../.ref/parity/03/runs/20261101-codex-mcp-output/actual/verify-all-result.json)、[日志](../../../.ref/parity/03/runs/20261101-codex-mcp-output/actual/verify-all.log)包含命令、交错序列、工具、思考、内容及隔离协议探针。检查不是 MCP 真实账号调用证明。
- 浏览器回放发现仅靠 showModal 在最后控件 Tab 后可失焦至弹窗外，补首尾边界并加回归。修前/后状态均保存于 [browser-verification.json](../../../.ref/parity/03/runs/20261101-codex-mcp-output/actual/browser-verification.json)；修后双向 Tab 均在 dialog 内。
- Enter 打开、modal 状态、关闭后入口焦点、失败 payload kind=tool、实际错误正文均验证。宽窗 960×680 和窄窗 600×680 截图保留；窄窗 dialog x=24/right=576、scrollWidth=600。fixture 明确是本地组件回放，没有真实工具副作用。
- [构建结果](../../../.ref/parity/03/runs/20261101-codex-mcp-output/actual/build-result.json)、[绑定输入](../../../.ref/parity/03/runs/20261101-codex-mcp-output/actual/build-inputs.json)、[产物身份](../../../.ref/parity/03/runs/20261101-codex-mcp-output/actual/build-manifest.json)记录退出码及源码哈希。Vite 大 chunk 警告保留。

## 保留差距

专用 app/widget 的展开、加载、重新打开与插件分支未对齐；普通媒体与资源可展示，但媒体失败降级、annotations、JSON 语法高亮/复制工具栏及专用内容推断未完整对齐。官方默认显示范围受 widget/展开分支控制，本轮继续沿用已有普通卡正文，不宣称所有 MCP 默认展开或折叠规则一致。

原生 WebView 的 dialog/媒体行为、真实服务错误及晚到通知、固定官方配对截图和像素均待验。03A/03B 的专用命令摘要、连续活动分组和中途用户消息位置继续保留，03 整页未验收。

下一批转向 04 会话组织与项目页的现有实现和缺口，避免一直停留在工具卡细节；本单元待验项保留，不以推进下一页视为验收通过。未提交或推送。
