# 16.14C 环境操作终端：编码前宿主合同

本模块实现固定Store TerminalManager.runAction的可观察主链：校验session原生窗口owner，串行关闭旧backend进程树并确认，创建真实cwd的新PTY，发送原命令一次，复用terminal:data/exit和generation隔离。固定原文见16.14C研究anchors中的terminal-host-run-action、terminal-restart-and-command；PTY写入接受不等于命令成功。

范围：仅terminal.rs和必要已获父授权的共享Job接线，不修改cleanup/setup runner、Git算法、产品页面或依赖。普通既有终端兼容；action不能认领已有普通session。所有native普通IPC须持有authorize返回的RAII访问guard直到操作结束，避免检查后所有权变化；run_action自身持guard，外层不可再authorize重入。

API：run_action(app,owner,session_id,cwd,command,cols,rows,shell)->TerminalSessionInfo；authorize(owner,id)->TerminalAuthorization；close_owner(owner)及新原生实例reopen_owner(owner)。action session按owner隔离，旧generation reader/waiter不能移除或标记新backend退出。

portable-pty0.8.1 Windows Child提供as_raw_handle；ConPTY CreateProcessW未开放CREATE_SUSPENDED。因此action使用禁用startup profile的PS/cmd shell，用户动作只在Job挂载成功后发送。其他Windows shell无法保证此路径时明确拒绝，普通终端仍按原实现。新backend必须使用真实有效cwd，不能静默回落用户目录。停止复用Windows Job确认全部进程退出，不能仅kill shell；普通非action的历史关闭语义不冒充新的进程树保证。

验证：隔离临时目录PTY，原命令写测试marker/输出，正确cwd与真实exit；重启先停旧子进程树（延迟marker不得出现）；并发/多次运行不重复写同次命令；跨owner普通IPC不能绕过；close_owner拒绝晚调用；旧generation不能删除新session。只运行无害测试脚本、不改全局环境；Cargo由父分配时段，测试通过前不写已完成。

## 2026-11-03 宿主专项结果

实现：`src-tauri/src/terminal.rs`；复用 `recommended_skills::git_job::Job` 的挂载、kill-on-close 和全树退出确认，仅提取 `attach_running`，未增加依赖。动作入口持 owner 控制锁串行重启；普通 create/write/resize/close 由调用端持 RAII guard。共享控制锁也会串行不同 action session 的创建/重启，暂未按 session 分锁；后台读取/等待不持有该锁。

`cargo test --manifest-path src-tauri/Cargo.toml terminal::tests -- --test-threads=1` 退出码 0：15/15，通过日志 `.ref/parity/16.14/actual/16-14C-terminal/terminal-tests.log`。包含原有 8 项 UTF-8、输出水位、attach、generation 和 worktree env 回归，以及新增 7 项：PowerShell 正确 cwd/单次文件写入/真实 exit 7；cmd 正确 cwd/exit 9；同 owner 并发重启；跨 owner 与普通 session 防认领；关闭墓碑及新实例重开；RAII guard 阻止控制竞态；重启终止旧后台子进程；shell 自然退出清理后台持管道进程（部分同一测试组合多个断言）。

退出事件增加 `exitCode` / `error`。该退出码代表真实 shell 进程退出；普通环境操作完成后 shell 可继续交互，因此不能用写入接受或 PTY 仍存活推导操作成功。旧 generation 事件保留其 generation，由消费端过滤。

剩余限制：Windows 动作仅支持 PowerShell/cmd，禁 profile/AutoRun 后才挂 Job、写原命令；WSL/Git Bash 明确报不支持，普通终端支持不变。非 Windows 进程组路径未实测。真实官方窗口动作对照、完整 Tauri UI/键鼠、视觉像素验收由上层交付继续记录，本专项通过不代表页面已验收。
