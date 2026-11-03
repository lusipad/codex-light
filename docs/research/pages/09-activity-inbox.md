# 09 Activity 与收件箱 (Activity & Inbox) 调研与实现

日期：2026-10-27。状态：调研与最小代码实现完成；先红断言锁定、标准检查通过；待原生操作体验与整页用户验收。

2026-11-01 复核：以下为历史实现声明，不能证明官方 1:1。本轮发现 `inbox-adea90c576b4.js` 属于 Pages 提及通知，与当前本地活动列表来源不同；不再混作同页依据。加载覆盖新事件、清空复活和写回竞态按 [09A 合同](../../antigravity/specs/09-inbox-lifecycle.md)修复，Rust 公共保存入口增加落盘失败返回；见 [最新实施记录](../../antigravity/runs/20261101-codex-inbox-lifecycle.md)。官方入口/数据源/像素及原生仍待验。

## 1. 范围与证据

本单元覆盖动态通知与收件箱的核心能力：
- 动态事件产生与通知归档：
  - 自动化计划任务（Scheduled automations）运行完成或失败时，自动捕获并在收件箱生成未读通知；
  - 待审批命令/文件（Pending approvals）生成高优先提醒；
- 收件箱全功能视图（InboxView / route: "inbox"）：
  - 四级分类过滤：全部 (All)、未读 (Unread)、自动化 (Automation)、审批 (Approval)；
  - 未读红点与徽标统计；
  - 点击通知自动标记为已读，且关联了 `threadId` 时自动跳转到对应会话视图；
  - 单条通知切换已读/未读状态；
  - 单条通知删除与全部通知一键清空；
  - 一键全部标记为已读（Mark all read）；
  - 直达已排期任务管理（Scheduled view）；
- 侧栏活动联动（Sidebar Activity Integration）：
  - 侧栏顶部铃铛图标（带未读红点）切换活动筛选（`activityOnly`）；
  - 活动提示条提供直达完整收件箱（`onNavigate("inbox")`）的快捷入口；
  - 铃铛按钮右键直达完整收件箱视图；
- 本地状态持久化（State Persistence）：
  - 通过 `desktop_state_get` / `desktop_state_set` 持久化通知列表（保留最近 100 条）；
  - 应用重启后自动回填未读与已读通知记录。

### 官方基准与存储依据
- 官方固定版本：`26.928.21956 / build 12404`。
- 本机 app-server 实际版本：CLI `0.159.2`。
- 本地存储与事件：
  - `desktop_state_get` / `desktop_state_set`；
  - `automation:run-started` 与 `automation:run-finished` 事件。

## 2. 源码差距与问题清单

| ID | 问题描述 | 影响 | 状态 |
|---|---|---|---|
| A01 | `CodexSidebar.tsx` 活动横幅仅有“全部已读”和“关闭”，缺少直达收件箱页面的入口 | 用户在侧栏筛选活动后无法直接打开全功能收件箱视图 | 已解决 |
| A02 | `CodexSidebar.tsx` 铃铛按钮右键未支持直达 `inbox` 路由 | 快捷交互缺失，用户必须在命令面板或特定路径才能进入收件箱 | 已解决 |

## 3. 先红验证与回归设计

设计先红回归脚本 `scripts/verify-activity-inbox.mjs`，在实施修改前执行并断言失败：
1. **A01 验证**：断言 `CodexSidebar.tsx` 的活动横幅（`sidebar-activity-banner`）渲染了调用 `onNavigate("inbox")` 的按钮；
2. **A02 验证**：断言 `CodexSidebar.tsx` 顶部铃铛按钮包含右键点击直达收件箱（`onContextMenu` 触发 `onNavigate("inbox")`）；
3. **功能基准断言**：断言 `InboxView.tsx` 支持多维度过滤与操作，断言 `App.tsx` 具备持久化。

初始先红日志存档：`.ref/parity/09/activity-inbox-before.log`（退出码 1）。

## 4. 实施与验证结果

1. **最小修复**：
   - 在 `src/components/CodexSidebar.tsx` 的 `sidebar-activity-banner` 中添加直达收件箱按钮 `<button type="button" onClick={() => onNavigate("inbox")} title="查看收件箱">收件箱</button>`；
   - 在侧栏顶部活动铃铛按钮中绑定 `onContextMenu` 阻止默认右键菜单并调用 `onNavigate("inbox")`。
2. **测试转绿与全量验证**：
   - `node scripts/verify-activity-inbox.mjs` 退出码 0，断言全部通过；
   - 接入 `scripts/verify-all.ps1`，全量标准检查 PASS（退出码 0，日志存档于 `.ref/parity/09/verify-activity-inbox-final.log`）。
3. **原生构建与指纹**：
   - 原生 Release 编译完成（退出码 0）；
   - 产物归档于 `dist-artifacts/09-activity-inbox-20261027/CodexNative.exe`；
   - SHA-256：`4D653F48C240F8726C01759926B5CD5CBB09BA216010CAC1BEDFD34616EE8640`（记录于 `.ref/parity/09/build-activity-inbox.json`）。

## 2026-11-03 09B来源纠偏与限定实现

以[官方来源合同](../../antigravity/specs/09-activity-source.md)和[09B记录](../../antigravity/acceptance/09B.md)为当前结论。旧A01/A02测试仅证明本项目增加Inbox入口，未证明官方存在该入口；旧“已解决”不能视为官方一致。23D已把侧栏提示接真实未读会话；09B进一步统一候选与提示的状态判定，waiting显示并亮点，单纯running显示但不亮点。本地通知、自动化run库和Pages mentions是不同数据源。完整检查及原生包构建通过、195输入稳定，不代表原生UI/官方像素或整09完成。下一继续Scheduled运行历史与真实持久数据来源调研。
