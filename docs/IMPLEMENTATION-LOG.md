# 实施日志（按轮次）

> 对标对象：本机官方 Codex App 26.928.x（Electron）。差距清单见 [CODEX-APP-PARITY-GAP.md](CODEX-APP-PARITY-GAP.md)。

## Round 1 — 差距分析 + 审批协议正确化（commit `0ac8331`）

| 项 | 内容 |
|---|---|
| 分析 | 从安装包 `app.asar`（555MB）抽取官方 UI 功能面；用 `codex app-server generate-json-schema` + 运行时方法枚举 + 真实环境探针拿到 170 个 RPC / 84 通知 / 11 类服务端请求；全量审计本项目 22 个前端文件与 6 个 Rust 模块 |
| 交付 | `docs/CODEX-APP-PARITY-GAP.md`、`docs/research/*`（官方清单 109KB、当前审计、占位清单、协议图） |
| 修复 | `turn/interrupt` 缺 `turnId`；`turn/steer` 缺 `expectedTurnId`/错用 `text`；权限"自动"档映射非法枚举 `on-failure`；审批/提问应答结构错误 |
| 新增 | `src/protocol.ts`（协议类型与精确应答构造）、`src/components/ApprovalCenter.tsx`（命令/文件/权限/提问 4 类审批 UI）；`serverRequest/resolved`、`thread/tokenUsage/updated`、线程改名/归档/删除通知；连接后回填未决审批 |
| 验证 | `npm run build` ✅；`cargo check` ✅（审计时基线） |

## Round 2 — 核心链路补全（本轮）

### 新增/改造的 UI
| 文件 | 内容 |
|---|---|
| `src/components/TurnDiffPanel.tsx/.css` | 本轮统一 diff 面板：解析 `diff --git`/`@@`/`+`/`-`，文件级折叠、+N/-N、kind 徽标、空态/刷新 |
| `src/components/PlanPanel.tsx/.css` | 执行计划清单：待处理/进行中/已完成/失败四态、完成数进度、折叠 |
| `src/components/TokenUsageMeter.tsx/.css` | 用量表：compact 圆环（percentRemaining 优先）+ popover 明细（输入/缓存/输出/推理/总计/上下文窗口/剩余）+ 速率限制（usedPercent/重置时间/credits） |
| `src/components/ThreadActionsMenu.tsx/.css` | 线程操作菜单：portal 下拉、方向键导航、danger/disabled/hint/分隔线 |
| `src/slashCommands.ts` | 官方风格斜杠命令注册表 32 条（insert/action 两类）+ 过滤助手 |
| `ApprovalCenter.tsx` | 增加 legacy `execCommandApproval`/`applyPatchApproval`（approved/approved_for_session/denied/abort + execpolicy 修正）与 `mcpServer/elicitation/request` 卡片 |

### App.tsx 接线（核心链路）
- 流式：`item/reasoning/textDelta` 与 summary 分离累积、`item/reasoning/summaryPartAdded` 分段、`item/plan/delta` 计划流、`turn/plan/updated` → PlanPanel、`turn/diff/updated` → TurnDiffPanel、`item/fileChange/patchUpdated` 实时更新文件变更卡、`thread/tokenUsage/updated` → TokenUsageMeter
- turn 完成：合并服务端权威 `turn.items`（按 id 去重合并，修复流式缺条目的问题）
- item 渲染：`fileChange.changes[]`（path/kind/diff + 真实增删行统计）、`mcpToolCall`、`webSearch`、`imageView`/`imageGeneration`、turn 内 `plan` 卡片
- Markdown：代码块「运行」→ 终端、文件路径点击 → 右侧预览（此前回调用未接线）
- 线程生命周期：`thread/fork`（含"从当前轮次派生"）、`thread/revert`（每轮"回滚到此"）、`thread/compact/start`；新建的 ThreadActionsMenu 集成 11 项操作（Fork/压缩/回滚/复制 Markdown/导出 JSON/重命名/置顶/新建/归档/删除）
- 用量与账号：连接后 `account/read` + `account/rateLimits/read`，顶栏 compact 用量环 + 真实额度 popover；移除伪造的采样参数滑块，改为只读运行参数 + 明确提示"协议不支持逐会话覆盖"
- 通知：`thread/reverted` 重新加载、`thread/compacted` 插入压缩提示、`item/autoApprovalReview/started|completed` → 自动审批横幅、`account/updated`、`account/rateLimits/updated`、`skills/changed`、`thread/status/changed`
- 快速搜索：`QuickSearchModal` 接入 `fuzzyFileSearch` + `thread/search`（`workspacePath` prop 已接线），斜杠命令 21 个 action 接入 `handleSlashAction`（fork/新会话/重命名/归档/置顶/宠物/用量/项目/MCP 等）
- 清理假 UI：`⚙️ 参数` 面板改为只读真实参数；`📊 用量` 换成真实 token/额度

### 验证
- `npm run build` ✅（1,622 modules，CSS 96.5KB / JS 846KB）
- 真实 app-server 请求形状校验：**9/9 通过**（`thread/start` 的 approvalPolicy/approvalsReviewer/sandbox、`turn/steer` 的 expectedTurnId+input、`turn/interrupt` 的 turnId、`turn/start` 的 sandboxPolicy/effort/serviceTier、`thread/fork`、`thread/revert`、`thread/compact/start`、`thread/delete`）。脚本：`.ref/scripts/verify-appserver-shapes.mjs`（结果 `.ref/protocol-probe/_verify-shapes.json`）
- 组件层 SSR 冒烟（由组件作者执行）：16 组渲染，diff 分类/数字格式化/状态归一化/空态正确

### 仍未完成（进入后续批次）
- 批次 2：设置页全面走 `config/*` 协议、`fs/watch` 实时文件树、资源管理器增删改、`config/mcpServer/reload`
- 批次 3：`thread/goal/*` 真 Goal、`threadSection/*` 分组、`project/*` 项目实体、插件市场、Code Review、`experimentalFeature/*`、Windows 沙箱安装、线程队列
- 批次 4：原生菜单 + 可改键快捷键、系统通知/托盘/多窗口、自动化调度器、Inbox 持久化

## Round 3 — 批次 2：设置/文件系统协议化 + Code Review

### 设置页（`src/config.ts` + `SettingsView` + `types.ts`）
- 新增 `src/config.ts`（511 行）：`config/read|value/write|batchWrite`、`configRequirements/read`、`config/mcpServer/reload`、`experimentalFeature/list|enablement/set`、`account/read|rateLimits|usage` 的协议封装 + 有效/无效 config 键白名单 + 枚举常量。
- 读取：优先 `config/read(activeWorkspaceRoot)` 映射真实配置，失败回退 Tauri `config_read`。
- 保存：`config/batchWrite` + `reloadUserConfig:true`，只提交白名单键；providers/MCP 仅 dirty 时才走既有 Rust 写入；协议失败整体回退。
- 删除 7 个无效键控件（temperature/top_p/max_output_tokens/context_window/max_parallel_tools/subagent_concurrency/allow_network）+ 3 张假预设卡；改正 2 个错误键（`web_search_mode`→`web_search`、`output_verbosity`→`model_verbosity`）；新增 model_provider、approvals_reviewer、instructions、真实模型候选、托管约束提示。
- 新增「实验特性」分区：`experimentalFeature/list` 全量 152 项，stage 分组 + 搜索 + 开关（乐观回写/失败回滚）。
- 新增「账号与额度」分区（只读）：email/planType、主/次窗口 usedPercent + 重置时间 + credits、usage summary + 最近 14 天柱状图。
- MCP 增删改/导入/raw TOML 保存后追加 `config/mcpServer/reload`。

### 文件系统（`src/fsClient.ts` + `DiffDrawer` + `FileExplorer.css`）
- 新增 `src/fsClient.ts`：`fs/readDirectory|readFile|writeFile|createDirectory|remove|copy|getMetadata|watch|unwatch` 封装（base64 编解码、二进制检测、路径工具、`renamePath`=copy+remove、`watchPath` 唯一 watchId + 先订阅后 watch + 幂等 teardown）。
- DiffDrawer Files tab：目录读取/预览/保存协议优先（保留 Tauri 回退）；新增新建文件、新建文件夹、重命名、删除（二次确认）、复制路径；`fs/watch` 300ms 防抖刷新、切 tab/目录/卸载清理、app-server 重连自动重建 watch；图片/大二进制回退本地预览。

### 主界面（App.tsx / NavigationRail / CodexSidebar）
- 全局工作区 `fs/watch`：文件变化 400ms 防抖刷新 Git 状态与文件列表。
- **计划模式走真实协议**：`thread/settings/update` 的 `collaborationMode: {mode:"plan"|"default", settings:{model,reasoning_effort}}`，移除原「prompt 前缀」伪装；新会话在首个 turn 前应用。
- 线程状态条：监听 `thread/status/changed`，头部显示 空闲/运行中/等待批准/等待输入/出错 状态徽标。
- Inbox 持久化（`desktop_state` 读写）+ turn 完成自动入箱（去重）。
- **Code Review 页面（新增）**：`review/start` 内联审查，支持 4 种目标（未提交改动 / 对比分支 / 指定提交 / 自定义指令）、分支与提交选择器、审查结果在会话中流式展示；导航栏与侧边栏新增「代码审查」入口。

### 验证
- `npm run build` ✅（1,6xx modules，CSS 104KB / JS 888KB）
- 协议 shape 校验 **22/22 通过**（`.ref/scripts/verify-batch2-shapes.mjs`，隔离 `CODEX_HOME`）：config/read|batchWrite|value/write 实测生效、configRequirements、mcpServer/reload、experimentalFeature list/set（152 项）、fs 全操作（含 base64 读写、copy、remove、metadata）、**fs/watch→fs/changed 真实通知**、thread/settings/update collaborationMode plan/default、review/start 形状。
- 组件层：队友对设置页做了隔离 CODEX_HOME 的真实 app-server 枚举矩阵测试（6 档 effort / 3 档 sandbox / 4 档 web_search / 3 档 verbosity 写读通过）。

### 后续（批次 3）
- `thread/goal/*` 真 Goal、`threadSection/*` 侧栏分组、`project/*` 项目实体、`plugin/*`+`marketplace/*` 插件市场、`thread/queue/*`、`windowsSandbox/*`、`hooks/list`、Apps、原生菜单/快捷键、自动化调度器。
