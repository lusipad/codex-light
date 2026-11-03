# 11A 工作树上下文与会话入口合同

日期：2026-11-01。修改前规格；本批仅修复上下文与入口，整页未验收。

## 官方依据与边界

固定 asar SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。本轮从原包提取并校验 integrity 的两个资源见 `.ref/parity/11/runs/20261101-codex-worktree-context/reference/manifest.json`。

- `worktrees-settings-page-7fd919fb89de.js`：检索 `Starts a fresh chat using the same files and branch`、`sourceConversationId`、`workspaceRoot:n.dir`。静态入口使用选定目录；完整下游执行和中文文案未实测。
- `use-codex-worktrees-0bc45459a742.js`：检索 `queryKey`、`signal`，查询以 host/worktreesRoot 区分上下文。仅作上下文隔离依据，不推断官方完整取消时序。

已观察本项目：现有目录入口将 useWorktree 置 true，首条发送会创建另一工作树；绑定会话只改 ID/路由；列表无请求代次。旧 W01–W04 字符串检查不能证明上述行为正确。

## 修改范围与验收

允许修改 App 的 Worktrees 接线、WorktreesView 读取生命周期及对应测试/资料；复用已有 selectThread、startNewThread、Rust 命令，不新增依赖。

| ID | 操作 | 预期与证据 |
|---|---|---|
| WC01 | 选现有 W，启动会话 | 先复用 workspace_add 登记目录但不激活，导航仍有效才经 startNewThread 激活；失败可见，晚到结果不跳转；新会话 cwd=W，关闭“创建新工作树”开关，不复制为 W2 |
| WC02 | 点击绑定会话 | 复用完整 selectThread，不只修改 ID/路由 |
| WC03 | 同项目先后刷新，旧 list/branches 最后返回 | 仅最新请求写列表、分支、错误；旧 list 不继续请求 branches |
| WC04 | A→B、A→B→A，旧成功/失败晚到 | 切换即清旧行与分支；旧组件无权写新上下文 |
| WC05 | A 写入中切 B，A 完成后 refresh | 不在已卸载 A 发起刷新，不把 A 行带入 B |

采用按 workspaceRoot 设置组件 key 的最小隔离方案；每次挂载有独立 refs/state，读取增加代次和卸载保护。原生真实 Git 操作、终端入口、重复写锁、官方页面布局/像素仍需另验。本批回归使用受控 Promise 执行生产组件、入口及真实发送回调，不能替代真实 Git/官方运行时对照。workspace_add 会登记目录；其持久化副作用不能随导航撤销，跨项目写回问题不在本批声称解决范围。
