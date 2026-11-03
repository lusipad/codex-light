# 03A 命令执行卡增量

日期：2026-11-01。状态：功能增量已实现，自动检查与构建结果见下列证据；官方运行时、原生交互、配对像素和用户验收未通过。03 整页未完成。

## 依据和范围

先建立[修改前规格](../specs/03-command-cards.md)，从固定官方 app.asar 提取并校验 10 项资源，见[清单](../../../.ref/parity/03/runs/20261101-codex-execution-cards/reference/manifest.json)。原包 SHA-256 为 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`；定位偏移均为 0-based UTF-16。

- `DS`：命令卡默认折叠，展开才挂载正文。
- `KHe → zHe`：摘要使用原生 button，提供 aria-expanded 与 toggle。
- command adapter：保留 execution status、output 和 exitCode；turn interrupted 且 item inProgress 时适配为停止。
- `an` footer：运行中不显示终态结果，中断显示“已停止”，exitCode 0 才显示“成功”，其余显示实际退出码或“未知”。

以上为静态合同。未操作官方窗口，不能证明当前官方动画、键盘焦点与像素。

## 实现与简化

- 新增 `CommandExecutionCard.tsx`，替换 App 内联命令卡 JSX；每个 item 独立维护展开状态，流式更新不重置展开。
- 展开显示实际命令、权威输出及终态结果。空 aggregatedOutput 不回退到过时 output；completed 或缺少退出码不再被当作成功。
- 复用现有图标、TurnItem、协议通知与样式；未新增依赖、权限、执行请求或模拟成功。
- ThreadFindBar 直接定位 command item，先展开隐藏正文再滚动；搜索输入保留焦点。
- 原 execution-items 回归继续检查通知与最终输出，展示断言移到实际组件回归；旧“完成/失败”标签断言按官方 footer 合同替换。保留权威空输出回归。

## 验证证据

- [修改前失败](../../../.ref/parity/03/runs/20261101-codex-execution-cards/actual/command-before.log)：原摘要不是 button。
- `verify-command-cards.mjs`：EC01–EC08，覆盖默认折叠、展开/收起、流更新、权威空输出、真实退出码、turn 中断、独立状态及搜索先展开后滚动。
- 执行通知、工具卡、会话内容和 TypeScript 专项通过。
- 首次完整检查唯一失败为 UM11 的 mock 只允许用户消息查询，无法处理新增命令查询；[失败日志](../../../.ref/parity/03/runs/20261101-codex-execution-cards/actual/verify-all-before-mock-fix.log)保留。mock 增加命令查询返回 null，原用户展开/滚动断言保留。
- 最终完整检查：[结果](../../../.ref/parity/03/runs/20261101-codex-execution-cards/actual/verify-all-result.json)、[日志](../../../.ref/parity/03/runs/20261101-codex-execution-cards/actual/verify-all.log)。Fast 未启用；协议探针是隔离真实协议检查，不是当前命令卡的服务端端到端验收。
- [浏览器生产组件回放](../../../.ref/parity/03/runs/20261101-codex-execution-cards/actual/browser-verification.json)：Enter/Space 展开/收起；运行态没有终态 footer；失败无退出码显示未知；完成 code 0 显示成功；搜索 second marker 仅展开第二卡，焦点仍为搜索框。
- 宽窗 960×680 与窄窗 600×680 截图保留；窄窗 document scrollWidth=600，卡片 x=24、right=576。fixture 工具栏仅更新本地样本，不执行命令。
- [构建结果](../../../.ref/parity/03/runs/20261101-codex-execution-cards/actual/build-result.json)、[输入绑定](../../../.ref/parity/03/runs/20261101-codex-execution-cards/actual/build-inputs.json)、[产物身份](../../../.ref/parity/03/runs/20261101-codex-execution-cards/actual/build-manifest.json)。保留既有 Vite 大 chunk 警告。

## 保留差距与下一步

1. 当前 timeline 仍按 commands→files→MCP→messages 分组；官方按原 item 顺序转换/遍历。下一主要开发项是修复执行与消息顺序，先用交错 item 回放锁定预期。
2. 已解析 commandActions 的 read/search/list 专用摘要、后台进程、elapsed 与 auto-review 尚未对齐。
3. MCP raw output、widget 分支和其他工具卡不在本次范围，不宣称默认折叠规则通用。
4. 完整 App、真实命令的运行/失败/拒绝/中断、窗口键盘、官方同条件截图与像素仍待验；没有相似度评分或原生通过声明。
5. 基于 HEAD `97a4eca9f0a3bb529620c610f273b14057a4470c` 加工作区未提交增量，未提交或推送。
