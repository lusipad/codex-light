# 03 会话执行与交互：审批与提问首轮

日期：2026-10-26。状态：审批与提问首轮实现及自动/浏览器自验完成；原生完整回传、视觉与整页用户验收未通过。01/02未验收状态保留。

## 范围与证据

本单元覆盖工具卡、思考、Plan/Goal、队列/Steer、中断、审批、多问题及附件。当前仅只读核对代码与静态实现，不代表整页调研完成或运行时通过。

- 官方固定版本26.928.21956 / build12404，asar SHA-256沿用并重新核对为 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。
- 共享chunk `app-shared-a906948d8868.js`，SHA-256 `1ffb0654bdfcba23be50c06c8698e665bdb17330d923758001d01262aa81cb5b`，完整提取在 `.ref/parity/02/reference/`。以下UTF-16偏移只是固定哈希定位，升级必须重查。
- 官方审批按threadId写入对应会话状态，锚点 `Missing threadId for approval request` / `Missing threadId for user input request`，约2819297–2820500。
- 官方请求解决时清除对应请求，锚点 `function j5t`、`t.requests=t.requests.filter(e=>e.id!==i)`，约2739088。
- 本轮重新检索上述锚点并保存定位片段至 `.ref/parity/03/reference/request-lifecycle.txt`，不是运行时截图或协议执行结果。
- 协议资料：`.ref/protocol/ToolRequestUserInputParams.json` / `ToolRequestUserInputResponse.json`，以及当前app-server schema。正式开发前应再次核对实际CLI生成schema及官方文档，不把旧JSON当作当前协议已验证。
- 官方运行时尚未执行这些用例，不能把静态证据写为实测。

## 源码确认的问题与验证计划

| ID | 问题及定位 | 开发前故障用例 | 预期 |
|---|---|---|---|
| E01 | App全局pendingRequests未按会话筛选即传入ApprovalCenter | B显示时注入A的命令审批/多问题 | B无A卡片，返回A可见 |
| E02 | App响应前移除卡片；Rust写stdin前删除pending map，失败后无法恢复 | 注入请求，令响应IPC/写入失败 | 不显示已批准，错误可见；不能在投递结果未知时盲目重复提交 |
| E03 | Rust仅转发serverRequest/resolved，未清除后端map | 请求→resolved→重读pending | 已解决请求不复活 |
| E04 | ApprovalCenter自由输入Enter不检查IME且绕过canSubmit | 中文选字Enter/空输入Enter/真正提交 | 前两项不响应，合法提交只一次 |

主要文件：`src/App.tsx`、`src/components/ApprovalCenter.tsx`、`src-tauri/src/app_server.rs`。

额外候选：Steer异步结果缺少会话代次校验，可能在切B后追加A消息；失败自动回退队列可能产生未知投递下重复输入。须先故障注入，不凭静态推测宣称复现。

## 后续开发顺序

1. 先补真实协议与官方状态映射，记录请求身份、会话归属、待提交/发送中/已解决/失败。
2. 先写E01–E04回归，证明现有行为失败，再实施最小修复；前后端请求生命周期分开验证。
3. 使用明确标注的隔离请求fixture验证界面；Rust用隔离I/O故障验证map与resolved生命周期。
4. 再验证真实执行/中断/审批往返，最后同尺寸视觉与原生操作。固定回放不能替代真实任务结果。

预调研阶段无产品改动或真实任务；下方首轮开发范围另行记录。完整像素基准和账号能力仍待调研。

## 首轮开发前协议复核与边界

- 已搜索并fetch官方 https://learn.chatgpt.com/docs/app-server#approvals ：审批携带threadId/turnId，客户端按会话隔离；serverRequest/resolved确认已回答或已清理，最终执行状态来自item/completed。不能把写入stdin成功当作工具执行成功。
- 当前本机CLI实际版本0.159.2，重新执行`app-server generate-json-schema --experimental`保存至`.ref/parity/03/schema/`。ServerRequestResolvedNotification必含threadId与requestId，ID可为string或integer；响应payload按各方法schema构造。
- 首轮仅E01–E04，其他工具卡/Goal/队列/Steer/附件留后续，不以审批子范围代表整页完成。无新增依赖、不执行真实模型任务、不修改安全设置。
- 请求状态：待处理→发送中→本地响应写入完成；服务器resolved清除，item/completed才说明执行结果。未投递失败保留卡片与错误；部分写入/flush失败可能已送达，标记投递未知并阻止重发，等待resolved/连接恢复核对。
- 原生桥附加generation与responseDeliveryUnknown属于本地传输元数据，不添加到官方JSON-RPC wire params。generation检查防止旧卡响应重连后复用ID；numeric和string ID必须分开。
- 自验顺序：Rust故障写入/已解决清理，前端隔离/发送中防重复/失败恢复，IME与空输入，最后完整检查及原生构建。视觉无同尺寸官方参考仍记未验证。

## 已实现与聚焦证据

- `approvalRequests.ts`复用thread归属与generation+typed ID身份；App审批卡与快捷入口只面向当前会话。后台请求仍保存在全局集合，通知携带原threadId。重复请求更新同一条，解决事件按ID类型与thread匹配清除。
- 响应前不移除卡片，发送期间防重复。未投递失败保留错误并刷新状态；后端标记投递未知时禁用整个响应区，刷新不清该标记。旧卡的generation不能响应重连后复用的ID。
- `ApprovalCenter`通过卡片闭包传递generation；UserInputCard的Enter与发送按钮共用canSubmit，IME/isComposing和229选字事件不提交。保留原有“至少一个答案”规则，没有凭空改成必须答完所有问题。
- Rust请求查找/写入/移除在同一锁内；写入前标记未知，写入/flush失败或future取消后保持禁止重发；无stdin不标未知。成功写入只说明传输，不说明操作执行完成。resolved同时兼容threadId及旧请求conversationId（threadId优先）。
- Tauri command本地参数增加generation；官方响应wire仍只有JSON-RPC id/result或error，无额外官方协议字段。
- 快捷“批准最近拒绝”旧实现把不匹配协议的`approved`发送给任意最新全局请求；现改为定位当前会话审批卡，让用户在实际卡片确认选项，不再显示假批准成功。

### 失败回归

- 修改前App实际请求表达式回放：B显示A、B两张卡，期望只有B，真实断言失败。
- 旧ApprovalCenter源码回放（`.ref/parity/03/ApprovalCenter-before.tsx`）：合成中文选字Enter调用响应1次，空submit也调用1次，期望均0。`verify-old-user-input.mjs`在真实行为断言失败，不将旧代码通过或脚本语法错误当作成功证据。
- Rust修改前numeric7/string7键碰撞断言失败。新增8个聚焦测试，app_server模块11/11通过，含写入/flush/取消、重复/并发、旧代次、resolved错误身份与旧字段。
- 新`verify-approval.mjs`直接执行App/输入组件的实际AST函数并渲染真实卡片，覆盖隔离、身份、发送中防重、失败保留、投递未知、过期快照重读、IME/空Enter、状态禁用。无新增测试依赖，已接入标准检查。

### 浏览器实际App集成

`.ref/parity/03/fixture.html/.tsx`显式固定协议样本，不执行命令、不联系模型。

1. B显示时注入A命令审批，B卡片0；切A卡片1。
2. 未投递失败后错误可见且卡片1；投递未知后响应禁用，刷新仍禁用。服务器resolved后卡片0。
3. 自由输入空提交按钮禁用；空Enter和合成isComposing/229均不新增响应。该合成事件不冒充真实Windows输入法实测。
4. 输入蓝色后延迟发送，状态提示1、按钮禁用；重复点击响应总数不增。离开B后释放，返回B卡片0，载荷为`{answers:{color:{answers:["蓝色"]}}}`，含原ID与本地generation。
5. 截图`actual/unknown-delivery.png`和`actual/user-input.png`；界面固定样本不代表真实工具执行。

6. 响应失败且状态读取也失败时，卡片保持投递未知和禁用；恢复读取、后端确认未发送后才恢复重试。自动回归亦覆盖该分支。

## 最终检查、构建与原生结果

- 最后产品修改后完整`verify-all.ps1`为exit0 / ALL CHECKS PASSED，日志`.ref/parity/03/verify-all-final.log`。包含新增审批回归、现有内容/复制/timeline回归、类型检查、前端构建、Rust check/调度单测及87项真实CLI隔离协议探针。
- `cargo test --manifest-path src-tauri/Cargo.toml`为30/30通过，日志`cargo-test.log`。修改Rust后执行了全量测试，没有仅以automations过滤代替。
- 最终Release构建exit0，日志`release-final.log`。产物`dist-artifacts/03-approvals-20261026/CodexNative.exe`，源码/EXE指纹`build.json`已再次核对。构建包含既有未提交改动，没有创建提交。
- 无新增依赖，无独立lint配置；不报告不存在的lint检查。已有Vite混合导入/bundle体积和协议探针DEP0190提示继续保留。
- 准备了显式本地协议fixture（`native-app-server.cjs` / `native-cli.cmd`），但携带该模拟CLI启动原生构建被自动审批拒绝，工具仅返回blocked by policy，没有具体原因；该模拟app-server没有启动，不能记为原生审批/输入回传通过。
- 采用更窄的真实CLI路径完成原生基础回归：仅本进程使用已安装`codex.exe`和已有独立`.ref/parity/02/native-home`，不复制认证，不调用模型。新构建已连接并读取固定历史，显示中文、代码、表格。截图`actual/native-real-cli.jpg` / UIA记录。未触碰沙箱安装或忽略按钮。
- 本轮没有执行真实命令审批、权限授予或真实模型任务；原生完整审批/提问回传、物理中文输入法选字、同尺寸官方视觉仍为未验证。

## 验收与后续范围

当前仅E01–E04的首轮修复，不是第03整页1:1完成。仍需继续工具卡、思考摘要、Plan/Goal、队列/Steer、中断、附件，以及真实任务链路、官方同尺寸宽/窄窗口对照与用户验收。Steer旧候选问题继续登记，未被本轮修复覆盖。

可先人工检查当前构建中的待处理请求是否属于当前会话，发送中是否禁用、失败与投递未知是否区分。使用真实账户的付费任务或权限操作前仍应确认具体测试范围，不能用固定fixture替代执行结果。

## 队列、Steer与中断：续开发前调研（2026-10-26）

- 官方文档已搜索并fetch https://learn.chatgpt.com/docs/app-server#steer-an-active-turn ：Steer必须携带匹配当前轮次的expectedTurnId，没有活跃轮次时失败，不产生新turn/started。当前CLI schema另包含clientUserMessageId。
- 固定asar `hon`（UTF-16约2958041）、`h8t`（2708047）仅对明确的ExpectedTurnMismatch/可启动条件处理重试；未知投递错误直接传播，不能把任意错误改成queue/add或turn/start。
- 官方队列读取逐页传cursor（3679347），操作使用queuedSubmission.id；clientUserMessageId独立用于消息关联。队列Steer（3684480–3685350）沿用原clientUserMessageId，成功后delete原队列且校验deleted，不应让同一消息再次自动消费。
- 当前确证：普通流式发送的Steer错误会落入新turn/start；独立Steer错误自动队列甚至本地假排队；队首Steer成功未删除原队列。list只有一页且旧响应可覆盖新会话；取消失败直接隐藏队首；快捷队列只写本地数组。
- 修改前实际streaming分支回归已失败：`unconfirmed Steer must not fall through to a new turn`。本轮范围是这些明确投递/状态缺陷，不扩展Goal或工具卡样式。

### 续修计划与验收

1. 流式发送仅对确认结果清理原草稿，失败保留输入与附件，绝不自动再投递；附件异步保存后再次核对会话代次及目标轮次。中断失败可见，成功等待真实完成事件。
2. 队列加载分页且绑定会话/请求代次，改真实add/start/delete，使用服务端ID，失败不假成功；发送与删除防重复。
3. 队列Steer沿用完整input/client ID，成功清理原队列；清理失败保留“已发送待移除”状态并阻止再次启动/引导，允许重试移除。
4. 用实际函数回放和隔离App fixture覆盖挂起A→切B→晚到返回、分页、失败、重复点击与清理失败。最后标准检查、构建及原生基础回归；无真实模型任务或官方同尺寸对照则继续记未验证。

## 队列、Steer与中断续修结果（2026-10-26）

### 实现与回归

- `src/App.tsx`：流式Steer失败不再落入turn/start，保留草稿与附件；附件异步保存后复核会话代次/轮次，成功仅清未修改的原稿。相同会话发送期间防重复。中断RPC返回不再假定任务已结束，等待turn/completed；失败显示错误。
- 队列逐页读取并隔离晚到/乱序结果，真实add/start/delete替代本地假操作；使用服务端队列ID。Steer沿用原clientUserMessageId与完整input，成功后验证deleted；清理失败或投递未知跨页保留禁止重发状态，取消只在确认删除后移除。
- `src/types.ts`保留队列真实身份及input；`scripts/verify-queue.mjs`与`verify-turn-controls.mjs`接入标准检查。修改前Steer落入新轮、分页和交互容器均有失败断言；修改后11+6组通过。
- 浏览器实测发现队列栏位于pointer-events:none的dock中、未进入pointer-enabled inner，鼠标穿透且队列与输入框并排。仅移动既有inner容器边界，复用样式，没有新增依赖或CSS规则。修复后鼠标Steer产生对应RPC，清理失败禁重发，成功取消推进下一项。

### 集成证据与限制

- 固定App场景`queue-fixture.html/.tsx`，不联系模型、不执行命令：两页队列、Steer失败保留稿且无fallback、队列Steer保留原ID、删除失败禁重发并跨页保留、删除成功推进下一项通过。
- 挂起A队列读取→切B→释放A，A队首0/B队首1；延迟A Steer→切B填写草稿→释放，UI仍显示B草稿和B队列。截图`actual/queue-cross-thread.png`。
- 中断失败和成功各产生一次真实App回调请求；成功请求返回后仍显示停止按钮，收到fixture turn/completed后消失。失败toast在浏览器取样时未捕获，不报该项浏览器通过；错误与保持运行状态已由实际函数回归覆盖。
- `actual/queue-cleanup-failure.png`展示本轮最终容器修复后的固定样本状态。缺少官方同场景同尺寸参考图，visual-verdict没有可用输入，不编造评分或像素通过。
- 最终完整标准检查exit0，见`verify-queue-final.log`，包含17组新回归、既有前端回归、类型、构建、Rust check/调度测试和87项真实CLI隔离协议探针。本轮没有Rust源码修改，未重复全量Rust测试；上一轮30/30仅为历史证据。无独立lint配置；Vite与DEP0190既有提示仍保留。
- Release构建exit0：`release-queue-steer.log`。当前产物`dist-artifacts/03-queue-steer-20261026/CodexNative.exe`，指纹`build-queue-steer.json`。真实CLI隔离home原生基础回归通过：连接与固定历史中文/代码/表格，见`actual/native-queue-build.png`和UIA。没有触碰沙箱按钮或发起模型任务。
- 原生真实队列/Steer/中断执行、物理IME、官方宽窄窗像素对照仍未验证；工具卡、思考摘要、Plan/Goal与附件等03范围待继续。此轮为03子范围自验交付，不是03整页1:1或用户验收通过。

## 真实状态补查与投递内容续修：开发前验收（2026-10-26）

- 已重新fetch官方Steer文档：无活跃轮次失败，不产生新turn/started；原asar队列sendNow在streaming时Steer，idle时queue/start（reference/queue-steer.txt）。enqueue构造完整input后提交（shared chunk UTF-16 3681396附近），不能仅保留text。
- 当前源码可见：handleEnqueueFollowup只构造text，且只允许非空文字；队列立即发送无视streaming直接start。先补实际callback回归，验证附件/纯附件、失败保留、保存期间切会话、运行中立即发送分流，再最小修改。
- 真实CLI新增状态探针：在独立home、无认证、无turn/start的线程上请求Steer/interrupt/空队列start，记录实际错误和前后历史/队列。该探针仅证明真实服务的无活跃轮次边界，不证明真实任务或原生完整端到端。
- 验收：真实服务结果可追溯；附件保存失败不排队，成功后完整input且只清原稿/原附件；保存期间切B不投递到旧A；运行中队首立即发送复用已验证Steer清理，空闲才start。类型/完整标准检查/新Release通过，原生基础回归与官方视觉继续分开记录。

## 排队内容与运行中立即发送续修结果（2026-10-26）

- 修改前实际callback回放失败：send-now期望Steer→delete→list，实际queue/start→list。失败证据`queue-input-before.log`。本轮修复`App.tsx`的handleStartServerQueue，在streaming时复用原handleSteerTurn，idle仍走start，无重复协议实现。
- handleEnqueueFollowup复用persistThreadAttachments，成功且会话代次仍有效后构造完整text/localImage/mention输入；支持纯附件。仅确认服务端队列ID后清理未修改的原稿/附件，失败保留。队列Steer允许无文字但有input的消息，不丢纯附件。
- `verify-queue.mjs`由11组扩为14组，覆盖运行中send-now、文件/图片/纯附件、保存失败/排队失败、保存期间切会话、晚到结果保留新附件/草稿。加既有turn-controls共20组回归通过，无新依赖、无布局或CSS改动。
- 新增`verify-idle-turn-controls.mjs`，标准检查接入。真实官方CLI、独立home/工作目录、清空子进程API key环境、无认证复制、无turn/start或queue/add模型触发：6项通过。实际Steer错误`no active turn to steer`，interrupt错误`no active turn to interrupt`；缺失队列删除deleted:false，空队列启动`queued submission not found: missing-item`；前后历史/队列一致、无turn/started。日志`idle-turn-controls.log`，原始请求/响应`idle-turn-controls.json`。这不是活跃任务端到端验证。
- 浏览器真实App+固定协议场景：鼠标点击运行中A的立即发送，记录只有turn/steer(client-a1, a-turn, 原input)、delete(a1)，没有queue/start，队首推进a2。证据`send-now-browser.json`。本轮不展示测试控制栏作为产品界面。
- 最终完整标准检查exit0：`verify-input-final.log`；旧87协议检查加新增6项状态检查通过（旧shape通过不能理解为真实任务通过）。Release exit0：`release-input-final.log`，产物`dist-artifacts/03-queue-input-20261026/CodexNative.exe`与指纹`build-queue-input.json`。
- 新EXE原生真实CLI基础回归：连接与固定历史打开、中文/代码/表格可读，`actual/native-input-build.png`及UIA。未执行模型、命令或权限操作。没有新Rust产品修改，未重复全量Rust测试；标准脚本包含现有Rust过滤测试。没有独立lint配置，Vite/DEP0190既有提示仍存在。
- 新发现且未修复：Composer占位提示Alt+Enter排队，但handleKeyDown没有对应分支，在默认Enter发送设置下会调用普通发送/Steer；排队动作入口的callback修复不能证明该键盘入口完成。需先核对官方默认排队按键/偏好行为再独立修复并验收，不宣称当前快捷键正确。
- 未完成：具有测试认证的真实活跃任务排队/Steer/中断、物理IME、同尺寸官方宽窄窗截图与像素比较、工具卡/思考摘要/Plan/Goal等03范围和用户验收。测试home无认证且本轮不调用模型，不能把真实服务空闲边界或固定样本当作真实活跃任务。没有对应官方参考图，不运行虚假视觉评分；本轮未修改视觉布局。
