# 10 Scheduled (计划任务) 调研与实现

日期：2026-10-27。状态：调研完成，准备先红回归与代码实现。

2026-11-01 复核：以下是历史调研和实现声明，不能作为当前官方全页通过依据。CRUD 异常、防重入、列表请求和延时代执行缺陷按 [10A 合同](../../antigravity/specs/10-automation-actions.md)修正；最新范围和证据见 [10A 记录](../../antigravity/runs/20261101-codex-automation-actions.md)。本地 scheduler/目标分类、真实文件/原生/像素仍待对照。

## 1. 范围与证据

本单元覆盖计划任务与持续目标的核心管理与调度执行：
- 任务配置与存储：
  - 读取与写入 `~/.codex/automations/<id>/automation.toml`；
  - 任务类型：`cron`（定时周期）、`heartbeat`（会话巡检）、`goal`（长期自治目标 `/goal`）；
  - 周期支持标准 RFC 5545 RRULE 格式（HOURLY/DAILY/WEEKLY/MONTHLY/YEARLY 及间隔与星期过滤）；
  - 执行环境：工作目录、隔离 Worktree、指定模型与推理深度；
- 调度器执行引擎（Rust 原生 `automations.rs`）：
  - 幂等调度后台循环（5s 启动自检，30s 周期探测）；
  - 调度状态持久化于 `~/.codex/.codex-native/scheduler-state.json`；
  - 触发执行链：`thread/start` -> `turn/start`；
  - 事件广播：`automation:run-started` 与 `automation:run-finished`；
  - 调度 RPC：`automations_scheduler_status`、`refresh_schedule`、`automations_run_now`；
- 前端管理视图（`AutomationsView` / route: "scheduled"）：
  - 顶部调度器状态条（健康状态指示灯、当前墙钟时间、配置任务数、下次预计运行时间摘要、手动刷新调度）；
  - 分类切换（全部 / 计划任务 / 长期目标）与状态过滤（全部 / 已开启 / 已暂停 / 已完成）；
  - 搜索过滤（按名称与提示词）；
  - 快捷预设模板一键填入；
  - 任务卡片操作：立即运行、启用/暂停、标记完成、编辑、删除；
  - 实时运行历史（最近 20 条，可清空，带状态颜色与耗时，包含关联会话跳转）。

### 官方基准
- 官方固定版本：`26.928.21956 / build 12404`。
- 本机 app-server 实际版本：CLI `0.159.2`。

## 2. 源码差距与问题清单

| ID | 问题描述 | 影响 | 状态 |
|---|---|---|---|
| S01 | `AutomationsViewProps` 缺少 `onSelectThread` 回调，`App.tsx` 未传该回调 | 任务执行生成的会话线程无法通过点击直达 | 已解决 |
| S02 | `AutomationsView.tsx` 中运行历史或任务卡片的 `threadId` 仅作为纯文本展示 | 用户在看到运行结果后无法直接点击跳转至该会话交互 | 已解决 |
| S03 | `AutomationsView.tsx` 缺少任务编辑（Edit）能力，修改已有任务只能删除重新创建 | 无法快捷调整已配置任务的周期规则、Prompt 或关联模型 | 已解决 |

## 3. 先红验证与回归设计

设计先红回归脚本 `scripts/verify-scheduled-automations.mjs`，在实施修改前执行并断言失败：
1. **S01 验证**：断言 `AutomationsView.tsx` 中 `AutomationsViewProps` 声明了 `onSelectThread` 属性；
2. **S01 App 接线验证**：断言 `App.tsx` 渲染 `AutomationsView` 时传入了 `onSelectThread`；
3. **S02 验证**：断言 `AutomationsView.tsx` 运行历史或卡片中的 `threadId` 渲染了可点击的跳转控件（调用 `onSelectThread`）；
4. **S03 验证**：断言 `AutomationsView.tsx` 支持编辑已有任务（存在 `editingItem` 或 `handleEdit` 编辑保存链路）。

初始先红日志存档：`.ref/parity/10/scheduled-automations-before.log`（退出码 1）。

## 4. 实施与验证结果

1. **最小修改实施**：
   - `src/components/AutomationsView.tsx`：
     - `AutomationsViewProps` 补充 `onSelectThread?: (threadId: string) => void;`；
     - 新增 `editingItem` 状态与 `handleStartEdit`，支持载入已有任务并修改保存；
     - 卡片操作栏增加“编辑”按钮；
     - 运行历史与任务卡片上的 `threadId` 改造为直达对应会话的交互按钮。
   - `src/App.tsx`：
     - 在渲染 `AutomationsView` 时传入 `onSelectThread={(tId) => { setActiveThreadId(tId); setActiveRoute("thread"); }}`。
2. **测试转绿与全量验证**：
   - `node scripts/verify-scheduled-automations.mjs` 4 项检查全部通过（退出码 0）；
   - 接入 `scripts/verify-all.ps1`，全量标准检查 PASS（退出码 0，日志存档于 `.ref/parity/10/verify-scheduled-final.log`）。
3. **原生构建与指纹**：
   - 原生 Release 编译完成（退出码 0）；
   - 产物归档于 `dist-artifacts/10-scheduled-automations-20261027/CodexNative.exe`；
   - SHA-256：`9481A98A39B5E0136A6141D7BCB4F76EF3B95F17265C6B1A436E4B8A60A9BE65`（记录于 `.ref/parity/10/build-scheduled-automations.json`）。

## 2026-11-03 10B终态纠偏

[官方执行合同](../../antigravity/specs/10-run-completion.md)与[限定验收记录](../../antigravity/acceptance/10B.md)为当前结论。原实现把turn/start响应当completed；本轮修为匹配thread/turn真实终态，失败/中断/未知不会成功。事件早于回包及按startedAt归并已有生产回归；持久声明失败不执行，终态保存失败仅重试磁盘，自动扫描不重跑unknown。完整隔离标准、全Rust229、原生包通过，195输入稳定；无真实模型任务端到端、原生或官方像素证据。完整automation_runs持久历史/身份/查阅策略仍未实现，不能由本轮推导整页一致。
