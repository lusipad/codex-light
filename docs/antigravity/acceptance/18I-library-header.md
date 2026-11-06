# 18I 普通资料库滚动标题与自动分页

日期：2026-11-06。状态：功能、独立组件及宽窄/限定原生组件已自验，完整标准和当前生产构建限定路径自验通过；未获用户验收，不是资料库整页1:1。[规格与动作合同](../specs/18I-library-header.md)。

## 改动与来源

`LibraryStickyHeader.tsx/.css`恢复实测高度的折叠、容器滚动和新旧布局/有无导航分支；`LibraryPagination.tsx`替代普通Pages专属分页按钮。`LibraryView.tsx/.css`接两个真实组件，移除无来源scrollport内边距，将48px gutter放回内容wrapper并限制extraWide1440；保留原路径、搜索、预览、身份、游标去重与错误重试。`libraryClient.ts`仅从完整、身份绑定的原Statsig响应输出可选newLayout，未强开gate或新增HTTP、依赖、生成及写操作。

固定Store26.1027.3384.0，完整ASAR SHA256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`沿用同goal已完整校验结果；本单元重新核header哈希及12条资源integrity、20完整函数/CSS锚点、6原函数样本。偏移为0-based UTF-16。`reference/gate-evidence.json`另保留JD/Cv完整来源和320个明确ChatGPT原函数组合；实际账号gate/官方GUI未取得。

## 功能和实际界面证据

证据根`.ref/parity/18/actual/18I-library-header/`。

- 哨兵对旧按钮版产品真实红后实现；共享harness改为执行实际Pagination的IO/ref而非按钮测试入口，保留单飞、重复游标、中间空页、身份/取消/旧scope和预览断言。专项覆盖默认IO、交叉才触发、先disconnect再派发、最新回调、排队重复/卸载晚到、重新观察、无IO回退和页key重挂。错误不循环请求，显式重试仍单飞。
- Header隔离几何/observer回归覆盖76→136动态测量、content-start、缺toolbar、Mutation重观察、旧overlap高度比/边距、新sticky阈值/背景inset、导航归属及分支切换清理。该组件首个红测只是缺模块，不能当作滚动缺陷复现。
- 真实React浏览器发现子layout effect先于父ref提交而没有绑定scroll监听；补两阶段回归后红→绿，父依赖绑定改为passive effect，安装时立即同步当前位置。另发现旧24px顶部padding令新layout吸顶判断一直false；完整N补证确认无此padding后修复，保存`browser-parent-ref-red/green.json`和`browser-padding-red/green.json`。
- 1280×800浏览器：修复后新分支header.top=container.top-16、inset16、content-start48、scrolled=true；旧root导航在shell内，无导航目录使用真实overlap transform；新分支tabs外置。首屏自动续页、滚动续页、3条保留内容+分页失败暂停、重试变4条、6条+3占位时重复滚动仅1请求、身份失效中止cursor6及晚释放均实测。未借默认计时器触发分页。
- 640×800工具条换行、筛选菜单边界、Escape、无横向溢出；1800×900 header/body最大1440px。截图为原始JPEG，没有官方配对图，score=null。内存reader/CSP connect-src none只替换桥接和数据，不冒充真实服务。
- 既有独立Tauri/WebView2 file-origin夹具加载当前生产组件bundle：原生滚轮实际从2页续至5页；旧root折叠后保留tabs，新分支滚动后保留标题/搜索；滚动后的筛选菜单、Escape可见焦点返回、中文Unicode查询及首屏自动补齐4条结果实测。`native-component-inputs.json`绑定bundle/旧夹具二进制，PNG/结果在verification；这不是当前生产EXE认证路径。UIA缓存/聚焦返回RootWebArea不可靠，依据可见光标、焦点环、真实输入结果交叉判断，不称物理IME选字通过。
- 最终66组前端发布回归退出0；独立复核Header/Pagination/Library read退出0。没有新Rust代码，完整标准按原分组执行，不预填全库531通过。

## 完整标准及交付构建

完整非Fast标准单次退出0，323检查段、32隔离协议探针；最终66组前端退出0，647产品输入构建前后稳定。当前debug原生构建退出0，3前端产物/5许可，EXE位于`dist-artifacts/library-18I-20261106/CodexNative.exe`，SHA256 `b3a69f0e6833ce371ca0d0e5e734ce08891d3c81f0234fa99471d6c29db10844`。私有CODEX_HOME和WebView目录中实际进入资料库、显示未登录错误、重试和Alt+F4退出通过，只读数据库确认0会话；没有触发模型。未另跑本地全库Rust或新打安装包。此次普通协议探针仅子进程使用私有D盘TEMP；Rust短路径测试及external-import仍使用原C盘TEMP。Node包装器传播真实退出码，先以退出7自测，不跳过探针或替换成功值。此前已结束的8个18G私有探针目录逐文件复制校验后归档，映射可恢复，未清理用户数据或全局缓存。

## 明确限制

官方同环境配对像素、真实账号HTTP及runtime gate、非1x windowZoom context、标题栏left inset、物理IME、多窗及用户验收未完成。旧root固定搜索的部分裁切与原CSS/flex/nested sticky规则一致，官方运行时是否同样呈现尚未实测，不能按理想UX改成永久top0。旧panel底部token保留24px fallback，精确日期/图标/目录叠层/非图像缩略图、收藏资格、provider/Pages、URL路由和完整预览/写矩阵仍是后续工作。

计划将18G–18I累计功能纳入preview.6；尚未提交推送/发布成功，结果另核。preview.5不包含这些阶段。下一19E有开发前合同与真实旧数据层红例，主根图像页尚未恢复，不能把研究写成已开发。
