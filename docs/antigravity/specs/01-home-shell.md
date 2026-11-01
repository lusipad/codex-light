# 01 首页与公共外壳 (Home Shell + Public Surface) 执行规格草案 - F3/F4 修正版

> 2026-10-29：用户授权Codex接手开发。本轮仅实施A03最大化/还原状态的已复现缺陷，合同与证据见`../runs/20261029-codex-01a-window.md`；不表示用户确认本草案54/60px等候选值、整页G2或放行01B。官方main的36×缩放是窗口控制overlay高度，并非整条标题栏高度；当前几何仍待消歧。

- **规格状态**：**AG-00 待确认规格草案 (Draft Specification Pending Official Evidence)，停在 G2 门槛**
- **基准 ID**：`official-win-26.928.21956-b12404-dark-zhCN-100pct-draft`
- **对应 Run ID**：`20261027-ag00-01`
- **规约原则**：严格区分“官方可观察事实”、“asar 静态代码分支”、“当前项目实现”与“未知项”，无确凿依据绝不补写推测性预期，不声明已通过 G2 验证。

---

## 1. 首页整体结构与图谱

```text
01.WINDOW (基准客户区候选: 1568 x 934 宽窗 / 960 x 640 窄窗)
├─ 01.TITLEBAR (顶部标题栏，候选高度 54px)
│  ├─ NAV_CONTROLS: 后退 (Back)、前进 (Forward)、侧栏切换 (Toggle Sidebar)
│  ├─ APP_MENUS: 文件 (File)、编辑 (Edit)、视图 (View)、帮助 (Help)
│  ├─ DRAG_REGION: 可拖拽区域 (-webkit-app-region: drag)
│  └─ WINDOW_CONTROLS: 最小化 (Minimize)、最大化/还原 (Maximize/Restore)、关闭 (Close) (no-drag)
├─ 01.RAIL (左侧全局导航轨，候选宽度 60px)
│  ├─ TOP_ENTRIES: Home (首页)、Inbox (收件箱/活动)、Projects (项目)、Worktrees 等
│  └─ BOTTOM_ENTRIES: Usage (额度)、Settings (设置)、Profile (个人资料/模式切换)
├─ 01.SIDEBAR (侧边栏，候选宽度 344px)
│  ├─ HEADER: 搜索按钮 (Search)、新会话 (New Chat Ctrl+N)
│  ├─ SECTIONS: 置顶会话 (Pinned)、最近项目 (Recent Projects)、历史会话列表 (Threads)
│  └─ FOOTER: 快捷操作或折叠状态
└─ 01.MAIN (主工作区，背景采样 #181818)
   ├─ 01.HERO (首页欢迎与引导区，居中对齐)
   │  ├─ LOGO: 56px 官方 SVG Logo 容器 (透明度 0.3)
   │  └─ TITLE: 欢迎文案 (字体 28px, 行高 34px, 字重 400, 字距 0.38px, Segoe UI)
   └─ 01.COMPOSER (底部输入主体，最大宽 784px)
      ├─ CONTEXT_BAR: 当前项目、执行目录 (cwd)、Worktree 分支
      ├─ ATTACHMENTS_BAR: 图片/文档预览 Chips、移除按钮
      ├─ INPUT_AREA: Textarea (空态高度约 24px，多行自动撑开至最大 240px，内部滚动)
      ├─ ACTIONS_ROW: 附件、权限、模型/推理/速度、听写、发送/停止按钮
      └─ OVERLAYS: 模型下拉菜单、权限弹窗、项目选择 Popover
```

---

## 2. 首页可见控件清单 (严格区分视觉识别与待证实可访问性)

| 控件 ID | 父区域 | 官方可见呈现 | 识别来源 | 视觉几何候选值 (1568x934 PNG) | 样式与 Token 来源 | 交互已知事实与待验证项 |
|---|---|---|---|---|---|---|
| `CTL-TB-BACK` | `01.TITLEBAR` | 导航左箭头图标 | REF-IMG-HOME-DEFAULT | 30x30, 距左 12px, y=12 | 前景 `#b4b4b4` | 事实：空历史时呈现暗淡禁用态；**待证：可访问性 name/role** |
| `CTL-TB-FORWARD` | `01.TITLEBAR` | 导航右箭头图标 | REF-IMG-HOME-DEFAULT | 30x30, 距左 46px, y=12 | 前景 `#b4b4b4` | 事实：无前进历史时禁用；**待证：可访问性 name/role** |
| `CTL-TB-SIDEBAR` | `01.TITLEBAR` | 侧栏切换图标 | REF-IMG-HOME-DEFAULT | 30x30, 距左 80px, y=12 | 前景 `#b4b4b4` | 事实：点击折叠/展开侧栏；**待证：Tooltip 弹出延迟与文案** |
| `CTL-TB-MENU-FILE` | `01.TITLEBAR` | 文本 "文件" | REF-IMG-HOME-DEFAULT | 高 25px, padding 0 9px, y=14 | 字体 13px, 前景 `#b4b4b4` | 事实：点击展开文件菜单；**待证：是否支持 Alt+F 快捷激活** |
| `CTL-TB-MENU-EDIT` | `01.TITLEBAR` | 文本 "编辑" | REF-IMG-HOME-DEFAULT | 高 25px, padding 0 9px, y=14 | 字体 13px, 前景 `#b4b4b4` | 事实：点击展开编辑菜单 |
| `CTL-TB-MENU-VIEW` | `01.TITLEBAR` | 文本 "视图" | REF-IMG-HOME-DEFAULT | 高 25px, padding 0 9px, y=14 | 字体 13px, 前景 `#b4b4b4` | 事实：点击展开视图菜单 |
| `CTL-TB-MENU-HELP` | `01.TITLEBAR` | 文本 "帮助" | REF-IMG-HOME-DEFAULT | 高 25px, padding 0 9px, y=14 | 字体 13px, 前景 `#b4b4b4` | 事实：点击展开帮助菜单 |
| `CTL-TB-DRAG` | `01.TITLEBAR` | 标题栏空白区域 | REF-CSS-SHARED | x=260..1420, y=0..54 | `-webkit-app-region: drag` | 事实：拖动移动窗口；双击最大化/还原 |
| `CTL-TB-WIN-MIN` | `01.TITLEBAR` | 最小化横线 | REF-IMG-HOME-DEFAULT | 48x54 候选, y=0 | 前景 `#b4b4b4` | 事实：点击最小化窗口；no-drag |
| `CTL-TB-WIN-MAX` | `01.TITLEBAR` | 最大化方框 | REF-IMG-HOME-DEFAULT | 48x54 候选, y=0 | 前景 `#b4b4b4` | 事实：正常态单方框，最大化态双方框；no-drag |
| `CTL-TB-WIN-CLOSE`| `01.TITLEBAR` | 关闭叉号 | REF-IMG-HOME-DEFAULT | 49x54 候选, y=0 | 前景 `#b4b4b4`, hover 红色 | 事实：点击触发关闭；**待证：进程退出 vs 最小化到托盘** |
| `CTL-RAIL-ROOT` | `01.RAIL` | 导航轨垂直容器 | REF-IMG-HOME-DEFAULT | 候选宽 60px, x=0..60, y=54 | 采样 `#1C2124`~`#212020` | 事实：容纳全局入口；**待证：不同位置采样色不同（机制待证）与 CSS token** |
| `CTL-RAIL-HOME` | `01.RAIL` | 首页图标 | REF-IMG-HOME-DEFAULT | 40x40, 距顶 8px | 选中态灰色高亮 | 事实：当前处于选中态；**待证：Tab 键焦点环形态** |
| `CTL-SB-ROOT` | `01.SIDEBAR` | 侧边栏垂直容器 | REF-IMG-HOME-DEFAULT | 候选宽 344px, x=61..403, y=54 | 采样 `#333536` | 事实：展示会话列表；可折叠 |
| `CTL-SB-SEARCH` | `01.SIDEBAR` | 搜索图标按钮入口 | REF-IMG-HOME-DEFAULT | 约 32px 高度 | 采样与背景一致 | 事实：点击打开全局搜索面板；**纠正：非普通 input 文本框** |
| `CTL-SB-NEWCHAT`| `01.SIDEBAR` | 新聊天图标按钮 | REF-IMG-HOME-DEFAULT | 约 32px 高度 | 前景 `#fff` | 事实：点击重置为空会话，快捷键 Ctrl+N |
| `CTL-HERO-LOGO` | `01.MAIN.HERO` | 官方大 Logo | REF-JS-PRIMARY | 56x56 容器, 居中 | 静态 SVG, opacity 0.3 | 事实：居中展示，hover 有微弱增亮 |
| `CTL-HERO-TITLE`| `01.MAIN.HERO` | 问候标题文案 | REF-CSS-HOME | 居中, 28px/34px/0.38px | home-49f9c30a8c63.css | 事实：400 字重，排版规则已从官方 CSS 证实 |
| `CTL-COMP-ROOT` | `01.COMPOSER` | 输入区域外框容器 | REF-IMG-HOME-DEFAULT | 最大宽 784px, y=803..905 | 边框与阴影组合 | 事实：空态高 102px 候选, 底边距 28px 候选 |
| `CTL-COMP-TEXT` | `01.COMPOSER` | 提示词输入区域 | REF-CSS-SHARED | 宽 100%, 最小高约 24px | 字体约 14px, 前景 `#fff` | 事实：支持多行与换行；**待证：真实 IME 组合时序** |
| `CTL-COMP-MODEL`| `01.COMPOSER` | 模型选择按钮 | REF-IMG-MODEL-COMPACT | 胶囊形状, 居中靠左 | 前景 `#fff` | 事实：展示当前模型名及推理标签；点击展开菜单 |
| `CTL-COMP-SEND` | `01.COMPOSER` | 发送圆形按钮 | REF-IMG-HOME-DEFAULT | 32x32 圆形, 右下角 | 空态灰色禁用 | 事实：有文本时激活；**待证：点击后禁用时延** |

---

## 3. 画面与状态清单 (S01–S14) 完整登记 (F4 恢复)

| 场景 ID | 画面名称与状态 | 宽窗 (1568x934) 证据 | 窄窗 (960x640) 证据 | 01A 关联度 | 状态判定与缺证据说明 |
|---|---|---|---|---|---|
| **S01** | 首页默认空输入稳定态 | `REF-IMG-HOME-DEFAULT` (1568x934 PNG) | 待官方采证 (提供人工采集步骤) | **01A 核心必须** | 宽窗候选已有，窄窗待采证 |
| **S02** | 侧边栏折叠状态 | 待官方采证 (需人工折叠截图) | 待官方采证 | **01A 核心必须** | **阻塞：待官方采证** |
| **S03** | 项目与长会话列表滚动态 | 待采证 (非01A阻断项) | 待采证 | 01B 侧栏批次 | 待 01B 采证 |
| **S04** | 项目选择器展开状态 | 待采证 | 待采证 | 01E 菜单批次 | 待 01E 采证 |
| **S05** | 执行位置 / Worktree 切换状态 | 静态代码发现，运行时受账号限制 | 待采证 | 01E 菜单批次 | 能力受限待确认 |
| **S06** | 模型选择器展开紧凑态 | `REF-IMG-MODEL-COMPACT` (1568x934 PNG) | 待官方采证 | 01E 菜单批次 | 宽窗已有，窄窗待采证 |
| **S07** | 推理档位 / 速度子状态展开 | `REF-IMG-MODEL-COMPACT` 局部包含 | 待官方采证 | 01E 菜单批次 | 局部已有，窄窗待采证 |
| **S08** | 权限模式下拉菜单展开态 | `REF-IMG-PERMISSIONS` (1568x934 PNG) | 待官方采证 | 01E 菜单批次 | 宽窗已有，窄窗待采证 |
| **S09** | 附件菜单与附件 Chips 状态 | 待官方采证 | 待官方采证 | 01D 输入批次 | 待 01D 采证 |
| **S10** | 一行 / 多行 / 超长输入状态 | 待官方采证 | 待官方采证 | 01D 输入批次 | 待 01D 采证 |
| **S11** | 键盘焦点环与按钮 Hover 状态 | 待官方采证 (需无损截取焦点环) | 待官方采证 | **01A 核心必须** | **阻塞：待官方采证** |
| **S12** | app-server 离线 / 连接断开态 | 本地协议可复现 | 本地协议可复现 | 01F 综合验收 | 协议样本已就绪 |
| **S13** | 语音录音 / 转写状态 | 外部服务不可用 (无官方语音凭据) | 不适用 | 01D 输入批次 | 外部依赖阻塞 |
| **S14** | 首次点击发送 ➔ 会话页过渡动画 | 待录屏采证 | 待录屏采证 | 01F 综合验收 | 待 01F 录屏采证 |

---

## 4. 动作合同清单 (A01–A30) - 严格标注已知、待证与采证步骤 (F3/T2/T3/R4 修正)

| 动作 ID | 动作名称 | 官方可定位依据 (文件/片段/样式) | 当前已知观察事实 | 待采证/未验证项 (撤销“已证实”) | 精确人工采证步骤 | 01A 关联度 |
|---|---|---|---|---|---|---|
| **A01** | 首页冷启动与初始挂载 | `main-DkWgQSQe.js:3643901` (主窗口标题栏 overlay 样式分支，0-based UTF-16 字符偏移) / `preload.js` (IPC 暴露) / `REF-IMG-HOME-DEFAULT` (原图) | 仅原图 `REF-IMG-HOME-DEFAULT` 观察到稳定首页外壳呈现（标题栏、导航轨首页高亮、展开侧栏、Hero、空输入 Composer） | **待证 (待官方实测)**：1) 完整冷启动时序（上述 main 片段仅能证明窗口样式配置，不证明启动顺序）；2) CLI 连接建立前是否有骨架屏；3) 首屏渲染后首个获得焦点的 DOM 控件 | 录制官方退出后冷启动的 60fps 逐帧视频，并在首屏加载瞬间使用 Inspect.exe 查询活动焦点元素句柄 | **01A 核心基础** |
| **A02** | 标题栏拖动 | `app-shared-342447930c78.css:12` (`.!draggable {-webkit-app-region: drag!important}`) | 鼠标在标题栏空白处拖动，窗口物理移动；双击最大化/还原 | **待证**：Win11 窗口贴边吸附 (Snap Layout) 是否被原生拦截 | 在官方应用拖动至屏幕顶边，观察是否触发 Snap 预览框 | **01A 核心** |
| **A03** | 窗口最小化/最大化/关闭 | `main-DkWgQSQe.js:3643901` (`titleBarStyle: "hidden", titleBarOverlay: j9(r)`，0-based UTF-16 字符偏移) / `bootstrap-DvSEn4qy.js` (`CTe` 中的 `window-all-closed` 平台分支) | Windows 下官方通过 Electron WCO 原生覆盖层提供控制按钮，非前端手写 DOM | **待证 (阻塞)**：点击 X 是主进程退出还是托盘常驻守护；Tauri 下对齐策略与拦截实现 | 点击官方 X 按钮，在任务管理器观察主进程是否存活及托盘图标变化 | **01A 核心** |
| **A04** | 标题栏前进/后退 | 路由历史栈管理 | 空历史时置灰禁用，有历史时切换视图 | **待证**：跨项目切换时前进历史栈是否清空 | 官方应用中切换两个会话后再点后退，观察状态 | 外壳相关 |
| **A05** | 侧边栏切换 (图标/Ctrl+B) | `main-DkWgQSQe.js:3300916` (`toggleSidebar` IPC 发送) / `main-DkWgQSQe.js:3309312` (`toggleSidebar` 菜单项 accelerator 注册，0-based UTF-16 字符偏移) | 主进程具备分发 `toggle-sidebar` IPC 消息的接口；`REF-IMG-HOME-DEFAULT` 显示展开态侧栏（候选约 344px） | **待证 (阻塞)**：1) 前端接收端实际渲染宽度与展开/折叠过渡动画曲线；2) 侧栏折叠状态持久化存储机制与 key；3) Windows 平台物理按键 "Ctrl+B" 的具体键位映射绑定表（代码仅注册 accelerator 符号，未在片段内直显字符串值） | 折叠侧栏后彻底重启官方应用观察持久化；录屏分析折叠过渡帧数并抓取键盘按键映射 | **01A 核心** |
| **A06** | 导航轨项 Hover 与 Click | `app-initial-e55cd978d577.css` (页面表面布局引用 `var(--app-shell-navigation-rail-width)`) / `app-initial-fd3c4b862660.js:7923186` (`<nav data-app-navigation-rail>` 与导航项 `variant: "navigationRail"`，0-based UTF-16 字符偏移；宽度变量定义待官方静态代码定位) / `REF-IMG-HOME-DEFAULT` (原图) | 仅根据 `REF-IMG-HOME-DEFAULT` 观察到左侧垂直导航轨区域（估计候选宽 60px，x=0..60），首页图标处于选中高亮态 | **待证 (待官方实测)**：1) 鼠标悬停图标是否有背景高亮与 Tooltip 显现及其延迟毫秒数；2) 点击各导航项切换主视图路由的具体行为与时序；3) 各入口项对应的完整路由映射 | 运行官方客户端录制鼠标悬停导航轨图标的 60fps 逐帧视频，读取 Tooltip 显现延迟帧数；点击各导航入口记录视图切换与路由状态 | **01A 核心** |
| **A07** | 标题栏菜单展开与 Escape 关闭 | `.ref/asar-files/native-menu-zh-CN.json` (原生菜单多语言文案映射表) / `main-DkWgQSQe.js:3261930` (通用原生上下文菜单 IPC `codex_desktop:show-context-menu` 处理，0-based UTF-16 字符偏移) | 主进程具备弹出原生上下文菜单的 IPC 接口，并具备中文菜单文案定义 | **待证 (阻塞)**：1) 顶栏点击“帮助”等按钮到主进程 IPC 的完整调用链；2) Windows 下菜单是系统原生 Win32 弹窗还是 HTML 模拟浮层；3) Escape 键关闭菜单后焦点是否返回原 Trigger 按钮 | 在官方应用点击菜单并按 Escape 关闭，使用 Accessibility Insights / Inspect.exe 检查焦点元素句柄是否精准停留在原按钮 | **01A 核心** |
| **A08** | 个人资料/模式入口点击 | ProfileMenu 组件 | 点击弹出浮层 | 待证：账号切换确认逻辑 | 待官方采证 | 01A 后续 |
| **A09** | 新聊天 (按钮/Ctrl+N) | 路由回到 `/` | 静态取证：普通入口恢复首页草稿，local会话按身份保留输入；特殊freshDraft分支另计 | 待证：官方运行时焦点、特殊分支和丢弃提示；见[草稿合同](../runs/20261031-codex-01b-drafts.md) | 01B 采证/开发中，未验收 | 01B 批次 |
| **A10** | 侧栏项目行展开/收起 | 侧栏项目树组件 | 点击折叠/展开子会话 | **待证**：各项目折叠状态是否持久化 | 待 01B 采证 | 01B 批次 |
| **A11** | 会话行选择与右键 | 列表上下文菜单 | 静态取证：右键独立于选择，ContextMenu/Shift+F10共用菜单入口；结束可恢复此前焦点；local重命名为弹窗，初值为title，后台保存 | 已补入口/限定原生回归，见[菜单合同](../runs/20261031-codex-01b-thread-menu.md)、[重命名合同](../runs/20261031-codex-01b-rename.md)；官方原生分支、完整项目/二级层级与像素待证 | 01B开发中，未验收 | 01B 批次 |
| **A12** | 侧栏长列表滚动 | `app-shared-a906948d8868.js` 中有 `data-app-action-sidebar-scroll` 定位锚点；`app-initial-fd3c4b862660.js` 的分页分支支持每项目初始5条、每次增加10条。shared CSS 中 `scrollSection/fixedSection` 类的高度变量明确属于 dropdown section，未发现其Sidebar调用链 | **官方运行时尚无滚动实测**。当前复刻 release 在隔离28条样本下验证5→15→25展开、Sidebar内滚动及Recent末项可达；固定产品栏/“新聊天”不随列表滚动。当前 hoverCard 对83字符混合标题显示3行并停在窗口底边内。见[本轮 A12 记录](../runs/20261031-codex-01b-longlist.md) | **待官方实测**滚动容器、头尾固定、滚动条显隐、overscroll 与分组标题行为；本项目 hoverCard 水平翻转、窄窗及滚动时定位仍未验证；虚拟滚动缓冲区阈值待查 | 官方长列表场景录屏记录滚动位置、固定元素、分段标题和末项；复刻侧用同等数据/窗口尺寸重放并保存截图 | 01B 批次 |
| **A13** | Hero 项目文字点击 | 项目选择联动 | 点击弹出项目选择器 | 待证：无项目状态下的占位文案 | 待 01C 采证 | 01C 批次 |
| **A14** | 项目选择器选择/取消 | `fs/selectWorkspace` 协议 | 切换工作区上下文 | 待证：无效目录的错误形态 | 待 01E 采证 | 01E 批次 |
| **A15** | 执行位置切换 | targetEnvironment | 切换目标环境 | 待证：无权限时的禁用提示 | 待 01E 采证 | 01E 批次 |
| **A16** | Worktree 开关 | Git 模块调用 | 切换分支与隔离目录 | 待证：分支冲突时的回滚行为 | 待 01E 采证 | 01E 批次 |
| **A17** | 模型选择器展开 | `REF-IMG-MODEL-COMPACT` (官方紧凑态原图)；官方前端静态代码待定位 | 点击胶囊按钮展开模型与推理档位弹层 | **待证**：ArrowDown/ArrowUp 键盘焦点导航循环边界（待官方实测，不得反向以当前实现充当规格） | 在官方客户端按键盘上下键至首尾边界测试焦点流转 | 01E 批次 |
| **A18** | 模型选择 | 触发模型切换事件 | 选中项关闭菜单并更新 Trigger 文本 | 待证：不支持当前推理时的归一文案 | 待 01E 采证 | 01E 批次 |
| **A19** | 推理档位调整 | `input[type="range"]` 独立事件 | 滑块滑动，标签联动更新 | 待证：非 o 系列模型的隐藏机制 | 待 01E 采证 | 01E 批次 |
| **A20** | 权限模式选择 | 权限配置项 | 下拉选择权限级别 | 待证：高危权限系统级弹窗形态 | 待 01E 采证 | 01E 批次 |
| **A21** | 附件菜单选择文件 | `dialog.showOpenDialog` | 调起原生系统文件选择器 | 待证：多文件拖选上限 | 待 01D 采证 | 01D 批次 |
| **A22** | 文件拖拽到输入框 | 原生 dragover/drop 事件 | 出现高亮边框，释放生成 Chip | 待证：不支持类型的错误呈现 | 待 01D 采证 | 01D 批次 |
| **A23** | 单行到多行输入自动增高 | `textarea` 高度自适应 | 换行后高度撑开，超出内部滚动 | 待证：最大增高行数的像素上限 | 待 01D 采证 | 01D 批次 |
| **A24** | Enter / Shift+Enter 发送 | 键盘事件分流 | Enter 发送，Shift+Enter 换行 | 待证：多行状态下的偏好细节 | 待 01D 采证 | 01D 批次 |
| **A25** | Windows 中文 IME 选字 | 原生 IME composition 事件 | 选字回车上屏不触发发送 | **待证**：真实 Windows 物理输入法时序 | 连接真实微软拼音录屏与网络抓包 | 01D 批次 |
| **A26** | 菜单按键导航 (Arrow/Home/End) | 键盘焦点管理 | 方向键循环切换，Escape 关闭返回 | **待证**：循环包裹的具体边界 | 待 01E 采证 | 01E 批次 |
| **A27** | 展开菜单时点击输入框 | pointerdown 关闭 | 菜单关闭且输入框获得焦点 | 待证：输入框内光标落点位置 | 待 01E 采证 | 01E 批次 |
| **A28** | app-server 断开时状态与重试 | 连接状态流推送 | 显示离线，草稿保留，提供重试 | 待证：倒计时重试 UI 呈现 | 待 01F 采证 | 01F 批次 |
| **A29** | 语音录音开始与转写 | 外部语音服务 | 外部不可用 (标为阻塞) | **阻塞**：无官方语音接口权限 | 无 | 阻塞 |
| **A30** | 首次点击发送与页面过渡 | 页面过渡路由动画 | Composer 动画下移，Hero 淡出 | **待证**：过渡动画精确时长与缓动 | 录屏官方首次发送逐帧分析 | 01F 批次 |

---

## 5. 视觉锚点清单 (V01–V08) 完整登记 (F4 恢复)

| 锚点 ID | 测量内容与区域 | 官方原图候选估计值 (1568x934 PNG) | 当前实现状态 | 物理偏差判定 | 状态 | 所属修复批次 |
|---|---|---|---|---|---|---|
| **V01** | 客户区顶边至标题栏底边高度 | 候选 **54px** (y=0..54) | 代码已修改为 54px | 待原生无损截屏测量 | `pending-native-capture` | **01A 外壳** |
| **V01-BTN**| 窗口控制按钮高度与贴顶度 | 候选 **54px** 充满顶边 (y=0) | 代码已设为 100% | 待原生无损截屏测量 | `pending-native-capture` | **01A 外壳** |
| **V02** | 导航轨物理宽度与色彩 | 候选 **60px** (x=0..60), 采样 `#1C2124`~`#212020` | 代码已修改为 60px | 色彩 token 待消歧 | `pending-color-disambiguation` | **01A 外壳** |
| **V03** | 侧边栏物理宽度 | 候选 **344px** (x=61..403) | 当前代码 340px | 待 01B 阶段测量 | `pending-01B` | 01B 侧栏 |
| **V04** | Hero Logo 尺寸与标题排版 | Logo 56x56, 标题 28px/34px/0.38px 400 | 代码排版已匹配 | 待 01C 几何测量 | `pending-01C` | 01C Hero |
| **V05** | Composer 外框高度与底边距 | 候选空态高 102px, 底边距 28px | 依赖 flex 居中 | 待 01D 渲染测量 | `pending-01D` | 01D Composer |
| **V06** | Composer 操作栏与首行基线 | 候选首行基线约 y=832 | 待 01D 测定 | 待测 | `pending-01D` | 01D Composer |
| **V07** | 模型/权限下拉菜单与 Trigger 相对偏移 | 投影 `0 8px 16px rgba(0,0,0,0.35)` | 待展开态测量 | 待测 | `pending-01E` | 01E 菜单 |
| **V08** | Focus 环与 Hover 高亮效果 | Focus 环 2px 外边框 | 待真实原生渲染抓取 | 待测 | `pending-native-run` | 01A/01E |

---

## 6. 01A 阶段实施状态与待验清单

### 6.1 01A 包含范围与实施成果
- **包含范围**：`CTL-TB-*`, `CTL-RAIL-ROOT`, 动作 `A02`, `A03`, `A05`, `A06`, `A07` 的外壳样式与事件接线，锚点 `V01`, `V01-BTN`, `V02`；
- **实施完成内容 (DIFF-01A-01 ~ DIFF-01A-07)**：
  1. `src/styles.css`：`--app-titlebar-height: 54px;`（候选估计值）；
  2. `src/components/AppTitleBar.css`：`.app-window-controls { height: 100%; }`（顶格充满规则）；
  3. `src/styles.css`：`--nav-rail-width: 60px;`（候选估计值）；
  4. `src/styles.css`, `AppTitleBar.css`：色彩 token 保持待消歧状态，不盲目绑定单点采样；
  5. `src/components/AppTitleBar.css`：拖拽区 `-webkit-app-region: drag` 与按钮 `no-drag` 防穿透规则；
  6. `src/shortcuts.ts`, `src/App.tsx`：侧栏双快捷键 `Ctrl+B` 与 `Ctrl+Shift+S` 支持，并过滤 `e.repeat` 与 `e.isComposing`（对齐官方 `app-initial:3561470, 9026914`）；
  7. `src/App.tsx`：实现 `window.innerWidth <= 960` 响应式自动折叠监听器（对齐官方 `app-initial:1351772 zIt` 断点）；
- **当前待采证与待验项**：S01 窄窗实测图、S02 侧栏折叠态实测图、S11 焦点环无损采样；A03 托盘常驻细节与 A05 持久化通道待实测。未获得无损对比与真实原生运行日志前，保持真实性声明，不声称像素 1:1 或整体通过。
