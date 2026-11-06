# 18H 普通资料库浏览阶段

日期：2026-11-06。状态：限定浏览功能、组件及原生未登录子范围自验完成，待用户验收；不是整页1:1完成。[开发前合同及来源](../specs/18H-library-browse.md)。

## 修改与复用

- `libraryBrowse.ts`、`libraryBrowsePreferences.ts`及`LibraryBrowseLayout.tsx/.css`实现普通推荐/文件夹/图像/全部、五分类与来源、账号/用户隔离显示偏好、真实高度瀑布流和三态本地排序。默认推荐/grid/无排序，图像强制网格不覆盖保存偏好。
- `LibraryView.tsx/.css`和`libraryClient.ts`接现有真实reader、搜索、目录、历史、预览、身份及取消；推荐使用新增固定只读宿主`library_suggested`。`chatgpt_service.rs`与前端操作联合类型仅增加该固定操作，没有任意HTTP代理、写链或新依赖。
- 新两组browse回归接入标准和发布入口；既有read脚本仅导出原client夹具供复用，服务脚本调整真实reader/布局装配，保留原有断言。排序复用导航根识别，图片复用现有真实bytes路径，不造Office/PDF正文。

## 来源与证据

证据根`.ref/parity/18/actual/18H-library-browse/`。官方固定Store26.1027.3384.0；完整ASAR SHA-256为`6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`，本轮完整流式核验一致。21参考条目integrity、81完整函数锚点和86中文定位；偏移为0-based UTF-16。Header及图片缓存另有原函数补证，不把静态gate当作当前账号资格。

- 宿主新增4项修复前失败→修复后通过，原library只读5项通过；非法URL/method/flags/ranking等鉴权前拒绝，固定limit/providers，原images正文保持一致，复用同身份401及网络边界，显式阻止晚到取消。没有真实账号HTTP验证。
- 360个生产排序结果对当前官方提取函数比较一致；fixture适配位置另行标明。默认顺序、目录优先、坏日期/大小置尾和三态循环均有回归。
- 最终64组前端发布回归退出0；独立复核browse UI、search、browse core、navigation、cleanup与diff检查退出0，无新增确定阻断。三个复核发现的状态缺陷及Header/aria标签均保留先红后绿记录。首次跨realm fixture断言和一次并发资源不足导致的Node内存失败另记，不冒充产品红例；最终串行类型检查通过。
- 实际React组件浏览器1280×800/640×800：清空搜索隐藏分类清除、筛选空态、菜单Escape及焦点、三态排序无额外列表请求、图像强制网格后恢复list、A重挂与A/B偏好隔离、6页18条、3张有效64×64 PNG解码、长文件名及窄窗无横向溢出、搜索预览返回保留查询均留证。`browser/browser-result.json`保存DOM调用证据，`sort-result.json`保存实际排序；最终截图是原始JPEG，夹具显式内存reader且CSP connect-src none，不能代替HTTP或官方像素。
- 当前组件bundle另在既有独立Tauri/WebView2 file-origin夹具验证菜单开关、Escape、可见焦点环和中文Unicode输入。`native-component-inputs.json`绑定当前bundle及夹具二进制；UIA focused_element返回RootWebArea且树更新不可靠，采用截图可见光标/焦点环与实际输入结果，不能单凭UIA宣称原生焦点完全通过。此项不是当前生产EXE认证路径，也不是物理IME选字验证。

完整非Fast标准实际执行321段、32个协议探针，原始退出码为1：C盘耗尽后，首个失败为schema写入OS112，其余出现ENOSPC。其余301段已通过。保留`standard.log`及`standard.exit=1`，没有将其改写为0；20个失败目标随后在源码未变条件下全部取得通过结果，见`standard-resolution.json`。其中19项在私有D盘临时目录通过；外部导入在仓库内D盘fixture得到空发现结果，保留该失败，恢复原C盘临时目录后同断言通过，具体发现排除机制未证实。不能将这段过程称为“一次标准命令退出0”。

为恢复空间，只归档本轮已结束的10个精确私有探针目录至`.ref/scratch-archives/18H-protocol-20261106/`，每个文件复制后核对SHA再移除C盘原件；可恢复映射在`scratch-archive-18H-result.json`，未清理用户项目、真实账号、全局缓存或修改系统设置。Rust分组保留原C盘TEMP（短路径卷条件），未另跑全库531项；构建专用TEMP才使用D盘。独立lint未配置。

当前生产debug原生构建退出0，642项产品/验证/原生输入构建前后哈希一致，3份前端资产和5份主题许可绑定收据；没有生成新安装包。产物`dist-artifacts/library-18H-20261106/CodexNative.exe`，SHA-256 `1a1f7384ec8e8aaf1ac52f4f3bba4865ff1ad8548af698e5027c30136eb2964c`。私有CODEX_HOME/WebView目录、当前重核CLI0.165.0下验证启动、探索→资料库、未登录错误、无资格隐藏搜索/标签/模式、重试及Alt+F4正常退出；进程已消失，SQLite只读确认0会话。`native-product-result.json`与截图/数据库证据保存该限定路径，不代表认证后的标签/筛选已通过原生真实HTTP验收。

## 未完成与下一步

滚动实测确认普通标题随内容滚走，官方sticky/collapse未对齐；“加载更多”保留旧原生按钮外观。官方图标、目录叠层图、非图像缩略图和精确日期格式仍有差异。收藏需要独立实验资格，当前不造收藏按钮；外部provider/Pages、选择及写操作、完整URL路由、PDF/Office完整预览、真实账号HTTP、配对物理像素、物理IME、多窗口偏好广播和用户验收均未完成。视觉score=null，不用当前截图替代官方基准。

下一步按18I取证补Header滚动与自动分页回归：官方监听自身滚动容器，折叠高度由ResizeObserver动态测量，并受新旧布局/导航分支影响，永久sticky不能代替；普通native使用IntersectionObserver哨兵，常驻“加载更多”属于错误分支。`.ref/parity/18/actual/18I-library-header/reference/contract.md`保存12资源/20锚点/6原函数样本，尚未开发。

之后推进[19E图像页开发前规格](../specs/19E-images.md)；旧19C不能整包合并，其recent首请求after:null与真实宿主拒参冲突已定位，资源角色冲突和晚到字节失效仍需先复现再修。preview.5不含18G/18H，本阶段本地提交，未推送/另发版本，不自动改变用户验收状态。
