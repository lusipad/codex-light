# 04 会话组织与项目页调研与实现

日期：2026-10-27。状态：调研、先红断言、最小代码实现、全量标准检查与 Release 构建完成；待原生操作体验与整页用户验收。

## 1. 范围与证据

本单元覆盖会话组织与项目管理的核心能力：
- Projects 实体管理：`project/*`（列表 `project/list`、创建 `project/create`、重命名与路径更新 `project/update`、删除 `project/delete`、位置排序 `project/move`）；
- 侧栏自定义分区：`threadSection/*` 与 `thread/section/move`（分区列表、创建、重命名、删除、会话在分区之间的移入/移出）；
- 会话生命周期与元数据：置顶（Pin/Unpin）、最近会话（Recents）、重命名（Rename）、未读指示（Unread dot）、正在运行指示（Streaming/running spinner）、归档/恢复（Archive/Unarchive）、删除（Delete）；
- 服务端通知驱动刷新：`project/changed`、`thread/project/updated`、`thread/name/updated`、`thread/archived`、`thread/unarchived`、`thread/deleted`。

### 官方基准与协议依据
- 官方固定版本：`26.928.21956 / build 12404`。
- 本机 app-server 实际版本：CLI `0.159.2`。
- 协议 Schema 依据（`.ref/protocol/ServerNotification.json` 及 `codex_app_server_protocol.schemas.json`）：
  - `ProjectChangedNotification`: `{ changeType: ProjectChangeType, projectId: string }`，通知方法为 `project/changed`。
  - `ThreadProjectUpdatedNotification`: `{ projectId: string | null, threadId: string }`，通知方法为 `thread/project/updated`。
  - `ThreadSectionListResponse`: `{ data: ThreadSection[], nextCursor: string | null }`。
  - `ThreadSummary`: 包含 `id`、`name`、`preview`、`cwd`、`createdAt`、`updatedAt`、`model`、`status`、`section`（分区 ID）、`projectId`（项目实体 ID）。

## 2. 源码差距与问题清单

| ID | 问题描述 | 影响 | 状态 |
|---|---|---|---|
| P01 | `src/protocol.ts` 缺少 `THREAD_PROJECT_UPDATED: "thread/project/updated"` 常量 | 无法对齐官方协议定义，通知分发无类型安全常量 | 已修复 |
| P02 | `src/App.tsx` 的 `handleNotification` 未处理 `NOTIFICATION.PROJECT_CHANGED` | 后端项目变更通知到达时无法自动触发刷新，导致侧栏与项目视图数据滞后 | 已修复 |
| P03 | `src/App.tsx` 的 `handleNotification` 未处理 `NOTIFICATION.THREAD_PROJECT_UPDATED` | 会话被关联或移出项目实体时，本地 `threads` 数组中的 `projectId` 未被更新 | 已修复 |
| P04 | `src/App.tsx` 传递给 `CodexSidebar` 和 `ProjectsIndexView` 的 `refreshToken` 仅为静态 `connected ? 1 : 0` | 本地执行项目新建/修改或收到服务端变更通知时，子组件无法响应式重新拉取真实项目数据 | 已修复 |
| P05 | `src/components/CodexSidebar.tsx` 的 `renderThreadRow` 悬浮操作区缺少 `···`（更多操作）按钮 | 用户在侧栏悬停会话时无法直接左键点击唤起操作菜单（移入分区、重命名、删除等），操作路径不完整 | 已修复 |

## 3. 先红验证与回归设计

设计先红回归脚本 `scripts/verify-projects-sections.mjs`，包含：
1. **P01 验证**：断言 `src/protocol.ts` 导出的 `NOTIFICATION` 包含 `THREAD_PROJECT_UPDATED === "thread/project/updated"`；
2. **P02/P03 验证**：断言 `src/App.tsx` 存在 `NOTIFICATION.PROJECT_CHANGED` 和 `NOTIFICATION.THREAD_PROJECT_UPDATED` 通知分支，且在收到 `thread/project/updated` 时同步更新 `thread.projectId`；在收到 `project/changed` 时刷新项目与会话；
3. **P04 验证**：断言 `src/App.tsx` 维护了动态的 `projectsRefreshToken`（初始状态定义与自增处理），并将其作为 `refreshToken` prop 传递给 `CodexSidebar` 与 `ProjectsIndexView`；
4. **P05 验证**：断言 `src/components/CodexSidebar.tsx` 在 `sidebar-thread-actions` 操作区中渲染了带有 `EllipsisIcon` 的“更多操作”按钮，并绑定了 `openThreadMenu`。

修改前运行结果：真实先红断言失败，保存日志至 `.ref/parity/04/projects-sections-before.log`。

## 4. 实施与验证结果

- `src/protocol.ts`：补充 `THREAD_PROJECT_UPDATED: "thread/project/updated"`。
- `src/App.tsx`：
  - 新增 `projectsRefreshToken` 状态并接入 `project/changed` 与 `app-server:status` 连接事件；
  - 在 `handleNotification` 中处理 `thread/project/updated`，同步更新本地 `threads` 的 `projectId`；
  - 将动态 `projectsRefreshToken` 传递给 `CodexSidebar` 与 `ProjectsIndexView`，并在 `onProjectsChanged` 回调时自增。
- `src/components/CodexSidebar.tsx`：
  - 在 `sidebar-thread-actions` 操作区增加 `EllipsisIcon` 更多操作按钮，点击时计算视口边界定位并触发 `openThreadMenu`。
- `scripts/verify-all.ps1`：集成 `verify-projects-sections.mjs`。

### 自动化测试与全量标准检查
- `node scripts/verify-projects-sections.mjs`：6 项检查全部通过（PASS）；
- `npx tsc --noEmit`：0 错误通过；
- `pwsh -NoProfile -File scripts/verify-all.ps1`：**ALL CHECKS PASSED**，退出码 0，日志保存至 `.ref/parity/04/verify-projects-sections-final.log`；
- Release 原生构建：退出码 0，日志保存至 `.ref/parity/04/release-projects-sections.log`；
  - 可执行文件：`dist-artifacts/04-projects-sections-20261027/CodexNative.exe`；
  - SHA-256 哈希：`07C3EAD32E4012B1A2B5894FD35C2C13688A9E88F1B242ACBC3B0AF740F3485E`；
  - 指纹记录文件：`.ref/parity/04/build-projects-sections.json`。

## 5. 限制与待用户验收说明

- **外部依赖与多客户端**：多客户端同时对同一项目执行重命名/排序时的远端合并冲突需由 app-server 后端锁裁决；
- **视觉像素对齐**：原生窗口下的侧栏折叠状态、项目卡片排版在不同缩放比下的逐像素对比仍待进一步采集参考并实测；
- **验收结论**：目前已通过先红自动化回归、全量协议探针验证及 Release 构建，处于“待用户验收”状态。未经验收前不标为“已验收”。
