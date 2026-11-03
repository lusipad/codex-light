# 10B Scheduled 执行终态合同

日期：2026-11-03。先调研、后开发；本文件仅建立修改前合同，不表示功能或页面已验收。

## 基准与边界

候选 asar SHA-256：`17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。候选含 offline 补丁，不能称为干净官方发行基准。以下是包内静态实现，未进行官方运行时、账号、原生或像素对照。

原始文件复用 `.ref/parity/09/actual/09B-research/` 中的 `main-DkWgQSQe.js`、`bootstrap-DvSEn4qy.js`；完整 SHA-256、字节数、检索锚点与原始片段保存在 `.ref/parity/10/actual/10B-research/anchors.json`。偏移统一为 **0-based UTF-16 字符偏移**，不是字节、物理行号。10A 的三个 UI chunk 只证明写操作在途状态，不能证明执行终态；本合同补充主进程调用链。

## 静态调用链

1. `main` 的 `Wl`（194019 后）先创建 `pending:<UUID>` 的运行记录并通知刷新；创建真实 thread 后把临时 ID 替换为真实 thread ID。调用 `startTurn` 前准备 cron 已读监听，随后 `await i.startTurn(...)` 返回。这个返回点没有把记录置为成功或完成。
2. `bootstrap` 的 `_c` 插入运行记录，初始 `IN_PROGRESS`；`yc` 只把 `IN_PROGRESS` 转为 `PENDING_REVIEW`（或按显式参数修改已有待查阅记录）。`PENDING_REVIEW` 是查阅状态，不能等同“模型执行成功”。`vc` 的 `ACCEPTED` 与 `xc` 的 `ARCHIVED` 也是运行记录工作流状态，不是 turn 成败枚举。
3. `bootstrap` 的 `mM.startTurn` 发出 `turn/start`，响应只用于 `register(n.turn.id, metadata, input)`。它将 `threadId + NUL + turnId` 作为跟踪身份；真正结束由 `complete` 处理。
4. `bootstrap` `turn/completed` 路由：解析 thread/turn → `automationTurns.complete` → 可选自动归档 → `yc` 更新运行记录 → 通知刷新 → 内部通知处理。因此 **turn/start 的 RPC 成功响应不等于任务执行完成**。
5. 结束通知可能早于 start 响应。`mM` 以 `pendingStartCountByThreadId`、`completedBeforeStartResponse` 暂存终态；`register` 配对，`flushDeferredAutomationCompletion` 重走通知。缺少这个顺序处理会丢终态或失去 automation metadata。
6. `main` `vKe` 只处理同 thread、同 turn 的 `turn/completed`。`didCompleteSuccessfully` 明确为 `turn.status === "completed"`。失败/中断不能冒充成功；仅 `failed_runs_only` 策略在完成成功时不提示、非成功时提示。其通用通知策略还可能从最后 assistant 消息解析决定，不能把“所有完成均强制未读”写成官方规则。
7. `bootstrap` `archiveCompletedAutomationRun` 必须同时满足 cron、autoArchive、turn status 为 `completed` 等条件；非成功状态不走成功自动归档。
8. 启动恢复 `bc`：未绑定真实 thread 的 `pending:%` 在途记录归档，其他 `IN_PROGRESS` 转待查阅。启动恢复并没有把遗留运行猜成成功。

精确偏移以 anchors JSON 为准。以上函数定位和原片段均来自当前候选文件，不能跨版本直接沿用。

## 本轮实现合同

本轮最小闭环是“真实运行请求 → 绑定 thread/turn → 等待匹配终态 → 发布真实结果 → UI 刷新”，并修复同一任务跨入口重复启动。允许 Tauri 内部结构不同，但不能把调度命令返回、thread 创建或 turn/start 响应当作执行成功。完整持久运行历史库留待后续，不能为了修复终态扩大为历史库重建。

- 发起成功仅表示已启动；运行记录保留在途状态。`running`/`IN_PROGRESS` 是本项目与官方状态命名可能不同的层次，映射必须明确。
- 只有匹配运行身份的 `turn/completed` 或可证明的对应真实历史终态才能结束运行。成功仅对应 `completed`；`failed`、`interrupted` 保留不同结果及实际错误，未知终态不能默认为成功。
- 监听先于请求。通知早于响应时缓存并按 thread/turn 绑定；无关会话、旧 turn、重复终态不能关闭当前运行。
- RPC 启动失败必须可见、持久化为启动失败；进程退出/连接中断不能写成执行成功。若无法确认实际终态，应保留未确认/中断原因并允许从真实历史恢复。
- 状态更新保持幂等；终态后不会被晚到的“已启动”写入倒退。现有存储字段发生写入时应回读验证；通知刷新本身不是持久化证据。尚未保存的逐次运行结果明确列为历史库缺口。
- 同一任务的定时 tick、立即运行和其他入口共享在途互斥，不能仅依赖某个前端按钮锁。这里是本轮防止重复副作用的实现不变量；当前静态依据不足以宣称官方所有类型任务都采用同一重入策略，不把本项目实现反推为官方合同。
- 不强行复制官方 SQLite 架构，不把自建本地通知表当作官方 automation_runs。完整历史/查阅/自动归档/通知策略若未实现，应单列缺口。

## 必须验证的操作序列

| ID | 操作/故障 | 可验证预期 |
|---|---|---|
| RC01 | start 响应返回，尚无完成通知 | 仍在执行；无成功 toast/成功运行记录 |
| RC02 | 匹配 turn 收到 completed | 仅此时发布成功并刷新；既有存储写入回读一致 |
| RC03 | 匹配 turn 收到 failed / interrupted | 分别保留失败/中断；不进入成功，不触发成功自动归档 |
| RC04 | 完成通知先于 start 响应 | 配对后仅结束一次；晚 start 不恢复 running |
| RC05 | 其他 thread / 旧 turn / 重复通知 | 不污染当前运行；同一次运行无重复终态副作用 |
| RC06 | start RPC 错误、连接/进程退出 | 错误可见；不伪造成功；存储可回读，明确未确认或真实失败 |
| RC07 | 重启时有在途记录 | 对应真实历史恢复或明确中断/待确认；不能仅凭重启判成功 |
| RC08 | 执行完成后打开生成会话 | 打开真实 thread，正文/工作区与该运行一致；不只设置 ID |
| RC09 | 定时 tick 与立即运行并发启动同一任务 | 共享后端在途 guard；只创建一个真实 thread/turn，结束后允许下一次运行 |

回归先覆盖 RC01–RC06 的生产路径。真实协议探针应使用隔离 CODEX_HOME/工作区，不产生付费模型运行；若无法获得真实执行终态，应把回放/测试桥与真实服务证据分别登记。页面原生操作、官方运行时通知规则与同条件视觉仍需独立验收。
