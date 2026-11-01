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

## 排队键盘入口：开发前调研与验收（2026-10-26）

- 官方文档已search并fetch https://learn.chatgpt.com/docs/prompting#steering-and-queuing ：桌面跟进行为受General设置控制，CLI的Tab规则不能直接套用桌面。
- 固定26.928.21956/build12404提取：app-primary-84ad97f06929.js 的Vrt（UTF-16 1220315）将enter映射CmdOrCtrl+Enter，将cmdIfMultiline/cmdAlways映射CmdOrCtrl+Shift+Enter；1224100附近的实际Enter处理排除Alt，按单次反转选择queue/steer。shared chunk followUpQueueMode默认steer，interrupt兼容归一steer；general-settings chunk跟进行为说明调用Vrt生成快捷键。
- 本项目当前仅Enter/Ctrl+Enter发送偏好，没有可验收的跟进行为设置。本次只接通当前默认Steer的单次queue路径，不添加未验收的设置，不宣称cmdIfMultiline或自定义命令绑定已实现。
- 修改前Composer实际handler：Alt+Enter错误调用send；Ctrl+Enter在streaming仍send/Steer，没有queue回调。用实际AST事件处理回归先红。
- 计划：Composer增加queue回调，两个App挂载点复用handleEnqueueFollowup；streaming默认Enter偏好下Ctrl+Enter排队，cmd-enter偏好下Ctrl+Shift+Enter排队。Alt修饰不发送；IME/isComposing/229不发送；Shift+Enter换行；修饰键长按不重复投递。移除错误Alt+Enter占位提示。
- 验收：键盘handler分支及App接线回归；浏览器真实App按键验证只queue/add、不Steer、不turn/start，失败保留/成功清稿；标准检查、Release及原生键盘基础回归。官方运行时键盘、物理IME及视觉仍独立待验。

## 排队键盘入口续修结果（2026-10-26）

- `ComposerBox.tsx`增加必需onQueueMessage；App首页/会话两个实际挂载点均接已有handleEnqueueFollowup，复用真实队列、附件与失败保留逻辑。没有新增协议构造或依赖。
- 当前默认Steer下：enter发送偏好→Ctrl+Enter排队；cmd-enter发送偏好→Ctrl+Shift+Enter排队。Alt修饰不发送、Shift+Enter换行、IME/isComposing/229不投递、修饰键repeat消费但不再次提交。移除无依据的Alt+Enter排队占位提示。
- 修改前`verify-composer-keys.mjs`真实handler回放exit1：Ctrl+Enter实际[send1,queue0]而预期[send0,queue1]，见`composer-keys-before.log`。修改后5组检查通过（包括两个App挂载点真实接线），接入标准检查；queue/turn-controls原回归亦通过。
- 浏览器实际App固定协议场景：Enter偏好Ctrl+Enter成功只queue/add且清稿；故障queue/add后草稿和错误提示保留；cmd-enter偏好Ctrl+Shift+Enter成功只queue/add且清稿；切回enter后Alt+Enter保留输入，请求总数仍3（包含一次失败），无Steer或turn/start。原始请求`composer-keys-browser.json`。该证据不是官方运行时或真实模型任务。
- 最终完整`verify-all.ps1`exit0：`verify-keys-final.log`，含5组新键盘检查、既有回归、类型/构建、Rust标准过滤测试及原87协议形状+6真实空闲状态检查。无Rust产品改动，未重复全量Rust测试；未配置独立lint。既有Vite和DEP0190提示保留。
- 限制：仅当前默认Steer行为已接通。官方General跟进行为设置/默认Queue反转、cmdIfMultiline及自定义命令绑定不在本子范围，不能称桌面键盘全部一致；真实活跃任务、物理IME和官方同尺寸像素仍待验。本次无布局/CSS修改，缺少官方同场景截图不编造visual-verdict评分。
- 最终Release构建exit0：`release-keys-final.log`。产物`dist-artifacts/03-composer-keys-20261026/CodexNative.exe`，源码/脚本/EXE指纹`build-composer-keys.json`；HEAD为380c32c后的未提交修复，未自动提交推送。
- 此EXE使用真实CLI和独立home，原生空闲首页输入`Native keyboard check`后Alt+Enter：保留草稿、未进入会话；Shift+Enter后输入`Second line`：两行保留在输入框，未发送。截图`actual/native-composer-keys.png`和UIA。UIA输出存在短暂滞后，结论同时由截图确认。该非发送路径不证明原生活跃任务排队或物理中文IME。

## 工具输出与思考摘要：开发前调研及验收（2026-10-26）

- 已search/fetch官方 https://learn.chatgpt.com/docs/app-server#item-deltas ：summaryTextDelta按summaryIndex分段、textDelta按contentIndex；命令outputDelta按序追加，item/completed为最终条目。
- 固定shared chunk的2717977/2718350附近分别将summaryIndex/contentIndex投递到reasoningSummary/reasoningContent目标；summaryPartAdded仅记录边界，不凭空追加正文。定位锚点item/reasoning/summaryTextDelta、reasoningSummary、summaryIndex。
- 当前App将所有summary增量写text、所有content增量写reasoningText，partAdded添加空行；最终item与流式旧字段并存，extractReasoningText可能重复。command增量写output，最终aggregatedOutput与旧output并存且渲染优先旧output；无exitCode时不论status均显示运行中。
- 本轮限定数据与状态正确性，不重绘整个工具卡/思考摘要样式。先实际AST通知回放复现分段串接、完成后旧输出及错误运行状态；再最小修改规范字段、最终条目覆盖与历史回放；保持会话身份隔离。
- 预期：不同summary/content索引独立追加，重复边界不改正文；完成事件不重叠旧delta；历史包含的同索引增量不重复，新增增量保留；命令完成输出（包括空串）覆盖旧缓冲；failed/declined/completed不显示运行中。回归、浏览器固定通知场景、标准检查、Release及原生基础回归分别留证，不代替真实任务或官方像素验收。

## 工具输出与思考摘要续修结果（2026-10-26）

- 修改前实际App分支回归exit1：summaryIndex分段结果为undefined，而预期[第一,第二段]，见`execution-items-before.log`。独立相同文字段被Set误删亦有失败断言，见`reasoning-repeated-before.log`。测试脚本最初存在undefined JSON序列化问题，修正测试后保存的失败证据为真实断言，不将脚本语法错误当作产品缺陷证明。
- `App.tsx`：规范summary/content数组按索引追加，不以summaryPartAdded生成正文；兼容旧reasoning/delta路径。完成事件清理旧text/reasoningText字段，保留独立但相同文字的段；inProgress思考条目所在运行轮次正确显示正在思考。
- command delta改写规范aggregatedOutput，最终快照清理旧output。渲染优先规范输出，空串是有效终值，不回退旧流式内容；无退出码时按completed/failed/declined显示完成/失败/已拒绝，不再一律运行中。复用原卡片，无新依赖/CSS。
- `threadTimeline.ts`：历史回放按summaryIndex/contentIndex分开去重；沿用已登记的官方endsWith策略，重复文本的语义歧义并未被证明消除。空started不覆盖已加载的摘要/命令输出，缓冲区存在最终completed时跳过其旧增量。公共历史回放的既有回归已重验。
- `verify-execution-items.mjs`实际App通知分支/输出表达式、摘要提取与历史buffer回归4组通过：交错分段、重复边界、最终内容、相同独立段、命令最终/空输出与终态、逐索引history去重/新内容保留、空started与completed覆盖。接入标准脚本，未新增依赖。
- 浏览器实际App+显式固定通知：先summaryIndex1再0再1，展开为第一段\n第二段后缀；完成后只有最终固定摘要。命令从旧流式输出变为最终失败输出/失败，再完成空输出后command-exec-body为0、显示完成。截图`actual/execution-item-failure.png`为测试场景，不是官方或真实工具执行。原生测试另记。
- 最终完整标准检查exit0：`verify-execution-final.log`，涵盖新4组及既有键盘/审批/队列/历史回归、类型/前端构建、Rust标准过滤测试、原87形状+6空闲状态协议检查。本轮未改Rust产品代码，未重复全量Rust测试。无独立lint配置，Vite/DEP0190既有提示仍存在。
- 尚未完成：真实活跃任务中的工具卡/思考/中断完整链路、物理IME、官方同尺寸视觉及MCP/文件变更等其他工具卡范围。未改变布局/CSS，当前没有同场景官方参考图，不伪造visual-verdict评分；本轮不代表整个工具卡范围或03已验收。
- 跨午夜完成交付（2026-10-27）：Release exit0，`release-execution-final.log`；产物`dist-artifacts/03-execution-items-20261027/CodexNative.exe`，指纹`build-execution-items.json`。包括前轮未提交键盘修复，无提交/推送。
- 新EXE使用真实CLI及独立home，原生连接和固定历史中文/代码/表格加载通过，`actual/native-execution-build.png`与UIA。未执行真实命令/模型；此基础回归不证明原生工具状态通知完整链路。

## 工具卡子范围：MCP与文件变更状态对齐（2026-10-27）

- 官方来源与依据：
  - 固定版本 26.928.21956 / build 12404，asar SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`；
  - shared chunk `app-shared-a906948d8868.js` Offset 2718919（`item/fileChange/patchUpdated` 更新与创建逻辑）、Offset 2736064（`item/mcpToolCall/progress` 通知）、Offset 4838700 左右（`fileChange` 和 `mcpToolCall` 渲染条目构建：`tJ` 提取变更、`status` 映射；`h_r` 与 `yjn` 提取 MCP 错误与文本内容）；
  - 本机 CLI 0.159.2 schema：`FileChangeThreadItem`（`PatchApplyStatus`：`inProgress`, `completed`, `failed`, `declined`；`FileUpdateChange`：`path`, `diff`, `kind: { type: "add" | "delete" | "update", move_path?: string }`）、`McpToolCallThreadItem`（`McpToolCallStatus`：`inProgress`, `completed`, `failed`；`McpToolCallError`: `{ message: string }`；`McpToolCallResult`: `{ content: any[] }`）、通知 `v2/FileChangePatchUpdatedNotification.json`、`v2/McpToolCallProgressNotification.json`。
- 修改前先红回归：
  - 新增 `scripts/verify-tool-cards.mjs`，在修改前执行失败，记录真实失败断言至 `.ref/parity/03/tool-cards-before.log`（包含缺失 `NOTIFICATION.ITEM_MCP_PROGRESS` 通知分支、`fileChange` kind 对象渲染出 `[object Object]`、缺少状态指示、MCP 错误对象展示为 `[object Object]` 等）。
- 实施修复：
  - `src/App.tsx`：
    - 增加 `method === NOTIFICATION.ITEM_MCP_PROGRESS` 通知分支，同步维护 `progressMessage`；
    - `item/completed` 清理临时 `progressMessage`，确立纯净终态快照；
    - `fileChanges.map`：安全解析 `kind` 对象（`{ type: "update" }` 等），映射中文标签（修改/添加/删除），彻底避免渲染 `[object Object]`；补齐 `inProgress`（修改中…）、`failed`（失败）、`declined`（已拒绝）等状态指示；
    - `mcpCalls.map`：提取 `call.error.message` 防止错误对象字符串化为 `[object Object]`；提取 `call.result.content` 文本段落，避免强制展示原始包装JSON；在 `inProgress` 且有 `progressMessage` 时展示进行中进度。
  - `src/threadTimeline.ts`：
    - 历史已完成项及缓冲中已完成项抑制过时的 `item/fileChange/patchUpdated` 与 `item/mcpToolCall/progress`；
    - 空 `item/started` 不清空已 hydrated 的 `fileChange.changes` 或 `mcpToolCall.result/error`。
- 自动化与 Release 验证：
  - `node scripts/verify-tool-cards.mjs` 5组检查全部通过；
  - 既有键盘/思考摘要/审批/队列/历史回放等全部现有回归均重验通过；
  - `pwsh -NoProfile -File scripts/verify-all.ps1` exit 0（ALL CHECKS PASSED），完整日志保存至 `.ref/parity/03/verify-tool-cards-final.log`；
  - Release构建 exit 0，日志保存至 `.ref/parity/03/release-tool-cards.log`；新产物 `dist-artifacts/03-tool-cards-20261027/CodexNative.exe`，哈希 `8890370DC1AD8A73B67F51F6610E8DB993D3F9CAEE5BF0CBCFCE9E9280D47794`，源码/产物指纹记录于 `.ref/parity/03/build-tool-cards.json`。
- 限制与未验证项：真实活跃任务中的MCP/文件变更写入原生回传、物理IME与官方宽窄窗像素比对仍待验；Plan/Goal 独立生命周期仍待继续；01/02/03整页用户验收状态保持不变。

## Plan与Goal生命周期及其他工具卡对齐（2026-10-27）

- 官方来源与依据：
  - schema：`PlanThreadItem`（`id`, `text`, `type: "plan"`）、`PlanDeltaNotification`（`item/plan/delta` 流式增量）、`TurnPlanUpdatedNotification`（`turn/plan/updated` 下发计划步骤 `plan: TurnPlanStep[]` 及可选说明 `explanation?: string | null`）；
  - 固定asar shared chunk Offset 2741332（`thread/goal/updated` 与 `thread/goal/cleared` 实时事件）、Offset 2739243（`M5t`、`N5t` 状态机切换逻辑：`active` -> `paused`，`paused`/`blocked`/`usageLimited` -> `active`）、Offset 2751902（`turn/plan/updated` 绑定到轮次）；
  - `ImageGenerationThreadItem` 状态字段与 `failure` 结构、`SleepThreadItem` `durationMs`。
- 修改前先红断言：
  - 新增 `scripts/verify-plan-goal.mjs`，断言 `handleToggleGoalPause` 状态机在 `blocked`/`usageLimited` 时能恢复推进（修改前因仅判断 `cur.status === "paused"` 导致死锁失败），保存日志至 `.ref/parity/03/plan-goal-before.log`；
  - 新增 `scripts/verify-misc-tools.mjs`，断言 `ImageGeneration` 失败/生成中状态展示以及 `Sleep` 时长展示（修改前失败断言保存至 `.ref/parity/03/misc-tools-before.log`）。
- 实施修复：
  - `src/App.tsx`：
    - `handleToggleGoalPause`：对标官方 `N5t` 逻辑，`cur.status === "active"` 切换为 `paused`，`paused`/`blocked`/`usageLimited` 均恢复推进为 `active`；
    - `NOTIFICATION.TURN_PLAN_UPDATED`：提取并保存 `explanation` 说明文本，切会话或新轮次时完整清理；
    - `imageViews.map`：支持 `ImageGeneration` 的 `inProgress`（图片生成中…）与 `failed`（失败原因或提示）；
    - `systemEvents.map`：支持 `Sleep` 事件展示等待时长 `durationMs`。
  - `src/threadTimeline.ts`：
    - 将 `item/plan/delta` 纳入 `isDelta` 流式增量列表；
    - 历史已完成项压制过时缓冲的 `item/plan/delta`；
    - 空 `item/started` 不清空历史已 hydrated 的 `plan.text`。
  - `src/components/PlanPanel.tsx`：增加 `explanation` prop，在展开时展示官方下发的计划说明。
  - `src/components/ToolCallCards.tsx`：`stringifyOutput` 支持对象错误消息 `record.message` 提取。
- 自动化与 Release 验证：
  - `node scripts/verify-plan-goal.mjs` 与 `node scripts/verify-misc-tools.mjs` 全部通过；
  - 既有全部专项回归（键盘、思考摘要、工具卡、审批、队列、历史）重验通过；
  - `pwsh -NoProfile -File scripts/verify-all.ps1` exit 0（ALL CHECKS PASSED），全量日志保存至 `.ref/parity/03/verify-plan-goal-final.log`；
  - Release 构建 exit 0，日志保存至 `.ref/parity/03/release-plan-goal.log`；新产物 `dist-artifacts/03-plan-goal-20261027/CodexNative.exe`，哈希 `F4710E1B1F92C8B128FF2BE39447AF77831EFAF260A2C50C039F60DA20B0BD6C`，源码/产物指纹记录于 `.ref/parity/03/build-plan-goal.json`。
- 限制与未验证项：真实环境中的长程 Goal 自主推进循环、物理 IME、同尺寸官方像素对比仍未验证；01/02/03 整页用户验收状态保持不变。

## 思考流真实性与空折叠块防护对齐（2026-10-27）

- **问题现象与官方依据**：
  - 用户反馈：“这个思考是假的吗”，截图显示发送简单问候“你好”后，界面展示了“已思考”，点击展开后内部完全为空；
  - 官方 asar 取证依据：`app-shared-a906948d8868.js`（`Zhr(e.summary)` 提取函数、`case "reasoning": let r = Zhr(n.summary); if (r.length > 0 || t) { ... }` 以及 `case "reasoning": return Zhr(e.summary).length > 0;`）；
  - 官方行为规范：服务端针对简单提问或不需要深度思考的模型，下发空的 reasoning item（`{ summary: [], content: [] }`）；官方客户端在轮次完成且无实质思考文本时，**绝不渲染思考折叠块**。只有当存在实质思考内容或正在流式思考中，才渲染思考块。
- **根因剖析与代码修复**：
  1. **误清空**：`src/App.tsx` 的 `item/completed` 通知处理中存在 `...(method === "item/completed" && item.type === "reasoning" ? { text: undefined, reasoningText: undefined } : {})`，将流式累积的思考文本全部覆盖为 `undefined`。已彻底删除该清空语句，并确保合并时已有的 `summary/content/text` 不被空数组破坏。
  2. **空思考渲染门控缺失**：`src/App.tsx` 之前仅用 `thoughts.length > 0` 判定是否渲染 `thought-accordion`。修改为计算 `meaningfulThoughts = thoughts.filter((t) => extractReasoningText(t).trim().length > 0)`，并结合 `isCurrentlyThinking`。轮次结束且思考文本为空时，绝不渲染空折叠块。
  3. **思考正文提取增强**：`extractReasoningText` 优先提取权威 `summary`（保持多段换行），并在无 summary 时无缝支持 `content`、`text`、`reasoningText`。
- **自动化与原生交付**：
  - 新增专项测试 `scripts/verify-reasoning-rendering.mjs`（覆盖空 reasoning 过滤、流式累积完好保留、静态源码清空代码检查 3 组场景）；
  - `pwsh -NoProfile -File scripts/verify-all.ps1` exit 0 全部 PASS（23 组自动化回归 + 6 组隔离真实 app-server 探针全绿）；
  - Release 构建输出：`dist-artifacts/02-thread-basics/CodexNative-v2.exe`。
