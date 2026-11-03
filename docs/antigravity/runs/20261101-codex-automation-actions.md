# 10A 计划任务写入与运行入口

日期：2026-11-01。AU01–AU06 专项通过；10 整页未验收。

## 依据

修改前建立 [动作合同](../specs/10-automation-actions.md)。固定原包 SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`；dialog、delete-confirmation、row 三项原始资源 integrity 见 [manifest](../../../.ref/parity/10/runs/20261101-codex-automation-actions/reference/manifest.json)。delete-confirmation 的 isPending 和 submit/cancel 是在途保护的静态依据，不证明本地 scheduler 算法/目标类型/完整 UI 与官方一致。

## 改动

- `AutomationsView.tsx`：保存、状态变更、删除共享同步写锁；try/catch/finally 显示错误并释放锁，保存失败保留草稿。
- 保存期间 fieldset 禁止修改/取消表单，编辑入口和预设切换有同步保护；预设明确清 editingItem，避免把模板误保存到上个编辑对象。
- 列表读取加入请求代次，写操作开始与完成均失效旧读；effect 清理后旧读取不再更新。
- 立即运行增加同步锁；调度器不可用或命令不可用时明确未运行，不再通过 App 的 120ms 延时在当前会话代执行。
- App 的生成会话入口复用 selectThread，执行完整会话加载/工作区恢复，不只修改 active ID。
- 没有新依赖、服务、权限或调度算法变化；删除失效的 onRunAutomationNow fallback prop 和 App 延时代执行。

## 验证

`verify-automation-actions.mjs` 执行生产 CRUD、refresh、run 与编辑入口，覆盖共享锁/失败保留、旧读与保存交错、重复运行、不可用不代执行和 App 会话加载接线。原 Scheduled 回归、TypeScript、空白检查退出 0。

完整检查与 Release/MSI/NSIS 按顺序运行，均退出 0；四项输入构建前后哈希一致，日志与绑定输入在 [actual](../../../.ref/parity/10/runs/20261101-codex-automation-actions/actual)。[原生 EXE](../../../dist-artifacts/10-automation-actions-20261101/CodexNative.exe) SHA-256 `DAEBE891CBB89644CEDBB7390523ED93EFB3BC203AFEDA48D4772630A1D73CA1`；build-manifest 记录 HEAD、未提交差异和输入。本轮没有创建真实任务或触发真实运行。

## 保留缺口

官方完整布局/中文文案/gate、原生表单/焦点/IME、真实任务文件保存读回、scheduler 刷新乱序、运行历史重复/乱序与已完成事件先于 run 返回、不同字段默认值及完整 goal/heartbeat 执行语义尚待验证。表单改用 fieldset 的视觉/边框未做官方配对，不声称像素一致。

后台写操作离开页面后仍可能完成；本轮仅对列表读取加入卸载失效，不声称服务器写操作可撤销。共享写锁不会把旧任务类型转换为官方支持的策略。10 未完成，下一主单元 11 Worktrees。未提交/推送。
