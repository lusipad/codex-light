# backend-surface — 前后端接口清单 & Codex app-server 协议对照

> 审计对象：`D:\Repos\codex-desktop-native`
> 目的：给出 Rust 后端全部可调用面（Tauri command / JSON-RPC 透传 / 事件 / 持久化键），并逐项标注前端是否使用、是否与真实 codex app-server 协议吻合。
> 数据来源：
> - `src-tauri/src/*.rs` 全量阅读（lib.rs 803 行、app_server.rs 710、config_skills.rs 1151、git.rs 780、state.rs 645、terminal.rs 223）
> - `src/**` 全量 grep `invoke(...)` / `tauriInvoke(...)` / `callAppServer(...)` / `listen(...)` / `tauriListen(...)`
> - **本机实测**：`codex app-server generate-json-schema --experimental`（0.159.0）+ 通过 stdio 实际发送 JSON-RPC 请求验证（见 §6）
> - 对照产物：`.ref/audit/schema/`（本次生成，含 experimental）、`.ref/protocol/`（并行任务生成，非 experimental，104 client methods）

---

> **并行改动声明**：本报告源码阅读基于 2026-10-23 ~06:50 的工作树快照（HEAD `fad9129`）。06:53 后另一并行任务新增了 `src/protocol.ts`、`src/components/ApprovalCenter.tsx` 并修改 `src/App.tsx`/`src/styles.css`（未提交）。下表凡标注“并行改动已接”的条目为 S1 之后的变化；其余结论仍以 S1 为准。

---
## 1. 基线：app-server 版本与二进制解析

| 项 | 值 | 证据 |
|---|---|---|
| Rust 侧启动命令 | `codex app-server --listen stdio://` | `app_server.rs:162-174` |
| Windows 下 `.cmd/.bat/codex` 走 `cmd.exe /C ...` | 是 | `app_server.rs:162-169` |
| 二进制解析顺序 | ① 用户自定义路径（Settings 输入）② 环境变量 `CODEX_CLI_PATH` ③ exe 同目录 `codex.exe` / `resources/codex.exe` / `_internal/app/resources/codex.exe` ④ `%APPDATA%\npm\codex.cmd` ⑤ `"codex.cmd"` | `app_server.rs:88-130` |
| 本机实际默认命中 | `%APPDATA%\npm\codex.cmd` → **codex-cli 0.159.0** | 实测 `codex --version` |
| 官方离线包内置 CLI | `...\OpenAI\Codex\bin\896a0166b774037a\codex.exe` → app-server `0.163.0-alpha.10.2` | 握手实测 |
| 初始化握手 | 发 `initialize`（clientInfo.name=codex-tauri-native, capabilities.experimentalApi=true）→ 收结果 → 发 `initialized` 通知 | `app_server.rs:244-292` |
| 请求 id | 单调递增 u64（`AtomicU64`），与 server 推送的字符串/UUID id 分开存 | `app_server.rs:48-69, 328-339, 408-414` |
| 请求超时 | 固定 60s（initialize 15s） | `app_server.rs:257, 376` |
| 错误处理 | 所有错误转 `String` 返回前端；`error.message` 优先 | `app_server.rs:430-441` |

---

### 1.1 本机 codex CLI / app-server 能力（实测 `--help`）

```
codex-cli 0.159.0

codex app-server [OPTIONS] [COMMAND]
Commands:
  daemon                 Manage the local app-server daemon
  proxy                  Proxy stdio bytes to the running app-server control socket
  generate-ts            [experimental] Generate TypeScript bindings for the app server protocol
  generate-json-schema   [experimental] Generate JSON Schema for the app server protocol
Options:
  -c, --config <key=value>     覆盖 config.toml 配置（TOML 解析）
  --enable/--disable <FEATURE> 开关实验特性
  --code-mode-host <URL>       远程 code-mode
  --strict-config              出现不认识配置字段时直接报错（本次用于验证 config 键有效性）
  --listen <URL>               stdio://（默认）| unix://[PATH] | ws://IP:PORT | off
  --stdio                      等价 --listen stdio://
  --analytics-default-enabled / --ws-auth / --ws-token-file / ...
```

对本项目的含义：
- 只用了 `--listen stdio://`，**未使用 daemon/ws 传输**；窗口重载时 Rust 会重启子进程（`app_server_restart`）。
- `generate-json-schema` / `generate-ts` 可随时重新生成协议基准（本报告用 `--experimental` 生成 167 方法版本）。
- `--strict-config` 是验证 Settings 写入键是否有效的可靠手段（见 §9.3）。
## 2. Tauri command 清单（64 个，`lib.rs:735-800` 注册）

说明：Tauri v2 默认把 Rust `snake_case` 参数映射为 JS `camelCase`；已逐一核对，**未发现参数名不匹配**。
状态列：**used** = 前端有 `invoke` 调用；**UNUSED** = 后端已实现但前端无调用点；**stub** = 实现为硬编码/固定返回。

### 2.1 app-server 控制（6）

| command | 参数 | 前端调用点 | 状态 |
|---|---|---|---|
| `app_server_status` | – | 无 | **UNUSED**（前端靠 connect 返回 + status 事件） |
| `app_server_connect` | – | App.tsx:511 | used，真实 |
| `app_server_restart` | `custom_cli_path?: string` | App.tsx:2275（Settings 传入） | used，真实 |
| `app_server_call` | `method: string, params?: any` | bridge.ts:32（`callAppServer`） | used，**通用透传**（见 §3） |
| `app_server_respond` | `id: any, result?: any, error?: any` | App.tsx:1347, 1366 | used（但应答结构有问题，见 §5） |
| `app_server_pending_requests` | – | App.tsx:465（并行改动新增 `refreshPendingRequests`） | **used（06:54 后）**；S1 快照时未使用（重载后审批/提问会丢） |

### 2.2 工作区 / 文件系统 / 桌面状态（16）

| command | 参数 | 前端调用点 | 状态 |
|---|---|---|---|
| `workspace_list` | – | App.tsx:321 | used，真实（读官方 global state `electron-saved-workspace-roots`） |
| `workspace_add` | `path, label?, set_active?` | App.tsx:809 | used，真实 |
| `workspace_remove` | `path` | App.tsx:792 | used，真实 |
| `workspace_set_active` | `path` | App.tsx:778 | used，真实 |
| `pick_folder_dialog` | – | App.tsx:805 | used，rfd 原生对话框 |
| `pick_files_dialog` | – | App.tsx:859 | used，rfd 原生对话框 |
| `workspace_agents_md` | `cwd` | App.tsx:377 | used，真实（AGENTS.md/CLAUDE.md 查找） |
| `fs_list_dir` | `path, show_hidden?` | App.tsx:384；DiffDrawer.tsx:211 | used，真实 |
| `fs_read_preview` | `path, max_bytes?` | DiffDrawer.tsx:318 | used，真实（文本/图片 base64/二进制判定） |
| `fs_write_file` | `path, content` | AgentsMdModal.tsx:26；DiffDrawer.tsx:334 | used，真实 |
| `fs_search_files` | `cwd, query?, limit?` | App.tsx:396；DiffDrawer.tsx:226 | used，真实（本地 BFS，depth≤4、≤250 目录、忽略 node_modules 等） |
| `desktop_state_get` | `key` | App.tsx:499；SettingsView.tsx:360, 422 | used |
| `desktop_state_set` | `key, value` | SettingsView.tsx:490, 868, 872, 912, 2728, 2845 | used（写 `~/.codex/.codex-global-state.json`） |
| `thread_record_workspace` | `thread_id, cwd` | 无 | **UNUSED**（thread/start 时在 `app_server_call` 内部自动记录，lib.rs:64-82） |
| `threads_meta_get` | – | App.tsx:334；SettingsView.tsx:444 | used，真实 |
| `thread_toggle_pin` | `thread_id, pinned` | App.tsx:1393 | used，真实（本地 global state） |

### 2.3 线程归档/删除/系统（2 + 1）

| command | 参数 | 前端调用点 | 状态 |
|---|---|---|---|
| `thread_archive_toggle` | `thread: Value, archive: bool` | App.tsx:1423；SettingsView.tsx:1422 | used，真实（调 `thread/archive`/`thread/unarchive` + 落盘 archivedThreads） |
| `thread_delete` | `thread_id` | App.tsx:1446；SettingsView.tsx:1440 | used，真实（`thread/delete` + `thread/archive` + 清本地记录） |
| `reveal_path_in_explorer` | `path` | App.tsx:1467；WorktreesView.tsx:208 | used，真实（explorer/open/xdg-open） |

### 2.4 工程脚本探测（1）

| command | 参数 | 前端调用点 | 状态 |
|---|---|---|---|
| `detect_project_scripts` | `cwd` | App.tsx:420 | used，真实（package.json/Cargo/py/go/Makefile → run/test/build） |

### 2.5 Git（18）

| command | 参数 | 前端调用点 | 状态 |
|---|---|---|---|
| `git_status` | `cwd` | App.tsx:348 | used，真实 |
| `git_diff` | `cwd, file_path?, staged?, base_branch?` | DiffDrawer.tsx:198 | used，真实 |
| `git_stage` | `cwd, file_path?` | DiffDrawer.tsx:238 | used，真实 |
| `git_unstage` | `cwd, file_path?` | DiffDrawer.tsx:247 | used，真实 |
| `git_discard` | `cwd, file_path` | DiffDrawer.tsx:257 | used，真实（`git checkout --` / untracked clean） |
| `git_commit_changes` | `cwd, message` | DiffDrawer.tsx:270 | used，真实 |
| `git_branches` | `cwd` | App.tsx:357；WorktreesView.tsx:45 | used，真实 |
| `git_branch_create` | `cwd, branch, checkout?` | App.tsx:842 | used，真实 |
| `git_branch_checkout` | `cwd, branch` | App.tsx:826 | used，真实 |
| `git_worktrees_list` | `cwd?` | WorktreesView.tsx:41 | used，真实（含 `~/.codex/worktrees` 扫描） |
| `git_worktree_create` | `source_cwd, starting_mode, branch_name?, owner_thread_id?` | App.tsx:997；WorktreesView.tsx:65 | used，真实（working-tree diff + untracked 拷贝；ported from official pendingWorktrees.ts） |
| `git_worktree_delete` | `worktree_path, git_dir?` | WorktreesView.tsx:82 | used，真实 |
| `git_worktree_set_owner` | `worktree_path, thread_id` | 无 | **UNUSED**（创建时直接写 `codex.ownerThreadId`） |
| `gh_status` | – | 无 | **UNUSED**（PR 前无法检测 gh 是否可用） |
| `git_log_commits` | `cwd, limit?` | DiffDrawer.tsx:181 | used，真实 |
| `git_commit_diff` | `cwd, commit_hash` | DiffDrawer.tsx:187 | used，真实 |
| `git_push_changes` | `cwd, force_with_lease?` | DiffDrawer.tsx:284；App.tsx:1730 | used，真实（`git push -u origin branch`） |
| `git_create_pr` | `cwd, title, body, base_branch?, draft?` | DiffDrawer.tsx:298 | used，真实（`gh pr create`） |

### 2.6 存储 / 配置 / 技能 / 自动化（15）

| command | 参数 | 前端调用点 | 状态 |
|---|---|---|---|
| `storage_stats_get` | – | SettingsView.tsx:440, 1359, 1378 | used，真实（扫描 `~/.codex` 目录字节数） |
| `storage_clean_cache` | – | SettingsView.tsx:1356 | used，真实（删 `log/`、3 天前 `rollouts/`） |
| `import_external_tool_config` | `kind, cwd?` | SettingsView.tsx:2721/2761/2806/2838 | used，真实（claude/cursor/windsurf/vscode） |
| `local_environment_read` | `cwd` | SettingsView.tsx:448 | used，真实（读 `.codex/environments/default.toml`，不存在则返回模板） |
| `local_environment_save` | `cwd, content` | SettingsView.tsx:1480 | used，真实（TOML 语法校验后写盘） |
| `config_read` | – | App.tsx:460；SettingsView.tsx:339；SkillsMcpView.tsx:175 | used，真实（解析 `~/.codex/config.toml`） |
| `config_save_raw` | `raw_toml` | SettingsView.tsx:642 | used，真实（校验 TOML + 根键归位） |
| `config_update` | `payload: CodexConfigUpdatePayload` | SettingsView.tsx ×6；SkillsMcpView.tsx ×4 | used，真实（但 payload 中 10 个键 codex 不识别，见 §8） |
| `config_generate_models_api` | – | SettingsView.tsx:656 | used，真实写 `~/.codex/models-api.json`（示例模型硬编码，见 STUBS） |
| `skills_list_local` | `workspace_root?` | App.tsx:409；SkillsMcpView.tsx:163 | used，真实（`~/.codex/skills` + 种子目录） |
| `skill_save_or_install` | `id, content, source_dir?` | SkillsMcpView.tsx:201/220/457 | used，真实 |
| `skill_delete` | `id` | SkillsMcpView.tsx:239 | used，真实 |
| `automations_list` | – | AutomationsView.tsx:76 | used，真实（扫 `~/.codex/automations/*/automation.toml`） |
| `automation_save` | `item` | AutomationsView.tsx:102, 118 | used，真实（写 TOML；字段集不全，见 §8） |
| `automation_delete` | `id` | AutomationsView.tsx:126 | used，真实（递归删目录） |

> 注：2.1~2.7 合计 6+16+3+1+18+15+5 = **64**，与 `lib.rs:735-800` 注册数一致。

### 2.7 终端 / shell（5）

| command | 参数 | 前端调用点 | 状态 |
|---|---|---|---|
| `terminal_create_or_attach` | `session_id, cwd, cols?, rows?, shell?` | TerminalDock.tsx:157 | used，真实（portable-pty） |
| `terminal_write` | `session_id, data` | TerminalDock.tsx:101, 149 | used，真实 |
| `terminal_resize` | `session_id, cols, rows` | TerminalDock.tsx:170, 186 | used，真实 |
| `terminal_close` | `session_id` | TerminalDock.tsx:223 | used，真实（kill 子进程） |
| `exec_shell_command` | `cwd, command` | App.tsx:1107（goal 验证）；SettingsView.tsx:557（MCP 测试） | used，真实（Windows `powershell -NoProfile -NonInteractive -Command`） |
| （`terminal.rs` 内部，无 command） | – | – | – |

### 2.8 不存在的调用 / 前后端不一致

- **前端调用但后端未定义：0 个**（逐一比对 64 个注册 command 与全部 `invoke(` 字面量）。
- **后端定义但前端未用：4 个（S1 为 5 个）** = `app_server_status`、`thread_record_workspace`、`git_worktree_set_owner`、`gh_status`；`app_server_pending_requests` 已于 06:54 后由并行改动接入。
- Tauri capabilities 仅 `core:default / core:event:default / core:window:default`（`src-tauri/capabilities/default.json`），未使用 dialog/notification/updater/autostart 插件——因此**没有任何系统级通知/自动更新能力**。

---

## 3. app_server.rs（Rust 侧 JSON-RPC 桥）实现清单

**核心结论：Rust 侧是“通用管道”，没有方法白名单**。任何 `method` 都可通过 `app_server_call` 发出去；任何 server 请求/通知都统一 emit 给前端。因此协议覆盖度的瓶颈全在前端。

### 3.1 Rust 处理的特殊分支（仅 7 处）

| 位置 | 特殊处理 |
|---|---|
| `app_server.rs:257-292` | `initialize` → 发 `initialized`，解析 `userAgent`/版本写状态，emit `app-server:status` |
| `app_server.rs:369-373` | **别名**：`mcpServer/list` → `mcpServerStatus/list` |
| `app_server.rs:374, 487-504` | 对 `thread/start\|resume\|fork`、`turn/start` 的 `config` 字段做 `sanitize_codex_app_mcp_config`（删不完整 codex_app MCP 配置） |
| `app_server.rs:378, 544-563` | 结果后处理：`model/list` 注入/取消隐藏模型；`thread/resume\|read` 补 turn 时间；`thread/turns/list` 补时间 |
| `lib.rs:64-82` | `thread/start` 成功后把 (threadId, cwd) 记入 global state |
| `app_server.rs:416-485` | 入站消息三类分流：response → oneshot；server request → 存 pending + emit `app-server:server-request`；notification → emit `app-server:notification` |
| `app_server.rs:381-405` | `app_server_respond`：按 id 找到原始 wire id 回写 JSON-RPC response，emit `app-server:server-request-resolved` |

### 3.2 结果后处理细节

- `patch_model_list_result`（`app_server.rs:565-600`）：遍历 `model/list` 返回，`gpt-6-astra` 强制 `hidden=false`、`gpt-6.1-sol` 强制 `hidden=false`；若列表里没有 `gpt-6-astra` 则 `insert(0, create_astra_model())`。`create_astra_model`（602-636）是**硬编码的完整模型对象**（含 reasoning efforts / serviceTiers / multiAgentVersion）。注释称“ported from scripts/desktop-patches/model-catalog-compat.cjs”，属官方兼容补丁的移植；本机真实 model/list 已含 `gpt-6-astra`，当前 CLI 下不触发注入，但换旧版 CLI 会凭空出现一个模型。
- `enrich_turn_timing`（646-672）：用 `completedAt - durationMs/1000` 反推 `firstTurnWorkItemStartedAt(Ms)`。注意真实 `Turn.startedAt/completedAt` 单位是**秒**（schema 注释），而前端 `normalizeTurnsFromThread` 把它们当毫秒存（App.tsx:173-180），只影响内部字段，UI 仅用 durationMs。

### 3.3 Rust → 前端事件（7 个）

| 事件名 | 触发点 | 前端是否监听 |
|---|---|---|
| `app-server:status` | 连接中/成功/失败/退出（`app_server.rs:158, 192, 229, 280, 289`） | ✅ App.tsx:528 |
| `app-server:notification` | 所有 server notification（`app_server.rs:477-483`） | ✅ App.tsx:539 |
| `app-server:server-request` | 所有 server→client request（`app_server.rs:466`） | ✅ App.tsx:702 |
| `app-server:server-request-resolved` | 前端应答后（`app_server.rs:403`） | ❌ S1 无监听；06:54 后并行改动已监听 |
| `app-server:stderr` | app-server 进程 stderr 每行（`app_server.rs:239`） | ❌ 无监听（stderr 日志不可见） |
| `terminal:data` | PTY 输出（`terminal.rs:147-153`） | ✅ TerminalDock.tsx:57 |
| `terminal:exit` | PTY 进程退出（`terminal.rs:159-164`） | ✅ TerminalDock.tsx:66 |

### 3.4 前端事件监听完整清单（S1 为 5 个；并行改动新增对通知内容的监听仍在 `app-server:notification` 通道内，不新增 Tauri 事件）

| 事件 | 位置 | 用途 |
|---|---|---|
| `app-server:status` | App.tsx:528-537 | 更新连接状态、连上后刷新模型/线程 |
| `app-server:notification` | App.tsx:539-700 | 流式 turn/item 渲染（唯一数据通道） |
| `app-server:server-request` | App.tsx:702-720 | 审批/提问卡片 + 入箱 |
| `terminal:data` | TerminalDock.tsx:57-64 | 写入 xterm |
| `terminal:exit` | TerminalDock.tsx:66-73 | 打印进程退出 |

> 注意：`bridge.ts` 提供 `isTauriRuntime()` / `tauriInvoke` / `tauriListen` 封装；`DiffDrawer.tsx`、`TerminalDock.tsx` 直接 `import { invoke, listen } from "@tauri-apps/api/..."`，绕过封装，风格不统一但功能等价。

---

## 4. 前端实际使用的 JSON-RPC 方法（client → server）

### 4.1 已使用（15 个 request + 1 个 notification）

| method | 调用点 | 参数 | 与协议 schema 对照 |
|---|---|---|---|
| `initialize` | app_server.rs:258 | `{clientInfo, capabilities}` | ✅ 合法 |
| `initialized`（notification） | app_server.rs:262 | – | ✅ 合法 |
| `thread/list` | App.tsx:432 | `{limit:60}` | ✅ 合法；响应 `{data, nextCursor, readStates...}`，前端只取 `data`、不翻页 |
| `thread/read` | App.tsx:892 | `{threadId, includeTurns:true}` | ✅ 合法（协议标注 full history deprecated） |
| `thread/resume` | App.tsx:900 | `{threadId}` | ✅ 合法 |
| `thread/start` | App.tsx:1022 | `{cwd, model, approvalPolicy, sandbox}` | ✅ 合法；但 approvalPolicy 可能非法（见下） |
| `thread/name/set` | App.tsx:1411 | `{threadId, name}` | ✅ 合法 |
| `thread/archive` / `thread/unarchive` | lib.rs:260/265 | `{threadId}` | ✅ 合法 |
| `thread/delete` | lib.rs:281 | `{threadId}` | ✅ 合法 |
| `turn/start` | App.tsx:1040 | `{threadId, input, model, effort, temperature, topP, maxTokens, webSearch, allowNetwork, outputVerbosity, approvalPolicy, serviceTier}` | ⚠️ `input/threadId/model/effort/approvalPolicy/serviceTier` 合法；**temperature/topP/maxTokens/webSearch/allowNetwork/outputVerbosity 不在 TurnStartParams**（实测被忽略） |
| `turn/steer`（流式中发送） | App.tsx:974 | `{threadId, input}` | ❌ 缺 required `expectedTurnId`（实测报错） |
| `turn/steer`（“立即引导”） | App.tsx:1310 | `{threadId, text}` | ❌ 缺 `expectedTurnId` + `input`（实测报错） |
| `turn/interrupt` | App.tsx:1298 | `{threadId}` | ❌ 缺 required `turnId`（实测报错） |
| `model/list` | App.tsx:448 | `{}` | ✅ 合法 |
| `skills/list` | SkillsMcpView.tsx:206/225 | `{cwds:[ws], forceReload:true}` | ✅ 合法（用于刷新服务端技能缓存） |
| `mcpServerStatus/list` | SkillsMcpView.tsx:180 | `{}` | ✅ 合法 |

### 4.2 协议有、前端未用（重点缺口，按域）

| 域 | 未使用的方法 |
|---|---|
| 账号/额度 | `account/read`、`account/login/start\|cancel`、`account/logout`、`account/rateLimits/read`、`account/usage/read`、`account/workspaceMessages/read`、`account/bedrock/*`、`account/gatewayOAuth/*` |
| 线程 | `thread/fork`、`thread/revert`、`thread/compact/start`、`thread/unsubscribe`、`thread/turns/list`、`thread/items/list`、`thread/timeline/list`、`thread/attachment/add\|list\|remove`、`thread/inject_items`、`thread/shellCommand`、`thread/goal/set\|get\|clear`、`thread/search`、`thread/searchOccurrences`、`thread/section/move`、`threadSection/*`、`thread/metadata/update`、`thread/settings/update`、`thread/memoryMode/set`、`thread/queue/*`、`thread/loaded/list`、`thread/approveGuardianDeniedAction`、`thread/backgroundTerminals/*`、`thread/realtime/*` |
| Turn | `turn/settings/update` |
| 项目 | `project/create\|read\|update\|delete\|list\|move\|import` |
| 插件/市场 | `plugin/list\|read\|install\|installed\|uninstall\|search\|reconcile\|skill/read`、`plugin/share/*`、`marketplace/add\|remove\|upgrade` |
| MCP | `config/mcpServer/reload`、`mcpServer/tool/call`、`mcpServer/resource/read`、`mcpServer/oauth/login`、`mcpServer/event/stream/*` |
| 配置 | `config/read`（协议方法；本项目用自研 Rust 解析）、`config/value/write`、`config/batchWrite`、`configRequirements/read` |
| 技能 | `skills/config/write`、`skills/extraRoots/set` |
| 命令/进程 | `command/exec`、`command/exec/{write,resize,terminate}`、`process/spawn\|kill\|writeStdin\|resizePty` |
| 文件 | `fs/readFile\|readDirectory\|writeFile\|copy\|remove\|createDirectory\|getMetadata\|watch\|unwatch`（本项目全用自研 Rust fs，功能重叠但协议不同） |
| 搜索 | `fuzzyFileSearch`、`fuzzyFileSearch/session*` |
| 评审 | `review/start` |
| 其它 | `hooks/list`、`memory/status`、`memory/reset`、`externalAgentConfig/*`、`environment/*`、`collaborationMode/list`、`permissionProfile/list`、`experimentalFeature/*`、`app/list\|read\|installed`、`app/installed`、`server/diagnostics`、`feedback/upload`、`remoteControl/*`、`windowsSandbox/*`、`userVerification/*`、`rollout/compress`、`configRequirements/read`、`modelProvider/capabilities/read` |

### 4.3 错误处理行为

- 所有 `callAppServer` 失败大多被 `catch {}` / `catch(e){console.warn}` 吞掉（如 App.tsx:439, 454, 906, 1299, 1412），**用户无感知**；这是“点得动但没效果”的主要技术原因之一。
- `handleSendMessage` 是唯一把错误显示给用户的地方（1054-1072 追加“⚠️ 执行出错”turn）。

---

## 5. Server → Client 请求（11 个）处理矩阵

协议（非 experimental）11 个 server request：

| # | method | 本项目 UI/应答 | 结论 |
|---|---|---|---|
| 1 | `item/commandExecution/requestApproval` | 通用审批卡 + `{decision:"accept"/"acceptForSession"/"decline"}` | ✅ 正确 |
| 2 | `item/fileChange/requestApproval` | 同上 | ✅ 正确 |
| 3 | `item/tool/requestUserInput` | 问题卡 + `{answers:[...], selected}` | ❌ 协议要求 `{answers:{<questionId>:{answers:[string]}}}` |
| 4 | `item/permissions/requestApproval` | 通用审批卡 + `{decision}` | ❌ 协议要求 `{permissions:{...}, scope?}` |
| 5 | `item/tool/call`（dynamic tool） | 通用审批卡 | ❌ 协议要求 `{success, contentItems}` |
| 6 | `mcpServer/elicitation/request` | 通用审批卡 | ❌ 需要专属 elicitation response |
| 7 | `execCommandApproval`（legacy） | 通用审批卡 + `{decision:"accept"}` | ❌ 需要 `approved/approved_for_session/denied/abort/...` |
| 8 | `applyPatchApproval`（legacy） | 同上 | ❌ 同上 |
| 9 | `account/chatgptAuthTokens/refresh` | 无处理（卡片出现但按钮语义错误） | ❌ |
| 10 | `attestation/generate` | 无处理 | ❌（initialize 已声明 requestAttestation=false） |
| 11 | `currentTime/read` | 无处理 | ❌ |

**前端分发逻辑**：`App.tsx:2622-2752` 只看 `params.question(s)` 判断是否 UserInput，其余一律当“命令审批”渲染 → 上述 9 种请求都会给出错误结果或悬挂。

**待处理请求的维护**：
- Rust 存 `pending_server_requests: HashMap<String, PendingServerRequest>`（app_server.rs:40），并有 `list_pending_server_requests`（78-81）暴露给 `app_server_pending_requests`。**S1 快照**：前端从不调用 → 刷新/重连后挂起审批在 UI 里消失。**06:54 后并行改动**：`refreshPendingRequests()` 已在连接建立时拉取并恢复。
- `serverRequest/resolved` 通知：S1 未监听；06:54 后并行改动已处理，并同步移除对应 pending 卡片。
- **并行改动注**：新增 `src/protocol.ts`（response builder / classify）与 `src/components/ApprovalCenter.tsx`，command/fileChange/permissions/requestUserInput 四类应答已按协议实现。仍缺：legacy `execCommandApproval`/`applyPatchApproval` 的 `approved/denied` 词表、`item/tool/call`、`mcpServer/elicitation/request` 的专属应答。

---

## 6. Server → Client 通知（83 个）对照

前端 `app-server:notification` 处理分支（App.tsx:539-700）实际命中 **7 个真实 method + 1 个不存在的旧 method**：

| 已处理 | 说明 |
|---|---|
| `turn/started` | ✅ |
| `turn/completed` | ✅（但丢弃 turn.items） |
| `item/agentMessage/delta` | ✅ |
| `codex/event/agent_message_delta` | 旧版事件名，0.159 协议中无（无害 fallback） |
| `item/reasoning/summaryTextDelta` | ✅ |
| `item/reasoning/delta` | **协议中不存在**（真实为 `item/reasoning/textDelta`） |
| `item/commandExecution/outputDelta` | ✅ |
| `item/started` / `item/completed` | ✅（合并 item） |

> **06:54 后并行改动新增监听**（S1 未监听）：`serverRequest/resolved`、`thread/tokenUsage/updated`、`thread/name/updated`、`thread/archived/deleted/unarchived`、`warning/configWarning/deprecationNotice/guardianWarning`、`error`（后几类仅 console）。仍未消费的高价值通知：`turn/diff/updated`、`turn/plan/updated`、`item/plan/delta`、`item/reasoning/textDelta`、`item/fileChange/outputDelta`、`item/mcpToolCall/progress`、`thread/goal/updated`、`thread/status/changed`、`serverRequest/resolved`（S1）等。

### 6.1 未处理但影响可见功能的通知（优先补齐）

| 通知 | 缺失影响 |
|---|---|
| `thread/tokenUsage/updated` | 无 token/上下文用量（“用量”面板只能造假） |
| `turn/diff/updated` | Diff 面板不能实时反映本轮改动，只能手动 git_status |
| `turn/plan/updated` + `item/plan/delta` | 没有 Plan 模式渲染/进度 |
| `item/reasoning/textDelta` + `item/reasoning/summaryPartAdded` | 思考流不完整 |
| `item/commandExecution/terminalInteraction` | 无法展示/交互终端会话 |
| `item/fileChange/outputDelta` / `item/fileChange/patchUpdated` | 文件变更不能流式预览 |
| `item/mcpToolCall/progress` | MCP 工具调用无进度 |
| `thread/started`、`thread/name/updated`、`thread/archived`、`thread/deleted`、`thread/status/changed` | 侧边栏/标题不自动同步（靠轮询 refreshThreads） |
| `thread/goal/updated`、`thread/goal/cleared` | 官方 Goal 进度不可用（自研替代） |
| `thread/queue/changed` | 队列状态不同步 |
| `serverRequest/resolved` | 审批卡不能跨入口同步关闭 |
| `error` / `warning` / `configWarning` / `deprecationNotice` | 运行错误/配置告警对用户不可见（configWarning 实测确实会发） |
| `skills/changed`、`mcpServer/startupStatus/updated`、`mcpServer/oauthLogin/completed` | 技能/MCP 状态不刷新 |
| `account/updated`、`account/rateLimits/updated`、`account/login/completed` | 登录/额度不可见 |
| `hook/started\|completed`、`process/*`、`command/exec/outputDelta`、`fs/changed`、`project/changed`、`thread/section/*`、`remoteControl/*`、`windows*` 等 | 对应功能整体缺失 |

完整 83 个通知名清单见 `.ref/audit/schema/ServerNotification.json`（本报告 §6 已列出全部“已处理/重要未处理”）。

---

## 7. 持久化键对照（`~/.codex/.codex-global-state.json`）

Rust `state.rs:10-15` 使用的键 vs 官方真实文件（本机 49 个顶层键，642 KB）：

| 本项目使用键 | 官方真实文件是否存在 | 备注 |
|---|---|---|
| `electron-saved-workspace-roots` | ✅ 存在（数组） | 工作区根目录，兼容 |
| `electron-workspace-root-labels` | ❌ **不存在** | 项目显示名写入一个官方不读的键；真实项目名在 `local-projects[*].name` |
| `active-workspace-roots` | ✅ 存在 | 兼容 |
| `pinned-thread-ids` | ✅ 存在 | 兼容 |
| `archivedThreads` | ✅ 存在（本机 99 条） | 兼容 |
| `thread-workspace-root-hints` | ✅ 存在 | 兼容 |
| `desktopPreferences`（Settings 自造） | ❌ 不存在 | 官方 UI 偏好在 `electron-persisted-atom-state`（数百个键） |
| `colorTheme`（Settings 自造） | ❌ 不存在 | 官方主题键是顶层 `theme`（本机值 `"dark"`） |
| – | 官方 `local-projects` / `project-order` / `selected-project` / `thread-project-assignments` / `projectless-thread-ids` / `sidebar-project-thread-orders` / `pinned-project-ids` | 本项目完全未读写 → 项目实体与排序不同步 |
| – | 官方 `electron-persisted-atom-state`（含 `composer-prompt-drafts-v1`、`prompt-history`、`sidebar-width`、`codex-sidebar-sort-mode-v1`、`thread-client-id-v1:*`、`thread-browser-tabs-v1:*`、`thread-tab-routes-v1:*`、`queued-follow-ups` 等） | 本项目未读写 → 草稿/历史/侧栏宽度/排序/浏览器 tab/队列状态不持久化 |

> 结论：核心 6 个键与官方兼容，但**设置/主题/项目/草稿/队列**的自造键与官方不互通。若目标是“复刻官方功能”，这些应迁移到 `electron-persisted-atom-state` 对应键。

---

## 8. Rust 数据结构 vs 真实 codex 数据格式差异

| 数据结构 | 本项目 | 真实官方格式 | 影响 |
|---|---|---|---|
| `AutomationItem` 写盘字段 | id/kind/name/prompt/status/rrule/execution_environment/cwds/model/reasoning_effort/target_thread_id/updated_at | 真实 `automation.toml` 另有 `version = 1`、`target = { type = "project", project_id = "..." }`、`created_at`/`updated_at` 为真实 epoch ms（非 mtime） | 官方桌面端可能读不到/部分字段丢失；我们的 `created_at` 用 mtime 冒充 |
| automation `status` | 直接写 "ACTIVE"/"PAUSED"/"COMPLETED" | 真实可为 `PAUSED`/`ACTIVE` | 兼容 |
| `SkillInfoItem` | 目录名作 id，解析首个 `# 标题`/`description:` | 兼容 SKILL.md 约定 | OK |
| `CodexConfigOverview` 字段 | 多出 10 个 codex 不识别键（temperature/top_p/max_output_tokens/context_window/web_search_mode/allow_network/max_parallel_tools/subagent_concurrency/output_verbosity + 前端 session 参数） | codex config.toml 只认 `model/model_provider/model_reasoning_effort/approval_policy/sandbox_mode/model_catalog_json/instructions` 等（实测 strict-config） | 写盘污染 + UI 假效果 |
| worktree 目录 | `~/.codex/worktrees/<4hex>/<repo>[-n]` + `git config codex.ownerThreadId` | 官方 `pendingWorktrees.ts` 同构（注释注明 ported） | ✅ 兼容 |
| 执行 `exec_shell_command` | `powershell -NoProfile -NonInteractive -Command` | 官方走沙盒/审批后的 exec 或 app-server `command/exec` | 绕过沙盒、无审批、无输出流式 |

---

## 9. 实测证据附录（协议探针）

用于本次审计的 stdio 探针（可复现；未修改任何源码）：

### 9.1 请求/错误

```
→ {"id":1,"method":"initialize","params":{"clientInfo":{"name":"audit",...},"capabilities":{"experimentalApi":true},...}}
← {"id":1,"result":{"userAgent":"audit/0.163.0-alpha.10.2 (...)","codexHome":"C:\\Users\\lus\\.codex",...}}

→ {"id":2,"method":"turn/interrupt","params":{"threadId":"bogus"}}
← {"error":{"code":-32600,"message":"Invalid request: missing field `turnId`"},"id":2}

→ {"id":3,"method":"turn/steer","params":{"threadId":"bogus","input":[{"type":"text","text":"hi"}]}}
← {"error":{"code":-32600,"message":"Invalid request: missing field `expectedTurnId`"},"id":3}

→ {"id":4,"method":"turn/steer","params":{"threadId":"bogus","text":"hi"}}
← {"error":{"code":-32600,"message":"Invalid request: missing field `input`"},"id":4}

→ {"id":2,"method":"thread/start","params":{"cwd":"C:\\definitely-not-exists-xyz","approvalPolicy":"on-failure"}}
← {"error":{"code":-32600,"message":"Invalid request: unknown variant `on-failure`, expected one of `untrusted`, `on-request`, `granular`, `never`"},"id":2}

→ {"id":13,"method":"turn/start","params":{"threadId":"0000...","input":[...],"temperature":0.2,"topP":1,"maxTokens":8192,"webSearch":"cached","allowNetwork":true,"outputVerbosity":"medium","model":"gpt-5.4","effort":"low"}}
← {"error":{"code":-32600,"message":"thread not found: 00000000-..."},"id":13}
    （即 params 反序列化通过 → 未知字段被忽略，超参数无效）

→ {"id":5,"method":"turn/start","params":{... ,"serviceTier":"priority"}}
← {"error":{"code":-32600,"message":"thread not found: 0000..."},"id":5}   （serviceTier 合法）
```

### 9.2 成功响应结构

```
thread/list    → {"data":[Thread...],"readStates":...,"nextCursor":...,"backwardsCursor":...}
thread/start   → {"thread":{...},"model":...,"modelProvider":...,"cwd":...,"approvalPolicy":...,"sandbox":...}
turn/start     → {"turn":{...}}
skills/list    → {"data":[1 个 cwd 聚合项]}
mcpServerStatus/list → {"data":[6 个 server],"nextCursor":null}
model/list     → {"data":[7 个模型]}（gpt-6.1-sol / gpt-6-astra / ... / gpt-5.6-luna）
```

### 9.3 config 键识别（`codex app-server --strict-config` + 临时 CODEX_HOME）

| 键 | 结果 |
|---|---|
| model / model_provider / model_reasoning_effort / approval_policy / sandbox_mode / model_catalog_json / instructions | ✅ accepted |
| temperature / top_p / max_output_tokens / context_window / web_search_mode / allow_network / max_parallel_tools / subagent_concurrency / output_verbosity | ❌ `unknown configuration field`（逐项实测） |

---

## 10. 结论：后端“面”完成度

| 层 | 完成度 | 说明 |
|---|---|---|
| Tauri command 层（64 个） | **~92%** | 除 5 个未使用 command 外全部真实实现；Git/PTY/FS/config 质量较高 |
| app-server 桥 | **~100%（通用管道）** | Rust 侧无缺口；瓶颈在前端只用 15 个方法 |
| 事件通道 | 管道 100% / 前端消费 ~10% | 7 个 Rust 事件、83 个通知、11 个 server request 已具备转发能力 |
| 持久化 | **~70%** | 工作区/置顶/归档/配置/技能/自动化真实落盘；设置/主题/项目/草稿/队列与官方不兼容或不持久 |
| 协议语义正确性 | **~55%** | 15 个方法里 4 个参数错误（interrupt/steer×2/approvalPolicy），6 类 server request 应答错误，通知消费仅 7/83 |
| 缺失的系统能力 | 无通知/自动更新/托盘/登录 | capabilities 未授权任何插件 |





