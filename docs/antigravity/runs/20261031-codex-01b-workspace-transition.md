# 01B A11：会话工作区迁移执行链

状态：本轮执行依赖已自验，01B 仍开发中。本文先记录实现前合同和验收预期，执行结果见文末。此增量不代表已实现项目移动菜单或已验收 01B。

## 官方依据与范围

固定候选包仍为 26.928.21956。`app-shared.js` SHA-256 为 `89601A70E2C369695B147F7EB24A8AE054CA01AB62425E7B1ED5D8BF22844D17`，`app-initial-fd3c4b862660.js` 为 `577A50E29502F573E2FBCCF4940B9BD875339DB420D6D5A9798A0D201EE0AFF1`。位置均为 0-based UTF-16 字符偏移。

- shared `xP` 2007609：`thread-workspace-state-v1:<threadId>`，存于桌面 global-state 的 `electron-persisted-atom-state`。
- shared `Ean` 2930470、`Dan` 2930639、schema 2931692：状态含 `revision, project, applied, pending`；快照含 `projectSources,cwd,runtimeWorkspaceRoots`。projectless 保留 applied、清 pending，不任意创建目录。
- shared `Ian` 2931982、`Uan` 2933043：本地 pending 优先，非 local environment 不消费本地 pending。
- shared `Ran` 2932430：workspaceWrite 从 writableRoots 去除旧 applied 的 runtime roots 和 project sources，再加入目标 runtime roots，保留其他授予目录。保持 sandbox 类型和网络等其他选项。
- shared `f.accepted` 2955212、commit 调用 2956485：服务接受 turn/start 后提交工作区，不等 turn/completed。提交失败仅警告，不把已接受 turn 变为发送失败。
- shared `Oan` 2930751：提交此次接受的快照；revision 相同才清 pending，否则保留新 pending。`te` 2950458 另保护 turn 请求 ownership，阻止晚到旧请求覆盖较新上下文。

假设与限制：本轮只消费已存在、明确 local 来源的 pending；不创建迁移目标，不扩大项目 sources，不接入移动菜单。普通无 pending 请求保持原路径；applied 回退、项目成员关系事务、worktree 目标构造、持久化跨进程同步与完整迁移仍需后续集成。不能据此宣称移动已完成。

## 修改前验收预期

1. WT01：本地 pending 将真实 turn/start 的 cwd/runtimeWorkspaceRoots 改为目标；不把 projectSources 当成 runtime roots。worktree 快照原样使用。
2. WT02：workspaceWrite 替换旧 workspace roots，保留额外授权和网络/临时目录选项；readOnly、dangerFullAccess 不被转成 workspaceWrite。
3. WT03：服务拒绝、超时或未知结果不修改 applied/pending/retained roots，不自动重发。
4. WT04：服务返回有效 turn ID 后提交；相同 revision 清 pending，较新 revision 的 pending 和 membership 字段保留。
5. WT05：晚到旧请求不能覆盖新 accepted 状态；其他会话独立。
6. WT06：非 local environment、remote 项目来源不消费 local pending。local environment 在首环境中写 cwd/roots，顶层置 null，避免两套上下文。
7. WT07：无状态、无 pending、projectless 保留原请求与持久状态；空/相对/跨平台目录等无效 local pending 明确报错，不能回退至任意 active workspace 继续执行。
8. WT08：持久化失败不发布内存新状态；接受后同步失败保留可重试 pending、返回已接受 turn 并向 UI 提示，不诱导重发。
9. WT09：独立重载持久状态能读取尚未应用与已接受的快照；测试只使用临时目录，不改真实 Codex Home。
10. WT10：省略 environments 必须解析会话 sticky selection；非 local 透传，null/缺失/读取失败不发 turn。读取期间被新请求替代的旧请求，不得继续派发。

先建立 Rust 回归确认缺陷，再实现最小桥层；运行模块单测、完整 Rust 单测、标准检查和 Release 构建。此轮没有界面几何修改，原生启动只证明构建可运行；未进行付费模型 turn，不能把替身调用测试称作真实模型集成。官方同条件截图仍缺，视觉分数保持 null。

## 实施与验证结果

- `src-tauri/src/thread_workspace.rs` 定义 pending 快照解析、目标目录/路径族校验、workspaceWrite roots 替换和 revision 提交。保持 worktree 快照中的 cwd/runtime roots，不用项目目录覆盖它。保留 profile、非 write sandbox 类型和其他 sandbox 选项。
- `src-tauri/src/state.rs` 在共享 turn 网关内捕获会话快照及 owner；接受前不落盘，接受后将 retained roots 和 transition 一起写入同目录临时文件、替换成功才发布内存。失败返回已接受的 turn 加独立警告，不诱导重新发送。请求拒绝/结果未知时保留 pending。
- `src-tauri/src/lib.rs` 的真实 `app_server_call` 对 turn/start 使用该网关，覆盖经此入口的普通/后台调用；不改 turn/steer。`src/App.tsx` 复用 toast 展示保存警告，并在卸载时释放订阅。没有新增依赖、目标创建逻辑或移动菜单。
- 独立复审发现省略 environments 会继承 sticky selection，已改为先读取 `thread/read` 的有效环境：远程环境不注入本地快照；未知/未加载环境不派发。隔离 CLI 0.165.0 的真实 `thread/start`→`thread/read` 观察确认省略、本地列表、空列表三种返回，零模型 turn，见 `actual/environment-readback.json`。此探针创建的是隔离离线会话，不是模型执行证据。
- 另用异步回归复现“旧请求等待 read→新请求接受→旧请求仍派发”缺陷，修改前明确失败，增加发送前 owner 校验后通过。先前已派发旧请求的晚回包也不会覆盖新 accepted workspace。独立复审最终通过。
- 本轮新增 16 个 Rust 用例。`cargo test --manifest-path src-tauri/Cargo.toml --lib` **57/57**，完整标准检查退出 **0**（含新接入的 workspace/identity **25/25** 筛选与原 automations **17/17**），Tauri Release 构建退出 **0**。完整标准检查不是全量 Rust 测试的替代；本轮另跑了全量 lib。日志保存于本轮 `.ref/.../actual/`。
- 现有 SettingsView 动静态导入、大 chunk、Node DEP0190 警告仍存在；没有独立 lint 配置。`git diff --check` 无空白错误。

构建：[`CodexNative.exe`](../../../dist-artifacts/01B-workspace-transition-20261031/CodexNative.exe)，13,422,592 bytes，SHA-256 `04CDB49E8772F6D2CC22C74A2C11A335350C79DDF0232DBEF6B20F5EF8FD1ECE`。源码基于 HEAD `380c32c7b6e3d1ce6cabcf49c7b5ca07b1b76ec7` 的工作树构建，包含既有未提交改动；实际 HEAD 和产品输入指纹以 `source-fingerprints-final.json` 为准。未提交、未推送。

## 当前哈希的原生验证

使用 Computer Use 绑定上述 EXE，PID 209416、窗口 3870794。隔离 home 位于本轮 `.ref/.../native-home`，无 auth.json、无 API key；只复制既有离线会话回放及其 SQLite 备份，额外设置故意无效的 local pending。旧测试实例已退出，避免重叠窗口造成截图错配。

原生操作：打开离线会话→通过 UIA ValuePattern 填写测试文字→点击发送。实际读取因会话尚未加载而无法确认有效 environment，应用显示“无法确认会话当前的执行环境，待迁移工作区已保留，本次没有发送。”；编辑框保留原文，发送按钮恢复可用。退出应用后读取本地状态，pending/revision 保留，rollout 中没有测试文字或 turn/task started 事件。此处验证的是**环境未知时的原生阻断路径**，未执行到无效目录校验，也不是成功迁移的原生证明。

证据：`native-trees-final.json`、`native-persistent-readback-final.json`、`native-launch-final.json` 和 `native-environment-guard.jpg`。截图为 1442×914 的 JPEG，主题深色、语言中文；App 缩放和官方配对条件仍未知，不作像素差异比较。没有测试保存失败 toast 的原生故障注入、真实模型接受后的迁移、物理 IME 或跨进程同步。

## 仍需完成

1. 读取/恢复当前会话有效执行上下文，完整 applied 回退与后续 turn/重启集成，避免无 pending 路径仍依赖前端 active workspace。未知环境的当前策略是明确阻断，不是自动清除用户环境或强行 resume。
2. 项目目标构造、目录 sources 扩展确认、真实 membership 与 workspace transaction/rollback、侧栏顺序保存、适用的 worktree/host/来源条件，再接移动菜单。
3. 真实模型/服务集成、当前最终哈希原生成功/故障路径、官方运行时和同条件像素、IME 及用户验收。

01B 未用户验收；不放行 01C。视觉分数 null，不将本轮必要依赖的自动检查通过等同于页面或整个移动功能完成。
