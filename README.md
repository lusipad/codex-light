# Codex Native (Tauri v2 + React 19 + Rust)

基于 [`codex-app-offline`](../README.md) 协议与能力契约重写的全功能、轻量化原生 **Codex 桌面客户端**。

## 核心特性

1. **原生 Rust `codex app-server` 引擎桥接 (`src-tauri/src/app_server.rs`)**
   - 自动发现本机或离线包内的 `codex` CLI 并以无窗口模式拉起 `codex app-server --listen stdio://`
   - 完整实现 JSON-RPC 2.0 双向通信：`initialize` 握手、流式消息 (`item/agentMessage/delta`)、流式推理 (`item/reasoning/*`)、流式命令输出 (`item/commandExecution/outputDelta`)
   - 支持服务端反向审批请求 (`item/commandExecution/requestApproval`、`item/fileChange/requestApproval` 等)，提供一键**批准本次 / 会话内始终允许 / 拒绝**
   - 内置 `GPT-6-Astra` 与 `gpt-6.1-sol` 模型列表可见性补齐，以及 `mcp_servers.codex_app` 残缺配置自动清洗
2. **多项目工作区与桌面状态互通 (`src-tauri/src/state.rs`)**
   - 直接读写 `~/.codex/.codex-global-state.json`，与官方 Codex Desktop 及 Web Gateway 共享工作区列表、会话置顶 (`pinned-thread-ids`)、归档会话 (`archivedThreads`) 与会话目录映射
   - 自动检测并提示项目根目录下的 `AGENTS.md` / `CLAUDE.md`
   - 内置工作区文件树浏览、源码预览与在线编辑保存、二进制图片 Base64 预览
3. **Git 状态、Unified/Split Diff 审阅器与隔离 Worktree 管理 (`src-tauri/src/git.rs`)**
   - 实时展示当前分支、变更统计 (`+additions / -deletions`)、工作区/暂存区/对比主分支三种 Diff 视图，支持 **Unified** 与 **Split (左右分栏)** 模式切换
   - 支持单文件或全量 Stage / Unstage / Discard (丢弃改动)、直接输入 Commit Message 提交、创建与切换分支
   - 完整移植官方 `pendingWorktrees` 隔离工作区创建逻辑：支持从指定分支或**带未提交改动+未跟踪文件的当前工作区**一键在 `~/.codex/worktrees` 下创建独立 Worktree 并绑定会话
4. **多标签交互式 PTY 终端 (`src-tauri/src/terminal.rs`)**
   - 基于 Rust `portable-pty` + 前端 `@xterm/xterm`，支持多标签页 PowerShell / Shell 终端、窗口自适应缩放，以及从 AI 回复的代码块一键点击**「运行」**发送到终端执行
5. **无损 `config.toml` 工作台、Skills 技能库与 Automations 自动化 (`src-tauri/src/config_skills.rs`)**
   - 基于 `toml_edit` 无损读写 `~/.codex/config.toml`，严格保证 `model_catalog_json` 位于任何 `[table]` 之前的根级键位置
   - 支持可视化管理自定义 Provider (`[model_providers.*]`)、一键生成 `~/.codex/models-api.json`、配置外部 MCP 服务器 (`[mcp_servers.*]`) 以及 TOML 源码直编校验
   - 支持浏览、编辑、新建与一键安装 `~/.codex/skills` 技能 (`SKILL.md`)
   - 支持读取、新建、启停与立即触发 `~/.codex/automations/*/automation.toml` 定时任务

## 开发与构建命令

```powershell
# 1. 安装前端依赖
npm install

# 2. 启动 Tauri 开发模式 (自动启动 Vite + 编译并打开 Rust 桌面窗口)
npm run tauri dev

# 3. 构建生产级独立安装包 / 单文件 EXE
npm run tauri build
```
