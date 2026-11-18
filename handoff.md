# 开发交接：Codex Light

更新时间：2026-10-27（Asia/Shanghai）。工作目录：`D:\Repos\codex-desktop-native`。

> 后续更新：本文主体记录的是 Antigravity 后续大批修改之前的交接状态。当前工作树已变化，不能继承本文源码/构建通过结论。用户已要求制定详细纠偏计划，执行入口为 [docs/antigravity/README.md](docs/antigravity/README.md)，启动指令见 [START-HERE.md](docs/antigravity/START-HERE.md)。新计划尚未执行；先审计当前改动与证据，保留所有工作，不凭本文回滚或直接扩页。

## 1. 接手结论

当前推进 **03 会话执行与交互**，最近完成“排队键盘入口”及“思考摘要、命令输出状态”的子范围修复。两轮修改尚未提交，已包含在最新 Release 中。

**01、02、03 均未获用户整页验收，不得标为 1:1 完成。** 最新检查通过只证明对应检查范围，不代表真实活跃任务、全部原生交互或官方像素一致。

用户的持续要求：必须中文回复；先功能文档调研，再开发；按页面/验收单元推进；充分利用固定版本 asar，但以运行时与可测试证据交叉验证。用户不希望反复询问是否继续，应自主完成明确、可逆的下一步。

先读 [AGENTS.md](AGENTS.md)、[逐页计划](docs/PAGE-PARITY-PLAN.md)、[03 页面记录](docs/research/pages/03-thread-execution.md)、[实施日志](docs/IMPLEMENTATION-LOG.md)。本文为交接索引，不能替代其中的约束和详细证据。

## 2. Git 与未提交工作

- 当前分支：`master`。
- 远端：`https://github.com/lusipad/codex-light.git`。
- 最近提交：`380c32c7b6e3d1ce6cabcf49c7b5ca07b1b76ec7`，`Preserve user intent while aligning desktop conversation behavior`。
- 上述提交已按用户要求推送。编写本文前，`HEAD...origin/master` 为 `0 0`；这是本地远端跟踪引用的状态，后续推送前仍需 fetch。
- 最近两轮修复在该提交之后；不要 reset、checkout 覆盖或误当成可丢弃的工作。
- 用户未再次要求提交/推送，因此本轮没有自动提交。

编写本文前的未提交文件：

| 文件 | 变更职责 |
|---|---|
| `src/components/ComposerBox.tsx` | 排队键盘回调、修饰键/长按保护、移除错误提示 |
| `src/App.tsx` | 两处 Composer 接线；摘要按索引合并；命令输出与终态 |
| `src/threadTimeline.ts` | 摘要逐段历史回放、命令/摘要最终快照处理 |
| `scripts/verify-composer-keys.mjs`（新增） | 实际键盘 handler 与 App 接线回归 |
| `scripts/verify-execution-items.mjs`（新增） | 实际通知分支、渲染表达式与历史回放回归 |
| `scripts/verify-all.ps1` | 接入两项新检查 |
| `docs/research/pages/03-thread-execution.md` | 调研、预期、结果与限制 |
| `docs/IMPLEMENTATION-LOG.md` | 两轮实施记录 |
| `.omx/`（未跟踪） | 本地页面进度，不作为产品源码提交 |

本文 `handoff.md` 是此次请求新增的交接文档。`.ref/`、`dist-artifacts/` 和 EXE 已被忽略；它们是本机证据/产物，不会随普通 clone 获得。需要远程交接时必须另行交付，不能假定 GitHub 中已有这些附件。

## 3. 已提交基线包含什么

提交 380c32c 已收录此前累计的公共外壳、模型菜单、快捷键、会话历史/内容、复制/查找、连接生命周期及 03 审批/提问、队列/Steer/中断等修复。

03 的关键已提交行为：

- 审批按会话隔离，typed ID 与本地 generation 防止错配；响应期间防重复，投递未知时不盲目重发；后端 resolved 清理待处理请求。
- 中文组合输入/空答案不提交多问题卡；不能把“响应已写出”当成工具成功。
- Steer 失败不再自动落入新轮次；队列读取分页并隔离跨会话/乱序结果，增删启动使用真实服务端 ID。
- 队列 Steer 沿用原 clientUserMessageId/完整 input，成功后确认删除原队列；失败或未知投递禁止重复启动/引导。
- 排队保留图片/文件引用及纯附件；运行中的队首“立即发送”复用 Steer；中断请求返回后等待完成通知，不假定任务已停止。

这些是修复范围说明，不是整页已验收声明。前序页面的状态、历史测试与边界见对应页面文档。

## 4. 最近两轮未提交修复

### 4.1 排队键盘入口

先核对官方文档及固定 asar，确认旧占位提示“Alt+Enter 加入队列”没有实现依据，且旧 handler 会误走普通发送。

当前只支持已有的**默认 Steer**跟进行为：

| 发送偏好 | 运行中单次排队 |
|---|---|
| Enter 发送 | Ctrl+Enter |
| Ctrl+Enter 发送（内部 `cmd-enter`） | Ctrl+Shift+Enter |

实现同时兼容对应 Meta 修饰键。Alt+Enter 不再发送，Shift+Enter 保留换行；isComposing/keyCode 229 不投递，修饰键长按不重复提交。首页和会话两处 Composer 都接已有 `handleEnqueueFollowup`，没有新建队列协议实现。

**未实现/未验收**：General 中默认 Queue/Steer 跟进行为设置、官方 `cmdIfMultiline`、自定义命令绑定。不能把当前按键修复写成官方键盘全部一致。

### 4.2 思考摘要和命令输出

- summaryTextDelta 写入 `summary[summaryIndex]`，textDelta 写入 `content[contentIndex]`；分段边界不再凭空拼正文。
- reasoning 完成快照清理旧兼容流式字段，防止旧文本与最终数组重叠；相同文字但不同索引的段不会被 Set 删除。
- command 增量写规范 `aggregatedOutput`；最终快照清理旧 `output`，渲染使用空值合并，最终空串不再回退旧缓冲。
- 无 exitCode 时按 completed/failed/declined 显示完成/失败/已拒绝，不再全部显示运行中。
- 历史回放按摘要/content 索引分别去重，空 started 不覆盖已加载内容；缓冲区有 completed 时跳过对应旧增量。既有历史回归已重验。

仍沿用此前记录的官方 `endsWith` 回放策略；重复字符串/部分重叠的语义歧义没有被证明完全消除。不要宣称无条件 exactly-once。

本轮复用原卡片，无新依赖、无 CSS 或布局重绘。MCP、文件变更、其他工具卡和完整 Plan/Goal 不属于这次完成范围。

## 5. 基准与调研依据

固定官方基准：Windows App `26.928.21956 / build 12404`。

- asar SHA-256：`17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。
- shared chunk：`.ref/parity/02/reference/app-shared-a906948d8868.js`。
- shared SHA-256：`1ffb0654bdfcba23be50c06c8698e665bdb17330d923758001d01262aa81cb5b`。
- 最新使用的本机 CLI schema 基准为 `0.159.2`，保存在 `.ref/parity/03/schema/`。安装版本可能变化，下一轮先核对，不将旧 schema 当成当前证明。

官方来源：

- [App Server：增量事件](https://learn.chatgpt.com/docs/app-server#item-deltas)
- [App Server：Steer](https://learn.chatgpt.com/docs/app-server#steer-an-active-turn)
- [Steering and queuing](https://learn.chatgpt.com/docs/prompting#steering-and-queuing)

关键本地静态锚点：

- `.ref/parity/03/reference/followup-keys.txt`：Vrt 根据发送偏好生成反向跟进快捷键，含 primary/settings chunk 哈希。
- `.ref/parity/03/reference/reasoning-stream.txt`：shared chunk 约 2717977/2718350，摘要/content 按索引分流，partAdded 仅标记边界。
- `.ref/parity/03/reference/queue-steer.txt`：分页、原消息身份、sendNow 和 Steer 后删除原队列。

偏移是固定哈希文件的 UTF-16 定位，不是稳定源码行号。asar 存在某分支不代表当前账号可用；官方升级后须重新核对。

## 6. 最新构建与验证证据

最新产物：`dist-artifacts/03-execution-items-20261027/CodexNative.exe`，包含前轮键盘修复。

源码/脚本/EXE SHA-256 清单：`.ref/parity/03/build-execution-items.json`。编写本文前已重新比对，清单内文件与最新源码/产物一致；文档更新不影响该产品构建。

| 证据 | 实际覆盖范围 |
|---|---|
| `verify-execution-final.log` | 完整标准检查 exit 0；包含新 4 组 execution 回归、前轮 5 组键盘回归及既有回归 |
| `release-execution-final.log` | Release 构建 exit 0 |
| `execution-items-before.log` | 修改前分段行为真实断言失败 |
| `reasoning-repeated-before.log` | 修改前相同独立段被误删除的失败断言 |
| `composer-keys-before.log` | 修改前 Ctrl+Enter 错走 send 的失败断言 |
| `composer-keys-browser.json` | 固定 App 按键只走 queue/add、失败保稿、Alt 不误投递 |
| `actual/execution-item-failure.png` | 固定通知中的最终摘要、命令失败和最终输出 |
| `actual/native-execution-build.png`、同名 UIA 文本 | 最新原生 EXE 连接真实 CLI、读取固定历史中文/代码/表格 |
| `actual/native-composer-keys.png`、同名 UIA 文本 | 前轮新 EXE 的 Alt+Enter 保稿、Shift+Enter 换行 |

证据目录均位于 `.ref/parity/03/`。完整索引见 `.ref/parity/03/verification.md`。

验证口径必须区分：

1. 自动回归执行实际源码分支/表达式及确定性回放，不代表官方运行时一致。
2. 浏览器测试使用真实 App 组件与显式固定协议通知，未运行命令或联系模型。
3. 原生最新回归只验证连接和历史读取，不代表工具流式通知/审批完整回传。
4. 标准脚本含原 87 项协议形状检查及新 6 项真实空闲状态检查；空闲 Steer/interrupt 返回错误、缺失队列删除为 false、无新轮次，不等于活跃任务通过。
5. 标准 Rust 单测使用 automations 过滤。本轮无 Rust 产品改动；前轮全量 30/30 只是历史证据，不能写成本轮再次执行。
6. 未配置独立 lint；已有 Vite 混合导入/bundle 大小及 DEP0190 提示仍存在。
7. 无匹配的官方同场景/尺寸参考图，未给 visual-verdict 评分，未证明像素一致。

## 7. 测试工具与环境注意事项

- `.ref/parity/03/queue-fixture.html/.tsx` 是本地测试页面，有“固定协议样本：不运行命令，不联系模型”和故障控制按钮。**这些按钮不是产品 UI，也不应作为正式界面截图交付。** 用户曾专门询问过这些按钮。
- 固定页面包含 A/B 会话、队列/Steer/中断、两种发送偏好和摘要/命令通知控制。页面刷新重置样本；偏好按钮会写该测试源的 localStorage，应在测试前显式选择偏好。
- 本轮启动的 Vite 服务已停止。需要时：`npm run dev -- --host 127.0.0.1 --port 1422`，访问 `http://127.0.0.1:1422/.ref/parity/03/queue-fixture.html`。
- 原生基础测试仅给子进程设置隔离 home：`.ref/parity/02/native-home`；CLI 路径为 `C:\Users\lus\Codex\_internal\app\resources\codex.exe`。不要复制真实认证或修改全局 CODEX_HOME。
- Cargo 实际输出目录为 `C:\Users\lus\.cargo-target\codex-desktop-native\release\codex-tauri.exe`，不是默认 src-tauri/target。构建后核对路径与时间再复制产物。
- 已存在多个旧版本自研 EXE 窗口。原生验收按确切进程路径选择最新窗口，不用旧窗口证明新源码，也不要批量终止用户程序。
- 此前携带本地模拟 CLI 启动原生构建被自动审批拒绝，仅返回 blocked by policy，无具体原因。没有原生模拟回传结果，**不要换工具或方式重试被拒绝的模拟启动**；已采用真实官方 CLI 的隔离基础回归。
- 不自动化操作官方 ChatGPT.exe；需要官方运行时证据时遵守适用工具/技能边界。官方 UI、物理中文 IME 和同尺寸参考未取得时如实记未验证。

## 8. 建议接续顺序与成功条件

继续留在 03，不因为子范围自验完成就进入 04。

1. **工具卡下一子范围：MCP/文件变更。** 先读官方完成/失败/progress schema、固定 asar 与 `App.tsx`/`ToolCallCards.tsx` 渲染，建立字段和状态映射；仅确认缺陷后写先红回归，再最小修复。成功条件：真实字段样本的进行中/完成/失败正确、最终快照不残留旧增量、切会话不串卡；不预设尚未证实的根因。
2. **Plan/Goal 单独调研验收。** 不把协议可调视作完整持久化/生命周期正确；按真实读写与事件往返建立用例。
3. **补真实活跃任务和原生完整链路。** 先明确可用测试认证与隔离工作区，验证队列→Steer→清理、中断、审批/提问、工具事件。涉及实际付费/权限动作先核对已有具体授权，不能用无认证边界或固定样本代替。
4. **补官方视觉与物理 IME。** 同版本、主题、语言、DPI、缩放、客户区与等价数据采图，保存原图/差异图/几何测量。不能拉伸图片或把当前输出更新为官方基准。
5. **交付用户验收。** 提供当前构建、可重复步骤和剩余限制；用户明确确认后才能改变整页验收状态。

General 跟进行为设置、默认 Queue 的反向快捷键、cmdIfMultiline 和自定义绑定仍是已登记的独立缺口，后续到相应设置分区时必须回归 Composer。

## 9. 常用验证命令

在仓库根目录执行：

```powershell
node scripts/verify-composer-keys.mjs
node scripts/verify-execution-items.mjs
node scripts/verify-thread-timeline.mjs
node scripts/verify-queue.mjs
npx tsc --noEmit
pwsh -NoProfile -File scripts/verify-all.ps1
cargo build --release --manifest-path src-tauri/Cargo.toml
git diff --check
```

修改后先跑相关回归，再做页面交付所需完整检查；读取实际退出码。`-Fast` 会跳过协议探针，不能报告协议已通过。修改 Rust 非调度模块时补跑相应测试或全量 cargo test。

本次 handoff 请求只创建交接文档，不重新运行产品测试、不自动提交或推送。若后续获得提交授权，遵循 AGENTS.md 的 Lore Commit Protocol，保留 Not-tested 与未验收说明。
