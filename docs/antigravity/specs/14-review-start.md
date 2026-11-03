# 14A Code Review 启动链路复核草案

日期：2026-11-01。状态：已补静态调用链并进入14A增量开发，完整页面未验收。

## 固定来源与已知事实

原包 SHA-256：`17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。
本轮直接从原包提取三项资源并核对 entry integrity，见
[manifest](../../../.ref/parity/14/runs/20261101-codex-review-research/reference/manifest.json)
及 [定位片段](../../../.ref/parity/14/runs/20261101-codex-review-research/reference/anchors.json)。
下列数字均为原始文件 0-based UTF-16 字符偏移。

`code-review-e186157cbafd.js`：

- `3581` 的 `F`：未提交审查生成 staged、unstaged、untracked 范围的文本请求，返回 `diffFilter: unstaged`；分支审查先调用 `git-merge-base`，缺少 mergeBaseSha 则失败，随后将明确的 baseBranch、mergeBaseSha 写进请求。
- `4600` 的 `I`：接收 context、conversationId、delivery；inline 且会话属于当前 host 时沿已有会话发起 turn，携带 `turnTrigger: code_review`，无可用 host 则报错；其余路径创建 `threadSource: code_review` 的新会话，返回 detached。
- `6379` 的模板要求普通 Markdown、简洁可执行意见；仅此路径不能证明官方使用结构化 findings 响应。

这条已追踪的官方快捷审查路径使用普通 turn 的封装；该文件没有直接 `review/start` 调用。不能由此推断整个官方 App 都不使用该 RPC，也不能直接把本项目已有 `review/start` 当作这条路径的等价实现。

## 当前实现与待解差距

- `App.handleStartCodeReview` 无条件新建会话并调用 `review/start`、delivery inline；现有验证只是源码包含四种 target 字符串，不证明官方启动方式、事件或结果一致。
- `CodeReviewView` 提供四类卡片及 PR 工作台；本轮证据仅证明上述官方快捷审查两类 context，不能据此确认卡片布局、提交/自定义入口或中文文案一致。
- 当前 PR 按钮将 `head_ref_name` 填入本地 baseBranch target，额外 instructions 在非 custom target 不进入请求；尚不能证明会审查正确的 PR head/base，禁止报告 PR 专项审查通过。
- 当前启动无同步请求锁；快速重复点击及项目切换后的晚到导航需要函数级实测。

## 修改前仍须完成

1. 追踪 E/T 封装至实际 RPC，核对当前 app-server 的 thread/turn 参数、权限继承及会话订阅；不能只把 minified helper 名当协议。
2. 官方实际入口、当前会话 inline / 新会话 detached、分支选择及失败路径交叉验证；暂不可访问的项明确未验证。
3. PR source/head/base 的实际比较链路另行追踪，未证明前不将本地分支审查包装成 PR 审查。
4. 在修改前补可执行合同：单次派发、正确 cwd/目标/权限、无 merge base 不提交、失败可重试、导航代次失效、真实通知及空结果/取消/错误。
5. 视觉合同需官方同条件截图和控件依据；当前无配对截图，不给视觉分数。

以上为初次复核记录，后续RPC补证见下文。旧页面“实现与全量验证通过”保留为历史声明，不能作为当前1:1放行依据。

## 14A 修改前执行合同

本批先对齐已确认的本地快捷审查链路，并保留现有提交/自定义 RPC 路径等待其独立官方证据。当前完整页面和PR流程不因此通过。初版草案拟保留detached默认；修改前进一步追踪caller确认官方reviewDelivery默认inline，因此采用同项目已有会话默认inline、没有则detached，显式detached仍新建，不新增未知UI选项。

| 用例 | 操作及预期 |
|---|---|
| RA01 | 同步重复启动只产生一条请求链；失败显示原因、释放锁并可重试 |
| RA02 | 分支先真实解析 merge base，再建 code_review 会话及普通 turn；提交的文本包含确定的基准/SHA和用户关注点；权限来自当前设置，清除计划协作模式 |
| RA03 | 未知分支、无共同祖先或 merge-base 失败不新建会话、不执行模型 |
| RA04 | 同项目已有会话默认inline，普通turn带code_review；未提交范围包括staged/unstaged/untracked；运行中的会话不能被本入口误当审查追加输入 |
| RA05 | 创建会话前后项目或页面代次变化，旧流程不再启动 turn、不覆盖新视图 |
| RA06 | turn启动后有更新导航，晚到成功不抢占导航；已发出的服务操作不伪称被撤销 |
| RA07 | 原有commit/custom协议目标继续正确；不把兼容保留称官方入口已证明 |
| RA08 | 异步加载提交/分支后有效默认项能选择；项目切换或卸载后旧列表不回填 |
| RA09 | 审查面板使用同一个merge base，包含已提交与工作区差异；手动分支对比保持旧语义；换项目撤销旧审查导入状态 |

Git merge-base 仅只读解析，不自动 fetch 或 checkout。先用执行生产 callback 的回归捕获重复启动（已观察旧实现发出两次thread/start），再修改；隔离Git测试覆盖分叉、未知ref和orphan历史。官方运行时、完整提示词/host权限档、真实模型结果、PR head/base及视觉仍单独待验。

## RPC及调用者补证

[protocol-trace.json](../../../.ref/parity/14/runs/20261101-codex-review-research/reference/protocol-trace.json)含原包integrity、偏移片段及CLI 0.165.0隔离schema生成结果：

- initial `9508149`：E=Z1s沿manager.startTurn，shared executeTurnStart最终发送turn/start。
- initial `4042409`：T=X9r沿startConversation，shared `2921174`最终thread/start后turn/start。
- shared `1990438`：reviewDelivery默认inline；slash caller传当前conversationId及`V??inline`。有独立提交锁；成功inline设置diffFilter/baseBranch并打开split diff，detached导航新会话。
- turnTrigger是真实turn字段，threadSource是真实thread字段；不互相错传。当前schema支持。旧CLI兼容剥离策略尚未接入本项目，不声称适配所有旧版本。
- 官方权限封装允许sandboxPolicy或named permissions二选一；当前本项目沿用现有permissionMode/sandbox设置。named profile、服务端返回的有效权限以及完整官方review guidelines尚未全部对齐。

新会话先沿现有selectThread完成历史读取/缓冲，再提交首个turn，避免快速事件被非当前会话过滤。此处只有函数级回归，真实通知订阅、读取失败和原生表现仍待验。
