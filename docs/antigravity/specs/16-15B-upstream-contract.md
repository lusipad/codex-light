# 16.15B 上游刷新核心合同与隔离验证

2026-11-03。依据固定包 [运行补证](16-15B-runtime-closure.md) 的 `upstream-refresh-consumer` / `create-before-refresh-and-starting-ref` 原文。本模块不创建生产工作树；创建消费者接线、原生和官方界面验收仍由主阶段记录。

## 范围与接口

`src-tauri/src/worktree_upstream.rs::refresh(RefreshRequest, &SetupOperation, &AtomicBool, LogSink)` 复用偏好 `UpstreamRefreshMode`。请求含 source cwd、starting mode、branch name、explicit remote ref 和 resolved commit。返回 `Skipped`、`Refreshed { destination_ref }` 或非零 fetch 的 `Warning { message }`；进程启动、读取、Job/管道异常返回 Err，主取消返回 Err，独立 skip 返回 Skipped，不伪造创建成功。

never、working-tree、explicit remote ref、预解析 commit 跳过。官方 HEAD 输入为 `type:branch, branchName:HEAD`，解析当前本地分支；detached HEAD 跳过。项目旧 `starting_mode:"HEAD"` 在创建函数中含义为不携带 diff 的 HEAD，接线层须仅在刷新请求规范为 branch/HEAD，不能把 working-tree 规范为 branch。刷新 remote tracking ref 不等于移动本地分支或 HEAD；后续创建仍须使用实际请求的 starting ref。

普通分支读取 remote/merge/upstream，`.` 或缺配置跳过。远程分支先解析 symbolic-ref，remote 名最长前缀匹配；fetch refspec 反向映射 source，只有唯一 source、且未被负 refspec 排除才刷新。精确 URL/refspec fetch：`fetch --progress --no-tags --no-recurse-submodules -- URL +src:dst`，不 fetch-all、不 pull、不更新本地分支、不推送。

## 凭证隔离与取消

原文不是“保留整个 global config”：先独立读取 `git config --system/--global --includes --null --get-regexp ^credential\.`，只重放 credential 配置为 `-c key=value`；fetch 设置 `GIT_CONFIG/GIT_CONFIG_GLOBAL=NUL`（非 Windows `/dev/null`）、`GIT_CONFIG_NOSYSTEM=1`、`GIT_PROTOCOL_FROM_USER=0`，并 `-c protocol.file.allow=always`。模块不输出远程 URL 或完整 credential 值；错误日志用固定 warning，progress 只转发已知进度前缀，省略含 URL 的 `From ...` 行。

所有子进程受 SetupOperation 主取消约束。Windows suspended spawn 后复用现有 Job attach/resume，全树确认停止后再回收输出 reader；独立 skip 仅结束刷新。Unix 进程组路径未在本次 Windows 环境验收。15 秒仅为静默进度提示，不是取消/超时；输出持续 drain，保留日志上限 256 KiB，管道释放异常不会当作 best-effort 成功。

## 测试约定

### 本地分支创建 ref 修正（编码前补证）

追加完整 `_a`、`_o`、`_n` 和 `g7` 原文到 `.ref/parity/16.15/actual/16-15B-upstream/starting-ref-anchors.json`，包含 worker SHA-256 与 UTF-16 精确范围。官方 `_a` 对 branchName 为 HEAD/@ 直接保留该 ref；普通本地分支走 `_o`：`rev-parse --abbrev-ref --symbolic-full-name branch@{u}` 找 upstream，优先已存在 `refs/remotes/<upstream>`，否则 `refs/heads/<upstream>`；`rev-list --left-right --count local...upstream` 仅 **left=0 且 right>0** 时选择 upstream，其余 equal/本地领先/分叉/比较失败都保留本地 ref。不移动任何本地分支。

据此新增 `resolve_starting_ref`，父消费者在刷新后、真实创建前调用。WU07 改为真实 UI 的 `branchName:main`，检查远程领先时创建检出上游新提交、本地 main 未移动；追加 WU09 的 right-ahead/equal/local-ahead/diverged/no-upstream/HEAD/resolved-commit。补丁最终专项 **9/9，退出码 0**（`--test-threads=4`，63.21 秒），日志 `.ref/parity/16.15/actual/16-15B-upstream/tests-starting-ref-final.log`；未覆盖前次 8 项日志。父 `git_worktree_create` 已读回：刷新同一请求 clone 后解析，仅 branch 模式使用选择出的 ref，HEAD 与 working-tree 保留原创建模式。现产品只列本地分支与 HEAD，验收先覆盖该真实入口及已存在的 remote ref、commit；`useExactStartingRef`、explicit remoteRef 和远程分支不存在时的 `_s/ls-remote` 探测没有产品入口，单列未接入，不杜撰 UI。已提供 resolved commit 时返回其提交，不刷新；生产当前无此用户输入入口，不将纯核心分支测试说成已交付 exact 模式。

生产 TypeScript client VM 补测 `node scripts/verify-worktree-creation-b.mjs` 退出码 0：预取消 refresh 必须等待 skip IPC ACK 才创建，skip 失败不创建，监听注册期间主取消不创建且解除监听，进度仅本 operationId，结束清理监听；native 两个 progress phase 检查均为所属 webview target。此 VM/静态边界检查不代替双原生窗口实测。

只用临时 bare/local Git fixture，不访问用户 remote 或外网。fixture 初始化/提交隔离 system/global Git config，不运行用户 hooks。WU01 精确目标、其他分支/标签不变、source 子目录与日志先后；WU02 never/exact/remote/working-tree/detached 跳过；WU03 fetch 非零 warning 与主取消；WU04 独立 skip；WU05 唯一/负 refspec 和最长 remote；WU06 活进程及持管道子进程取消；WU07 refresh 后真实创建，分别验证新提交/缓存/skip/主取消不建目录；WU08 spawn 异常不能成为成功。

命令：`cargo test --manifest-path src-tauri/Cargo.toml worktree_upstream::tests -- --test-threads=1`，退出码 **0**，**8/8**（91.66 秒）。结果日志 `.ref/parity/16.15/actual/16-15B-upstream/tests.log`。首轮 5/6：`git remote add origin/team` 被 Git CLI 拒绝与已有 origin 重叠，改为在临时 repo 用 `git config remote.origin/team.*` 构造真实可读 refspec，重验通过；没有修改生产策略规避失败。原生 UI、真实账号凭证、真实网络失败及官方同场景对照均未测；生产创建接线仍以主阶段验证为准。
