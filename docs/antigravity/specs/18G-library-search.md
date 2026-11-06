# 18G 普通资料库搜索：开发前合同

日期：2026-11-06。状态：固定来源调研、开发、完整标准与限定原生自验完成，待用户验收。只覆盖普通native根/目录，不把分类、provider、Pages和完整GridList计入本阶段。

## 已证来源与约束

Store26.1027.3384.0；同会话asar整包hash沿用6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074，本轮header SHA和直接条目integrity另核。来源与UTF-16定位见`.ref/parity/18/actual/18G-library-search/reference/manifest.json`、function-index及assessment。

- app-initial::dKi（5718247）使用现有GET `/backend-api/files/library/nodes`，普通native的q取search或省略空值，保留parent_directory_id、cursor和既有flags。搜索不能只过滤当前已加载行，结果仍遵循真实分页/权限/账号和取消。
- library-page::xa（36995）通过BrowseHeader提供搜索；输入变化replace当前导航并保留state/目录，不为每个字符push新的后退记录。完整App URL搜索路由尚未接入，本轮须明确内部状态与路由缺口。
- 当前宿主LibraryNodes已经允许q，无需新增后端operation或任意URL代理。复用现有ServiceIdentity/reader；cleanup/images调用不加入此搜索参数。
- 已直接核17资源integrity、24原函数、14实际中文与3字体CSS锚点。输入显示原始location search，scope parser才trim，因此只改前后空白不重读或清分页。普通native链无已证防抖/专用IME处理，不添加其他分支的计时器。
- 搜索replace保持原preview state、request及首次returnLocation；修改搜索不关闭或重读文件，close返回原位置。根唯一h1为“资料库”或“搜索”，目录唯一标题为面包屑；24px/500/1.2，搜索32px高、基础240px，容器小于768px换行，不用13px根字号误算rem。
- 搜索无文件为“未找到文件”；普通根空态为“创建新内容”及原说明，普通目录为“此文件夹为空。”。当前未实现上传资格分支，不造上传按钮来填空态。

## 本轮验收合同

1. 客户端根/目录请求正确传q，分页保留同一搜索词与目录；清空后省略q，不改变images通道参数。
2. 搜索改变立即取消旧列表/分页，清旧cursor与错误；旧输入回调、旧分页、晚到响应及账号换代不得写入新结果。路径错误不冒充搜索无结果。
3. 真实搜索空结果和普通空目录分开记录；服务失败可见/可重试，同一搜索词不因重试丢失。进入目录、祖先/根、标题栏前后退的搜索保留/清理按补证执行，禁止凭印象决定。
4. 输入框及清除的真实中文、尺寸、焦点、输入时序和IME边界先原文取证再开发。普通native未证防抖，不套用其他搜索的175ms或任意300ms计时器。
5. 先写请求与组件生命周期回归锁定缺陷，再开发；实际React宽窄截图、生产类型/构建及必要原生检查留证。官方配对像素、真实账号搜索和物理IME缺失时明确未验，不能据此宣称整页完成。

## 发行与开发边界

preview.5已锁定b45727a的此前阶段，当前18G开发不计入该标签。无新增依赖或真实账号HTTP；PDF依赖选择、snapshot内部云端聊天目标页仍各自未完成。

## 当前实现及回归边界

复用现有LibraryNodes的q白名单、固定reader和导航/预览状态，未修改Rust或增加搜索代理。目录入口清空搜索，面包屑优先恢复当前身份保存的返回查询；前后退分别恢复原始输入。搜索替换保留文件请求及首次returnLocation。输入在重新校验资格期间保留，确定无资格时隐藏。

真实红绿锁定两项持续加载缺陷：仅空白不同的预览返回不得取消有效列表；根目录身份兜底切换必须递增读取revision。证据见verification/return-space-red、identity-root-red与对应green；所有原始失败保留。

实际组件隔离浏览器已验证跨页搜索、原始空白与归一查询、分页、目录/历史、空结果、失败重试、晚到请求取消、预览返回、清空焦点、连续输入及身份资格。1280×800搜索240×32、13px；640×800标题与搜索分行，无横向溢出。截图是含夹具控制条的JPEG，非官方配对图。独立Tauri文件来源夹具实测中文输入/清空后直接输入和Tab顺序；读取器为显式内存，不代表生产认证HTTP或物理IME。结果与输入哈希独立记录。
