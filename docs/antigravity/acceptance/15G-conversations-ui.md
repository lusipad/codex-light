# 15G-A ChatGPT 会话归档 UI 增量

2026-11-06。状态：生产组件隔离回归通过，等待数据模块落盘后的类型核验、主线程浏览器/原生及用户验收。不是完整云端归档或像素验收。依据 [15G来源和开发合同](../specs/15G-archive-eligibility.md) 第6–7节。

后续主线程已完成类型、完整标准、宽窄浏览器及限定原生自验，终态与构建绑定见[15G整合记录](15G-conversations-read.md)；下面保留UI专项执行范围，用户与像素验收仍未完成。

## 实施

ArchiveView新增type-only `conversationArchive?:ArchivedConversationsState`。local、cloud-task、chatgpt-conversation在同一设置投影按项目分组、三排序与搜索，row key包含source+id，不合并跨源相同ID。global保持旧工作面，local类型不显示新来源状态或故障。

conversation仅用gizmoId与本地实体`SidebarLocalProject.id`精确相等归组，绝不按serverProjectId、assignment/projectless、cwd/hint、名称或环境猜测；不为legacy workspace.id制造Gizmo关联。可信匹配不存在时无项目。排序用数据模块按官方Date.parse处理的秒值，显示单独使用raw displayTime（数字秒或日期字符串），chosen日期无效不回退。不会向原conversation增加archived字段冒充task。

会话与任务各有独立加载、错误、后续页错误、重试和加载更多（offset=0仍为非null下一页）。一个来源失败保留其他来源成功项；denied明确无权、不当作成功空态或0计数。只在未传conversation来源时保留原“尚未接入”兼容提示；实际传入后说明当前账号资格和仅已读页范围，不无条件宣称来源未接入。

官方标题是内部`/c/<encoded id>`导航；本项目缺完整ChatGPT会话工作面，本轮标题保持非链接且页面/tooltip明确未接入。没有调用系统浏览器、selectThread或导入Codex会话。恢复/删除为只读disabled，无本地mutation handler；本地全删、恢复与确认仍只作用原完整本地列表。

## 实际自动检查

新增 `scripts/verify-archive-conversations-ui.mjs` 执行整生产组件，保留Object.is memo依赖缓存。先真实红灯CV01（预期2条会话、实际0），实现后CV01–CV07通过；另denied+任务空真实红灯后修复，防止权限拒绝被当空成功。

- CV01–CV07退出0：同ID三条、gizmo精确实体归属且server ID拒绝猜配、conversation不受本地projectless/assignment冒认、跨源数据更新memo重排、无导航/本地写、task/conversation双向失败隔离、cursor与offset独立按钮/重试、denied无伪空计数、global隔离。
- 原AC01–AC08、AS01–AS10、AA、AB、archive service、ARS回归持续适用；本轮已跑AC/AS/AA/AB/ARS退出0（ARS含当前生产设置接线）。
- 初次tsc因并行数据模块尚未落盘报TS2307及推断any，不属于通过；最终结果待下方补记。

没有真实HTTP、账号操作、模型、恢复/删除、Cargo/全库build、Git操作或新依赖。隔离UI测试不代替数据层资格、分页或换号生命周期回放。

## 剩余差异

内部ChatGPT工作面和标题路由、云端恢复/删除、官方Fuse搜索与markdown标题清理仍未实现；资格与服务结果依赖可信数据层。图标复用现有lucide，来源状态/只读提示为明确兼容呈现。无官方同环境截图配对，视觉score=null；浏览器/原生和用户验收另记。

最终类型补验：`archiveConversations.ts`实际落盘后，主UI负责代理重新执行 `npx tsc --noEmit` 退出0；CV/AC/AS与archive-service再次退出0。此前等待模块的TS2307已解除，没有吞错或填临时类型。
