# 09A 活动历史加载与持久化

日期：2026-11-01。范围：当前本地活动列表的数据生命周期。09 整页未验收。

## 取证与边界

修改前建立 [IL01–IL06 合同](../specs/09-inbox-lifecycle.md)。官方原包 SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`，三项资源直接提取/integrity 见 [manifest](../../../.ref/parity/09/runs/20261101-codex-inbox-lifecycle/reference/manifest.json)。

重要纠偏：包内 inbox chunk 是 Pages 提及通知，接口为 `/pages/mentions/inbox`，包含 account/user/notification_id 和取消信号；不是当前本地 turn_done/approval/automation 列表。仅能证明其自身身份/取消/失败反馈，不能据此放行本地 Activity 的布局、功能和数据源。notifications-runtime 也不是本地 storage 的等价实现。本批修复当前真实事件数据不变量，官方完整页面继续待研究。

## 改动与复用

- `inboxState.ts` 只承载被多处加载状态共同使用的恢复合并：合法历史过滤、按 ID 去重、当前状态优先、排序/100 条上限。清空/删除记录阻止迟到历史复活，全部已读应用于恢复历史，后续新事件保持未读。
- `App.tsx` 加载取消、状态驱动的 hydrated、读取错误/重试；加载期间记录清空/删除/全部已读，不覆盖早到事件。未知历史时禁止回写，空历史也进入已加载状态。
- 写请求通过 Promise 链串行化，避免旧快照晚完成覆盖新状态；失败提示可见，不阻断后续写。已有 500ms 防抖与 100 条保存上限保留。
- `InboxView.tsx` 显示读取错误和显式重试，未重写页面样式或过滤结构。
- Rust `desktop_state_set` 改用新增窄入口 `set_value_persisted`，复用已有 `persist_state_map` 原子临时文件/rename 逻辑，落盘成功后才更新内存。旧内部 set_value 调用保持原行为，避免扩大既有 Pin/Archive 等内部路径。
- 新增 Rust 隔离磁盘往返/失败测试，未访问用户真实 CODEX_HOME。无依赖、权限或新服务新增。

`desktop_state_set` 是公共入口，因此所有通过此 IPC 保存的偏好现在可能收到真实磁盘失败；现有调用方各自的错误展示不由本批全部改造。Rust 启动读取损坏状态的行为、退出前 500ms 尚未写出的快照与跨窗口写冲突仍有缺口。

## 验证

- `node scripts/verify-inbox-lifecycle.mjs`：IL01–IL06 通过，执行真实合并函数与加载/保存 effect，覆盖新事件、已读优先、清空删除、非法数据、卸载、读重试、连续写与失败恢复。
- `node scripts/verify-activity-inbox.mjs`、`npx tsc --noEmit`、`git diff --check`：退出 0。
- `cargo test --manifest-path src-tauri/Cargo.toml inbox_persistence -- --nocapture`：1 项隔离磁盘测试通过，证明读回、其他 key 保留、失败不改内存和清空往返；不等同原生 UI。
- 完整标准检查、全量 Rust 测试与构建日志见 [actual](../../../.ref/parity/09/runs/20261101-codex-inbox-lifecycle/actual)，最终退出码和源码/产物绑定以同目录结果文件为准。

最终结果：完整标准检查退出 0；全量 `cargo test` 92 项通过、0 失败；Release/MSI/NSIS 退出 0。七项绑定输入前后哈希一致。既有 Vite 大 chunk 警告保留，未配置独立 lint，不报告 lint 通过。

[本轮 EXE](../../../dist-artifacts/09-inbox-lifecycle-20261101/CodexNative.exe)：13,927,936 bytes，SHA-256 `289A9F74489B997DB3A11057DEB29E4A2C9E1AAC5AED36E65254292E5DB4177E`。[构建身份](../../../.ref/parity/09/runs/20261101-codex-inbox-lifecycle/actual/build-manifest.json)包含 HEAD、dirty 清单和输入哈希。该 EXE 未执行原生操作验收。

## 未验项与下一页

实际 UI 加载/错误提示布局、键盘、原生通知、审批状态关闭、重复运行事件身份、完整官方服务来源、配对像素和用户验收未完成。没有官方配对截图，不生成通过评分。此前浏览器控制连接超时，未把源码/VM 回放称为浏览器或原生通过。

下一主要单元为 10 Scheduled：已看到 CRUD 异常未捕获、请求乱序和快速操作单飞缺口，先取证再改。09 未标为完成，无提交/推送。
