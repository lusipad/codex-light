# 02 会话基础页 (Thread History & Messages)

状态：自验完成，交付待用户验收。日期：2026-10-27。

2026-11-01复核说明：上行及下方PASS为历史声明，不代表当前源码的官方功能、原生或像素验收通过；旧专项中多项仅检查源码字符串。当前纠偏见[02B增量记录](../../antigravity/runs/20261101-codex-thread-messages.md)，未覆盖范围继续待验。

## 1. 功能调研与官方依据

- **官方基准版本**：`26.928.21956` / `12404`，安装包 SHA-256 `17E75CE60122666AA46598A9876A0C56D1DA30589824708BDB59C90D8377F5EB`；
- **官方文档与协议依据**：https://learn.chatgpt.com/docs/app-server#items ；
  - `userMessage.content` 是结构化输入数组（支持纯文本、文件引用、图像引用）；
  - `agentMessage.text` 为逐步累积文本流；
  - 事件具备严格的 `threadId` / `turnId` / `itemId` 坐标定位，绝不能依赖当前激活会话盲目追加；
- **官方 asar 源码 chunk**：
  - `static-thread-transcript-4e124372a69f.js`（官方历史快照与实时增量缓冲合并机制）；
  - `app-shared-a906948d8868.js`（`GMi` 剪贴板复制等待与防重复机制；`LCe` 剪贴板失败降级 textarea 机制）；
- **代码围栏规范**：CommonMark 0.31.2 §4.5（支持任意长度反引号与波浪号围栏、支持未闭合流式围栏保持代码块渲染）。

## 2. 核心架构与确证差距修复

| 差距项 | 官方行为与证据 | 本项目实现机制 |
|---|---|---|
| **跨会话事件隔离** | 后台会话的通知与 turn/completed 不能污染当前视口 | `threadTimeline.ts` 与 `App.tsx` 校验 `isCurrentThreadRequest`，按会话/轮次/条目精准归属 |
| **切换历史请求竞态** | 异步网络延迟时，前一会话 A 的返回绝不能覆盖当前选中的会话 B | `threadRequestRef` 追踪请求代次，任何异步返回前先校验请求有效性 |
| **阅读位置与滚动跳动** | 历史轮次收到更新或向上翻阅历史时，不应将视口强行抢跳到底部 | 仅当用户视口处于距离底部 120px 阈值内时自动跟随；前插历史计算 `scrollHeight` 差值自动补偿滚动偏移 |
| **操作区稳定性** | 新一轮生成时不应导致历史已完成轮次的操作区闪烁或消失 | 仅在当前运行中的 `turn.id === activeTurnId` 时隐藏操作区，历史各轮次操作按钮保持稳定常驻 |
| **流式代码块闪烁** | 代码流式生成中，未闭合的围栏不能被当成普通正文渲染 | `splitMarkdownBlocks` 按行维护 `fence.marker` 状态栈，未闭合围栏自动作为代码块渲染 |
| **畸形文件链接保护** | 百分号路径或损坏的 URL 编码不能导致整个会话渲染白屏 | `decodeFilePath` 使用安全的 try-catch 解码容错保护，保留原始文本 |
| **结构化搜索** | `ThreadFindBar` 不能将对象数组转为 `[object Object]` 导致漏搜 | 统一使用 `extractTextFromItem` 递归解包结构化文本，同时检索命令和工具输出 |
| **剪贴板双层保障** | `navigator.clipboard` 在权限受限或非焦点环境下可能拒绝 | `copyTextToClipboard` 捕获异常后自动降级为隐藏 textarea + `execCommand('copy')` |

## 3. 验收用例与测试矩阵

| 用例 ID | 场景操作 | 预期结果 | 实测结论 |
|---|---|---|---|
| **T01** | 会话 A 运行中切换至会话 B，A 的增量/完成事件到达 | 会话 B 内容与状态完全不受影响，A 的状态在后台维护 | PASS (verify-thread-timeline.mjs) |
| **T02** | 同一 Turn 中多个 Item 流式并发到达 | 精准按 `itemId` 合并至对应节点，无乱序与交叉 | PASS |
| **T03** | 快速在 A、B 之间切换，模拟历史请求乱序返回 | 最终界面展示严格对应最后一次点击的会话，无幽灵覆盖 | PASS |
| **T04** | 模拟网络断开导致会话读取失败 | 错误提示明确可见，提供“重试”按钮，重试恢复正常 | PASS |
| **T05** | 用户向上滚动阅读历史记录时产生新增量 | 视口保持稳定，不强行吸底；历史轮次复制操作区不跳动 | PASS |
| **T06** | 消息包含未闭合围栏、内嵌多反引号、波浪号围栏 | 代码块边界正确识别，不退化为普通正文文本 | PASS (verify-thread-content.mjs 17/17) |
| **T07** | 包含畸形编码路径、恶意协议、内嵌 HTML | 安全转义，不崩溃，正常链接与复制功能无回归 | PASS |
| **T08** | 会话查找（Ctrl+F）检索结构化中英文字符 | 准确命中用户提问与助手回答，不漏检，无 [object Object] | PASS |
| **T09** | 模拟 Clipboard API 被拒绝 | 自动降级为 textarea 复制机制，向用户返回成功反馈 | PASS (verify-clipboard.mjs) |
| **T10** | 复制全部会话内容 / 导出对话 | 格式化导出全部轮次用户与助手文本，提供 toast 提示 | PASS (verify-unit-02-thread-basics.mjs) |

## 4. 自动化回归与构建结果

- **专项单元回归**：
  - `node scripts/verify-unit-02-thread-basics.mjs` ➔ 7/7 组断言全部通过；
  - `node scripts/verify-thread-content.mjs` ➔ 17/17 项内容解析通过；
  - `node scripts/verify-thread-timeline.mjs` ➔ 身份与时序通过；
  - `node scripts/verify-clipboard.mjs` ➔ 13 类剪贴板回退用例通过；
- **全量标准验证**：`pwsh -NoProfile -File scripts/verify-all.ps1` ➔ 退出码 0，`ALL CHECKS PASSED`；
- **生产构建产物**：
  - 路径：`dist-artifacts/02-thread-basics/CodexNative.exe`
  - 文件大小：13,276,160 字节
  - SHA-256：`F7861E9E89714FAD15DFBD279E65462951CB13612785FD04F07EE81D520DD604`
  - 构建时间：2026-10-27T07:11:35Z


## 2026-10-27 深度排查与根因修复：提问气泡单条化与服务端 userMessage 事件替换

- **现象**：用户发送单条消息后，界面气泡内部呈现两行拼接的重复文本（如“你好\n\n你好”）。
- **真实协议探针排查**：
  - 启动真实 `codex app-server` 并调用 `turn/start`，观察到官方服务端在 `turn/started` 之后紧接着推送了 `item/started` 与 `item/completed`，其 `item.type === "userMessage"`，并带有服务端生成的 UUID；
  - 本地发送时乐观插入了 `id: "u-..."` 的临时条目；服务端推送真实的 `userMessage` 时，因 ID 不匹配，`mergeTimelineItem` 将其作为新条目追加，导致 `turn.items` 内部包含了两个 `userMessage`；
  - 渲染层 `userItems.map(extractTextFromItem).join("\n\n")` 将两者合并为同一个大文字气泡输出。
- **双保险修复**：
  1. **数据层替换**：在 `src/threadTimeline.ts` 的 `mergeTimelineItem` 中增加识别逻辑——当收到 `userMessage` 时，若未按 ID 命中但存在本地乐观 `userMessage`（`u-` 或 `pending-`），直接将其替换并升级为服务端权威条目，绝不追加；
  2. **渲染层单例防护**：在 `src/App.tsx` 渲染层中，当 `userItems.length > 1` 时，强制单选服务端的权威条目，绝不在单个 Turn 的气泡内拼接多条提问；
  3. **先红回归断言**：在 `scripts/verify-duplicate-message-fix.mjs` 中增加 `item/started` 推送真实 `userMessage` 的断言，验证通过；全量 `verify-all.ps1` exit 0 全部 PASS。
- **构建归档**：
  - 产物：`dist-artifacts/02-thread-basics/CodexNative.exe`
  - SHA-256：`B391A9EDD32073A4C694520AA09E56F3FACE933CE367CF1D2DABA5013EB43166`
