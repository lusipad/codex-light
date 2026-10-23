# Codex Native (Tauri v2 + React 19 + Rust)

[![CI Build & Release](https://github.com/lusipad/codex-desktop-native/actions/workflows/ci.yml/badge.svg)](https://github.com/lusipad/codex-desktop-native/actions/workflows/ci.yml)

基于 [`codex-app-offline`](../README.md) 协议与能力契约重写的全功能、轻量化原生 **Codex 桌面客户端**。
对标本机官方 **Codex App（Electron）** 的 Codex 模式基线能力（不含 ChatGPT 云端专属：Artifacts/云浏览器/实时语音/计费团队等）。

> **最终交付报告：[docs/FINAL-REPORT.md](docs/FINAL-REPORT.md)**。对标差距分析、官方功能面清单与逐轮实施记录：
> [`docs/CODEX-APP-PARITY-GAP.md`](docs/CODEX-APP-PARITY-GAP.md) ｜
> [`docs/IMPLEMENTATION-LOG.md`](docs/IMPLEMENTATION-LOG.md) ｜
> [`docs/research/parity-summary-v2.md`](docs/research/parity-summary-v2.md) ｜
> [`docs/research/current-audit-v2.md`](docs/research/current-audit-v2.md)

## 核心特性（截至 Round 7）

1. **原生 Rust `codex app-server` 桥接 (`src-tauri/src/app_server.rs`)**
   - 自动发现本机/离线包内 `codex` CLI 并拉起 `codex app-server --listen stdio://`（无窗口）
   - JSON-RPC 2.0 双向通信；通用桥接层可透传任意 app-server 方法（前端已引用 **71 个 client 方法、35 个通知、7/10 类 server request**）
   - 审批中心：命令 / 文件变更 / 权限 / 提问 / MCP elicitation / legacy `execCommandApproval`+`applyPatchApproval`，按官方 wire shape 应答（含 execpolicy 记忆、网络策略、权限 scope）
2. **会话与流式渲染**
   - 发送 / 中断 / Steer / 服务端消息队列（`thread/queue/*`，Up next 栏）
   - 流式 agent 消息、reasoning（summary+原始）、plan、command 输出、fileChange patch、MCP 工具进度、turn diff / plan / token 用量
   - 长会话 `thread/turns/list` 分页 +「加载更早的轮次」；turn 完成合并权威 items
   - fork（含从指定轮次）/ revert / compact / 重命名 / 置顶 / 归档 / 删除 / 派生
3. **Diff 审阅与 Git (`src-tauri/src/git.rs` + `DiffDrawer`)**
   - Unified / Split diff、Staged/Unstaged/分支对比、Stage/Unstage/Discard、Commit、分支创建切换、Push、PR
   - Worktree 列表/创建/删除（`~/.codex/worktrees`），项目文件树 + 内联编辑 + 行内评论
4. **文件系统与工作区 (`src/fsClient.ts`)**
   - `fs/*` 协议读写（base64）+ `fs/watch` 实时刷新（防抖、重连续订）
   - 资源管理器：新建文件/文件夹、重命名、删除、复制路径；图片/二进制预览
   - 模糊文件搜索（`fuzzyFileSearch`）接入 Ctrl+K/Ctrl+P 命令面板
5. **设置中心（22 分区，协议驱动）**
   - `config/read|value/write|batchWrite`（`reloadUserConfig`）+ `configRequirements`、MCP 热重载
   - 实验特性 152 项开关、账号与额度（只读）、Hooks（真实 hooks 列表 + 实时运行记录）
   - 模型/推理档/approval policy/sandbox/web search/verbosity 等真实可写；删除 codex 不认识的伪造参数
   - 原生菜单 + 托盘 + 15 组快捷键（快捷键分区展示真实注册表）
6. **Codex 生态能力**
   - **Goal**：`thread/goal/*` 服务端驱动自主推进（替代自研 loop）
   - **自定义分区**：`threadSection/*` 侧栏分组 + 会话移动
   - **项目实体**：`project/*` 创建/编辑/排序/删除
   - **插件/市场/Apps/Skills/MCP**：`plugin/*`、`marketplace/*`、`app/list|installed`、`skills/list|config/write`
   - **Code Review**：`review/start` 四种目标（未提交/分支/提交/自定义）
   - **Windows 沙箱**：`windowsSandbox/readiness|setupStart`
7. **自动化调度执行器 (`src-tauri/src/automations.rs`)**
   - 应用运行期间每 30s 扫描 `~/.codex/automations`，自研 RRULE 解析（HOURLY/DAILY/WEEKLY/MONTHLY/YEARLY + INTERVAL/BYHOUR/BYMINUTE/BYDAY/BYMONTHDAY/WKST）+ chrono 本地墙钟计算
   - `.run-jitter-salt` 稳定抖动、`~/.codex/.codex-native/scheduler-state.json` 原子状态、事件 `automation:run-started|finished`
   - Automations 页：调度状态条、下次/上次运行、运行历史、立即运行；17 个单元测试
8. **多标签 PTY 终端 (`src-tauri/src/terminal.rs`)**
   - portable-pty + xterm.js，多标签 PowerShell/Shell，代码块「运行」直达终端
9. **收件箱 / 归档 / 通知**
   - Inbox 持久化（turn 完成、自动化完成、审批请求入箱）
   - 已归档会话页（`thread/list{archived}` + 恢复/删除）
   - 应用内 Toast + 提示音；自动审批审查状态横幅

## 验证

一键全量验证（类型检查 / 前端构建 / Rust 编译 / 单测 / 真实 app-server 协议探测）：

```powershell
pwsh -NoProfile -File ./scripts/verify-all.ps1          # 完整验证
pwsh -NoProfile -File ./scripts/verify-all.ps1 -Fast    # 跳过协议探测
```

- `npx tsc --noEmit` ✅
- `npm run build` ✅
- `cargo check --manifest-path src-tauri/Cargo.toml` ✅（0 error / 0 warning）
- `cargo test --manifest-path src-tauri/Cargo.toml automations` ✅（17 passed）
- `scripts/protocol-verify/*.mjs`：对真实 `codex app-server` 的请求/响应形状校验（隔离 `CODEX_HOME`，不触碰 `~/.codex`）——9/9、22/22、28/28、16/16 全部通过

## 开发与构建命令

```powershell
# 1. 安装前端依赖
npm install

# 2. 启动 Tauri 开发模式 (自动启动 Vite + 编译并打开 Rust 桌面窗口)
npm run tauri dev

# 3. 构建生产级独立安装包 / 单文件 EXE
npm run tauri build
```

## 已知限制

- 自动化调度器仅在应用运行时工作（无 OS 服务）；`run-finished` 表示成功发起 turn。
- 官方 `thread/start` 无 `projectId` 参数 → 新建会话暂无法挂到项目实体。
- 部分设置分区（Computer use / Appshots / Browser / Voice / Pets）依赖官方插件/服务，当前为本地偏好 UI。
- 实时语音、账号登录/登出、多窗口、系统级通知与自动更新、`command/exec`/`process/*` 尚未接入（详见差距报告）。
