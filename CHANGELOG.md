# Changelog

All notable changes to **Codex Native** (Tauri v2 + React 19 + Rust) are documented here.

## v0.1.0 — 2026-10-23

首个对标官方 **Codex App（Electron）Codex 模式核心能力**的发布版本。

### Highlights

- **app-server 协议覆盖**：前端引用 71 个 app-server client 方法（+Rust 桥 3 = 74 / 稳定目录 104 ≈ 68%）、消费 35 个 server 通知、处理 7/10 类 server request；一键验证脚本提供 4 组真实协议探测（隔离 `CODEX_HOME`，9/9 + 22/22 + 28/28 + 16/16 全通过）。
- **对话核心链路**：发送 / 流式 agent 消息 / reasoning（summary + 原始）/ 中断 / Steer / 服务端消息队列；turn 完成合并权威 items；长会话 `thread/turns/list` 分页。
- **审批中心**：命令 / 文件变更 / 权限 / 提问 / MCP elicitation / legacy 两类审批，按官方 wire shape 应答（execpolicy 记忆、网络策略、权限 scope、严格审查）。
- **流式面板**：本轮统一 diff（`turn/diff/updated`）、执行计划（`turn/plan/updated` + `item/plan/delta`）、上下文用量环（`thread/tokenUsage/updated`）、文件变更 patch、MCP 工具/联网搜索/图片 item 渲染。
- **线程生命周期**：fork（含从指定轮次派生）/ revert / compact / 重命名 / 置顶 / 归档 / 删除 / 已归档会话页（恢复 + 搜索）/ 分页加载。
- **Goal 与队列**：`thread/goal/*` 服务端驱动自主推进；`thread/queue/*` 服务端消息队列 + Up next UI。
- **Codex 生态**：自定义分区（`threadSection/*`）、项目实体（`project/*`）、插件/市场/Apps/Skills（`plugin/*`、`marketplace/*`、`app/*`、`skills/*`）、MCP 状态与热重载、Code Review（`review/start` 四种目标）、Windows 沙箱就绪检测与安装、Hooks（真实列表 + 实时运行记录）。
- **设置中心**：`config/*` 协议化读写（batchWrite + reloadUserConfig）、实验特性 152 项、账号与额度（只读）、通知与免打扰（系统原生通知 + 提示音 + 审批提醒）、模型/推理/权限/沙箱/规划模式真实生效；删除 codex 不认识的伪造配置键。
- **文件系统**：`fs/*` 协议读写 + `fs/watch` 实时刷新；资源管理器新建文件/文件夹、重命名、删除、复制路径；模糊文件搜索接入命令面板。
- **桌面体验**：原生菜单（File/Edit/View/Window/Help + accelerator）+ 系统托盘 + 15 组快捷键注册表（菜单去重）；自动化调度执行器（RRULE 解析 + chrono 墙钟 + jitter + 状态/事件 + 17 单测）；收件箱持久化。
- **保留强项**：Git 全链路（status/diff/stage/commit/push/PR/worktree）、Unified/Split diff 审阅器、多标签 PTY 终端、AGENTS.md 检测、与官方 `~/.codex/.codex-global-state.json` 互通。

### Verification

```powershell
pwsh -NoProfile -File ./scripts/verify-all.ps1
```

`tsc --noEmit` ✅ · `npm run build` ✅ · `cargo check` ✅（0 error / 0 warning）· `cargo test automations` ✅ 17 passed · 协议探测 9+22+28+16 全通过。

### Known limitations / out of scope

- 范围声明：不含 ChatGPT 云端专属（云浏览器/Artifacts/实时语音/团队计费/云环境等）、账号登录流程、computer-use/Appshots/Browser 真实执行（设置项标注为本地偏好）。
- 自动化调度仅在应用运行时执行；`run-finished` 表示成功发起 turn。
- 服务端 `thread/start` 无 `projectId`，项目内新会话暂不能挂到项目实体（按目录 + 会话列表过滤实现）。
- `thread/items/list` 在当前 CLI（0.159）返回 not supported，已降级为 turns 级分页。
- 附件持久化、Markdown 富渲染、多窗口、自动更新、可编辑 keymap、`command/exec`/`process/*` 尚未接入。

### Docs

- 差距分析：[`docs/CODEX-APP-PARITY-GAP.md`](docs/CODEX-APP-PARITY-GAP.md)
- 最终交付报告：[`docs/FINAL-REPORT.md`](docs/FINAL-REPORT.md)
- 一页纸对标：[`docs/research/parity-summary-v2.md`](docs/research/parity-summary-v2.md)
- 实施日志：[`docs/IMPLEMENTATION-LOG.md`](docs/IMPLEMENTATION-LOG.md)
