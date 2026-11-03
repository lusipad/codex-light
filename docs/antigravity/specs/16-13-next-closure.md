# 16.13B Git：真实提交 / PR 消息生成及指令消费

2026-11-03 修改前合同，调研完成，尚未实施。主切片：**设置中的提交 / PR 指令 → 真实 Git 上下文 → 隔离 app-server 生成 → 结构化结果 → 原有提交 / PR 表单**。禁止继续用文件名模板冒充生成，禁止仅增加没有消费者的指令表单。

## 1. 固定基准与取证

官方 Windows Store `OpenAI.Codex_26.1027.3384.0_x64__2p2nqsd0c76g0`，asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。本次提取文件逐一核验 asar header integrity，见 [manifest](../../../.ref/parity/16.13/actual/16-13B-research/manifest.json)。[anchors](../../../.ref/parity/16.13/actual/16-13B-research/anchors.json) 保留 0-based UTF-16 code units 片段；[中文](../../../.ref/parity/16.13/actual/16-13B-research/zh-copy.json)、[路由](../../../.ref/parity/16.13/actual/16-13B-research/route-anchor.json)、[产品快照](../../../.ref/parity/16.13/actual/16-13B-research/product-snapshot.json) 分别记录来源。未执行模型、真实 Git 写入、配置写入或账号请求。

固定包实际页面为 `git-settings-7f958a3af0c6.js`，`settings-lazy-routes-1c307af3cdd3.js` 的 `git-settings` slug 懒加载其 GitSettings；旧 a988 chunk 不作为本轮固定版本定位。页面依次包含：受 gate 的差异模式、分支前缀、PR 合并方法、force-with-lease、草稿 PR、审查呈现方式、提交指令、PR 指令。

## 2. 当前主要缺口和注入点

- `src/components/GitSettings.tsx` 仅有 3 个开关；`src/gitPreferences.ts` 已有宿主独立 key 写入→读回机制，可扩展真实 string 指令，不写 config.toml 的虚构字段。
- `DiffDrawer.tsx:1065` 的 handleGenerateCommitMessage 按文件扩展名和 basename 拼固定 Conventional 字符串，显示“已自动生成”成功；这不属于官方生成。handleCommit / handleCommitAndPush 在空输入时也直接拼 `update ...` 后提交。下一阶段须消除这些伪生成路径，不能只改“生成”按钮而留下空消息旁路。
- 同文件 handleCreatePr 已调用真实 git_create_pr，但当前需手填标题；增加真实消息生成后保留用户已填写标题/正文，仅填空字段。生成成功只表示表单获得文本，不表示 Git 已提交、推送或 PR 已创建。
- 现有 gitContextRef、gitWritePendingRef 可复用；生成还需自己的取消/代次和草稿快照，不能让晚到输出覆盖用户操作。

## 3. 设置与保存行为

共享 `Vht`→`yX` 定义：`git-commit-instructions`、`git-pr-instructions` 默认空字符串，均 `hostStorage.kind: global-state`。`agentAccess: read-only` 是 agent 访问标注，**UI 可编辑**。作用域是宿主偏好，不是每仓库配置或系统 Git config。

固定中文：提交指令 / “将添加到提交信息生成提示中” / “添加提交信息指引…”；Pull Request 指令 / “将添加到 PR 标题/描述生成提示中” / “添加 Pull Request 指引…”。官方 autosaving 组件为 6 行文本域，修改后 3000ms 去抖，显式保存或 Ctrl+S 可立即 flush，卸载触发 flush；相同 draft 复用结果，失败保留草稿可重试，显示保存/保存中/已保存（已保存 3000ms）。不要在未完成写入及真实读回前显示已保存；读回失败不得悄悄丢失输入。

## 4. 官方上下文与生成指令

### Git 上下文

`git-action-new-branch-field` 的 wr 请求 `commit-message-diff`，includeUnstaged 来自当前真实动作状态；不等于当前任意可见 diff。带用户原 draft、已保存提交指令；统计 unified diff hunk 增删行，合计 **>1000** 时不内联，改用文件数/增删行摘要。diff-too-large 同样明确说明过大；附“Untracked changes are not included.”。没有变更和草稿时不捏造提交文案。

PR 的 Cr 并行读取 branch review-patch、branch-metadata、review-summary；加入 head/base、已保存 PR 指令和真实 diff。diff 分行数 **>1000** 或为空时改用 filePaths（最多 100，剩余明确计数）。指令中的不成对 Markdown fence补齐。commit 指令只影响 message，PR 指令只影响 title/body。

提交上下文中的测试提示：“If you mention tests, include unit tests or UI testing frameworks only. Skip lint/tsc since CI runs those.” 不可据此编造已测试事实。

### 宿主确实走 app-server，不是专有远端假接口

固定 `.vite/build/early-bootstrap-339-096ec1020e8592e0.js`：`lE.generateCommit / generateCommitPullRequest / generatePullRequest` → ll → lo → eO。

1. ll 截取 prompt 上限：提交 20000、PR 30000、组合 40000 字符；模型来自真实 `ephemeralGenerationModel`，不能写死当前主聊天模型名。提供者兼容时检查真实 model/list，必要时在可见、无 specialty、支持 low 的候选中选默认/首项；获取失败可保留真实配置模型，不自造目录。
2. lo 创建 **ephemeral** thread：cwd 原上下文，approvalPolicy=never、只读 permissions、runtimeWorkspaceRoots=[]、serviceTier=null，effort=low。配置禁用 codex_app MCP、multi_agent/fanout、web_search。完整提示要求“Make 0 tool calls.”。独立线程避免污染用户会话与时间线；不复用当前工作会话 turn。
3. 先注册内部通知，再 startTurn，带 outputSchema。按 threadId/turnId 收集 agentMessage 最终文本；仅 completed 终态可解析。failed/interrupted/空结果/JSON或schema不合法均失败。超时提交 30s，PR/组合 45s；中止或超时尽力 turn/interrupt。
4. finally unsubscribeThread；宿主映射为真实 `thread/unsubscribe`。dispose 在未 settled 时 abort，不触发生成重试。关闭/换项目/重连不会把取消当成功。

固定宿主生成提示和 schema 原文见 anchors 的 `let lc=e_.Y.ephemeralGenerationModel` 片段，实施时按该片段建立黄金样本，不用本段概述替换原文。关键约束：

| 模式 | 输出结构与内容 |
|---|---|
| 提交 | `{message}`；message 8–4000字符；首行至多72且不能换行；内容是纯提交消息，无 JSON/标签/fence。自定义指令优先；默认简洁祈使句，不无依据添加 scope/尾标点。 |
| PR | `{title,body}`；title 8–120、body 12–30000；匹配上下文主要语言，默认英文；正文含摘要和测试，不重复标题。未运行测试如实写未运行。 |
| 组合 | `{message,title,body}`，分别服从上述边界；提交指令仅message、PR指令仅title/body。 |

严格 schema 校验不能只检查 truthy string；已填写的 message/title/body 优先保留，生成只填缺项。提交输出到达时，仅当现输入仍为空或等于发起时 draft 才覆盖；用户中途修改必须保留。

## 5. 本仓库可实施的真实替代

当前没有 gitMessageGeneration IPC，应实现等价 **宿主专用命令**，不是调用不存在的 `generateCommit` app-server method。复用 `AppServerManager.ensure_connected / call / connection_generation`、真实通知/监听能力及现有 Git只读函数；不要复用 automations 的 workspace-write 策略。也不要经通用 `app_server_request` 的 turn/start 路径，它会进入 call_turn_with_workspace 的用户会话绑定逻辑；临时生成直接使用 manager，显式隔离。

只读检查 Store schema：ThreadStartParams 支持 ephemeral、baseInstructions、config、permissions（不能与sandbox同时传）、runtimeWorkspaceRoots；TurnStartParams 支持 outputSchema、permissions（不能与sandboxPolicy同时传）；ThreadUnsubscribeParams、TurnInterruptParams 均存在。**没有独立提交生成 RPC**，生成由 thread/start + turn/start + 通知完成实现。若当前所用 CLI 版本不支持 named permissions，可经实际 schema 证明后改用 read-only sandbox/sandboxPolicy，不能同时发互斥字段或无验证照搬新版本。配置开关的实际接受/生效及0工具执行仍需隔离协议/回放和真实集成验证，不将静态schema当模型执行通过。

生成取消必须有显式 operationId→thread/turn 所有权；连接代次变更后，旧取消不得发给新连接。通知只匹配所属thread/turn；拒绝任何工具/审批请求而非执行它们；释放监听、计时器和临时线程。不向全局聊天 UI 泄漏临时消息、审批、最近模型使用记录。

DiffDrawer 注入点：生成按钮转异步；空消息提交/提交并推送先等待真实生成结果，失败/取消不得 stage/commit/push；PR 创建前缺字段可生成并校验，成功后才能继续真实创建。保留用户清晰输入，显式真实Git动作与生成动作分开记录。提交/PR操作本身沿用现有真实链，不让保存设置或单点生成自动产生Git写入。

## 6. 修改前验收目标

| ID | 可直接开发的验证目标 |
|---|---|
| GB01 | 两指令键保存→读回→重挂载保持原文（包括换行/空串），失败不成功、草稿保留、3000ms去抖/手动flush/卸载不丢；旧响应不覆盖新draft。 |
| GB02 | 提交 prompt、PR prompt、组合 prompt 与官方黄金样本一致；1000/1001行边界、100/101文件、过大diff、未跟踪排除、head/base、指令不混作用域。 |
| GB03 | 宿主 mock transport 完整跑 thread/start→turn/start→completed→unsubscribe；捕获真实只读/ephemeral/outputSchema，无额外工具执行、无用户线程写入，模型来自实际能力。 |
| GB04 | completed先于turn/start响应、delta/final重复、其他thread事件、错误后completed、failed/interrupted、空/畸形/字段越界输出均正确处理；只有合法completed生成成功。 |
| GB05 | 取消、30/45s超时、切cwd/连接、关闭/卸载、晚到start响应均清理并安全interrupt/unsubscribe；未知送达不自动重复模型轮次；重复点击不并发重复生成。 |
| GB06 | 中途手改message/title/body不覆盖；保留非空字段，缺项才填；生成失败/取消不stage/commit/push/createPR，空消息提交无固定update旁路。 |
| GB07 | 专用生成不污染App时间线/侧栏/最近模型与全局审批；关联现有三开关消费者回归，完整标准与原生构建后分别列出未验。 |
| GB08 | 实际UI宽窄窗、指令多行/保存状态/错误、按钮loading/取消、IME与Ctrl+S作用域留截图和原生证据；官方同环境像素与用户验收未通过前不写整页完成。 |

本轮只读未执行模型。实施阶段应先做确定性协议/事件回放与隔离无模型参数检查；真实生成如受账号/网络限制必须报告未验，不能用fixture或模板返回冒充实际生成。

## 7. 同页后续缺口（不混入主切片）

branchPrefix 默认codex/、global-state键git-branch-prefix；官方用于自动分支建议（conversationTitle），不强行给用户明确输入的分支名二次加前缀。合并方法 git-pull-request-merge-method 仅merge/squash、默认merge，须有真实合并消费者才能称生效。reviewDelivery为inline/detached，固定Store页确实包含，需另追其键与/review消费者。reviewMode UI受gate `2333235660`，不能仅因静态存在强开gate宣称官方账号一致。worktreeRoot等schema存在但本页未展示，不凭定义加入表单。

阶段完成后由父代理更新验收/实施日志并按用户授权提交；官方视觉、原生交互、真实账号生成和用户验收状态分别报告，不把代码构建成功写成Git设置1:1完成。
