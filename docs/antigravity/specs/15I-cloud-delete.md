# 15I 云端永久删除：开发前合同

2026-11-06。状态：静态调研完成，阶段已实现并自验，待用户验收，见[整合记录](../acceptance/15I-cloud-delete.md)。范围仅设置归档行的Codex cloud task与ChatGPT conversation永久删除，包括确认、真实固定请求、成功/失败、认证重放及账号隔离；不扩大项目批量删除、内部会话工作面或模型功能。调研阶段未改产品或执行真实HTTP；后续实施与验证另记，不以取证替代验收。

## 1. 基准与证据

固定Store `26.1027.3384.0`、asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。沿15H已从固定包提取的7个原始资源，复制到 `.ref/parity/15/actual/15I-cloud-delete/reference/raw/`并重新核对size/SHA与原asar manifest，均匹配；没有重新整包hash。manifest保留原始entry路径/offset/绝对byte位置，anchors.json保存25个0-based UTF-16片段。

实施时已重新计算整包哈希并复核7项资源，见`verification/official-baseline.json`；补入已核验同版app-shared错误解析原文，manifest现共8项。`delete-error-code-source.json`记录bct@1778013/Pct@1780628：按extra、root、error、detail、detail.error、error.error顺序，逐节点检查error_code/file_parse_error_code/code，首个非空字符串优先，不能从任意后项挑conversation_deleted。现有review_error_code已实现相同优先级，可复用。

来源核心：`data-controls-805edc0381e3.js:hn@2155`、`app-primary-998934e837fc.js:BOn@1767693/VOn@1768726/Jqn@2365375`、`app-initial-4267e52fe5b0.js:n2i@5919273`。精确anchor以JSON为准，不用混淆单行的物理行号。

## 2. 来源、权限与固定动作

| 来源 | HTTP方法/路径 | body | 明确404行为 |
|---|---|---|---|
| Codex cloud task | DELETE `/backend-api/wham/tasks/{task_id}` | 无requestBody | BOn捕获任何HTTP404后继续成功清理；不要求conversation_deleted |
| ChatGPT conversation | DELETE `/backend-api/conversation/id/{conversation_id}` | 无requestBody | 仅HTTP404且errorCode严格`conversation_deleted`继续成功；普通404仍失败 |

ID来自真实来源entry，保留cloud:<taskId>与chatgpt:<conversationId>复合身份；绝不把云端ID传给本地thread_delete_archived或thread/delete。固定route/method/body不允许由renderer覆盖；path ID单独编码/校验，拒绝额外URL、跨源/跨账户传入及路径注入。无body不能随意改成`{}`或`{is_visible:false}`等未观察动作。

前置资格沿15F/15G真实读取链；hn自身没有新加personal/paid gate。已能读取不代表服务器一定允许删除，401/403仍是可见失败；不要用通知personal过滤、云端环境CloudAccess或本地thread权限强开放行。真实恢复、删除各有独立busy，不因一个按钮可见猜测另一个权限。

当前用户授权开发/发布不是本调研可执行真实账号删除的授权。实施前先锁定隔离transport/RPC回归；真实删除验证需要另有明确对象和范围授权。取消确认必须零写，不用演示删除、定时成功或本地移除冒充服务器结果。

## 3. 行入口与确认弹窗

hn的云端两种行都提供danger/toolbar“删除”文字按钮，ariaLabel来自 `settings.dataControls.archivedChats.deleteWithTitle`（“删除已归档的聊天 {title}”）。disabled包括该行恢复pending、删除pending以及task状态忙。点击只打开确认，不发DELETE。

共用确认组件是primary `Jqn@2365375`，由data-controls导入rS；与本地归档的delete-archived-chats-dialog不是同一组件。结构为compact modal，sr-only标题/描述，加可见标题/描述，底部取消+danger submit，form提交preventDefault且busy时不再onConfirm。

同版中文资源：

- `chatgptConversations.sidebar.deleteDialog.title`@552821：“删除聊天？”
- `deleteDialog.description`@552738：“这将永久删除“{title}”。此操作无法撤销。”（按原资源插值和中文引号）
- `deleteDialog.cancel`@552682：“取消”
- `chatgptConversations.sidebar.delete`@552637：“删除聊天”（确认按钮文案）；行按钮仍采用设置归档自身的“删除”。

标题插入经过同版title清理，空标题用“无标题聊天”；不渲染HTML或以不可信标题拼代码。确定删除不依赖浏览器window.confirm，不能拿系统确认框声称官方compact modal。

Jqn接收autoFocusConfirm和onCloseAutoFocus；本hn调用没有显式传这两个参数，所以不能宣称已证明“初始总聚焦取消/确认”或“关闭必回行按钮”。它将onCloseAutoFocus透传给contentProps，busy时拒绝onOpenChange(false)，取消按钮disabled，submit loading。底层Modal默认focus、Escape/外点、Tab环与中文IME未实测；实施时需明确可靠键盘/焦点保护并记录适配，不能把推测当官方事实。

## 4. task与conversation确认后的不同状态机

**task**：hn确认立即`y(false)`关闭弹窗，再调用BOn。BOn用 `{accountId,userId,taskId}`键的WJ同步busy防重复；按钮读取该task busy。它捕获发起时账号与用户，o()检查二者仍相同。若当前route正好`/remote/<id>`，先导航`/`，然后发DELETE；因此不能把“请求失败也一定保留原task路由”当官方行为。归档设置场景通常不在该remote route。

**conversation**：hn的确认调用本行mutation T，弹窗保持打开并显示isDeleting。mutationFn调用n2i；成功onSuccess关闭弹窗并失效归档query `[chatgpt-archived-conversations]`；失败显示错误toast，弹窗不因这个onError自动关闭。n2i用AJ标记deleting，在finally清标记；不与task的WJ账号作用域lock混用。

这两种状态机均不等于“立刻删本地列表并显示成功”。本地实现可以用同步source/id操作锁防同tick重复，但应标注为健壮性实现，不声称官方所有不同条目必须全表互斥。

## 5. 成功、缓存及读回边界

task BOn正常2xx或认可的404后，先检查o()账号/用户仍相同，再VOn：取消tasks、单个task detail、sidebar tasks查询；通知该task已deleted；从非archived tasks、当前账号archived pages、sidebar列表移除该ID；移除单个detail query；失效tasks。没有成功toast的明确调用，不自行添加“官方删除成功”通知。finally释放该发起身份的busy。

conversation n2i在成功或明确conversation_deleted之后：r2i清history/project/pinned集合；MEi取消并移除conversation detail、关闭/清理相关会话流；清pending project move、归档placement与其他关联cache，发remove通知、清work-companion引用、通知deleted并失效conversation collection/search。n2i捕获部分账号/用户供清理使用，但不像BOn有同样显式o()终点guard，不能把task的账号保护描述套为n2i已证逻辑。底层认证principal/signal保护见第7节；本项目仍须额外验证generation与scope，避免旧回包改新账户页面。

官方删除函数没有独立GET确认不存在后才成功的合同；认可的404就是已不存在的来源语义，2xx后cache清理并非独立读回证据。本项目按实际响应和后续真实来源刷新记录结果，区分“服务器已接受/已不存在”“刷新确认”“删除已执行但刷新失败”“结果未知”。不能用部分分页里没看见目标或仅本地列表移除证明永久删除。

未知网络结果后重读来源，不用再次DELETE冒充验证；若仍需重试写，应明确目标与风险，且保持同一当前身份。任何适配策略不能扩大task404认可到conversation普通404。

## 6. 失败和重试呈现

task BOn捕获失败后先检查o()；账号/用户已变化时不向新账号弹旧错误。仍当前时danger toast使用 `cloudTask.deleteError`@613039：“无法删除聊天。请重试。”并带Retry action。源码 `cloudTask.deleteRetry` 的defaultMessage是“Retry”，同版zh-CN没有该专用键；中文实际fallback显示仍待运行时确认，不擅自把“重试”当已证翻译。action关闭toast，只有o()仍为真才重新调用同目标BOn。这是用户主动重试，不是网络自动重试；不会重新打开本次确认弹窗。

conversation本hn onError使用 `settings.dataControls.archivedChats.deleteError`@1843058：“无法删除已归档的聊天”，带归档删除失败analytics。该onError没有task同款Retry action。弹窗仍可取消或再次确认；不得用统一错误处理抹掉这个差别。2xx后缓存/引用清理也可能抛错，单凭外层error不能保证服务器没有删，实施需保留写入结果阶段。

HTTP403、普通conversation404、429、5xx、网络错误不是成功；task404和conversation特定404按各自合同。没有证据支持把归档GET的401/403/404空结果策略用于DELETE。

## 7. 认证401、取消和账号隔离

沿15H第8节已证宿主链：M_.safeDelete→Zg→udt→Qi.httpFetch→An.performDesktopFetch。默认retry未设never时，attachAuth有token、HTTP401、非workspace IP拒绝且不命中POST flora例外，刷新认证后按同method/body重放一次。**DELETE没有被排除**，第二次401不再重放；403/404不走认证重放。不能把本地“所有写从不重试”的偏好描述成官方行为。

task请求在账号/用户都存在时显式expectedIdentity；BOn清理与Retry动作另有o() guard。conversation n2i调用没有显式expectedIdentity和页面signal；默认jmt只提供locked-chat PIN信号。宿主发送前/认证刷新后检查principal，workspace routing signal失效可取消；window销毁会dispose所有活跃HTTP service request。**离开设置页立即取消DELETE、取消后服务器保证未删除均未证**。

本项目复用ServiceIdentity(account/user/generation)、取消登记、network policy、同一后端session；写发起时与结果落地时都核当前scope。发送前取消应零DELETE；发送后取消/超时/账号切换为可能已执行，取消本地等待不能承诺撤回删除。旧结果不污染新账号；回原账号后先真实读取核对。增加页面卸载取消/更严格锁属于本项目适配，需与官方已证行为分开记录。

## 8. 最小开发与验收合同

扩展现有ChatGPT service的明确task/conversation删除操作与结果分类，不开放通用DELETE通道，不复用本地thread删除/ASB CloudOperation，不新增依赖。先隔离fixture红→绿，后开发确认和真实HTTP结果UI；不以永久只读替代最终删除目标。

| ID | 可测试验收 |
|---|---|
| CD01 | 两来源固定DELETE路径、无body、ID编码；额外参数/未知source/跨账号identity拒绝；取消确认零transport |
| CD02 | 标题插值、无标题fallback、行按钮与确认按钮文案分别正确；提交前不删除；task确认关闭后busy，conversation确认保持pending |
| CD03 | task任意404成功；conversation仅404+conversation_deleted成功；普通404/403错误；两源同ID只清目标来源 |
| CD04 | 初次401符合条件仅一次重放原DELETE；第二次401、IP拒绝、retry=never不重放；network/5xx不新增自动重放 |
| CD05 | task错误toast带同身份Retry，账号改变Retry零写；conversation错误不自动关弹窗、无伪造同款action；成功不乱加toast |
| CD06 | 真实成功/认可404才做cache清理；部分页不当独立读回；服务器已接受后刷新/引用清理失败保留执行事实 |
| CD07 | 发送前取消零写，发送后未知不伪报撤回；A→B→A、同账号新generation、断连旧成功/失败不污染新页；不回放旧确认到新身份 |
| CD08 | Tab/Enter/Escape/IME、取消后焦点、busy关闭保护与窄窗按真实Tauri验证；官方默认焦点未证就明确差异，不编1px通过 |

未证边界：真实服务器返回/幂等保证、专用task Retry的中文fallback、默认Modal焦点/IME、网络取消与服务器提交竞态、完整独立读回、原生配对像素。无需再猜；进入实现时按上述已证路径推进，缺口独立补证，不能隐去风险或宣称已验收。
