# 16.18C 资料库清理工作面：只读开发合同

状态：修改前调研完成，尚未开发。承接[16.18B配额](../acceptance/16-18B.md)；只读列表先闭环，删除、付款不在本批。不能把此前静态发现的POST接口泛化为所有列表的唯一读取路径。

## 固定证据

官方Store26.1027.3384.0、asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。证据 `.ref/parity/16.18/actual/16-18C-research/{manifest.json,anchors.json}`：2项资源hash、14段原文；所有偏移是0-based UTF-16，区间[start,end)。initial SHA `ba06de8c5418586b49ca7d639ea5ad2af531c1037454ec69b10b9ea11e00992e`，library-page SHA `7fed8c7f6ce7af6fa09b0643127fb1992e4594f88e07ead505ff3cab7a815843`。没有真实账号HTTP或同条件官方运行时截图，不作布局/像素通过。

## 路由、动作与数据

1. `kMs` initial@9339048：无directory、tab=all或images，且entry_point=settings或storage_cleanup=true才激活cleanup。仅`/library?storage_cleanup=true`仍是默认suggested，不足以激活。入口必须带明确tab。library-page@48383会在清除entry_point前用replace保留storage_cleanup=true。
2. `M8`@9348114将storageCleanup从实际browse参数中剥离。`rKi`@5709588：all无search/directory走`dKi` GET `/files/library/nodes`；images无search/directory走`_Ki` POST `/files/library`。不能仅新增POST操作后把all页称为闭环。搜索、目录、page-index分支另有条件，本批若未接必须明确限制。
3. `dKi`@5718253：nodes query包含entry_surface、parent_directory_id、cursor、q、categories、source、include_hidden_files、include_files、include_saved_entities、include_provider_roots、include_pages、defer_page_sharing_badges、defer_sharing_badges、enable_page_type_filters、include_sites、include_folder_counts=false、include_onedrive、hydrate_folder_thumbnails=true。字段依赖实际scope/gates；不强开pages/providers或猜账号资格。复用既有固定nodes操作，先对照其白名单和实际生成规则。
4. `_Ki`@5722283：普通images cleanup（无search/directory）categories=[image]、cursor取实际输入、limit50、include_saved_entities=true，无ranking、sort或order字段；source、allowlist、exclude_saved_responses等取真实浏览状态。page-index相关`uq/nKi`不等于images开关。完整参数原文见post-list锚点，不从旧假数据推导请求。
5. POST响应为items/cursor；`vKi`把file_name映射name、directory_id缺省null、kind=file，保留原字段，current_version_number缺省0。GET items已经为node；消费id/kind/name/parent_directory_id/library_artifact_type/file_size_bytes等，但静态消费者不能证明完整线上schema和全部必填约束。错误/未知结构不能伪装空列表。
6. `P8`@9353640初始cursor=null；getNextPageParam@9356975遇空cursor或已用cursor停止。前端追加页按node.id去重；账号/scope变更清页、取消晚到，错误保留可恢复状态。不得无限重复同一页。

## 排序与呈现

- `qMs/YMs`@9342726/9342877：cleanup未显式选排序时默认size desc，但仍受可排序场景限制。
- `ONs`@9359351从P8.data.pages取当前已加载页，`xKi`@5725468合并按id去重，再`Jjs`@9330266本地排序；调用@9361068。混合结果ANs@9362248亦走该排序。
- 导航根/目录优先；无大小、非有限或负大小排有效值之后，大小按方向，相同大小再按名称Collator。不能以简单全数组字节降序代替。
- **只对已加载页重排，不宣称服务器全库size排序，也不先伪造抓齐所有页。** 未发现cleanup专属全页预抓；滚动取下一页的共享UI阈值仍待追踪，开发前补定位。
- `tNs`@9343763：cleanup初始list；`nNs`@9343822：根images非deleted强制grid。`gMs`@9336292：cleanup切换视图只写当前scope临时偏好，不写普通账号持久偏好。退出cleanup后不能污染普通Library展示。
- 当前LibraryView.tsx实际仍是未连接占位；服务层已有nodes/favorites操作不代表这个页面已经读取。先真实列表/状态/分页与入口，再做有官方证据的结构校准；不把自建卡片当官方布局。

## 修改前验收用例

| ID | 操作与预期 |
|---|---|
| LCR01 | 从存储打开all/images清理入口；tab与cleanup状态正确，entry_point规范化后不丢cleanup。 |
| LCR02 | all调用固定GET nodes，images调用固定POST list；未知参数/任意URL被拒绝，真实身份与网络策略复用。 |
| LCR03 | 加载→空/有数据/错误→重试；错误不伪装空；离页、连接/账号失效即取消清旧，晚到不回填。 |
| LCR04 | 追加页有重复id时去重；cursor空或重复停止；失败可重试，不宣称未读页已覆盖。 |
| LCR05 | 目录、相同size、未知/负size及第二页更大项：只对已加载合并结果按官方比较器重排。 |
| LCR06 | cleanup list和images grid规则生效，改view不写全局偏好；返回普通Library保留原偏好。 |
| LCR07 | 隔离Rust传输→生产TS与组件回放、TypeScript/标准/原生包留证；官方同条件图/原生GUI未验不得打勾。 |

实现前仍需补：上层scope/身份上下文完整构造链、运行时gate取得路径、官方实际布局与控件合同。删除资格、逐项结果、软删不释放配额及永久删除读回沿用16.18B调研边界，另开有权限且需确认的后续批次，不在只读阶段展示假删除成功。

## 后续只读取证补充（尚未开发）

补充证据位于 `16-18C-research/extra/`：6项原始资源与asar entry integrity匹配，22条精确UTF-16锚点，另有notes.md。没有产品修改或真实HTTP。

- 普通/library路由Wa只添加entrySurface=library，不给includePages=true等能力默认值；同文件Si显式sources=[generated]、includePages=false属于独立/space/files scope，不能移植。
- M8的includeHiddenFiles=false、source仅在单一sources时取值；普通/library不强开includeSites。includeLibraryFiles来自真实vF门槛，_F要求身份/Statsig上下文就绪、gate224248639或layer3017902351.web_file_library_enabled允许，且真实wb.fileLibraryEnabledForRegistrationCountry不为false。错误/未完成须保持error/loading，不能将包内gate存在当已获资格。
- providers另受外部账号库存、账号可见性/hiddenProviders与GoogleDrive3001618585、OneDrive3583034603、iManage1509044249等gate影响。候选列表不等于本账号可用列表；上游身份与scope构造仍未全部追完。
- trash-banner Et@4119、分页渲染@9591共用list/grid sentinel：hasNextPage、总isFetching、fetchNextPage({cancelRefetch:false})，key为pages.length，不传rootRef/rootMargin。primary Awn@1632618使用IntersectionObserver，本路径默认viewport root、0px margin、threshold0；相交后disconnect再加载。无observer时直接触发；无下一页或正在fetch时不发请求。不得猜成“距底部300px”。
- 真实zh-CN keys：libraryNext.results.loading=正在加载资料库、failed/pageFailed=文件加载失败。、retry=重试、loadMore=加载更多、size=大小、tabs.all=全部、view.grid/list=网格视图/列表视图。settings.chatGpt.storage.manageStorage=管理存储空间、files=文件、images=图像只证明译文，不能单独证明当前设置页布局/入口绑定。settings.storage.cleanup的聊天清理译文不适用于云端文件。
