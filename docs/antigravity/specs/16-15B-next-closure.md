# 16.15B 工作树偏好、保留与自动清理：下一阶段只读合同

2026-11-03。本文件仅调研和修改前验收合同；16.14C 的阶段交付另见对应验收记录，**本合同不表示 16.15B 已开发、自动删除已启用或页面已验收**。本次没有执行产品脚本、真实删除、Cargo 或修改用户配置。

## 1. 固定基准及证据

重新只读校验 Windows Store `OpenAI.Codex_26.1027.3384.0_x64__2p2nqsd0c76g0/app/resources/app.asar`，SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。直接从同一包提取 5 份资源，每项 payload SHA-256 与 asar integrity 相等：

- `worktrees-settings-page-e0a8009c3aa2.js`：工作树设置、禁用确认、数字输入。
- `app-shared-b9a49a97ca55.js`：真实 key、schema、默认值。
- `early-bootstrap-491-e75c34fa1b2c0832.js`：host 服务、元数据、清理调用链。
- `early-bootstrap-339-096ec1020e8592e0.js`：`fng → lX` 纯候选计划器。
- `zh-CN-88ebb426d686.js`：45 项工作树中文文案；只使用当前组件实际引用的 key，不假设语言包每项都正在渲染。

完整文件大小/哈希见 [manifest](../../../.ref/parity/16.15/actual/16-15B-research/manifest.json)；[11 项原始锚点](../../../.ref/parity/16.15/actual/16-15B-research/anchors.json) 中 start/end 为 **0-based UTF-16 字符偏移，end exclusive**；[中文](../../../.ref/parity/16.15/actual/16-15B-research/zh-copy.json)。下述“官方”均为固定包静态分支，未进行官方 UI 运行时、账号能力或像素实测。

## 2. 偏好合同

| 属性 | 官方 key / 默认 | 范围和输入行为 |
|---|---|---|
| 自动删除 | `worktree-auto-cleanup-enabled` / `true` | 设置组件 `or({hostId})` 通过 host-specific `jt(store,hostId,definition,value)` 写入；宿主读取相应 app-server 的 userSavedConfiguration.desktop。不是单纯前端全局布尔值。schema 为 boolean。 |
| 保留数 | `worktree-keep-count` / `15` | integer 且最小 1；缺失或 schema 无效时规范化回默认。宿主和 UI 消费同一有效值。 |
| 上游刷新 | `worktree-upstream-refresh-mode` / `never` | schema `never | best-effort`，UI 开关显示是否非 never；不是自动清理开关。此阶段可单列消费者，不能保存假开关。 |
| 手动删除确认 | `worktree-confirm-before-delete` / `true` | agentAccess:hidden；与自动删除的禁用确认不是同一偏好。 |
| 目录 | `git-worktree-root` / 空字符串默认；host settings 的 `worktreesRoot` | 16.15A 已有本地目录消费，本阶段保留其路径边界/读回行为，不把旧自定义目录都假设已扫描。 |

自动删除关闭时，官方 `sr` 先开确认 dialog；取消保持开启，提交确认才调用 `onChange(false)`。重新开启直接写 true。中文标题“禁用工作树自动删除功能？”，取消“启用自动删除功能”，确认“禁用自动删除功能”。不得把英文 defaultMessage 当实际中文。

数字输入：初值有效保存值；onChange 保留文本草稿，blur/Enter 提交。空白或非有限数撤回草稿；有效数 `Math.max(1, Math.trunc(Number(trimmed)))`，等于保存值则撤回、不写。自动删除关闭/切换写入中/数字写入中禁用数字框；关闭自动删除会清数字草稿，但不清已保存 keepCount。成功清草稿，失败错误可见；本项目还须真实持久化读回才能报告成功。

已确认上游 key 为 `worktree-upstream-refresh-mode`；开发前继续追创建消费者与网络失败策略，不能仅按 enum 猜行为。多主机 UI 只有在已有真实 host scope 时接入；本地实现不得冒充远程已支持。

## 3. 自动候选计划器的准确语义

`early-bootstrap-339` 的 `lX`（export `fng`）是可单独验证的纯函数，输入 records/keepCount/threadMetadataById/pinnedThreadIds/protectedWorktreeDirs/nowMs/迁移保护开关：

1. 总 records 不超过 keepCount 时立即无候选。
2. 保护 explicit protectedWorktreeDirs；owner 被置顶或 metadata.isInProgress===true 的工作树。
3. 无 owner 且已知 birthtime 距 now 小于 **1 小时**的工作树保护。不能替换成“所有无 owner 都可删”或“所有无 owner 永不删”。
4. 迁移保护开启时，再保护无 owner 且 createdAtMs 早于 `2026-02-21T00:00:00.000Z` 的工作树。服务用持久时间戳启用 **5 天（432000000ms）**宽限；时间戳真实 key 尚需追踪 `ao.wU`，不能随意把首次页面打开当迁移起点。
5. 去掉保护后：ownerless 先按 createdAtMs 升序（缺时间视 MAX_SAFE_INTEGER），平手路径 localeCompare；owned 后按 owner metadata.updatedAtMs 升序（缺值按 0），平手路径 localeCompare。
6. eligible = 排序后 ownerless + owned；删除前 `max(0, eligible.length - keepCount)` 项。

**保留数针对 eligible；不是总工作树数硬压到 15。** 例：总 20，保护 10，eligible 10，keepCount=15，候选为 0。例：保护 5，eligible 20，keepCount=15，只删除 eligible 中最旧 5，总数保留 20。不得按总数减保留数强删受保护项。

静态风险边界必须如实区分：owner 读取异常在服务中记 ownerReadFailed、将 owner 视为 null；该标记只见日志，未传入 planner 的保护条件。metadata readThread 异常则返回 isInProgress:true/readFailed:true，保护其 owned 工作树；任一 pinned 的 metadata 缺失或 readFailed 会让整轮退出。readThread 返回 null 与抛异常并非同一分支。不可将“所有读取失败/未知 owner 均官方保护”写成事实。本项目若额外 fail-closed，记录为保护增强，不冒充严格等价。

## 4. 宿主清理运行合同

`enU.runAutomaticArchive` 读取当前 host settings；autoCleanup=false 立即返回；获取该 host、该 worktreesRoot 的 managed records，总数不超上限返回。真正执行前调用纯 planner，附加以下保护：

- 已登记 workspace root 与其包含关系：工作树是登记根，或登记根在工作树之下，均保护；路径边界不能仅 startsWith。
- 所有 pinned 聊天 cwd 位于工作树内；包括 pinned 不在普通可见列表的情形。
- statesById 的待处理 worktreeGitRoot、新生/newborn 工作树。
- planner 自身的 owner pinned/in-progress、1 小时 newborn、迁移宽限。

逐候选执行前重新读取 pins：新增 pin 时重新排队并退出本轮；重新读 owner 元数据、检查外部 in-progress 回调、states、当前 workspace、attaching/newborn、attachmentGeneration 是否变化。变化时跳过/退出；另 attachment owner 查询返回 true 则跳过。该查询返回 null 的精确能力语义需要结合版本门槛验证，不能把 null 当已确认无人使用。

最终 `delete-worktree` 带 `force:true, reason:'startup-cleanup', operationSource:'worktree_auto_cleanup'`，并广播 worktrees-reload-requested；失败不能计入已删除，异常收集后 AggregateError。前面 `b.slice(0,20)` 只限**候选诊断日志**，真正 `for (i of b)` 没有该 20 项执行限制，不能误实现为每轮最多 20。

公共删除消费者应复用 16.14C 的 cleanup runner、真实目录读回、进程取消；但自动 reason 的 snapshot 必须更严格：16.14C 已证只有 settings-delete-targeted 可以快照失败后 warning 继续，**不能把现手动删除函数的例外沿用到自动删除**。自动 cleanup 仍遵循 snapshot→cleanup→Git remove→目录读回；snapshot失败/cleanup脚本失败保留目标。当前自动清理的精确会话归档/恢复附件队列应继续追 managedWorktrees archive queue，不直接调用前端手动“归档所有相关聊天”替代。

已证触发：managed 创建完成、分配流程完成、attachment lease 释放、手动删除完成、自动化会话建立并写 owner 后均可 requestCleanup→enqueueAutomaticArchive。另 host 请求经 managedWorktrees 的按账号/host 队列；缺账号/版本能力时有分流。**启动时何处排队、偏好保存后是否立即触发、debounce/合并/串行策略、休眠重连触发尚未完整闭环，不猜计时器/轮询间隔，不在本合同阶段新增调度。**

开发前还应确认 worktree 扫描 birthtime/platform、owner config 所属 scope、主树排除和 symlink/junction 安全边界；dirty 并不是上述纯 planner 的保护条件。官方先保存快照才能删除 dirty，不能凭 has_uncommitted_changes=false 推导安全。

## 5. 当前源码差距与最小实施边界

| 当前代码 | 已有能力 | 16.15B 差距 |
|---|---|---|
| `src/components/WorktreeSettings.tsx` | `git-worktree-root` 读/写/读回；草稿、单飞、卸载保护 | 无真实 autoCleanup/keepCount 或上游刷新消费者。 |
| `src-tauri/src/git.rs::list_worktrees_at_roots` | 当前配置+默认根；登记工作树及归属；主树标识 | owner 读取异常被压为 None；dirty异常压为 false；无 birthtime/read-status；不可直接成为删除候选数据源。 |
| `src/components/WorktreesView.tsx` | 用户手动创建、列表、关联聊天/置顶、显式删除/取消 | 不存在保留数执行器，不将手动确认链当自动策略。 |
| `src/worktreeRemoval.ts` | 手动归档关联会话后删除、读回和部分结果 | 自动清理附件/归档队列合同不同，不能直接复用为自动所有者策略。 |
| `src-tauri/src/git.rs::delete_worktree_with_cleanup_context` | C 的锁、snapshot、cleanup、身份复核、真实删除和读回 | 新增 reason 时分开 snapshot 失败政策；自动 worker 需同互斥，不能另起绕过 cleanup 的删目录命令。 |

推荐分两步，避免按钮先行而消费者缺失：

1. **先完整数据和纯计划器**：typed preference/readback、host identity、失败可辨的候选采集、保护与排序计划、不运行删除；从固定官方纯函数提取黄金输入/输出验证。只在隔离fixture给测试入口，不发布“可用自动清理”假开关。
2. **再闭合真实消费者**：补队列及全部触发依据、reason-aware snapshot、逐候选重校验、关联归档/恢复关系；只在临时仓库运行，所有检查通过后才接生产偏好开关。开发阶段不得触发对用户真实工作树的测试性清理。

默认值需与官方 true/15一致；“暂不挂消费者”是开发状态，不可冒充 autoCleanup=true 已工作。若无法实现必要保护，就保持阶段未完成，不能通过仅保存偏好宣称策略生效。

## 6. 修改前隔离验收矩阵

| ID | 操作 → 预期与证据 |
|---|---|
| WB01 | 私有 CODEX_HOME/状态目录缺失、true/false、非法类型、1/15/0/小数值 → schema/default明确；保存失败不报成功，重启读回同值，host A 不影响 B。 |
| WB02 | 生产设置组件：关闭确认取消/确认、重新开启、禁用数字框、空/NaN/负数/小数/相同值、blur/Enter、写入中连击/卸载 → 与第2节同序列；校验真实发出参数及读回。 |
| WB03 | 固定时钟纯计划器：全保护、20总数含10保护、eligible20含5保护、ownerless/owned混排、缺birthtime/updatedAt、同时间路径平手 → 官方函数与本项目逐项同候选，不只比数量。 |
| WB04 | 1小时临界点、未来birthtime、2026-02-21迁移边界、5天宽限临界、置顶/active/meta异常/null → 边界固定；额外fail-closed另列差异。 |
| WB05 | 临时真实Git仓库：默认/自定义根/相邻前缀/外部目录/symlink/junction/主工作树/损坏.git、owner成功/失败 → 扫描身份、失败状态和保护证据，不读取真实用户仓库。 |
| WB06 | 候选计划完成后新增pin/打开会话/attach/unpin/项目登记/账号切换/新born/owner变化/网络或metadata异常 → 逐候选重验，无晚删除，无跨scope回调。 |
| WB07 | 临时dirty/untracked/unpushed工作树：snapshot成功→cleanup marker→删除→恢复文件/提交；snapshot失败必须保留；cleanup失败/取消保持目录与快照，不补删凑数。 |
| WB08 | 队列相同host多触发合并、不同host隔离、先前轮未结束、窗口关闭/重连/取消 → 同target只一删除；所有进程与订阅释放。精确预期须队列原文取证后填写。 |
| WB09 | 附件owner unknown/true/false与app-server能力分支，归档/恢复/部分结果 → 真实隔离服务或固定事件回放，不能调用真实用户聊天归档做验收。 |
| WB10 | 当前源码完整标准、全量Rust、原生构建；设置/列表宽窄窗、确认dialog焦点/Escape/数字IME与官方同环境配对图 → 自动检查不替代原生与像素验收。 |

尚无本阶段测试运行结论；未完整追证项先补证再写产品，用户未验收。现阶段交付仅为下一阶段合同。
