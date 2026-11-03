# 02/03D 会话与执行 UI 纠偏合同

日期：2026-11-04。范围：用户长消息打印呈现、命令的真实已解析动作摘要。先核当前官方资料，再做独立组件增量；不修改 App、Composer、全局 CSS、审批 wire 或事件合并。

## 当前基准与证据

- Store `26.1027.3384.0`，原包 `C:/Program Files/WindowsApps/OpenAI.Codex_26.1027.3384.0_x64__2p2nqsd0c76g0/app/resources/app.asar`；实测 SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。
- 原文、逐文件 SHA、archive integrity、0-based UTF-16 锚点保存于 `.ref/parity/02/actual/02-03D-ui-correction/reference/`。旧 `scripts/extract-asar-file.mjs` 指向旧包，未用其默认路径冒充当前基准；本次显式读取上述 Store 原包。
- `app-initial-4267e52fe5b0.js`：`zZt`（2406306）将协议 `read/listFiles/search/unknown` 转为 `read/list_files/search/unknown`；command adapter（7737240）拒绝态退回 unknown，按最终/进行中状态传入 `isFinished`。共享该文件及 zh 原文的清单见05D reference manifest。
- `subagent-activity-chip-group-6fb64417b5f0.js`：`UT` 按 parsedCmd 分派，`JT`（180989）区分搜索 query+path、query、无query；`tE`（183394）区分列文件是否有path；`oE`（184952）读取摘要显示名称、完成后才显示普通 read。`GT` 默认 collapsed、保留真实 output/exitCode；`RT`（170514）进行中不宣告终态。
- 同包 `zh-CN-88ebb426d686.js`：`toolSummaryForCmd.read/searchingFor/searchedFor/exploringFiles/exploredFiles` 等作为中文原文；例如“已读取 {path}”“正在 {path} 中搜索‘{query}’”“已列出 {path} 中的文件”。不自行改写已知中文，引用中引号以原文实际中文双引号为准。
- `collapsible-user-message-content-7e9476df8dd3.js`：`x` 注册 beforeprint/afterprint，打印时 `d=true`，`x=!d&&collapsed`，完整正文且不显示展开按钮；afterprint 恢复先前展开状态。toggle 有 `data-markdown-copy=exclude`。保留20行/19行+省略号、代码块完整性与隐藏控件 inert 约定。

## 修改前行为与本轮选择

现有 CommandExecutionCard 对所有 read/search/listFiles 均显示“已运行命令 + 完整shell命令”，没有利用服务端已有解析结果。本轮只为单一明确 action 添加官方中文语义摘要；不本地猜 shell 意图。复合命令继续通用摘要，完整原命令、流式输出和退出码保留在现有详情，不丢任何数据。

官方专用 read/search/list 行与通用执行卡是不同组件；本轮仍保留现有展开输出入口，不能称这些行的整结构已1:1。普通read进行中继续现有通用运行摘要，不伪造读取完成；中断/拒绝继续通用状态，不根据未执行动作宣告完成。

用户长消息现有折叠影响打印，且展开控件未标排除Markdown复制。补官方同名打印事件与同步刷出，打印后恢复用户原先状态。不重写富文本，不修改复制业务回调或消息内容。

## 可执行验收

| ID | 输入/操作 | 预期 |
|---|---|---|
| CD01 | 单read完成，name与path不同 | 显示官方“已读取”及name；展开仍有完整命令和原输出 |
| CD02 | search含query/path，进行中→完成 | 正在/已在文案随真实状态变化；query/path不被删改 |
| CD03 | search仅query/无query，list有path/无path | 对应官方中文；不显示undefined/null；不推导本地路径 |
| CD04 | unknown/多个action/declined/interrupted | 使用既有通用摘要；不虚构解析结果、成功或已读取 |
| CD05 | 同item由流式转完成、折叠/展开 | 展开状态保留；聚合输出和真实退出结果仍权威 |
| UD01 | 长消息折叠→beforeprint→afterprint | 打印完整正文，无省略号/展开控件；之后恢复折叠 |
| UD02 | 用户已展开→beforeprint→afterprint | 仍保持展开，不强制折回；不改全文 |
| UD03 | 卸载 | 两个print监听释放；隐藏控件与测量observer原回归仍过 |

## 验证边界

本轮运行生产组件Node回归与事件/历史/审批既有定向回归；不触发HTTP、模型或真实任务。没有同环境官方配对图，visual-verdict输入不足，score=null，不评分。DPI/App缩放/账号gate、官方图标、专用摘要分组与文件点击、复合命令拆分、完整计划/推理/审批布局、原生GUI/IME和用户验收均未完成。PlanPanel步骤表与官方proposed plan摘要不是同一surface，不用错误合同删除真实计划数据。
