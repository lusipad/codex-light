# 18I 资料库 Header 动态折叠规格

日期：2026-11-06。开发前规格；来源是 `.ref/parity/18/actual/18I-library-header/reference/contract.md`、`anchors.json` 中完整 `ye/N/Te` 与 `126a18e4438e.css`，固定 Store 26.1027.3384.0。UTF-16 定位、哈希和原函数夹具结果见该目录。静态证据不证明账号 gate 或原生表现。

本单元恢复普通Header与自动分页，复用既有数据读取、身份及取消链。保留18H工具条顺序：已选筛选条件、筛选和视图切换、搜索；不将它搬到tabs一行。

## 结构与动作合同

- `LibraryStickyHeader` 接收 h1 内容 `title`、工具条内部 `actions`、完整 `navigation`、实际 `newLayout` 分支，以及页面唯一滚动容器和主体的两个 ref。组件创建 title wrapper/titleContent、actions wrapper/toolbar 和 navigation wrapper。
- 旧 layout 的 navigation 在 sticky shell 内；新 layout 的 navigation 在 shell 后独立行。资格由调用者已有证据决定，不在组件中强开 gate。
- shell 使用 `position:sticky` 和动态负 top；有无 navigation、新旧 layout 对应官方 CSS 分支。禁止以整个 Header 永久 top:0 替代折叠。
- ResizeObserver 观察 content 和标题 wrapper；内容子树的 childList/characterData 变化通过 MutationObserver 断开后重新观察。回调写 content-start，并以标题 wrapper 的 offsetHeight 加 shell paddingTop 计算 collapse-offset；没有 toolbar 时移除 collapsible。
- 页面容器 scroll 事件按真实 header/body 边界计算旧 layout overlap，按当前 scrollTop 和 header/container 的 sticky 边界计算新 layout scrolled。新 layout ResizeObserver 观察容器和 shell，更新背景 inset；卸载或分支切换断开并清理监听。
- 当前项目没有官方 windowZoom context，背景 inset 的除法限于当前 1x CSS 坐标适配；不能用设备 DPI 猜缩放。实际 zoom、官方同环境截图和物理输入法仍待原生对照。

## 修改前验收清单

独立 Node 夹具执行实际 TSX/hooks，显式控制 DOM 几何与 Resize/Mutation observer，验证：标题换行后的 offset 重算；content-start；缺 toolbar；mutation 重挂观察；旧 layout overlap 含 height 比值和 margin；新 layout sticky 阈值和正 inset；navigation 归属；旧 observer 回调卸载后不写；listeners/observers 清理。先记录缺少生产组件的红测，再实现并复跑。

CSS 分支检查只证明源码选择器存在；实际长列表滚动、宽窄布局、焦点、官方配对图与 Tauri GUI 由阶段整合验收补充，不以受控几何测试冒充像素通过。

## 普通分页与真实gate

普通native使用`LibraryPagination`底部哨兵，默认IntersectionObserver root/rootMargin，不引入额外预取距离；首次交叉先停止本observer再调用最新回调，cleanup屏蔽排队晚到事件。请求中不重复派发；无IO时沿官方立即请求回退。哨兵按实际pages.length重挂，空中间页继续；复用原loadMore的身份、scope、pending与重复cursor边界。全query读取时不观察，分页失败时停下并保留内容/明确重试按钮；不显示Pages特殊分支的常驻“加载更多”。列表/网格分别沿已有真实组件加3项加载占位，哨兵自身无spinner。

gate3085093835由完整、身份绑定的既有Statsig bootstrap解码；明确true/false时才输出可选newLayout，缺失保留未确认并用旧分支。原JD的Cv只排除denied/unsupported-auth，完整来源及320个明确ChatGPT原函数样本见`reference/gate-evidence.json`。非ChatGPT、错身份、delta与未知格式不因gate为true而放行，资格和真实请求参数保持原合同；没有读当前账号HTTP或强开gate。

## 整合纠偏：滚动容器内边距

真实新布局滚动时，旧页面的padding-top24令header停在container.top+8，而官方阈值为container.top-16，导致scrolled一直false。完整N证明滚动div和min-h-full父wrapper都没有顶部padding；本页sticky分支也不触发body的contentInset顶部类。因此移除scrollport内边距，将48px横向gutter放回header content/body/external navigation各自wrapper，extraWide上限1440。shell保留自己的16px padding。新布局body底部按原pb4使用16px；旧布局panel token未完整实测，保留现有fallback24px并单列限制。

`browser-padding-red/green.json`保存实测：修复后container padding0、header.top=container.top-16、背景inset16、content-start48及scrolled=true。1800px窗口header/body最大宽1440、640px无横溢已测；这仍不是官方配对物理像素。

## 整合纠偏：父节点 ref 提交时序

真实 React 浏览器发现 scrollTop=108 时旧版 Header 未写 scroll-position/scrolled。初版隔离夹具预先填入父容器 ref，遗漏了 React 子 layout effect 执行时父 host ref 尚未提交的情况。补入明确分开 layout/passive 两阶段的红例后，旧实现 listener 数为 0，真实失败退出 1。修复将依赖父容器和后续 body ref 的绑定放到 `useEffect`，自身测量仍用 `useLayoutEffect`；绑定时立即同步已有 scrollTop。新旧 layout 均验证父 ref 延后提交、单一 listener、初始状态、回顶和卸载清理，绿测退出 0。日志为 `header-parent-ref-red/green.log`，不能以这项受控时序回归替代主线程浏览器复验。
