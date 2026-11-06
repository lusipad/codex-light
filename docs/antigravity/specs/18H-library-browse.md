# 18H 普通资料库标签与网格/列表：开发前合同

日期：2026-11-06。状态：普通native核心合同已实现，限定阶段自验完成，未获用户验收。承接[18G搜索](18G-library-search.md)。目标是恢复普通native浏览工作面，不以cleanup表格或仅更换显示按钮代替官方正常页面。结果与限制见[18H验收记录](../acceptance/18H-library-browse.md)。

## 固定来源与已证差异

Store26.1027.3384.0；同goal完整asar SHA256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。当前header及相关条目integrity重新核对，证据归档`.ref/parity/18/actual/18H-library-browse/reference/`；原函数定位均为0-based UTF-16。实际账号、官方GUI与配对像素尚未取得。

- Ga仅在非deleted、无规范搜索且根目录时显示ya标签。顺序suggested/favorites/folders/images/all；favorites另需experiment3333071866的enabled为true。普通Wa未强开includePages，不套用Space/shared Pages门槛与控件。
- 当前根始终读取all并显示名称/类型/大小表格，与官方默认suggested、默认grid及name/date/size列表不同。不能将既有cleanup的size desc默认排序套到普通browse。
- rKi：搜索、目录、all、folders使用dKi固定GET `/backend-api/files/library/nodes`；root suggested无搜索使用_Ki固定只读POST `/backend-api/files/library`及ranking=suggested；root images无搜索同POST但categories=[image]且无ranking。不得用本地加载页过滤冒充服务端推荐/分类，不开放任意URL或通用POST。
- 普通布局偏好D8按JSON.stringify([accountId,userId])隔离，key前缀`library-display-preferences:`；默认grid，root images强制grid且隐藏切换。未取得userId时官方仅内存，不使用全局跨账号持久值。切换只影响布局，不应重读文件或清除预览。
- 普通默认sort=null，保留真实聚合顺序。表头name首asc，date/size首desc，再反向，再null；sort为scope内存而非display持久设置。普通native搜索、favorites/recent/deleted禁用排序。目录/navigation root优先，坏size置尾，同值按name。日期字段与精确归一规则须补证后实现。
- 标签选择清目录、搜索、categories、sources并保存lastTab。原始输入、历史及首次预览返回合同继续适用，不能因增加标签破坏18E–18G行为。

## 已补证的实施边界

完整assessment与原函数锚点已落盘；中文suggested实际为“推荐”。POST响应为file-info条目，经vKi转换为node{name:file_name,kind:file,parent_directory_id:directory_id??null}并保留currentVersion/lastUsedAt，现parseLibraryImagesPage已有同形状转换，不因函数名而只保留图片。folders根include_files=false，目录/搜索即使tab=folders仍true。普通五分类使用images/documents/spreadsheets/presentations/pdfs原字符串；sources选0或2个为null，选1个原样uploaded/generated，不改写分类为单数。root images无搜索的POST是例外categories=[image]。

新增固定只读`library_suggested`，宿主POST `/backend-api/files/library`，固定limit50、ranking:suggested、include_hidden_files:false、include_saved_entities:true、include_sites:false、trashed_only:false；可变仅cursor、categories和source。root无搜索故q省略，无Pages/allowlist/未知provider扩权。本阶段只接native范围，providers固定空数组，不假造已连接外部账号；其他provider/Pages保留缺口。非法method/url/body/固定旗标等在鉴权前拒绝，身份/网络/401一次重放/取消沿现有固定只读服务，并显式检查晚到取消；images旧合同不变。

排序日期按Qjs：modified取updated_at??file_upload_time；suggested仅在lastUsedAt较新或原日期无效时取lastUsedAt。无效日期保留未知，不造今天。size列只在mMs允许的普通all无搜索/目录出现；date列保留对应kind标签。JMs控制排序，deleted虽然可能有size列仍禁排序，不能将两条件混淆。

官方display底层W_/H_为host注入persist callback，未证实直接localStorage写；本项目可用自身WebView存储实现身份隔离及重开读回，须注明内部序列化适配，不能称官方同格式。完整URL/library显式路由与sidebar lastTab选择仍需区分。

## 开发顺序及验证目标

1. 补齐各标签请求与响应归一、实际中文、默认lastTab、分类控件与样式。取得完整原始函数后才开发对应分支。
2. 为默认推荐固定只读reader、身份/取消/401/分页和非法参数写回归；保留现images/cleanup和nodes语义，不增加依赖。
3. 实现正常标签、身份隔离显示偏好、网格/列表及有证据的排序与卡片；保留目录、搜索、预览、失败重试和晚到隔离。
4. 真实组件宽窄、键盘/焦点、布局切换不发请求、排序不增删条目、身份重开偏好隔离留证；统一类型/标准/原生构建后提交阶段。

## 不得冒充完成的范围

selection写操作、外部provider/Pages、完整URL路由、PDF/Office等完整预览矩阵、真实账号服务、官方同环境像素、物理IME和用户验收保持在缺口清单。既有preview.5不包含18G或18H。

## Header及图像缓存补证

`reference/header-placement.md`保存xa→browseM→searchablexe完整调用链：标题右侧工具栏顺序为已选筛选标签、筛选/模式、搜索、页面动作；根标签独立下一行，不将筛选/模式固定放在标签旁。容器小于768px时标题占完整首行，再换行整个工具栏。`header-placement-anchors.json`记录完整定位与CSS来源，不用猜测的CSS order改变顺序。当前实现已据此重排；官方吸顶/折叠仍未完成，长列表滚动实测标题移出视口，不能因静态结构接近而标像素通过。

原始图像asset的p/m函数见`reference/image-cache-supplement.json`：图像缓存modifiedAt仅取file_upload_time，不能套用列表排序的updated_at回退；truthy version可替代modifiedAt。卡片source另外绑定updated_at。相同节点后页更新file_id/时间时，旧bytes应取消并隐藏，晚到事件不能显示为新图。

根images无搜索清分类但保留来源，folders无搜索清分类与来源。规范化应用于搜索清空、过滤变更、历史和预览返回，不能只处理标签点击。筛选/搜索无结果使用实际中文“未找到文件”，不显示默认创建空态。
