# 18G 普通资料库搜索阶段

日期：2026-11-06。状态：功能、组件、完整标准及限定原生自验完成，待用户验收。固定来源、开发前动作合同及适用分支见[18G规格](../specs/18G-library-search.md)。

## 修改范围

`LibraryView.tsx/.css`增加普通根/目录搜索，纠正唯一标题、中文空态和窄窗头部；`libraryClient.ts`通过现有固定请求传q。复用已有身份、取消、历史、预览和后端路由，不增加依赖、计时器或后端操作。新增搜索回归并接入标准/发布验证，保留既有服务和预览断言。

## 证据与结果

证据根：`.ref/parity/18/actual/18G-library-search/`。

- 官方原包17条目integrity、24完整函数、14中文和3字体CSS锚点。偏移是0-based UTF-16；静态分支不证明当前账号资格或原生运行时。
- 请求、搜索、导航、预览回归通过；62组前端发布检查与生产类型/构建退出0。缺失q、空白返回持续加载及身份切换持续加载均保留修复前失败和修复后结果。
- 实际React组件浏览器1280×800/640×800通过；覆盖全数据集先过滤再分页的隔离reader、原始输入/trim查询、历史、目录、失败重试、取消、预览返回、焦点和资格。`browser-result.json`保存可观察DOM调用记录；`search-wide.jpg`与`search-narrow.jpg`为原始JPEG，不是官方配对像素。
- 独立Tauri/WebView2文件来源夹具加载当前组件bundle，中文查询、清空后直接继续输入、Tab/Shift+Tab通过。UIA focused_element未可靠更新，采用可见光标/焦点环与实际输入结果交叉判断。输入及二进制哈希在`native-component-inputs.json`，结果在`native-component-result.json`。未使用DevTools注入、降低CSP或真实账号。
- Rust源文件相对preview.5成功CI未改变，远端该版本527项通过；本阶段尚未另跑本地全库，不把既有CI当作本阶段新运行。
- 本阶段完整非Fast标准319段、32个隔离协议探针退出0；包含Rust分组、cargo check、类型检查与生产构建，不称另跑全库527项。未配置独立lint命令。636项产品/验证/原生输入哈希复核一致。
- 当前源码debug原生构建退出0，636输入构建前后稳定，3个生产前端产物、5份主题许可绑定收据；`dist-artifacts/library-18G-20261106/CodexNative.exe`的SHA-256为`4af66d11f5c4067809381648972571d42a538bf8dfffd88aff7038431adcf0d7`。未生成新安装包。构建使用仓库私有D盘target，保留C盘原缓存与默认TEMP，未修改用户全局配置。
- 最终产品EXE在私有CODEX_HOME/WebView目录、CLI0.165.0下实测启动、探索→资料库、未登录错误、无资格隐藏搜索、重试及Alt+F4退出；进程已消失，只读SQLite确认0会话。`native-product-result.json`保存边界。此路径不代表真实账号搜索或已认证文件预览。

## 未验与差异

官方同环境截图/DPI、严格像素、真实账号搜索、原生认证预览、物理IME及用户验收未完成。完整App URL搜索路由、分类/provider/Pages、GridList、写操作及PDF等完整预览矩阵仍有缺口。本阶段不计入preview.5，不宣称整页或整个App已1:1。
