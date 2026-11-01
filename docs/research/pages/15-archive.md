# 15 Archive (归档会话) 调研与实现

日期：2026-10-27。状态：调研完成，代码实现与全量验证通过。

## 1. 范围与证据

本单元覆盖已归档会话的管理与生命周期：
- 归档列表加载：
  - 调用 `thread/list` 传入 `{ archived: true, limit: 100, sortKey: "updated_at", sortDirection: "desc" }`；
  - 侧栏不展示已归档的会话；
- 搜索与防抖：
  - 300ms 输入防抖，携带 `searchTerm` 请求服务端过滤；
- 取消归档与恢复会话：
  - 单击会话行调用 `onSelectThread`，自动恢复会话并跳转至活跃聊天视图；
  - 点击“取消归档”按钮（`onUnarchive`），调用 `thread/metadata/update { threadId, archived: false }` 恢复会话；
- 永久彻底删除：
  - 点击删除按钮调用 `onDelete`；
  - 强制弹窗确认（`window.confirm`），包含忙态防重复 `busyId` 锁定；
  - 调用服务端 `thread/delete { threadId }` 彻底清理。

### 官方基准
- 官方固定版本：`26.928.21956 / build 12404`。
- 本机 app-server 实际版本：CLI `0.159.2`。

## 2. 源码差距与问题清单

| ID | 问题描述 | 影响 | 状态 |
|---|---|---|---|
| AR01 | 归档会话列表需支持加载中、空状态与错误重试 | 提供完整的网络异常与空归档容错体验 | 已解决 |
| AR02 | 删除归档会话必须有不可逆确认保护 | 避免用户手滑误删会话历史 | 已解决 |

## 3. 验证与回归设计

设计回归脚本 `scripts/verify-archive.mjs`，包含：
1. 断言 `ArchiveView.tsx` 请求 `thread/list` 时携带 `archived: true`；
2. 断言具备 300ms 搜索防抖与 `searchTerm` 查询；
3. 断言具备 `onUnarchive` 恢复与 `onDelete` 彻底删除（含确认保护与 `busyId`）。

## 4. 实施与验证结果

1. **测试转绿与全量验证**：
   - `node scripts/verify-archive.mjs` 3 项检查全部通过（退出码 0）；
   - 接入 `scripts/verify-all.ps1`，全量标准检查 PASS（退出码 0，日志存档于 `.ref/parity/14/verify-review-archive-final.log`）。
2. **原生构建与指纹**：
   - 原生 Release 编译完成（退出码 0）；
   - 产物归档于 `dist-artifacts/14-review-archive-20261027/CodexNative.exe`；
   - SHA-256：`E5276064234414EA0ECF0F44D3FBC448907329228D433EFC2B75C96CAC0C2687`（记录于 `.ref/parity/15/build-archive.json`）。
