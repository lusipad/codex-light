# 公共壳与工作流纠偏：开发前合同

2026-11-04，接续4a3047f。基准Store26.1027.3384.0，asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。`.ref/parity/all-pages-20261104/reference/manifest.json`保存14个原始chunk及integrity哈希；其余取证按页面另存。此处不把不同产品模式的同名页面混为一个工作面。

## 08 命令菜单

`command-menu-dialog-f789d2f2cc55.js`的命令菜单结构及当前`zh-CN-88ebb426d686.js`证明：title为“命令菜单”，description为“搜索命令和过往对话记录。”，默认placeholder为“搜索聊天或运行命令”，文件scope为“搜索文件”；suggestedGroup为“快捷操作”，chatResultsGroup为“聊天”，commandGroup.skills为“技能”。中文不能从英文defaultMessage反推，当前语言包与英语含义不完全相同。

本轮保留真实搜索、缓存/作用域、slash/导航/文件打开回调，改混合中英文分组和搜索提示，补有名称的dialog及输入。官方未闭合的scopes、人员/Pages/Space、搜索选项/F6、多host、最近结果不在本批冒充实现。验证真实组件从搜索到选择的回调、Escape/IME、scope切换和焦点回退。

## 17 Quick Chat

`hotkey-window-detail-layout-178f0ba5429e.js`的L/R：关闭位于左侧，标题居中，右侧新建与主窗口按钮；`hotkey-window-thread-page-87c8ba7f1954.js`标题来自真实workspace/会话，复用本地conversation工作面而非独立聊天消息协议。当前中文为“关闭弹出窗口／开始新对话／在主窗口中打开”。

本轮只改原生thread detail的标题栏区域与中文，传入真实标题，去掉首页/会话常驻实现说明；保留窗口关闭、主窗口接续、原Composer和审批、Escape/IME及焦点。原生home是另一条路由（`hotkey-window-home-page-d9599d8d099f.js`），不能将thread detail直接宣称home也已对齐。完整富内容与工具链仍需复用主会话渲染，不以当前只筛user/assistant的实现称完整。

## 01/23 主题消费者

新外观偏好已由`useAppearancePreferences`负责初始化及跨窗同步。App旧启动读取`desktop_state.colorTheme`后applyColorTheme会覆盖新token；自建toggle-theme循环旧四变量色板同样绕过新保存/读回。先锁回归，再移除旧启动覆盖和菜单入口；遗留事件仅引导到真实外观设置，不擅自推定官方模式/预设循环语义，不删除旧用户存储。当前Store全包未找到旧命令字串不是“官方没有主题能力”的证明。

## 07/09/10/14 的证据边界

07已取terminal-panel与terminal-tab，但其中包含云连接/环境生命周期；不能拿background只读输出或云terminal文案反推本地PTY布局。09的inbox chunk是Work Pages mentions，当前本地通知数据却是automation/approval/thread，必须追路由与gate后才改结构。10C本地管理增量已构建，不代替云Scheduled；14私人远程review、聊天本地review和05/06 Changes不同，保留各自真实来源。上述单元本轮登记各自结论，不为凑页面数套用同名UI。

## 验证与剩余项

当前App/标题栏/菜单/Quick Chat/命令菜单定向回归，相关设置主题回归必须继续通过。每轮浏览器检查保留隔离数据说明、宽窄图及测量；无同条件官方图不评分、不宣称像素或原生交互通过。完整标题栏、rail、侧栏、home、通知、终端、私人review及云任务仍按未验项逐个推进。
