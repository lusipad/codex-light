# PARITY SUMMARY v2 —— Round 初始 vs HEAD `a193da2`（一页纸对标）

> 基线：v1 审计（`fad9129`，~06:50 快照）与 `docs/research/protocol-features.md`（Round 初始计数）
> 现状：HEAD `a193da2`（Round 1-6 完成）
> 详细证据：`docs/research/current-audit-v2.md`、`.ref/audit2/raw/*`
> 审计方式：只读 grep/源码核对 + 本机 `npx tsc --noEmit`（exit 0）；统计脚本 `.ref/audit2/raw/stats.ps1`
> **审计快照**：HEAD `a193da2` + 工作树未提交增量（4 个 tracked 文件 +71 行：`src/App.tsx`、`src/components/CodexSidebar.tsx`、`src/components/NavigationRail.tsx`、`src/types.ts`；`src/components/ArchiveView.tsx/.css` 为 untracked，属 Archive 路由接入的并行改动，mtime 07:53-07:54）。本审计基于该工作树快照（~07:55）阅读与统计；`npx tsc --noEmit` 在该快照实测 exit 0。若收尾提交与此快照不一致，以提交后代码为准（行号可能轻微偏移）。

---

## 1. 一页纸核心数字

| 指标 | Round 初始 | 现在（v2） | 变化 |
|---|---|---|---|
| 前端引用的 JSON-RPC client 方法 | 17（含 Rust 桥） | **71**（纯前端）+ Rust 桥 3 = **74** | ×4.2 |
| 消费的 server 通知 | 8 | **35** | ×4.4 |
| 处理的 server request 类 | 1（且应答错误） | **7 / 10** | ×7 |
| Tauri 命令注册 / 有效使用 | 64 / 59 | **68 / 64** | +9 使用；未用 5→4 |
| Tauri 事件监听 | ~5 | **10** | ×2 |
| SettingsView 分区 | 20 | **22** | +2 |
| 官方 45 设置分区：真实可用 | ~0-2 | **10（22%）** | +8~10 |
| 官方 45 分区：真实+部分 | ~4 | **21（47%）** | — |
| 官方 45 分区：仅假 UI / 缺失 | ~16 假 / ~27 缺 | **5 假 / 19 缺** | 假 UI −11 |
| 功能点级真实度（v2 清点 127 点） | REAL 33% / PARTIAL 33% / MOCK 26% / MISSING 8% | **REAL 58.3% / PARTIAL 7.9% / MOCK 8.7% / MISSING 25.2%** | REAL +25pt |
| 模块级真实度（36 模块） | 8 R / 16 P / 6 M / 2 MISS | **16 R / 14 P / 4 M / 2 MISS** | REAL 模块 ×2 |
| 协议稳定目录覆盖 | 16/104 方法（15%） | **71/104 方法（68%）**、通知 35/83（42%）、请求 7/10（70%） | — |

> 注：v2 MISSING 比例上升是因为把此前未清点的官方能力（实时语音、附件持久化、command/exec、process、collab、账号登录、系统通知/更新、云/团队/计费类设置）全部纳入统计；核心本地客户端范围内的“真实可用”比例已从 ~1/3 提升到 ~58%。

---

## 2. 前端实际引用的协议方法清单（71，按域分组）

> 全部命中 `.ref/protocol/ClientRequest.json`（0.159 稳定目录 104 个）；脚本与原始清单见 `.ref/audit2/raw/used-client-methods-final.txt`、`callAppServer-call-sites.txt`。
> **+ Rust 桥内部引用**：`initialize`、`thread/archive`、`thread/delete`（lib.rs:242-288）→ 实现引用合计 **74**。

- **账号/额度（3）**：`account/read`、`account/rateLimits/read`、`account/usage/read`
- **配置（7）**：`config/read`、`config/value/write`、`config/batchWrite`、`configRequirements/read`、`config/mcpServer/reload`、`experimentalFeature/list`、`experimentalFeature/enablement/set`
- **文件系统（11）**：`fs/readDirectory`、`fs/readFile`、`fs/writeFile`、`fs/createDirectory`、`fs/remove`、`fs/copy`、`fs/getMetadata`、`fs/watch`、`fs/unwatch`、`fuzzyFileSearch`、`thread/search`
- **线程（21）**：`thread/start`、`thread/resume`、`thread/read`、`thread/list`、`thread/turns/list`、`thread/name/set`、`thread/unarchive`、`thread/fork`、`thread/revert`、`thread/compact/start`、`thread/settings/update`、`thread/goal/{get,set,clear}`、`thread/queue/{add,list,start,delete}`、`thread/section/move`、`threadSection/{list,create,update,delete}`
- **Turn（3）**：`turn/start`、`turn/steer`、`turn/interrupt`
- **项目（6）**：`project/{list,read,create,update,delete,move}`
- **插件/市场/Apps（10）**：`plugin/{list,installed,read,install,uninstall}`、`marketplace/{add,remove,upgrade}`、`app/list`、`app/installed`
- **技能/MCP（4）**：`skills/list`、`skills/config/write`、`mcpServerStatus/list`、`hooks/list`
- **审查（1）**：`review/start`
- **模型（1）**：`model/list`
- **Windows 沙箱（2）**：`windowsSandbox/readiness`、`windowsSandbox/setupStart`
- 备注：其中 12 个在 0.159 “稳定 schema”未列出（experimental-gated）：`project/*`(6)、`thread/queue/*`(4)、`thread/search`、`thread/settings/update`；实施日志记录已在隔离 CODEX_HOME 实测 28/28 通过。

### 2.1 通知消费清单（35 = 32 常量 + 3 raw）
- **Turn/Item**：turn/started（raw）、turn/completed（raw）、item/agentMessage/delta（raw）、item/reasoning/textDelta、item/reasoning/summaryTextDelta、item/reasoning/summaryPartAdded、item/plan/delta、item/commandExecution/outputDelta、item/fileChange/patchUpdated、item/autoApprovalReview/started、item/autoApprovalReview/completed
- **Turn 面板**：turn/diff/updated、turn/plan/updated
- **线程**：thread/name/updated、thread/archived、thread/unarchived、thread/deleted、thread/reverted、thread/compacted、thread/status/changed、thread/tokenUsage/updated、thread/goal/updated、thread/goal/cleared、thread/queue/changed
- **账号/配置**：account/updated、account/rateLimits/updated、skills/changed、configWarning、deprecationNotice、guardianWarning、warning、error
- **文件/审批/沙箱**：fs/changed、serverRequest/resolved、windowsSandbox/setupCompleted

### 2.2 Server request 处理（7/10）
✅ `item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/permissions/requestApproval`、`item/tool/requestUserInput`、`mcpServer/elicitation/request`、`execCommandApproval`、`applyPatchApproval`
❌ `item/tool/call`、`account/chatgptAuthTokens/refresh`、`attestation/generate`

---

## 3. 设置分区对标（官方 45 命名分区 / docs 称 48）

| 覆盖类别 | 数量 | 分区 |
|---|---|---|
| ✅ 真实可用 | **10** | Import、Account、Storage、Agent(Configuration)、MCP servers、Connections、Skills（应用内页面）、Code review（应用内页面）、Environments、Archived chats |
| ⚠️ 部分可用 | **11** | General、Profile、Appearance、Security（via Agent）、Personalization、Keyboard shortcuts、Usage & billing、Hooks、Plugins（能力在页面/设置分区假）、Worktrees（能力在页面/设置假）、Git（能力真实/设置假） |
| 🟡 仅 UI 假开关 | **5** | Computer use、Appshots、Browser、Voice、Mini & Pets |
| ❌ 完全缺失 | **19** | Notifications、Ads controls、Parental controls、Trusted contact、Safety & wellbeing、Billing、Analytics、Debug、Agreements、Teams、File type handlers、Passwords、Computer history、Codex Micro、Cloud computer、Browser extension、Cloud preferences、Codex Cloud、Cloud environments |
| 合计 | 45 | — |

- 本项目 SettingsView 22 分区：**✅ 9 / ⚠️ 5 / 🟡 8 / ❌ 0**（明细 `.ref/audit2/raw/settings-coverage.md`）。
- 真实可用占比：**10/45 = 22%**；真实+部分 **21/45 = 47%**；含假 UI 的“有界面/能力覆盖”约 26/45 = 58%。

---

## 4. 核心链路 ✅/⚠️/❌ 一页表

| 链路 | 状态 | 说明 |
|---|---|---|
| 对话发送 / 流式回复 | ✅ | turn/start + 通知流 + 权威 items 合并 |
| 中断 / Steer | ✅ | turnId / expectedTurnId+input 均正确 |
| 审批（命令/文件/权限/提问/elicitation/legacy） | ✅ | 7 类；缺 `item/tool/call` |
| 流式渲染（reasoning/plan/diff/fileChange/MCP/web/图片） | ✅ | 9 类 item 真实渲染 |
| Diff 审阅 + Git 全链路 | ✅ | diff/stage/commit/push/PR + 行内评论 |
| 文件树 / 预览 / 编辑 / fs/watch | ✅ | fs/* 协议化 + 300-400ms 防抖刷新 |
| 终端（本地 PTY） | ✅ | 未变，稳定 |
| 线程 CRUD / fork / revert / compact / 分页 | ✅ | turns 分页；items 分页 CLI 不支持 |
| 侧栏自定义分区 | ✅ | threadSection CRUD + 移动线程 |
| 项目实体 | ⚠️ | project/* CRUD/排序真实；**新建会话无法挂项目**（thread/start 无 projectId） |
| 收件箱 Inbox | ✅ | 本地持久化 + turn/automation 自动入箱；无 OS 通知 |
| 自动化（调度器） | ✅ | Rust 调度执行器 + 状态/历史 + 立即运行；仅应用运行时 |
| Goal | ✅ | thread/goal/* 服务端驱动 + 通知 + 完成 Inbox |
| 消息队列 | ✅ | thread/queue/* 服务端队列 + Up next UI |
| 插件 / 市场 / Apps / Skills / MCP | ✅ | plugin/marketplace/app/skills 协议 + MCP reload；app/list 403 有 fallback |
| Code Review | ✅ | review/start 四 target + 内联会话 |
| Hooks | ⚠️ | list/实时运行记录真实；无编辑/trust 写 |
| 设置页 | ⚠️ | 22 分区 = 9 真 / 5 部分 / 8 假 UI |
| 用量 / 额度 / 账号 | ⚠️ | token/额度/账号只读真实；无登录/登出/Billing |
| QuickSearch / 斜杠命令 | ✅ | fuzzyFileSearch + thread/search + 32 条 slash 注册表（少量动作占位） |
| 原生菜单 / 托盘 / 快捷键 | ✅ | 菜单+托盘+15 组快捷键；设置页不可改键 |
| Windows 沙箱 | ✅ | readiness + setup + 完成通知 |
| 通知 / 提示音 | ⚠️ | 应用内 toast+chime+Inbox；无 OS 通知/免打扰设置；warnings 仅 console |
| Markdown 渲染 | ⚠️ | 回调已接线；无表格/图片/高亮 |
| 语音 / @电脑 / Appshots / Browser-use | ❌ | 仅假开关/文本插入；无执行路径 |
| 实时语音 | ❌ | thread/realtime/* 0 引用 |
| command/exec + process/* | ❌ | 仅本地 PTY |
| 附件持久化 | ❌ | thread/attachment/* 0 引用；附件仅文本 |
| 多窗口 / Quick Chat | ❌ | 单窗口 |
| 系统通知 / 自动更新 / 窗口状态 | ❌ | 无对应插件 |
| 云/团队/计费/分析/合规类设置 | ❌ | 20 个官方分区缺失（多数可判范围外） |

---

## 5. 仍缺的 Top-10（按价值）

1. 系统通知中心 + 通知/免打扰设置分区（官方 Notifications）
2. 实时语音 `thread/realtime/*`
3. 附件持久化（`thread/attachment/*`）与协议富输入（localImage/mention/skill）
4. computer-use / Appshots / Browser 真实执行
5. 账号登录/登出（`account/login/*`、`account/logout`）
6. 服务端 `command/exec` + `process/*`（后台进程管理）
7. `item/tool/call` 动态工具 + collab/subAgent item 渲染
8. Markdown 富内容（表格/图片/语法高亮）
9. 多窗口 / Quick Chat / 可编辑 keymap
10. Settings 剩余 8 个“假开关”分区收口（接真实后端或明确标注）

---

## 6. 证据与复现

```powershell
cd D:\Repos\codex-desktop-native
git rev-parse HEAD                                 # a193da289e16f018440fe2afbc4f75abba298656
pwsh -NoProfile -File .ref/audit2/raw/stats.ps1    # 方法/通知/server request/命令/事件/设置统计
npx tsc --noEmit                                   # 本次实测 exit 0（未重跑 npm build/cargo check，保持只读）
```
- 统计原始清单：`.ref/audit2/raw/{used-client-methods-final,notifications-consumed,server-requests-handled,tauri-commands-*}.txt`
- 旧 §28 复核：`.ref/audit2/raw/old-section28-recheck.md`（已修复 14 / 部分 3 / 仍存在 3）
- 设置覆盖：`.ref/audit2/raw/settings-coverage.md`
- 功能矩阵：`.ref/audit2/raw/feature-matrix.csv`（127 点：R74/P10/M11/MISS32）
- 详细审计：`docs/research/current-audit-v2.md`



