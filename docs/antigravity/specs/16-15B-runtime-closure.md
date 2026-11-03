# 16.15B 运行闭环补证：队列、恢复、身份与上游刷新

2026-11-03。接续 [下一阶段合同](16-15B-next-closure.md)，本文件只读补证，不代表已开发/自验/启用策略。未修改产品、运行 Cargo、执行用户脚本或真实删除。

## 1. 基准与证据

重新从固定 Store `26.1027.3384.0` 的 `app.asar` 读取，整包 SHA-256 仍为 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。4 份 runtime 资源逐一验证 asar integrity：early-bootstrap.js、early-bootstrap-133-27035703de164763.js、early-bootstrap-491-e75c34fa1b2c0832.js、worker.js。

见 [manifest](../../../.ref/parity/16.15/actual/16-15B-runtime-research/manifest.json)、[21 项完整原文锚点](../../../.ref/parity/16.15/actual/16-15B-runtime-research/anchors.json)。所有 start/end 都为 0-based UTF-16 字符偏移、end exclusive。以下为固定包静态事实；原生运行时、远程、真实账号和像素仍未验。

## 2. 持久队列、启动与合并

`eoL` 保存于 **electron-managed-worktree-archives**，schema 区分 attached/thread/automatic，不能把自动清理等同 thread/archive。所有条目含 id/owner/hostId/phase；automatic 另有 revision。phase 为 detaching/queued/running/reattaching/failed/completed。

自动条目按 **owner + hostId** 找未 completed 的条目：

- 无条目则创建 queued/revision=0。
- 已排队未运行，重复触发合并，不增加第二条。
- 正在执行且持久 revision 等于运行快照 revision，仅第一次新触发将 revision+1；其后重复触发继续合并。
- 执行结束时，revision 与启动快照不同则回 queued 再跑一轮；相同才 completed；最终清理队列记录。

不是“每次触发新任务”，也不是“固定延迟 debounce 后第一次执行”。`kick()` 立即尝试执行已有条目。`start()` 立即 kick，再 **每 30 秒恢复扫描已有队列**；此 timer 不会凭空创建新 automatic 条目，不可实现为每30秒自动全盘删库。

运行条件：当前 owner 非空且与条目相同、host connected、未暂停、未处于失败冷却；active archive 最多 **2 条（该队列全局，不是每host2条）**。同条目已有 active 不重复启动。detach 有独立按条目单飞。失败退避为 `min(30000 * 2^min(failures-1,4),300000)`：30/60/120/240/300秒；周期 kick 或其他触发才能在到期后重试。不能杜撰每次失败立即定时精确重试。

停止清 interval/timeout、abort 全部 active archive/detach。账号变化 abort active，旧 owner 条目不会在新账号执行；断开本地服务同样 abort active。队列写入失败必须传播，不允许只内存执行后冒充恢复能力。

### 启动/重连触发已闭环

`eoJ.start` 注册连接增删、状态变化、authenticatedPrincipal变化。新增连接、连接变成 connected、账号变化分别 kick 队列并调用 `#n6(host)`；`#n6` 只在对应 host connected 时 requestCleanup。非云主机沿 requestCleanup→enqueueAutomaticArchive→`#n1` 当前账户→enqueueAutomatic。`#n1` 在本地连接未 connected 时返回 null；否则以 `[accountId,userId]` JSON 身份，API key/不要求OpenAI认证走 `apikey`，无法确认则 null 不排队。

因此生产启动消费者应接既有真实连接生命周期，不能让 SettingsView mount 成为唯一触发；初次启动不依赖用户打开工作树页。已有持久队列会由 start kick恢复。偏好保存后立即清理的额外调用本轮仍未闭环，不可自行宣称官方已证；已排队任务执行时会重新读当前有效偏好，autoCleanup=false 即退出。

## 3. attachment owner 三态及能力门槛

基础 `cc` / export M$l 逐页调用：

`thread/attachmentOwner/list { attachmentType:'worktree', identityKey:root, archived:false, cursor, limit:100 }`。

逐条解析 schema、过滤 archived；出现任何不同于当前 ownerThreadId 的线程返回 true；完整分页没有其他owner返回 false；协议/解析/重复cursor/请求异常返回 **null**。宿主不支持时也返回 null。已证协议能力最低版本：threadAttachments=`0.155.0-alpha.2`；threadAttachmentOwners=`0.162.0-alpha.1`，使用既有 capability比较逻辑，不能字符串比较 semver。

`enU.hasOtherAttachmentOwner` 对本地/SSH等支持分支发查询；cloud/environment分支或不支持返回null；有双身份根时，两者任一true→true，否则任一null→null，否则false。

**固定官方自动删除只检查 `===true`，null不会在这一条件阻断。** null不等于“已确认没有其他owner”；前一合同建议 fail-closed 是保护增强，应明确登记差异。本项目严禁把故意未实现查询/吞掉错误转换false后宣称官方一致。生产闭环选择必须明确：实现官方三态和全部其他保护后保留静态兼容语义，或明确采用null保留的更严格保护；不能在测试中把null样本省略。

## 4. 自动清理与聊天归档/恢复是两条不同工作流

automatic dispatch `#n3` 本地主机直接 `runAutomaticArchive(signal, threadId => hasThreadArchive(owner,host,threadId))`，第二参数保护已在归档队列中的owner。**不先分页归档所有相关聊天，不调用前端手动removeWorktreeWithConversations来替代**。environment/cloud分支通过独立removeFromThread，受targets和environment cwd保护，不是本地删目录路径。

thread归档条目：prepareThread 写 queued + **notBefore=now+60000ms**（FEK→sy=6e4），先暂停关联条目；settle重新延后60秒并解除相应暂停。到时不是直接删：

1. `#is` 真实确认聊天已归档；read不到返回false；先查 archived再查active，两个都找不到抛“Could not confirm the task's archive status”。
2. 等待该owner pendingCreations settled，检查取消。
3. 读取真实 thread attachments，收集 worktree/root以及对应PR身份；获取受保护的归档工作树列表。
4. enqueue attached entries，先 detaching。
5. `eoI` 在删除原worktree attachment前**先写 archived_worktree**，payload包含原worktree、sourceGitRoot/worktreesRoot恢复元数据及相关PR。路径身份必须一致；远程缺原attachment不可凭空通过。
6. 删除相关PR attachments并检查每项结果，再移除worktree attachment；中途失败持久队列保留、重试，不得报告完全完成。
7. attached archive分支确认归档状态并调用 archiveThreadWorktree；主动移除附件分支还要确认原附件已不存在、核primary checkout。

`cleanupArchivedWorktree` 继续核：登记workspace保护、真实owner==归档线程、attachmentGeneration、attaching/cleanup互斥、其他聊天引用。若其他聊天正在使用，转移owner并retained；owner transfer失败仍retained。不能简单“被归档就删”。

### 失败恢复与撤销

结果 retained/unsupported 进入 reattaching；failed保留failed状态与outcome。恢复前从 archived_worktree读取并校验root。非retained/unsupported可尝试 recoverFailedArchive：路径不存在才restoreAttachedWorktree；路径仍存在时检查 stable-metadata.root和owner一致，不覆盖变更checkout。存在“removal interrupted”保护分支，提示先保护剩余文件。

`eox` 按 **重新添加worktree attachment→添加原PR attachments→检查signal→删除archived_worktree** 顺序；不能先删恢复元数据。恢复流程会再次检查当前owner，账号变化不得继续。撤销归档 finishThreadUndo 先暂停/abort并等active/detach settled，未completed/failed attached转reattaching并恢复，再清可清队列记录；失败条目保留。通知失败不擦除重试状态。

这些是生产自动清理的邻接保护合同，不要求本阶段复制整个云流程；但若已有聊天归档入口绕过它，应标未闭环，不把“手动Git恢复测试通过”宣称附件恢复已完成。

## 5. 五天迁移宽限的真实 key

`ao.wU → early-bootstrap-133` 常量 **electron-worktree-cleanup-buffer-start-ms**。首次planner调用时有效值必须有限正数；缺失/非法设当前now，保护直到start+432000000ms。不是应用每次启动重置，也不是每个工作树一个新时间戳。只保护无owner且createdAtMs早于2026-02-21的迁移前项；其他保护规则继续独立生效。测试必须私有state并固定clock，不能修改用户真实global-state来制造已过宽限。

## 6. 上游刷新真实创建消费者

`enU.createManagedWorktree` 与pending创建从 settingsStore 读取 **worktree-upstream-refresh-mode**，缺失回默认never；传给 worker create-worktree。自动化创建的已证分支显式never，不可把设置开关无差别改写所有创建路径。

`worker Ef` 只有未预先resolvedStartingCommit才先调用 `El`，然后才解析startingRef、收集diff和执行`git worktree add --detach`。EX中的exact/local ref解析已有commit时跳过网络刷新。这与“开关开启每次必须联网”不同。

`El`：never、非branch、显式remoteRef立即跳过。HEAD先解析当前分支；无分支跳过。普通分支读取branch.remote/merge和upstream；remote为`.`、缺配置、无upstream跳过。refs/remotes分支使用最长匹配remote和fetch refspec，只有唯一可映射源ref且不被负refspec排除才刷新。

fetch使用真实remote URL和精确 `+sourceRef:destinationRef`，参数：`fetch --progress --no-tags --no-recurse-submodules -- URL +src:dst`。设置隔离Git config（NUL或/dev/null）、保留system/global credential配置；不触发push。不得用无界git fetch --all/checkout/pull代替，也不得自动修改用户分支配置。

- 主signal取消：停止后续创建，返回取消/失败；不能继续创建冒充用户只是跳过刷新。
- 单独upstreamRefreshSignal取消：输出“Continuing without updating”，继续基于已有Git状态创建。
- 普通fetch非0（包括认证失败）：记录warning；认证额外提示登录，再“Could not refresh upstream; using cached Git state”，**继续创建**。不重试登录/不自动拿新凭证、不把认证失败当创建已成功。
- fetch成功：invalidate remote-refs缓存，输出Upstream refreshed，再解析startingRef。
- 15秒timer只是静默fetch进度提示，不是超时取消；不能自行增加15秒超时策略。

接口调用抛异常并非显式“fetch非0”分支，外层创建会捕获/报告失败；不得吞掉所有异常当best-effort。网络测试只用临时bare remote/local fixture和受控失败，不向用户真实远程fetch或推送。

## 7. 父实施可执行切分与阻断门槛

1. typed preference、纯planner和差异报告完成后，增加真实host/account identity的持久automatic队列；按owner/host合并+revision，start/connected/auth变更恢复，执行时重读偏好。验证持久化拒绝、重启、同轮新增触发只再跑一轮、并发上限2、退避时钟。
2. 补候选采集明确成功/失败、birthtime、迁移时间戳、pins和真实attachment owner三态，逐候选重查。**若缺账号/host连接、候选身份不明、pin元数据缺失、snapshot失败、cleanup失败、target身份变化，不能进入真实删除。** 官方null兼容/更严格保护选择单列差异，禁止伪造false。
3. 自动reason与手动settings例外分开：自动snapshot失败必须中止，删除仍走C锁与cleanup，真实readback证明结果。不能调用前端“归档所有聊天”作为automatic前置步骤。
4. thread/attached队列若纳入本阶段，必须先archived_worktree记录再detach、支持undo/partial failure/reattach身份校验；未实现则明确当前复刻范围与后续单元，不假装整个归档恢复一致。
5. 上游刷新独立真实消费者，可先做never/best-effort正常创建与精确ref跳过。临时remote测试fetch成功、非0继续、skip-refresh继续、主取消不创建、source cwd和event日志顺序；不改用户真实repo。

无需等待真实账户来验证纯计划器/时钟/持久队列/临时Git路径；生产服务无法提供的协议能力仍须标未验。本轮没有运行上述用例，不写通过。界面/原生/同环境官方像素及用户验收继续独立。

## 8. owner 私有元数据读写：实施前必须纠正的现有差异

官方 worker `worktree-owner`→repository→`TF`→`TY`→`gU(repo, codex-thread.json)`。gU执行 `git rev-parse --git-path codex-thread.json`，解析为目标checkout的真实Git私有路径；linked工作树通常在 common/.git/worktrees/<id>/codex-thread.json，主树在自己的.git下。不得用shared git config或repo common-dir下同一文件代替。

JSON schema严格 version literal 1、ownerThreadId string（固定schema没有非空约束）。文件缺失ENOENT→null；JSON语法错/schema错→warning+null；其他文件读取错→warning+null；git-path返回不成功/空→null；git-path查询直接抛异常在读取try之外，可作为worker请求失败，不能悄悄当缺失。worker最终将无repo/无metadata映射ownerThreadId:null，无任何 codex.ownerThreadId fallback。

官方 `set-worktree-owner-thread`→TH→T$：写同一git-path，内容 `JSON.stringify({version:1,ownerThreadId:conversationId},null,2)+newline`；无法获得git-path抛错，writeFile失败返回错误，不能success。restore-worktree成功后也调用同TH，owner写失败额外warning，不声称owner一定已恢复。

当前src-tauri/src/git.rs：create_worktree写shared codex.ownerThreadId、set_worktree_owner_thread同写shared key、两个list分支同读shared key；project移动已正确读私有JSON。共享config可让同repo多个linked树串owner，且新建树无法被project移动的JSON读链识别。16.15B应统一修复**两个生产写入口、两个list读入口**，复用正确git-path解析；不要自动迁移/覆盖用户shared旧key。新版写入后读回确认是本项目可靠性增强，保持失败可见。

隔离必测：同repo linked A/B分别写owner A/B，互不覆盖且主树/config无新owner键；创建后project移动识别同owner；手动owner转移后list与项目解析一致；缺失/坏JSON/version2/非string/不可读保持可区分的内部状态；临时.git重定向/目标身份变化不向外写。官方UI null与本项目内部诊断状态可不同，但不能把损坏隐瞒为已确认无人使用后自动删。
