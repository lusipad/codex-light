# 15A 归档列表与真实删除合同

日期：2026-11-01。修改前合同，整页未验收。

## 官方依据与边界

固定原包SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。
[trace.json](../../../.ref/parity/15/runs/20261101-codex-archive-actions/reference/trace.json)含五项原包文件hash/integrity、0-based UTF-16定位及片段。

- `data-controls-a74fa5345759.js:8961`：本地archived thread/list按cursor循环，每页100，updated_at，检测重复cursor；随后本地搜索。该固定本机包含codex-offline patch，因此不采用其离线吞错/缓存降级作为正常产品合同。
- 同文件`32611`：本地标题span，不以点标题自动恢复；明确取消归档按钮。成功提示含“查看”动作，恢复与导航分开。
- shared `2766898`：deleteArchivedThreads成功后才清理会话；官方data-controls区分unsupported删除错误。共享`2767776`恢复后加载失败仍抛错，不静默导航。
- `delete-archived-chats-dialog`：单个/项目/全部三种确认；中文“删除已归档的聊天？”、“这将永久删除已归档的聊天”、“取消”。本批沿用现有单个确认，原生dialog及批量另验。
- 当前CLI 0.165.0 schema含thread/delete、thread/unarchive，参数均threadId。不能把本地记录清除或thread/archive替代永久删除。

## 缺陷与本批范围

当前Rust thread_delete先清本地record，吞thread/delete错误再归档，最后始终成功；列表只拿首100条；标题点击会自动恢复且恢复失败仍导航；busyId state不能同步去重；刷新与写结果可交错重现旧行。

本批最小修复真实删除、全分页本地搜索、明确恢复后查看、同步写锁与过期列表。项目/云端筛选、排序、批量、完整官方布局独立保留，不将本批作为整页放行。

| 用例 | 预期 |
|---|---|
| AA01 | nextCursor循环至null，重复游标报错；失败不以部分列表冒充完整成功；过期/卸载响应不回填 |
| AA02 | 搜索过滤完整已加载列表；刷新、重试保留当前查询，不发server searchTerm伪装官方搜索 |
| AA03 | 取消删除不调用后端；快速重复/冲突写只派发一条链，失败显示并释放锁 |
| AA04 | 后端delete失败原样报错，不清本地record、不归档、不提示成功；成功后才本地清理 |
| AA05 | 仅明确取消归档执行恢复，成功真实重读列表，用户另点查看才导航；恢复失败不导航 |
| AA06 | 写成功使先前列表请求失效并重读；失败保留当前数据，刷新失败明确提示，不把未恢复项当成功 |

验证使用生产回调/真实隔离协议，无模型执行、不触真实用户历史。当前全局toast无动作插槽，本批在页面显示恢复成功及查看按钮作为功能落地，视觉待官方配对，不能称提示样式1:1。
