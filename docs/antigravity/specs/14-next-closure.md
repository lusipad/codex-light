# 14B：真实审查终态与模型行评论闭环

2026-11-03。状态：调研合同；未修改产品，未启动模型，未宣称整页验收。承接 [14A](../acceptance/14A.md)，不重复其启动 target、merge-base、互斥和导航保护。

## 当前确定缺口

14A 已将两类快捷审查接到真实普通 turn，但输出链尚不完整：

1. 官方快捷审查提示包含完整 Review Guidelines，要求普通 Markdown 和 `::code-comment{...}` 行评论。当前 `App.handleStartCodeReview` 仅发送简短范围句和用户关注点，未带该输出合同。
2. 当前 `src` 没有 `code-comment` 解析。`MarkdownView` 将原文直接分块，`DiffDrawer` 只有用户手写评论发送入口，没有模型评论输入。因此模型即使返回正确指令，也不能形成右侧定位评论。
3. `reviewLastResult` 只被写入“已启动审查”，RPC 返回后 `reviewBusy` 即释放；它不追踪真实 thread/turn 身份或终态。现有全局 turn 处理保存部分消息和 status，但不形成审查结果状态；切聊天后 item 事件又被可见聊天筛选。不能把最近一次启动提示当执行结果。

本轮要完成的用户动作是：启动审查 → 看到真实输出和执行状态 → 真正结束后将最后助手消息里的有效行评论附到正确文件/行 → 切回仍可查看；失败/中断保留已收到内容并明确真实状态。无发现时呈现真实 Markdown 结论，不伪造“零问题”结果。

## 原始来源与边界

[manifest](../../../.ref/parity/14/actual/14B-research/manifest.json)、[定位片段](../../../.ref/parity/14/actual/14B-research/anchors.json) 本轮从候选 asar 只读重新提取 3 个 chunk，逐项与 archive entry SHA-256 integrity 核对。数字均为 0-based UTF-16 字符偏移。

候选包 SHA-256：`17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。该包含已知 offline 补丁，不能称干净发行基准。本轮只提供静态动作依据，官方运行时、原生与像素仍待配对实测。

| 官方锚点 | 已观察到的静态行为 |
| --- | --- |
| `code-review-e186157cbafd.js` 的 `M=# Review Guidelines`、`P` | 请求包含完整普通 Markdown 审查合同；有行问题时输出指令；必填 title/body/file，可选 start/end/priority；没有可行动问题时直接简短说明 |
| shared `turn/completed` @2749470 | 先 drain item stream，再按 thread/turn 更新真实 status/error，保留最后助手消息，发出 turn-completed 事件；failed/interrupted 不是成功 |
| shared `J8r` 的 turn-completed listener | 对 local host 的非空 lastAgentMessage 解析 code comments，输出与 conversationId、turnId、status 一起发布；**这里没有仅 completed 才解析的状态门槛**，不能凭推测丢弃失败/中断已有评论 |
| shared `DZ` @3716645、`i6r` @5466285 | 按行首指令语法提取 `code-comment`，再逐条验证 |
| shared `r6r`、`u6r` | title/body/file trim 后非空；可解析数值转整数；start 默认1且至少1，end 默认start，逆序end归到start；priority可补标题前缀，已有[Pn]不重复 |
| shared `J3r`、`D1` | 按 cwd 和 workspaceRoots 选择最长匹配根；Windows根比较忽略大小写；兼容绝对路径和包含workspace文件夹段的相对定位；位置为 right side，line=end，可带start_line |
| shared `E1` @4804715、`a6r`、`o6r` | 评论身份包括工作根、相对文件、side、行范围和内容，合并去重，按 conversationId 存储；不能只按标题或文件名去重 |
| initial `m8s` @9625506 | local host 的完成事件评论合并到 `diff_comments_from_model` |

这条链证明普通 turn 的 Markdown 行评论，不能推导 commit/custom 的 `exitedReviewMode.review` 内容应转换成相同结果，也不能把 PR 远端评论上传混进本单元。`enteredReviewMode/exitedReviewMode` 不得被视为执行成功证据。官方 shared `T_r` 将其列入不可见内容判断，但具体全部渲染条件仍须独立核对。

## 修改前执行合同

| ID | 操作、预期与验证 |
| --- | --- |
| RB01 | 快捷审查请求包含有来源的完整输出合同和原有范围/关注点，仍使用14A真实turn；不要求JSON findings，不增加不支持协议字段。检查真实提交参数与生产提示构造 |
| RB02 | 启动响应只表示已派发/执行中；threadId+turnId唯一关联结果，真实 `turn/completed` 才确定 completed/failed/interrupted。缺失/未知终态保持未确认，不默认成功。用执行实际通知入口的回放验证 |
| RB03 | 同turn最后助手消息流式分片合并；结束前不将半条指令变评论。完成时已有 item 流或 completed.turn.items 均能提供真实末条助手文本；不能只扫某个delta或把多个助手消息串成一个新结果 |
| RB04 | 完成通知可能早于启动RPC返回；按身份幂等归并，晚启动响应不能把已结束状态改回running，重复结束通知不重复评论。新turn不接受旧turn状态覆盖 |
| RB05 | 切聊天/项目后旧审查继续真实执行，晚通知不抢导航、不污染新项目；返回原聊天能从已保存状态或真实历史重新构造其结果。断连标未确认，重连真实读回thread/turn，不能凭本地计时器宣告结束 |
| RB06 | 有效指令映射 title/body/file/start/end/priority；数值、缺省、逆序范围、已有[Pn]、Windows大小写和多根最长匹配按上述来源核对。无效单条不生成空评论，不使整条Markdown丢失 |
| RB07 | 同一结果重复处理或历史重读不增殖评论；不同内容/不同范围的发现不能被文件名或标题误去重；以conversation隔离，适配本项目真实thread身份 |
| RB08 | 评论呈现在正确右侧文件/行范围；打开对应diff或文件定位，文件不存在/当前diff不含该行时保留可见内容并说明无法定位，不伪造匹配。用户手写评论入口保持原语义，不自动发送模型指令或外部GitHub评论 |
| RB09 | failed/interrupted保留真实已收Markdown及可解析评论，同时明确终态与错误；评论存在不等于审查成功。真实completed但空消息只表示已结束无返回内容，不能推断“未发现问题”；明确无问题文本按真实内容呈现 |
| RB10 | 普通非审查Markdown、历史消息、审批拒绝、停止按钮、共享DiffDrawer进行回归。新增渲染若剥离指令，必须验证有效指令转成可见评论、无效/普通代码示例不被吞掉；不要用全局正则抹除文本 |

## 最小开发范围与交付

优先复用现有通知合并、历史加载和 DiffDrawer；新增必要的纯解析/身份归并工具即可，不建第二套会话引擎。可以在现有最近审查区域呈现状态，但其布局只是本项目暂存入口，不能据此声称与官方首页/审查页视觉一致。执行状态不可绑在启动按钮的网络busy上。

验证分层：

- 函数/事件回放：执行生产解析和通知归并，覆盖 RB01–RB10，包括早完成、重复、乱序、切上下文、失败、断连重读。回放不是实际模型成功证据。
- 真实协议：隔离home/项目，至少核对当前两版CLI的Turn/AgentMessage/完成通知形状。schema只证明字段；有真实模型条件时执行含已知缺陷的小Git fixture，保留真实末条消息、终态和定位结果。不能硬编码模型一定发现某缺陷，也不能用注入文本冒充模型生成。
- 原生：当前源码构建，执行审查→流式→停止/失败/完成→评论定位→切回、窗口与键盘交互。缺少账号/模型时明确未测。
- 视觉：官方固定环境同尺寸配对，比较Markdown正文、行评论位置/范围、展开状态；保留差异。当前没有这一证据。

14B 自验后再转下一主要页；PR head/base真实比较及外部评论发布、commit/custom结果合同、完整官方Review Guidelines权限继承和像素配对仍分别登记，不因本单元部分通过被抹掉。
