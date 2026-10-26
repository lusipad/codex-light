# 02 会话基础页

日期：2026-10-25，续开发于2026-10-26。状态：本轮修复自验完成，待用户验收；整页严格1:1未通过。
用户本轮明确要求进入下一页，01 未完成项继续保留，不将其改为已验收。

## 功能调研与证据

- 基准沿用官方 26.928.21956 / 12404；包哈希和 CSS/首页样本在 `.ref/parity/00/manifest.json`。本页相关 chunk 须独立核对。
- 本轮搜索并读取官方文档：https://learn.chatgpt.com/docs/app-server#items 。userMessage.content 是结构化输入数组，agentMessage.text 是累积回答，item/completed 的 plan 为权威结果。事件有 threadId/turnId/itemId 定位，不能按当前页面的最后一条消息猜测。
- 官方功能总表 `codex-app-full-surface.md` §2.3：Markdown、代码、表格、复制、查找、历史失败恢复与消息流。
- 已提取文案索引：`codex.commandDescription.findInThread` = Search the current chat；`copyButton.copyCode` = Copy code。来源 `app-shared-a906948d8868.js` 和对应文案 chunk。这是静态发现，不等于最新 UI 实测。
- 本轮重新从当前 asar 提取 `static-thread-transcript-4e124372a69f.js`、`app-shared-a906948d8868.js` 并记录 SHA-256，见 `.ref/parity/02/reference-manifest.json`。
- 代码围栏解析参考 CommonMark 0.31.2 §4.5：https://spec.commonmark.org/0.31.2/#fenced-code-blocks 。本轮只修复围栏子集，不宣称整个 Markdown 解析器完全符合 CommonMark 或与官方渲染器完全相同。
- 官方 UI 由 ChatGPT.exe 承载，现有 Computer Use guidance 禁止自动化该 UI；本页不操作官方 UI。没有同尺寸参考时不宣称视觉通过。

## 当前确证差距

| 差距 | 当前证据 | 最小修复 |
|---|---|---|
| 跨会话事件污染 | App.tsx turn started/completed 未按 threadId 隔离，增量固定附加到最后一轮/最后一条 | 事件按 thread/turn/item 身份合并；后台通知使用原事件会话 |
| 历史请求竞态 | selectThread 和 loadEarlierTurns 的 read/list 返回后缺少请求身份核验 | 切换清理展示，每次异步提交核对请求代次；失败有重试 |
| 阅读位置丢失 | turns/isStreaming 改变即 scrollIntoView 到底部 | 用户接近底部才跟随；前插历史补偿视口 |
| 新一轮开始导致旧回复操作区消失 | 实际 App 隔离回放中，isStreaming 会隐藏所有历史回复复制操作区，引起阅读位置变化 | 仅隐藏当前运行轮次的回答操作区，历史轮次保持稳定 |
| 流式代码块闪为正文 | MarkdownView 仅匹配完整三反引号代码围栏 | 按行解析围栏，未闭合时保留代码块；支持更长围栏与波浪号 |
| 畸形文件链接导致页面异常 | renderInlineSegments 直接 decodeURIComponent | 非法编码保留原始路径，不使整个回答渲染失败 |
| 查找漏检结构化文本 | ThreadFindBar 对 content 数组执行 String()，变成 [object Object] | 复用文本提取规则，按实际文本搜索；结果变化时约束索引 |

## 本轮范围与边界

优先保证历史、流式、滚动与基础内容安全稳定；复用现有组件和协议，不新增依赖。不扩大到03审批/工具卡完整重做，不为 LaTeX/Mermaid 伪造渲染效果。

## 用例与完成标准

| ID | 场景 | 预期 |
|---|---|---|
| T01 | A 的 started/delta/completed 在 B 显示时到达 | B 的内容与运行状态不变；通知仍关联 A |
| T02 | 同 turn 两条消息/命令交错增量 | 仅按 itemId 合并到对应条目 |
| T03 | A 历史挂起→切 B→A 返回 | 仍显示 B；旧分页不能插入 B |
| T04 | read/list/resume 失败 | 错误可见，可重试，不展示旧会话或空成功 |
| T05 | 用户上滚时收到增量；前插历史 | 不抢到底部；当前可见内容位置保留 |
| T06 | 围栏未闭合、含内层三反引号、使用波浪号 | 已收到代码保持 pre/code，围栏边界正确 |
| T07 | 畸形百分号文件链接、HTML、危险协议 | 不崩溃、不执行 HTML/脚本；正常链接和代码复制不回归 |
| T08 | userMessage.content 数组及 assistant text 搜索 | 可命中中文与英文，不搜索 [object Object]，下一/上一结果正确 |
| T09 | 长文本、表格、代码与窄窗 | 内容不破坏布局；视觉无参考时仅记本地布局检查 |
| T10 | 最终构建打开现有会话、复制/查找/切换历史 | 原生 UI 实测；未执行的项目明确列出 |

先写回归并确认旧代码失败，再开发修复；保存最终命令和实际结果。已完成项、未测项、视觉及用户验收分别记录。

## 实现与复用

- `App.tsx` 使用 thread/turn/item 身份合并事件，保留后台完成通知；历史切换/分页/发送结果检查请求代次，提供加载失败重试，前插历史补偿视口，仅近底部跟随。
- `threadTimeline.ts` 承载最小的事件条目合并和请求身份判断；没有新增状态管理依赖。
- 将已有 `extractTextFromItem` 原样迁到 `threadText.ts`，会话渲染和查找共用，避免两套结构化文本规则。
- `MarkdownView.tsx` 按行识别围栏，支持未闭合、更长围栏与波浪号；畸形百分号文件路径不再使整条回答崩溃。复用原有代码高亮、复制、换行与表格组件。
- `ThreadFindBar.tsx` 正确读取结构化文本和命令输出，约束搜索索引，自动定位首个结果，清理定时器；Enter/Escape 不再向全局冒泡，组合输入期间不执行搜索导航。
- 新一轮输出仅隐藏当前轮次的回答操作，旧回答操作区保持稳定，避免阅读中布局跳动。

## 实际验证结果

### 自动检查

- 开发前内容用例 5/12 通过、7 项真实行为断言失败；修复后扩展为 17/17 用例通过。
- `verify-thread-timeline.mjs`：交错 turn/item/command 回放、不可变更新、缺失身份、A→B→A 延迟响应及历史合并通过。
- 两套回归已接入 `scripts/verify-all.ps1`。完整标准检查 exit 0 / ALL CHECKS PASSED：包含快捷键 39 项、内容回归、身份回放、类型检查、前端构建、Cargo check、调度单测、87 项隔离协议探针。
- 之后修正旧回答操作区隐藏，重新运行内容/身份回归、`npm run build` 与 Release 构建均通过。最终全量 `cargo test` 22/22。
- 已有 SettingsView 混合导入、bundle 体积与协议探针 DEP0190 提示仍存在。浏览器开发模式另观察到既有 popovertarget 属性提示，未扩大修改到公共菜单。

### 浏览器实际 App 集成验证

测试通过隔离 fixture 驱动真实 App 组件及 Tauri 事件监听回调；协议响应为明确标注的固定测试数据，不冒充真实后端或模型输出。文件保存在 `.ref/parity/02/app-fixture.html/.tsx`。

1. B 显示时回放 A 的 started/delta/completed：A 文本出现数 0，B 原回答出现数 1。
2. B 的两条消息交错增量：分别显示“第一继续”和“第二”。
3. A 历史挂起→切 B→释放 A：B 内容仍在，A 旧回答未覆盖。
4. B 读取失败：显示错误与重试；恢复测试后端后点击重试，B 内容恢复。
5. 结构化中文查找、Enter 下一处、结果 2/3 缩减到 2/2、代码复制内容 `const value = 1;`、畸形编码链接正常打开均已操作。
6. 阅读位置稳定后，追加增量前后 scrollTop 均为 2547.428466796875，旧消息锚点 y 均为 -146.21429443359375。
7. 顶部插入 3 轮历史后，原消息锚点 y 从 191.2857208251953 变为 191.58929443359375，差约 0.304px（浏览器小数像素取整）。没有跳回底部。

### 原生 Release 验证

- 构建：`cargo build --release --manifest-path src-tauri/Cargo.toml`，exit 0；产物 `dist-artifacts/02-thread-basics/CodexNative.exe`。
- 源码和 EXE 指纹见 `.ref/parity/02/build.json`，对应当前含既有未提交改动的工作树，不冒称干净 HEAD 构建。
- 进程使用独立 `CODEX_HOME=.ref/parity/02/native-home` 和已安装 CLI，不复制认证数据、不调用模型生成。固定消息写入隔离 rollout/projection 数据库后，通过真实 app-server 读取，用于原生渲染测试。
- 打开固定会话，显示中文、ts/python 代码块与表格；Ctrl+F 查找 marker 命中用户/助手共 2 组，下一处从 1/2 变为 2/2；Escape 关闭。UIA 与截图已保存。
- 新构建连接标识为“已连接”，上一页连接竞态修复已纳入构建。隔离目录未配置 Windows 沙箱，原生窗口显示对应提示；未安装、忽略或更改安全配置，未执行命令任务。
- 截图：`.ref/parity/02/actual/native-thread.png`、`native-thread-find.png`、`content-fixture.png`、`app-integration.png`。

## 仍未通过 / 未验证

- 缺少同尺寸、同主题、同数据的官方会话页参考；本轮主要完成逻辑和基础渲染修复，不宣称整页像素 1:1。
- 历史快照与加载期间增量重叠：2026-10-26已修复实时后缀覆盖历史全文，详见下方续开发记录；官方后缀判断仍有重复文本/部分重叠消歧边界，尚未证明所有时序均无遗漏。
- 未调用真实模型验证付费生成与中断；回放和固定消息不替代真实生成链路验收。
- LaTeX/Mermaid、复杂嵌套 Markdown、附件与03工具/审批完整行为不计本轮完成。
- 复制故障恢复：2026-10-26已补测并修复，详见下方续开发记录；原生权限拒绝本身未注入，仅浏览器故障样本覆盖。
- 本页状态为基础修复自验完成、完整对齐未验收。用户未确认，不标为已验收。

## 2026-10-26 继续开发：复制与加载重叠

先调研后修改：本轮重新计算官方 asar SHA-256，与上一轮一致。共享 chunk 的 `function GMi` 等待 onCopy Promise，拒绝或返回 false 不进入成功态，pending 时防重复，成功后约2秒复原；`LCe` 优先 Clipboard API，失败回退隐藏 textarea / execCommand。

复制回归前置样本 `.ref/parity/02/copy-fixture.html/.tsx` 明确替换剪贴板，不读取系统数据。旧代码实测：拒绝产生未处理 NotAllowedError；延迟未完成时已显示“已复制”。

计划与预期：复用 DiffDrawer 已有剪贴板回退逻辑，代码块仅在真实成功后显示已复制，pending 防重复，失败可重试，卸载清理计时器。先验证拒绝、延迟、成功、回退与卸载，再执行标准检查。历史与增量重叠另按官方 hydration 实现核查，暂不承诺无协议序号条件下的全时序保证。

### 加载回放的官方依据与已确认缺陷

- `function h7t`（共享 chunk UTF-16偏移2756521）在安装历史之前缓冲事件，安装后回放；同 item 有 agentMessage completed 时跳过对应 delta。整批 delta 已为历史正文后缀时跳过重叠，空 agentMessage started 保留适用的历史文本。命令输出取 `aggregatedOutput`。完整定位见 `.ref/parity/02/reference/hydration-replay.txt`。
- 旧函数实际回放：历史“完整前缀后缀”与加载期间“后缀”合并后只剩“后缀”，确认丢前缀。已改为请求代次绑定的缓冲，成功先安装历史再按原处理器重放；失败对空历史释放；旧代次不释放到当前会话。删除失效的 `mergeLoadedTurns`，不再并存两套合并规则。
- legacy事件归一化 method、thread_id/turn_id/text；缺少明确itemId不猜归属。
- `function l7t`（UTF-16偏移2748129）的 `turn/started` 分支对已有非inProgress轮次直接return。我们的处理器在判定前已设运行中，属于明确差异，补回归并修复。
- 该版本官方使用整批 `endsWith` 判断，不包含协议offset/sequence。对于重复字符串、历史只包含部分缓冲等情况，不能把固定版本的静态对齐当作协议无损保证。

### 复制与浏览器集成证据

- `clipboard.ts` 复用提取的 DiffDrawer helper；fallback在finally移除临时textarea。Markdown每个代码块独立等待、阻止自身重复点击、成功后2秒复原，卸载清理计时器；拒绝不抛未处理错误、不显示假成功。DiffDrawer保留原有调用方式。
- `verify-clipboard.mjs`：等待真正成功、拒绝后回退、回退false、回退throw及清理、API缺失5类通过；内容回归17/17保持通过。
- 浏览器故障fixture：拒绝后成功标签0且未处理错误为空；延迟时按钮busy/disabled，重复点击调用次数仍为2；另一个代码块可独立复制；释放后才成功。仅fallback可用时成功；pending时卸载再释放不影响新实例。页面内标注剪贴板已替换，不冒充原生权限故障。
- 真实App+隔离协议fixture：历史含后缀与不含后缀两种场景，最终均完整显示“完整前缀后缀”一次，后缀单独出现0次；完成项得到“最终权威完整回答”一次。A加载中切B再释放A，B回答1、旧A全文0。
- list与resume均失败时错误及重试可见，缓冲“后缀”仍显示，后续增量继续追加成“后缀后缀”，证明失败路径释放缓冲。
- 本轮故障截图：`actual/copy-recovery-20261026.png`、`actual/hydration-replay-20261026.png`；这些仍为明确固定数据的测试证据。
- 迟到开始事件修复：按当前会话登记初次/分页历史和完成通知中的终态轮次ID，在所有运行状态写入之前返回；切换/离开清理。直接执行App实际分支的回归先出现 `completed must ignore late started` 失败，修复后completed/failed/interrupted、新轮次和运行轮次用例通过。
- 最终源码浏览器验证：已完成快照+缓冲started，回答1、停止按钮0；B历史就绪后新轮次started，停止按钮1、交错消息各1。证据 `actual/turn-state-20261026.png`。官方guard独立保存为 `reference/turn-start-guard.txt`。

### 最终构建与本轮结论

- 最终产品修改后，完整 `scripts/verify-all.ps1` exit0 / ALL CHECKS PASSED，日志 `verify-all-20261026-final.log`；包含39项快捷键、17项内容用例、5类复制故障、历史/状态回放、类型检查、前端构建、Rust check/调度测试及87项真实隔离协议探针。未修改Rust实现，未重复报告本轮全量Rust单测。
- 最后 `cargo build --release --manifest-path src-tauri/Cargo.toml` exit0，日志 `release-20261026-final.log`。产物 `dist-artifacts/02-thread-basics-20261026/CodexNative.exe`，指纹见 `build-20261026.json`；保留上一轮构建。
- 最终原生进程使用原独立测试home与固定消息，经真实app-server读取；已连接、历史正常显示，已完成轮次无停止按钮。点击ts代码复制后显示“已复制”，系统剪贴板实际值等于固定代码 `const value = 1;`。Ctrl+F查marker、下一处2/2、Escape关闭再次通过。
- 最终原生截图 `actual/native-copy-20261026.jpg` / `actual/native-find-20261026.jpg`；没有调用真实模型，也没有操作沙箱提示中的安装或忽略。
- 本轮修复自验完成，不把固定样本回放替代真实生成，不把官方静态后缀策略替代全时序正确性证明。视觉仍缺同尺寸官方参考，页面用户验收与整页1:1仍未通过。

## 2026-10-26 会话复制入口补查

继续按本页范围收尾，03仅做独立只读调研，不越过用户验收门槛。依据已保存的官方 `GMi` / `LCe` 成功判定，检查所有会话内容复制入口。

- 当前确证：提问、回答与选区复制在异步完成前即显示成功；选区工具栏还会在父回调未完成时自动隐藏。全会话复制只读userMessage.text，遗漏结构化content。
- 新增实际App按钮回归，旧代码真实失败：`复制提问内容 must not announce success before clipboard completion`，1 !== 0。
- 最小计划：各入口复用已有clipboard helper，等待结果、失败可见可重试；选区回调传播成功/失败并清理计时器；全会话文本复用threadText提取。无新依赖，不修改工具执行/审批行为。
- 验证标准：Promise未完成无成功提示，拒绝无假成功，成功写入准确文本；选区失败保持可重试、成功后才收起。自动回归、浏览器隔离故障与最终原生构建分别记录。

### 本次结果

- `App.tsx`增加本页共用的`copyThreadText`，复用现有helper，提问/回答/选区/全会话复制都等待结果；全会话文本复用`extractTextFromItem`。未改其他全局快捷键/文件复制行为。
- `TextSelectionToolbar.tsx`传播boolean或Promise结果，失败不显示已复制、不自动隐藏；pending防重复，忽略旧选区/卸载后的结果并清理定时器。无样式变更、无新增依赖。
- `verify-clipboard.mjs`共13类检查通过：既有5类helper路径、真实App提问/回答callback、全会话结构化文本、选区失败/成功/拒绝/切选区/卸载。内容和timeline回归仍通过。实际callback测试使用TypeScript AST提取生产函数，不另写一份伪实现。
- 浏览器实际App+明确标注的剪贴板fixture：拒绝提问复制出现失败提示；回答pending成功提示0、释放后1；选区失败工具栏仍显示、已复制0；恢复成功后实际写入`b 的回答 marker`。截图`actual/message-copy-20261026.png`。
- 最终完整检查 `verify-message-copy-20261026.log` exit0 / ALL CHECKS PASSED，含87项真实隔离协议探针。Release日志`release-message-copy-20261026.log` exit0；无独立lint配置，不报告不存在的lint检查。
- 新产物 `dist-artifacts/02-thread-basics-copy-20261026/CodexNative.exe`，源码/产物指纹`build-message-copy-20261026.json`。旧构建保留。
- 最终原生进程使用独立测试home，经真实app-server读取已有固定样本，显示已连接。将提问滚至可见后复制，系统剪贴板为完整固定中文提问；回答复制出现成功提示，Markdown与固定消息统一CRLF/LF后完全一致（128字符LF文本在Windows剪贴板读取为142字符CRLF文本）。截图`actual/native-message-copy-20261026.jpg`。未请求模型、未修改安全设置。
- 原生选区故障与权限拒绝未注入，仅由浏览器和自动回归覆盖。官方同尺寸视觉、真实模型链路、复杂内容与整页用户验收仍未通过，前述限制继续保留。
