# 16.18B 云端配额与后续Library清理合同

状态：修改前调研合同，16.18B总配额增量现已实施（见阶段验收记录）；接续16.18A，先真实配额，再Library清理工作面。原始取证归档于 .ref/parity/16.18/actual/16-18B-research/，14项原始资源与21条UTF-16锚点已复验。

## 固定基准与证据边界

已从本机官方 Store `26.1027.3384.0` 只读提取；原包 SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074` 与既有 manifest 相同，所有新 raw 与各 asar entry integrity 匹配。`manifest.json` 保存绝对来源、大小及 SHA；`anchors.json` 是 UTF-16 片段定位。没有账号 HTTP、模型任务、用户配置写入、运行时/像素验收。

**跨版本关键差异**：原16.18A引用的是有已知offline补丁的旧包17e75c... 的 `storage-settings-6f17def9c29b.js`。当前固定 Store 包没有这个 chunk；本次扫描所有 webview/assets/*.js，`settings.chatGpt.storage` 仅命中语言包和搜索索引，没有设置页真实消费实现。新包仍有独立配额query、Library配额warning和cleanup路由。因此不能把旧设置页的逐项统计和布局宣称为新包已定位的实现；也不能因新包没有该chunk推断此页运行时被删除（可能按需交付，待实测）。

## 已证实且可直接推进的真实功能

1. 云端配额读取：initial `OLr` @4638459 调用 `M_.safeGet('/files/library/storage/usage',{})`，身份query key为 `['4231797315',accountId,userId]`；staleTime=0、refetchOnMount='always'、retry=false。`M_` @1839306 是带 `getAdditionalHeaders:A_`、`getRequestSignal:jmt` 的服务客户端，不是 app-server RPC。宿主现有固定服务操作和真实账号身份/代次、取消、headers 可复用；新增一个固定 GET `/backend-api/files/library/storage/usage` 服务操作，不开放任意路由。
2. 已证实响应 consumer 字段：`used_bytes`、`allowed_bytes`、`remaining_bytes`、`is_over_limit`、`limit_tier`、`plan_type`。没有找到新包的分类count/分类used_bytes消费，不能猜 breakdown schema；只给真实总额和比率，不伪造文件/图像统计。服务返回不符合期望时为显式schema错误，不回填0。
3. 阈值：initial `yLr` @4637472（准确位置以anchors片段为准）、Library `Aa` @41307：is_over_limit 或 remaining_bytes<=0 => full；allowed_bytes>0 且 remaining_bytes/allowed_bytes<=0.1 => almostFull；其余正常。Library banner gate 需 `2767344663 && 4231797315`，`ka` @41142。配额 query 本身没有这个双gate enabled 条件，不将banner gate误当API全局权限已证实。
4. 管理行为不等于一键本地清理：initial @4645837，上传配额对话框使用恢复内容的manage URL，缺省按模式去 `/library` 或 `/space/files`；Library banner manage 则去 `/settings/storage`。当前新包 cleanup route 真正消费 `tab=all|images`、无directory且 `entry_point=settings` 或 `storage_cleanup=true`；默认list、size desc（images仍强制grid），改view仅作用当前cleanup scope、不改全局偏好。可优先接现有 Library 页面为清理入口，**在未实现这些语义前不能把普通Library跳转叫管理合同已闭环**。
5. 升级资格：Library `Da` @40928：limit_tier free 仅plan_type free/free_workspace；或 limit_tier go/plus/prolite。还依赖运行时升级能力 `_r` 与 In(...)。不能仅根据套餐展示有效升级按钮，不能编造付款流程。

## list/delete 已找到的后续合同

- list（后续分支复核见[16.18C](16-18C-library-cleanup-read.md)：all根列表走GET nodes，images根列表才走以下POST，不能泛化）：initial `_Ki` @5722277，POST `/files/library` requestBody实际含cursor、limit50、q、categories、source、include_hidden_files、include_pages、exclude_saved_responses、include_saved_entities、include_sites、trashed_only、ranking等，由场景/真实gates决定；响应 `items`/`cursor`。既有 `LibraryNodes` 是GET目录节点，并不等于全存储清理POST列表。
- native file 单删除：initial @9730488 DELETE `/files/library/files/{library_file_id}`，query `file_id,parent_directory_id,file_name,soft_delete:!permanently`；要求响应success为true。
- native directory 单删除：同一分支 DELETE `/files/library/directories/{directory_id}`。Site、saved entity、page、space走不同分支，不可统一映射成file删除。
- 软删除批量：@9732715 POST `/files/library/files/delete-batch`，最多25一组；body.files包含library_file_id/file_id/parent_directory_id/file_name；返回files逐项 success、library_file_id；部分失败必须保留未删除项，不能用HTTP200当全成功。
- 资格：`I5`要求非pendingResponseFavorite、非space/page、非hq、provider=native、非mounted、非pQs。`iQs`还检查saved_entity/snapshot/site特例；永久删除 `P5` 另有规则。必须先补其provider/共享/mounted权限语义，不能按id前缀轻率放行。
- empty trash：`library-empty-trash... q` @3639，DELETE `/files/library/trash`，返回deleted_count/failed_count；pages/spaces各有独立分支，Promise.allSettled聚合，失败或部分失败保持对话框，真实用户确认不可逆删除。当前不建议这批同时实现。
- 数据复读：initial `X$s` @9734754；永久删除使quota key ['4231797315']失效，软删除不是立刻释放配额。批量逐项更新+重新读取；不能软删除后用本地减法伪造配额变化。

## 下一批建议及验证

优先16.18B：真实账号绑定配额GET、初始加载/失败重试/账号变更清旧状态、总额/满额warning；保留分类和升级缺口的真实说明。按当前已有ServiceOperation/ChatgptService客户端结构加入，复用身份和取消机制，无新增依赖。测试真实Rust service构造传输fixture→生产TS parser/UI，覆盖0 allowed、超限、10%边界、非数字或负值、账号/代次变更、晚到取消、离页与重试。固定API方法路径headers、请求无任意URL。可直接构成有用户价值的阶段，不继续留在未连接占位。

之后独立推进[Library storage_cleanup只读工作面](16-18C-library-cleanup-read.md)：all GET nodes / images POST list、已加载页本地size desc/临时视图scope、空/失败/重试、分页、只读文件能力，再有权限的软删除→trash→永久删除真实复读。不要同一轮混入所有pages/spaces/sites删除，避免再次陷入单功能长尾。

修改前产品映射：StorageSettings.tsx仅未连接提示，chatgpt_service.rs尚无StorageUsage；16.18B已补固定GET与真实总额消费者。集成时复核发现LibraryView.tsx仍为未连接占位，虽然共享服务已有LibraryFavorites/LibraryNodes操作，但未接该页面；不能把服务操作存在当成页面已读取，也没有cleanup排序或删除资格。官方像素、当前设置页实际chunk、response完整schema/分类分组、新包升级能力运行时和原生管理入口都仍待证。
