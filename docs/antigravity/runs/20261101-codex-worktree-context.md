# 11A 工作树上下文与会话入口

日期：2026-11-01。功能专项自验，11 整页未验收。

## 依据与修改

[修改前合同](../specs/11-worktree-context.md)；本轮从固定原包提取的 worktrees-settings-page/use-codex-worktrees 两项 integrity 与原包哈希见 [reference manifest](../../../.ref/parity/11/runs/20261101-codex-worktree-context/reference/manifest.json)。静态“使用同一文件和分支启动新聊天”及按 workspaceRoot 区分查询是依据；完整官方运行时/布局未测。

- App：现有工作树入口先用既有 workspace_add 登记目录（setActive=false），确认导航有效后经 startNewThread 激活目录、打开草稿并关闭另建工作树开关；失败提示可见，过期导航不替换新视图。成功文案明确为草稿，未发送前不声称服务端已启动会话。
- App：绑定会话复用 selectThread，执行完整加载；按 workspaceRoot 设置 WorktreesView key，跨项目即时重置旧行、分支和表单。
- WorktreesView：读取代次及卸载保护；旧列表不再发起 branches，旧分支/错误不覆盖新读取；写操作结束后对已卸载组件的 refresh 不再发请求。分支默认选择使用函数更新，保留在途用户选择。
- 复用组件 key、现有协议和发送回归 harness，无新依赖、无 Rust 修改、无视觉布局改动。

## 验证

`verify-worktree-context.mjs` WC01–WC05 执行生产组件与回调，覆盖重复创建条件、实际 thread/start.cwd、登记失败/旧导航、最新请求胜出、旧分支/错误、卸载与 A→B→A、旧创建完成后不刷新。修改前 WC01 在既有目录仍进入创建条件处失败，修改后通过。原 W01–W04 字符串测试仍保留，但不作为完整功能证据。

最终源码完整标准检查（含协议探针）与 Release/MSI/NSIS 均退出 0；四项绑定输入构建前后匹配，见 [actual](../../../.ref/parity/11/runs/20261101-codex-worktree-context/actual) 中 verify-all-final.log、build-final.log、build-result.json 和 build-manifest.json。[可运行 EXE](../../../dist-artifacts/11-worktree-context-20261101/CodexNative.exe) SHA-256 `17164FC9ACBEC14C3243907FF0E0228D499D1C1683A99EAE1AFCD39AED94FF72`。不能以构建通过替代官方/原生操作/像素验收。未配置独立 lint，未声称通过。

完整标准检查含协议探针退出 0。首次打包 Vite 输出后 Node 触发 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`，beforeBuildCommand 退出 `-1073740791`；原始日志为 actual/build.log，失败结果保留 actual/build-result-attempt1.json。不能据此推断产品代码故障或已确认工具链根因；后续重试结果单独记录。

同源码重试退出 0（build-retry.log），随后将登记动作收紧为 setActive=false 并补回归，最终重新顺序执行完整检查及打包，也均退出 0；早期成功构建未作为最终交付。

## 限制

未在真实仓库执行创建/删除/带回，没有官方配对截图或原生交互通过证据。写锁连击、带回目标服务端校验、终端 cwd 入口、写操作取消、workspace_add 持久化副作用及其跨导航恢复、toast 定时器仍需复核。组件 key 会重置切项目前未提交的创建表单，是否与官方相同未实测。branches 读取失败仍沿用空列表降级。11 未完成，未提交/推送。
