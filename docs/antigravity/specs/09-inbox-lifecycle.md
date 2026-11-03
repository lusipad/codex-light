# 09A 本地活动持久化合同

日期：2026-11-01，修改前建立。范围是当前真实协议/调度事件产生的本地活动数据，不把它当作已确认的官方 Inbox 全页。

官方包 SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`；本轮三项资源 integrity 见 `.ref/parity/09/runs/20261101-codex-inbox-lifecycle/reference/manifest.json`。

`inbox-adea90c576b4.js` UTF-16 偏移约 1184–1912 包含 account/user 身份、AbortSignal、notification_id 与 `/pages/mentions/inbox`，说明这是 Pages 提及通知，不能用来证明本地 turn-done/审批/自动化列表。notifications-runtime 是另一远程通知流，也不等同于本地存储实现。已知官方行为边界为避免旧账号/已取消操作污染并显式报告标记失败；未实测本地 Activity 的完整入口、分组和服务。

本地源码已确认：加载 `setInboxItems(saved)` 会覆盖读取期间的新通知；empty/read fail 只更新 ref 不触发保存 effect；多个 set 请求可能并发；读写错误静默丢弃。

| ID | 输入/操作 | 预期 |
|---|---|---|
| IL01 | 读取期间接收新事件 | 合并历史与当前，当前同 ID 优先，不重复、不丢已读变化 |
| IL02 | 读取期间清空/删除/全部已读 | 迟到历史不得复活已清空/删除记录；全部已读覆盖当批历史 |
| IL03 | 空历史、非法条目及超长记录 | 仅恢复合法条目，去重按时间排序，最多 100 条；空历史也完成加载 |
| IL04 | 读取失败/卸载后迟到 | 失败可见并可重试；未知历史期间不写回；卸载结果无效 |
| IL05 | 连续状态写回 | 按序调用真实 storage，晚完成旧写不能覆盖新快照 |
| IL06 | 写入失败后再次修改 | 错误可见，后续写不被 rejected Promise 阻断 |

验证使用生产函数/effect 的可控 IO，不接真实账号数据。官方 Pages 服务接入、真实磁盘往返、原生、截图及用户验收不在本批自动通过范围内。
