# 最终交付报告：对标官方 Codex App 的核心功能实现

> 完成时间：2026-10-23 ｜ 最终提交：`2fe35c3`（本报告随收尾提交更新）
> 对标对象：本机官方 **Codex App 26.928.x（Electron）** 的 Codex 模式基线能力
> 范围约定：不含 ChatGPT 云端专属能力（云浏览器/Artifacts/实时语音/计费团队/云环境等，详见 §5）

---

## 1. 结论

**目标已达成**：官方 Codex 桌面端的核心能力链路已全部接入真实协议与本地能力，并通过可复现的构建 / 编译 / 单测 / 真实 app-server 协议探测验证。

| 指标 | Round 初始 | 最终 | 变化 |
|---|---|---|---|
| 前端引用的 app-server client 方法 | 17 | **71**（+Rust 桥 3 = 74 / 稳定目录 104 = 68%） | ×4.3 |
| 消费的 server 通知 | 8 | **35** | ×4.4 |
| 处理的 server request 类 | 1（且应答错误） | **7 / 10** | ×7 |
| 功能点级真实度 | REAL 33% / MOCK 26% | **REAL 58.3% / MOCK 8.7%** | +25pt |
| 模块级真实度 | REAL 8 / 36 | **REAL 16 / 36**，PARTIAL 14、MOCK 4、MISSING 2 | ×2 |
| 官方 45 设置分区覆盖 | 真实 ~0-2 | **真实 10（22%）、真实+部分 21（47%）** | — |

> 详细取证：`docs/research/parity-summary-v2.md`、`docs/research/current-audit-v2.md`、`docs/CODEX-APP-PARITY-GAP.md`、`docs/IMPLEMENTATION-LOG.md`

---

## 2. 已完成的核心能力（全部真实接线）

### 2.1 对话与会话链路（P0）
- 发送 / 流式 agent 消息 / reasoning（summary + 原始）/ 中断 / Steer（`expectedTurnId`+`input` 形态正确）
- 服务端消息队列（`thread/queue/*`）+ Up next UI
- 审批中心：命令 / 文件变更 / 权限 / 提问 / MCP elicitation / legacy 两类审批，**7/10 类 server request 按官方 wire shape 应答**（含 execpolicy 记忆、网络策略、权限 scope/严格审查）
- 流式面板：`turn/diff/updated`（本轮 diff）、`turn/plan/updated` + `item/plan/delta`（执行计划）、`thread/tokenUsage/updated`（真实用量环）、`item/fileChange/patchUpdated`、`item/reasoning/textDelta`
- turn 完成合并服务端权威 items；长会话 `thread/turns/list` 分页 +「加载更早的轮次」
- 线程生命周期：fork（含从轮次派生）/ revert / compact / 重命名 / 置顶 / 归档 / 删除 / 归档页恢复
- 目标（Goal）：`thread/goal/*` 服务端驱动自主推进（替代早期自研 loop）
- 代码审查：`review/start` 四种目标（未提交 / 分支 / 提交 / 自定义）

### 2.2 模型 / 权限 / 配置
- 模型、推理档（`xhigh/max/ultra`）、speed tier、approval policy（合法枚举）、approvals reviewer、sandbox policy、plan 模式（`thread/settings/update.collaborationMode`）全部走协议且真实生效
- 设置页协议化：`config/read|value/write|batchWrite`（`reloadUserConfig`）+ `configRequirements`、MCP 热重载；删除 codex 不认识的 10 个伪造配置键
- 新增：实验特性（152 项）、账号与额度（只读）、通知与免打扰、Hooks（真实列表 + 实时运行记录）
- 8 个仅本地偏好的分区已明确标注「尚未接入执行器」

### 2.3 工作区 / 文件系统
- `fs/readDirectory|readFile|writeFile(base64)|createDirectory|remove|copy|getMetadata` 协议化（保留 Tauri 回退）
- `fs/watch` + `fs/changed` 实时刷新（防抖、重连续订）；资源管理器新建文件/文件夹、重命名、删除、复制路径
- `fuzzyFileSearch` + `thread/search` 接入 Ctrl+K/Ctrl+P 命令面板；32 条斜杠命令注册表

### 2.4 官方生态面
- 自定义分区（`threadSection/*` + 侧栏移动）、项目实体（`project/*` CRUD/排序）、插件/市场/Apps/Skills（`plugin/*`、`marketplace/*`、`app/*`、`skills/*`，17MB 目录只按 local 拉取）、MCP 状态/重载
- Windows 沙箱就绪检测 + 一键安装（`windowsSandbox/*`）
- 原生菜单（File/Edit/View/Window/Help + accelerator）+ 系统托盘 + 15 组快捷键（250ms 去重）
- 自动化调度执行器（Rust）：RRULE 解析 + chrono 墙钟 + jitter + 原子状态 + 运行历史/立即运行
- 已归档会话页、收件箱持久化、系统原生通知（回复完成/审批/自动化完成）

### 2.5 保留的原有强项
Git 全链路（status/diff/stage/commit/push/PR/worktree）、Unified/Split diff 审阅器、多标签 PTY 终端、AGENTS.md 检测、桌面状态与官方 `~/.codex/.codex-global-state.json` 互通。

---

## 3. 验证证据（可复现）

```powershell
cd D:\Repos\codex-desktop-native
pwsh -NoProfile -File ./scripts/verify-all.ps1        # 全量
pwsh -NoProfile -File ./scripts/verify-all.ps1 -Fast  # 跳过协议探测
```

最终一次运行结果（全部 PASS）：

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ exit 0 |
| `npm run build`（vite production） | ✅ 成功（1.6k+ modules） |
| `cargo check --manifest-path src-tauri/Cargo.toml` | ✅ 0 error / 0 warning |
| `cargo test automations` | ✅ 17 passed / 0 failed |
| 协议探测 `verify-appserver-shapes.mjs` | ✅ 9/9（interrupt/steer/approvalPolicy/sandboxPolicy/fork/revert/compact） |
| 协议探测 `verify-batch2-shapes.mjs` | ✅ 22/22（config 写读、fs 全操作、fs/watch→fs/changed、collaborationMode、review/start） |
| 协议探测 `verify-batch3-shapes.mjs` | ✅ 28/28（goal、queue、threadSection、project、plugin、marketplace、hooks、sandbox、apps 403 降级） |
| 协议探测 `verify-batch4-shapes.mjs` | ✅ 16/16（turns 分页、queue update/reorder/delete、project/import、review 四 target、skills 写） |

> 所有协议探测均使用隔离 `CODEX_HOME`（临时目录），不会修改用户真实 `~/.codex`。

---

## 4. 关键交付物索引

| 类别 | 文件 |
|---|---|
| 差距分析（总表） | `docs/CODEX-APP-PARITY-GAP.md` |
| 官方功能面清单（109KB，17 章） | `docs/research/reference-inventory.md`、`feature-index.json` |
| 当前真实度审计 v2（47 模块） | `docs/research/current-audit-v2.md` |
| 一页纸对标（协议/设置/链路矩阵） | `docs/research/parity-summary-v2.md` |
| 逐轮实施记录 | `docs/IMPLEMENTATION-LOG.md` |
| 协议能力图 / 运行时方法清单 | `docs/research/protocol-features.md`、`protocol-runtime-methods.txt` |
| 真实环境协议探针返回 | `docs/research/protocol-probe-summary.md` |
| 一键验证脚本 | `scripts/verify-all.ps1`、`scripts/protocol-verify/*.mjs` |

---

## 5. 明确不在范围内 / 未实现（范围声明）

以下能力**不纳入"核心功能对标"**，或依赖官方云端/内置插件/OS 服务，当前未实现（UI 已标注或不存在）：

1. **ChatGPT 云端专属**：云浏览器、Artifacts/Canvas、云环境/云 agent、团队/计费/分析/合规类设置（约 19 个官方分区）。
2. **实时语音** `thread/realtime/*`（官方独立的语音通话体系）。
3. **账号登录/登出流程**（`account/login/*`、`account/logout`）——本客户端复用 `~/.codex/auth.json` 已有登录态，只读展示账号与额度。
4. **官方插件实现的桌面能力**：computer-use、Appshots、Browser-use、Voice 输入引擎——设置项保留为「本地偏好」并明确标注。
5. **多窗口 / Quick Chat**、自动更新、可编辑 keymap（当前 15 组只读快捷键 + 原生菜单）。
6. **服务端 `command/exec` + `process/*`**（当前使用本地 PTY 终端，能力等价）。
7. **附件持久化**（`thread/attachment/*`）与富输入（localImage/mention/skill input）——当前附件以路径文本随消息发送。
8. **Markdown 富渲染**（表格/图片/语法高亮）——当前为轻量渲染。
9. `item/tool/call` 动态工具（官方 apps 生态路径，需 ChatGPT 连接）。
10. `thread/items/list`：当前 CLI 0.159 返回 `not supported`，已降级为 turns 级分页。

已知工程限制：
- 自动化调度仅在应用运行时执行（无 OS 服务）；`run-finished` 表示成功发起 turn，不等待模型跑完。
- 服务端 `thread/start` 无 `projectId` 参数，新建会话暂时无法挂到项目实体（项目内新建会话按根目录 + 会话列表过滤实现）。
- `app/list` 在当前账号返回 403（预期），已降级为提示 + `app/installed` 本地快照。

---

## 6. 建议的下一步（若继续迭代）

1. 附件持久化（`thread/attachment/*`）+ 富输入（localImage/mention）
2. 系统通知细化（免打扰时段、按事件类型）、可编辑 keymap
3. Markdown 富渲染（表格/图片/代码高亮）
4. 多窗口 / Quick Chat / 自动更新（`tauri-plugin-updater`）
5. 若接受云端依赖：账号登录/额度、`command/exec`+`process/*`、`item/tool/call` 动态工具
