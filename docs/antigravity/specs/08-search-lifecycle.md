# 08B 搜索缓存与请求生命周期合同

## 08I 显式文件夹范围

固定 Windows Store `26.1103.4239.0` 的 `async__596785.beac9065c9.js` 在 UTF-16 偏移 5882（`JM0a`）按主机和项目根列表保存范围选择，目录范围仅应用于非 root 文件搜索。144187、145960 和 147860 分别定位触发器、恢复项目范围与目录选择回调。当前中文包 1272877 起提供「选择文件夹…」「选择要搜索的文件夹」「在 {folder} 中」等文案。

- 项目范围菜单可以恢复默认项目根或选择单个本地文件夹。取消、关闭时迟到结果和项目切换不得污染新范围；成功选择保留输入词并切换所有文件来源。明确选择项目外目录不会将它加入项目。
- 本地实现复用 Windows 原生文件夹选择器。当前阶段保持 08H 的默认绝对路径约束，并复用文件树显示目录。官方自定义目录选择器、远端 host 和默认范围外的绝对路径另验。

## 08H 同项目多根文件搜索

固定 Windows Store `26.1103.4239.0`。`async__596785.beac9065c9.js`（SHA-256 `0007303e0586b98fbe597296f424f21a42498eaeb5cd2be1c6ec90598c021f69`）在 UTF-16 偏移 154100 附近把根列表交给模糊搜索及绝对路径判断，157729 附近将结果归属的根传给工作区打开动作。151875 为最近文件合并，根数大于一时带根目录标签。`early-bootstrap-339-ce026819bf837ba7.js` 的 953932 遍历每个根并按时间汇总。

- 复用现有工作区归属结果。同一项目的根参与模糊文件、最近文件和绝对路径查询。独立项目及不明确的归属保持现有隔离。
- 多根结果显示所属根和相对目录。文件继续走现有预览，目录在所属根展开。查询期间改根列表应取消旧请求并隐藏旧结果。
- 本阶段保持已有绝对路径范围约束及本地 host。官方全局范围选择和独立目录标签待单独验收。

## 08G 持久化最近打开

官方 Windows `26.1103.4239.0` 的 `async__182735.bb2cb0d2af.js`（SHA-256 `ab463aa100bbd1c6306d7b32c9de911db22d9bd03ee7a30f844e32d0069916ce`）在 UTF-16 偏移 4787298 定义 `recent-workspace-files-v3`。记录以主机、聊天、路径为键，按 `updatedAt` 保留 100 条，查询按主机和路径范围过滤，删除标记屏蔽旧记录。7823993 定位持久化更新。当前实现使用现有本地桌面状态，首页文件访问使用空聊天 ID。原生预览与保存仍是记录来源。

- 新进程应读回真实的访问时间，并与磁盘 mtime 合并。冷读只返回当前工作区仍存在的普通文件，识别官方删除标记。未确认的访问不写盘，损坏容器不被覆盖。
- 本阶段处理本地文件和已存在的删除标记。远端主机接入、官方模型补丁新增删除标记、多根投影另验。

## 08F 合并磁盘最近修改

基准 Windows Store `26.1103.4239.0`。`early-bootstrap-199-e3316cddb4ea6a6b.js` 的 4420238 连接 `recentFiles` 服务，`early-bootstrap-339-ce026819bf837ba7.js` 的 953932 定义扫描，949870 前为排除目录。官方使用 `rg --files --hidden --no-config --no-follow --sortr modified --null`，保留 ignore 语义，每个根取 20 个候选并以文件 mtime 复核，30 秒超时。`async__596785.beac9065c9.js` 的 150954 和 151875 定位按范围读取、按时间合并、去重取 10 条、显式重试。

- 仅在空查询 files 模式扫描活动本地工作区。按磁盘 mtime 与已打开记录的访问时间共同排序。保留隐藏文件和 ignore 语义，跳过生成目录、目录本身和符号链接。
- 输入查询、关闭或切工作区时取消扫描。旧结果不覆盖当前菜单。读取失败保留打开历史，并提供显式重试。现有安装可以复用 CLI 同目录或 PATH 中的 ripgrep，缺失时走错误路径。
- 本阶段仍采用单个活动工作区。远端 host、安装器自带 ripgrep 和重启后的打开历史另行核验。

## 08E 空查询显示最近打开的文件

当前固定 Windows Store `26.1103.4239.0` 的 `async__596785.beac9065c9.js` 在 UTF-16 偏移 150954 读取 `workspaceSearch.recentFiles`，151550 附近另读打开历史，151875 合并并按 `updatedAt` 倒序去重取 10 条，154019 定位去重和比较。选择行使用同一个文件打开入口。该 chunk SHA-256 为 `0007303e0586b98fbe597296f424f21a42498eaeb5cd2be1c6ec90598c021f69`。本阶段接入真实打开和保存记录，使用当前中文资源中的「最近打开」及「输入文件名进行搜索」。磁盘最近修改来源与重启历史另行取证。

- 空查询只在 files 模式显示当前工作区最近打开的文件，按成功打开或保存的先后排序。目录、失败预览、旧工作区迟到响应及后台刷新不登记。
- 最近项去重并最多显示十条，包含相对目录。非空查询继续走原有 fuzzy 或绝对路径分支。选择最近项复用真实预览，切工作区不会展示其范围外文件。

## 08D 当前官方绝对路径查询

沿用下方 08C 已核对的 Store `26.1103.4239.0` 原包。定位使用 UTF-16 偏移。

- `async/596785.beac9065c9.js` 153600–157510 处的文件提供器把绝对路径和 `~`、`~/` 交给 metadata 查询。显式目录范围会限制查询目标，模糊搜索收到空查询。不存在归为无匹配，其他错误显示可选择的重试项。查询无自动重试，结果包含文件和目录两种，目录选中时带类型传给工作区侧栏打开函数。此前 08B 对旧候选仅记录文件，当前包明确包含目录。
- 简体中文见 `async/1561.0f4c0bdc0f.js` 2447609、2447698、2447752，分别为「正在检查文件…」「无法检查路径。选择此项以重试」「未找到匹配的文件」。
- 项目沿用当前文件搜索的活动根范围。以本机 Tauri 路径服务解析 home 与规范化路径，再用真实 `fs/getMetadata`。隔离 CLI 探针确认缺失路径返回 `os error 2`，文件和目录分别用布尔字段区分。选择文件走现有预览，选择目录展开已有目录树并保留编辑器内容。宿主与 UI 适配不扩大到多 host 或新增全局目录入口。
- 验收覆盖普通相对查询、绝对文件及目录、home 解析、越界和路径前缀混淆零探测、显式重试、查找前后切查询或工作区、关闭后迟到结果、键盘选择与真实路径读回。官方成对截图与原生目录标签表现单列。

## 08C 当前官方文件搜索快捷入口

Windows Store `26.1103.4239.0`，asar SHA-256 `fb47d6491dc3006b708cb1e14de479b882bf50f88b7daa81818f154c253266aa`。原包以包内 integrity 校验后只读提取，证据在 `.ref/parity/08/actual/08C-selection/`。以下是 UTF-16 偏移。

- `async/596785.beac9065c9.js` 157729 起的文件搜索命令用 `rH(scope,"files")` 生成初始查询，随后直接打开 files 模式。快捷键和原生命令消息共用此入口。
- `async/182735.bb2cb0d2af.js` 4087185 起的选择读取优先使用焦点输入控件，排除密码，去掉首尾空白，拒绝空、多行、含 NUL 或超过 256 UTF-16 单元的选择。DOM 选择的两端都要在焦点范围。4087785 起的模式种子读取会回退同模式上次种子，并在菜单打开时避免把菜单自身的选择当作外部选择。
- 在本地快捷键和菜单动作共用的入口同步获取选择，在首次 files 查询前注入。复用现有 fuzzy 会话、快捷键分派、关闭和回焦。验证选中的中文路径片段进入首个更新，拒绝不合法选择，菜单内 Ctrl+P 不把输入框选区当外部选择；从 root 点「搜索文件」仍清空，普通 root 入口仍从空值进入。
- 本阶段覆盖原生 HTML 输入与 DOM 选区。官方定制编辑器的选择提供器和失焦缓存另行取证，原生按键与同条件像素待运行验证。

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
