# 11B 工作树删除与恢复保障：修改前合同

日期：2026-11-03。结论：下一单元应打通“关联会话检查 → 删除单飞 → 归档会话 → 保存恢复快照 → 移除目录 → 重新读取结果”的真实闭环。当前只有确认框后直接 `git worktree remove --force`，会丢失官方删除链的会话约束与恢复数据；增加 dirty 标签或按钮锁不足以完成此单元。

## 基准、证据边界

只读候选：`C:/Users/lus/Codex/_internal/app/resources/app.asar`，本轮重新计算 SHA-256 为 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。候选含 offline 补丁，不能称为干净官方发行基准；本合同没有官方运行时、原生操作或像素验收。

原始三个 chunk、完整哈希、UTF-16 定位和片段见 `.ref/parity/11/actual/11B-research/manifest.json`。`.vite/build/worker.js` 本轮从候选只读提取，2377168 字节，SHA-256 `f8b0ca645b63726993750e08e8fc23a04d815eca5de19674f89f8a29addea473`，与 asar header integrity 匹配。其他两个 chunk 复用此前已经提取的同候选文件；这不代替运行时验证。偏移均为 **0-based UTF-16 字符偏移**。

## 官方静态链与不能混淆的结论

### 页面与会话约束

- `worktrees-settings-page` 的 `qt/Jt/Yt` 获取所有未归档会话（分页）及置顶会话。对置顶项单独 `thread/read`；因此不能只看当前 sidebar 已加载的几条会话。
- `fn` 按 cwd 及其父路径建立工作树关联，包含在工作树子目录工作的会话，不能只用 cwd 字符串完全相等。
- `cn` 删除按钮在“关联会话加载中”或存在置顶会话时禁用，`ln` 明确只检查 `isPinned`。
- `Qt` 再读真实置顶列表，发现同目录/后代 cwd 对应会话时阻止删除；随后归档传入的全部关联会话，参数含 `cleanupWorktree:false`，防每条归档递归清理同一工作树。归档失败进入错误分支，不继续后面的删除。
- 任务按 host/worktree 键单飞；成功才 invalidate worktree 查询并提示成功，失败显示错误。
- 此定向删除链**没有证据证明“所有运行中会话一律阻止删除”**。主进程 startup-cleanup 排除活跃/新建/保留工作树属于自动清理路径，不能移植成手动删除的既成官方规则。操作系统文件占用也不是页面的置顶占用。

### 主进程、Git Worker 与恢复

- `main` 的 `"worktree-delete"` 调用服务 `deleteWorktree`，后者派发 `delete-worktree`，带 `force:true`、reason。成功后广播 worktrees reload，失败状态不能当作成功。
- Worker `scheduleWorktreeDelete` 按 host/worktree 保存 Promise，重复删除复用同一在途操作。
- `fOe` 在真正移除前调用 `XEe`。`XEe` 检查嵌套仓库/已初始化子模块，计算包含工作区改动的 tree，必要时创建 synthetic commit，以 `refs/codex/snapshots/<worktreeId>` 保存引用。快照不是只保存 HEAD；仅 `git diff` 无法覆盖新增未跟踪文件。
- `ZEe` 可通过保存的 snapshot ref 执行 `git worktree add --detach` 恢复目录，并约束恢复 cwd 在目标工作树内部。
- `q0` 执行可选 cleanup 脚本、`git worktree remove` 及目录清理；cleanup 脚本失败会抛错。Worker 对删除失败与不支持嵌套仓库有区分。
- **重要例外**：`fOe` 捕获快照错误时，`reason === "settings-delete-targeted"` 会继续移除（其他 reason 会重新抛出）。因此不能宣称“官方定向删除一定已成功保存快照”，也不能把“dirty/嵌套仓库无条件拒删”写成官方事实。若本项目选择更保守地拒绝快照失败，应明确登记与当前候选的差异，而非声称严格 1:1。
- `q0` 在 force 分支对 Git remove 非零还有后续目录清理；本项目不得凭抄这段就实施任意递归删除。目标身份与路径范围必须先确认，所有失败必须可见；具体平台行为仍待官方实测。

## 当前实现的已观察缺口

本轮只读 `src/components/WorktreesView.tsx` 与 `src-tauri/src/git.rs`：

1. `handleDeleteWorktree` 使用 `actionBusyPath` 的 React state 作为重入检查，尚无同步 ref guard；确认后直接传任意 `worktreePath/gitDir` 给后端。
2. `delete_worktree` 直接相信 `git_dir` 或从传入路径推导仓库，执行 `worktree remove --force`；无恢复快照、会话置顶复核、关联会话归档或后端重复删除合并。
3. dirty 状态来自列表时的 `git status`，不是删除时状态，不能当作新的删除授权/快照依据。
4. UI 仅按当前 activeWorkspaceRoot 比较“主工作区”，不证明后端排除了仓库 primary checkout、路径伪装或非关联工作树。

这些是当前源码事实，不表示已跑过真实删除验证。本次调研没有修改产品、运行 Cargo 或执行删除。

## 推荐实现顺序与范围

优先完整删除闭环，不顺手扩建创建、带回、跨主机或所有 Worktrees 设置：

1. 使用真实会话服务获取关联与置顶状态；加载/读取失败保持不可删除；检查子目录 cwd。真正执行前重新检查置顶，复用已有 archive API，明确禁止归档触发递归工作树 cleanup。
2. 后端验证目标确属指定 Git 仓库登记的非 primary worktree，匹配解析后的真实路径；前端锁与后端 host/path 在途单飞同时落实。错误不能被刷新或 toast 吞掉。
3. 保留可恢复 snapshot（tracked 修改/删除、新增非忽略文件、必要提交），再移除。为 snapshot 引用及恢复路径提供可测接口；完整恢复 UI 可以后续，但不能用“保存过快照”代替恢复测试。
4. 依据真实 Git 返回及重新读取的 worktree list/磁盘目录判断结果；不得先成功通知再验证。
5. 快照失败策略、文件占用/cleanup 失败、归档部分成功须透明记录。与候选定向删除例外不同的策略标差异，不包装成官方已证明行为。

如果本轮只能先交付关联会话约束与后端身份校验，也应把它作为明确子阶段，而非把整个删除/恢复闭环标完成。不能删除尚未具备恢复保障的 dirty 工作树后宣称安全复刻。

## 验收合同

全部真实写验证只使用隔离临时 Git 仓库和隔离 CODEX_HOME；先验证绝对目标在测试根内，再执行删除。

| ID | 场景 | 预期 |
|---|---|---|
| WR01 | 工作树根/子目录含置顶会话 | 加载完成前禁用；执行前真实复核；不归档、不删除 |
| WR02 | 会话/置顶读取失败 | 错误可见，不以空数组当作无占用继续 |
| WR03 | 关联会话多个，某条归档失败 | 失败可见；删除未执行；已成功归档的事实保留并明确部分结果 |
| WR04 | 快速重复、两个入口同路径删除 | 同步前端锁、后端同路径单飞；一次真实副作用；不同目录不串状态 |
| WR05 | 传主仓库、错误 gitDir、同名前缀/相对/外部路径 | 拒绝不属于目标仓库的 checkout，主仓库文件不变 |
| WR06 | tracked 修改/删除、新增非忽略文件和未推送提交 | 快照可重新读取；恢复后字节与所需提交一致；不声称保留被忽略文件 |
| WR07 | snapshot/cleanup/Git remove/文件占用失败 | 分别显示真实错误；未删除内容保持；不显示成功；具体官方快照失败例外单列差异 |
| WR08 | 删除成功后重读/重启 | worktree 登记与目录真实移除，关联会话归档状态回读一致，snapshot 可恢复 |
| WR09 | 切项目/导航离开时操作晚返回 | 真实已完成副作用保留；不把旧列表和焦点带回新项目 |
| WR10 | initialized submodule/embedded Git repo | 按明确策略处理；不谎称可恢复；若拒绝，与候选定向删除分支差异单列 |

页面完整布局、官方中文、确认/焦点形态与原生占用表现仍未测；本合同不能替代 11 整页验收。
