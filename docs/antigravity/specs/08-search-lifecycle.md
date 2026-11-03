# 08B 搜索缓存与请求生命周期合同

日期：2026-11-03。修改前调研，承接 `08-search-routing.md`；本文件本身不代表开发或验收通过。

## 基准与证据边界

只读提取 `C:/Users/lus/Codex/_internal/app/resources/app.asar`，SHA-256：
`17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。
这是**含 codex-offline 补丁的本地候选，不是干净发行基准**。不能由此证明官方当前账号 gate、干净版本运行时或像素表现。

原始四份 chunk、完整 SHA-256/包内 integrity 核验、定位片段保存于
`.ref/parity/08/actual/08B-research/`。四项 SHA-256 与包内 integrity 均一致。
所有定位均为**从 UTF-8 解码后的原始文件头计数的 0-based UTF-16 字符偏移**，不是行号。`manifest.json` 和各 `*.anchors.json` 可复核。

## 本地及 host 线程搜索

`command-menu-dialog-c95da71834af.js`：

- 28106：查询先 `trim`，`Pr(F,va)` 延迟值，45151 定义 `va=200`。本地/host 的远程线程搜索以这一 200ms 延迟值发请求；不是所有源统一 150ms。
- 28383：`queries:N.map(e=>...)` 每个 host 独立 query；key 为
  `["command-menu-thread-search", hostId, debouncedTrimmedQuery, maxResults]`。
- 同锚点：`queryFn` 内 `try { return await Xe(l,e).searchThreads(...) } catch { return [] }`，
  `enabled:j&&ae&&ie.length>0`，`staleTime:Ue.THIRTY_SECONDS`。
- **失败转成成功空数组发生在 queryFn 内**。因此不能据此实现“失败立即重开必重试”或“失败结果绝不缓存”并声称官方一致；按静态返回值语义，失败会得到与成功空结果相同的缓存值，并适用同一 staleTime。实际重新挂载是否自动刷新还受共享 query client 默认值、失效事件与运行时影响，尚未完整实测。
- 约28700：异步线程结果只有 `includeContentResults && debouncedQuery===trimmedCurrentQuery` 才合入当前结果。新查询输入期间旧查询结果不应当作当前异步命中。
- 33619：`Ki` 使用 `!isFetched||isFetching` 判定等待；`qi` 逐 host 提取 `data??[]`。没有 `Promise.all` 等所有 host 一起才显示的合同。

`app-shared-a906948d8868.js`：

- 2018973：导入 `lJt` 对应 `KP`，通过 `AppServerManager.forHost(hostId)` 取得宿主实例。
- 2623530：线程 store 实际发 `thread/search`，参数有 `cursor`、剩余 `limit`、
  compatible `sortKey`、`archived:false`、`sourceKinds` 和 `searchTerm:trimmedQuery`；
  按 `nextCursor` 继续填满 limit，防重复 cursor。没有 cwd 参数。
- 同函数把结果映射为 hostId/threadId/title/cwd/updatedAt/threadSource/searchPreview。
- 3273819：`THIRTY_SECONDS:3e4`。

**最短长度与模式不是同一个门槛**：
`app-initial-fd3c4b862660.js:7924081` 的 `bZo` 是命令菜单搜索计划，
7924680 定义 `EZo=2,DZo=3,OZo=9,kZo=9`：

| 模式 | 静态计划 |
|---|---|
| root | trim 长度 <2：无聊天搜索计划；长度2：计划存在但 includeContentResults=false，仅已加载聊天匹配；长度>=3：异步内容搜索，limit9 |
| chats | 任意长度均有计划；非空时 includeContentResults=true，limit9 |
| files | 无聊天搜索计划 |

当前本项目没有完整 chats 模式与 host 聚合。不能把 root 的长度3阈值无条件套用于所有聊天入口，也不能将本地 cwd 加入官方线程请求参数。可以在本项目缓存 key 中附加现有工作区上下文以隔离当前实现，必须注明这是本地实现约束。

## 文件搜索：两条不同路径

`app-primary-84ad97f06929.js:2086243` 的 `GEt` 为真正命令菜单文件入口；
导入 `LSe` 对应 initial chunk 导出的 `yTc`，不是仅凭 @mention 名称猜测关联。

1. **绝对路径及 `~/` 元数据查找**：key 为
   `["command-menu-file",hostId,resolvedPath]`，2086899 明确
   `staleTime:0,retry:false`。调用 `workspaceFiles.getMetadata`，仅 kind=file 命中；
   `~/` 依赖 host homeDirectory。错误行支持选中 `refetch`。
   这个查找的 retry 行**不能用于证明 fuzzy 搜索也有同样 retry 行**。
2. **普通 fuzzy 查询**：`GEt` 仅在 files 模式把 `trim(query)` 送入 `yTc`，
   root 模式传空字符串并显示“搜索文件”入口。
   `yTc` → `cTc` → `_Tc` → session controller，见 initial chunk
   10182050、10178020、10180323、10175551。
   本地普通 fuzzy 链没有 query cache key、30秒 stale 或150/200ms防抖；
   `_Tc` 对任意非空 query 调 `session.update(query)`。
   不应给它实现组件全生命周期的无限期 `(cwd,query)` 结果缓存并据此宣称官方一致。

本地 session 行为：

- 首次创建 session UUID，发 `fuzzyFileSearch/sessionStart`；query 更新发
  `fuzzyFileSearch/sessionUpdate`；卸载/controller或roots变化清理时停止 session。
- roots 身份由 `roots.join("\0")` 参与 effect；session 回调 token 不匹配立即忽略，
  防旧 session 回写。query effect cleanup 的局部标记避免已失效请求后续 update/错误写状态。
- server 不支持 session RPC 时退回 `fuzzyFileSearch`，
  `cancellationToken:"vscode-fuzzy-file-search"`；不能把此固定 token 当成所有宿主的唯一并发隔离机制。
- `_Tc` 在 controller/roots 变化时清空 response/loading，清理时清空 session ref/token，
  再等待 start 完成并 stop；空 query 清空响应且不请求。
- 本地 fuzzy 异常记录日志并结束 loading；源码中没有将异常转换为持久成功缓存，
  也未证明存在用户点击的本地 fuzzy retry 行。
- 结果带 query，controller 以 sessionId 过滤通知。这里未观察到严格逐 query generation 的全部保证；
  不应把本项目局部请求代次隔离机制描述为官方协议。

文件空查询显示最近打开文件（`GEt` 中取前10项），不是空 query 发 fuzzy。
`QEt:2090838` 的 Ctrl+P 入口读取当前选择文字作为初始查询，设置 files 模式；
files provider 是 exclusive，root 只是入口条目。

## 关闭、重开与不同来源

initial chunk `qjs:9038085`：关闭会 blur、结束搜索会话、清空 drill-in、设 root、
关闭菜单；主 close 包装还清空 query。普通命令入口打开默认清空 query，
携带 query 的入口按传入值打开；文件快捷入口随后设置 files。
线程 query cache 位于共享 query 体系，关闭组件没有就地清空该缓存代码；
fuzzy 本地 session 在文件组件卸载时停止。**这不等于已实测所有关闭时序与缓存存活时间**。

ChatGPT/Pages 使用 `recents` 内容搜索及各自错误/重试条目。command chunk 的
`wi:11712` 明确 `retry-chatgpt-search`；Pages 开启结果另有会话/路由身份检查。
它们不能用来证明本地 thread/search 或 fuzzy 文件查询错误必须出现重试行。
Cloud durable 文件另有 hosted query 与取消；本合同不移用其 stale/retry 到本地。

不同源独立完成可先显示的依据是独立 hook/query 和逐条 data 合并；
本项目把 thread 与 fuzzy 文件分开 Promise 回写是消除跨源等待的等价实现，
**官方 root 并没有把这两种异步搜索同时列出的既定合同**。本项目 root 是否应保留文件命中仍是独立差异，不能用本轮生命周期修复掩盖。

## 修改前用例与成功条件

以下 SB 是本轮可执行的生产 effect/生产请求链验证，不是已经通过的记录。

| ID | 操作 | 预期及证据范围 |
|---|---|---|
| SB01 | root 长度>=3搜索失败；相同 key在30秒内/之后重开 | 线程失败转空值的缓存也应有30秒上限；不能无限期冻结，不能把“立即重试”写成官方必需 |
| SB02 | 线程与文件并发，先只完成其中一个 | 本地实现已有并发源不因另一个 pending 而扣住结果；仅证明实现结果独立，不证明官方root包含文件结果 |
| SB03 | 完成文件查询，关闭后同 cwd/query 重开，文件已变化 | 本地 fuzzy 再请求，不复用永久缓存；最近列表/路径元数据独立待实现 |
| SB04 | 线程成功，同 key在30秒内重用、30秒后再次打开 | 旧缓存不能永久有效；30秒 stale 与强制精确轮询不是一回事 |
| SB05 | 查询A未完，改B或换cwd；A再晚到 | 旧请求不改变当前结果或当前loading，不能污染B上下文 |
| SB06 | 查询未完即关闭/切files；随后完成旧请求 | 已关闭视图与新模式不被旧结果回写；root/files的source范围另按08A回归 |
| SB07 | 空白、1/2/3字查询和200ms边界 | 线程按root/chats计划区分；本地 fuzzy任意非空，无无据长度2门槛或共享150ms timer |

## 本轮不能宣称完成的部分

干净发行包与官方运行时、共享 query client全部默认重试/GC/失效行为、原生WebView焦点和中文输入、
聊天/host/account gate、路径元数据和最近文件、root完整分组排序、截图/像素对照尚未闭环。
本地功能测试通过仅能支持相应用例，08整页仍不可标已验收。

## 本轮确定的实施范围（修改产品前）

- root仅提供“搜索文件”入口；`GEt:2086243` 内入口调用 `clearSearch()` 后切files，因此进入files清空查询，关闭后普通入口依旧清空。新增模式切换回调复用App既有mode状态。
- 本地线程root长度>=3才请求，200ms防抖，成功及catch空值均30秒stale；已加载聊天匹配长度至少2。暂不增加尚不存在的chats/多host能力。
- files任意非空查询使用真实sessionStart/Update/Stop，先安装通知监听再启动；明确不支持session时才回退原有单次搜索。空查询不请求，关闭/模式或workspace变化失效并stop；不引入永久query缓存。
- 文件和线程按互斥模式各自更新，不再有跨源Promise.all等待。原SB02改验模式切换后旧源不能阻塞当前源，而非保留官方没有的root并行文件命中。
- 扩充真实隔离协议探针和生产回调测试；不能以旧SB01立即重试或root并行源的初始期望反推官方行为。
