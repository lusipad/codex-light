# 01B 当前剩余验收清单

更新：2026-11-01。01B 仍开发中。下表用于确定下一项工作，不是通过清单，也不代表用户已验收。

范围依据：[HOME-SPEC](../HOME-SPEC.md) 的 01B 与 A08–A12。Hero 项目选择器属于 01C/01E，完整会话操作属于 04；不因 Sidebar 有入口就把其他整页管理功能全部塞入 01B。

| 范围 | 当前可追溯进展 | 下一项需要的证据 |
|---|---|---|
| A08 资料/模式入口 | 真实身份/竞态/菜单键盘已修正；中文帮助层级、外链命令及可搜索快捷键对话框已有专项/完整标准/当前原生证据，Codex-only 模式入口已按官方 disabled 静态分支移除三项占位；快捷键列表已按本地活动会话/工作区上下文隐藏无效条目，见[上下文筛选增量](../runs/20261031-codex-01b-shortcut-availability.md)。本轮 Release 与原生 Accessibility 树确认侧栏仅呈现静态 Codex | 官方运行时、英语 feed 及 setup/privacy/debug、usage/账号 gate、Codex-only/Work capability、官方命令集合全量比对；物理 IME、系统浏览器加载、已认证原生及像素未完成 |
| A09 新聊天与上下文 | 项目参数/首次目标ID已补；普通文本隔离、持久化、发送移交/失败保护及原生重开/按钮和Ctrl+N已测，见[文本草稿增量](../runs/20261031-codex-01b-drafts.md)。附件快照清理构建已有 Home/A/B 原生往返、隔离恢复和逐项移除，见[原生续验记录](../../../.ref/parity/01/runs/20261031-codex-01b-attachment-save-snapshot/verification.md)。纯文字发送等待期间误清新增附件已修，TS01–TS04 L2、完整标准及 Release 构建通过，见[文字发送增量](../runs/20261031-codex-01b-text-send-attachment.md)。本轮补首页首次发送后 `turn/start` 失败的附件归属回归 HF01–HF02（L2），见[失败保留增量](../runs/20261101-codex-01b-home-attachment-failure.md)；本机原生选择器已确认可以附加 fixture，但在途 `turn/start` 竞态两次续测均未形成有效时序结论，见[选择器与竞态续验](../runs/20261101-codex-01b-home-attachment-failure.md) | AS/TS 原生异步保存/发送竞态、官方运行时/特殊freshDraft和queued分支、附件草稿重启/多窗口（须先取官方预期）、富附件完整类别、切回会话精确焦点、账号scope；首页附件真实发送与官方对照仍未验证 |
| A10 展开/收起与项目列表 | 行/键盘独立展开、持久化、5→15→25、实体身份/多根已有专项和分轮原生证据 | 当前构建宽窄窗的行高/缩进/截断/图标与官方同条件无损对照；不能沿用旧 EXE 截图 |
| A11 会话行与菜单入口 | 菜单键/Shift+F10、button语义/键盘导航、关闭焦点、右键不导航及侧栏折叠清理已有本轮回归和限定原生证据；普通 local 重命名已改为弹窗，原生普通名称保存后真实 CLI 读回一致，失败可见有 L2；当前会话再次选已勾选分区会移出，真实 section 对象冷加载读 ID 已修复；等待/成功/失败状态与 checkbox 键盘遍历有 L2；分区子项及创建流程、菜单主层级顺序/短文案已按固定 asar 与中文资源收敛，并由专项覆盖 SC01–SC11，见[菜单增量](../runs/20261031-codex-01b-thread-menu.md)、[重命名增量](../runs/20261031-codex-01b-rename.md)、[分区切换增量](../runs/20261031-codex-01b-section-toggle.md)与[新建分区增量](../runs/20261031-codex-01b-section-create.md)；新建分区取消/Escape 焦点缺陷已由原生复现、回归锁定并在最新 Release 复验通过，见新建分区记录的焦点修复续验；已更正项目 assignment 能力调研，隔离 CLI 0.159.2/0.165.0 的 `thread/metadata/update` 移动/清除/重启读回均通过；0.165.0 本地 durable read-state 菜单、行/hoverCard 提示、冲突保护已实现，真实服务与新 Release 原生往返/重启证据见[已读增量](../runs/20261031-codex-01b-read-state.md)；完整 workspace 移动尚未实现 | 已读状态当前只覆盖服务端提供 receipt 的本地会话，0.159.2 无该能力时隐藏；官方 host-backed conversation client 与根/side 聚合仍待验证，不能以通知 read 或本地标签模拟；项目 RPC 只改 assignment，官方还会写 workspace transition，并在后续 turn 应用 cwd/runtime roots/权限。本轮已补齐已存在 local pending 的真实 turn 网关消费、权限 roots 替换、accepted/revision/owner 保存和 sticky environment 保护，见[执行依赖增量](../runs/20261031-codex-01b-workspace-transition.md)；发送前 read/resume 与 local applied 恢复、live cwd 优先级、remote 保护及首次迁移旧 roots 替换已补齐，67/67 Rust lib、完整标准、Release 和当前哈希原生恢复失败/无效目标阻断证据见[恢复增量](../runs/20261031-codex-01b-workspace-recovery.md)；仍须补齐目标构造、membership transaction/rollback、权限扩展确认及真实后续 turn/重启集成再做项目菜单，详见[条件动作调研与更正](../runs/20261031-codex-01b-menu-conditional-actions.md)；新建时 afterSectionId/顺序未验证；本项目 create+move 为分步服务请求；官方运行时优先原生分支与本项目 HTML 仍有差距；官方运行时、App 缩放及同条件像素仍待采证；完整归档/删除/派生动作仍归04；IME/Tab 及用户验收仍待完成 |
| A12 滚动与长名称 | 当前release以28条隔离离线列表实测Sidebar内滚动首尾、返回顶部及项目列表5→15→25展开；Codex产品栏/新聊天入口留在滚动区外，项目/Recent头部随列表滚出。83字符混合长标题 hoverCard 三行换行/底边内定位已在旧构建验证；碰撞定位修复版现已以有效最小尺寸窗口验证悬停卡片仍留在视口内，且靠近底部时向上重排，见[窄窗续验](../../../.ref/parity/01/runs/20261101-codex-01b-narrow-window/actual/native-verification.json)及[定位记录](../runs/20261031-codex-01b-hovercard-position.md) | 官方运行时固定区/滚动条/overscroll/分段标题、官方同条件窗口与截图、卡片水平翻转（支持最小宽度下仍有足够右侧空间）；原生证据为JPEG且缩放未知，不作像素比较 |
| 手动拖动和取消 | L2 覆盖阈值/插入线/取消清理，部分原生排序往返已测 | 当前构建真实拖动中间态，以及在途 Escape/失焦/缩放取消的原生证据，不复用仅源码存在结论 |
| 跨窗口与服务变化 | 归属通知、快照代次、真实 CLI 持久化已有证据 | 本应用多窗口实例的刷新/关闭生命周期仍未形成完整证明 |
| 像素基准 | 官方参考候选已有，Windows/App 缩放、语言、主题仍未知 | 同版本、同客户区、同缩放/主题/语言的官方无损宽/窄截图；缺少时保持未验证 |
| 用户验收 | 各轮只交付增量 | 用户明确确认 01B；此前不放行 01C |

2026-11-01 A09 鼠标发送增量：原生竞态探针暴露了按钮直接透传 React 点击事件到 `overrideText`、成功后不清原草稿的独立缺陷；已用生产 JSX 和发送回调先复现，再以一处无参调用修复。SB01–SB04 L2、完整标准检查和独立目录 Release 打包通过；新 EXE `D30CEDF2…7A9EB53` 已在隔离原生窗口完成鼠标发送成功后清空原文字的 SB01 复验，见[鼠标发送记录](../runs/20261101-codex-01b-send-button.md)。本轮 TS/AS 附件在途新增探针仍无有效时序，不能因 shim 标记 `released:true` 就计为通过；SB02–SB04 原生、真实服务和官方/像素对照也未由该结果覆盖。

2026-11-01 A11 确认框键盘增量：补齐项目移动确认框内的 WebView 按键冒泡隔离、Tab 首尾循环、IME Escape 保护及关闭时恢复仍连接的先前焦点。PMK01–PMK06 执行生产 JSX/effect，先红后绿；详见[确认框键盘记录](../runs/20261101-codex-01b-project-move-keyboard.md)。这是 L2 增量，不消除上表的原生 Escape/焦点返回待验项；Tauri 原生菜单 accelerator、忙碌态实际焦点与官方对照仍待验证。

同日续修：PMK07 先红后绿，确认框打开/提交中，生产应用命令入口阻止背景快捷动作（缩放除外）和工作区/设置/重载命令；菜单与托盘实际回调纳入 L2 回归，关闭后恢复原有分发。此修复覆盖原生命令接线入口，但尚无新构建上的物理 accelerator 证据，不取消上述原生待验项。

本轮 A12 续验：以当前附件竞态修复版 Release 和两条隔离离线 fixture，在 Windows DPI 168 下取得约 960×640 CSS 尺寸的本机窗口；测得长名称会话悬停卡片没有越出右侧/顶部边界，较矮窗口下卡片上移并保留底边空间。已确认实际原生窗口路径可达并产生边界内布局；由于窗口缩放设置、官方配对图与官方运行时证据缺失，**不代表官方对照、严格像素验收或完整 01B 验收**。记录在附件验收运行报告与 `native-verification.json`；下一个工作项仍是官方可用条件下的 A12 对照以及缺陷优先级较高的 A08/A09 剩余项。

本轮 A11 原生续验：在最新菜单焦点修复版 Release 上，以隔离离线会话验证主菜单层级、空分区子菜单、新建分区对话框及 Escape/取消返回焦点；对应截图、UIA 结果和 SHA-256 见 `.ref/parity/01/runs/20261031-codex-01b-section-create/actual/native-menu-focus-verification.json`。Windows 窗口 DPI 168、主题深色、屏幕 2560×1600；App 缩放和官方同条件截图仍未知，因此不做像素比较或用户验收。

本轮 A11 分区子菜单结构、悬停与键盘关闭修正：依据官方静态 submenu 合同，子菜单为独立侧向浮层；指针移到其他根项或键盘移动焦点离开触发项时关闭子层，并覆盖悬停/点击、左右方向导航、Escape 和触屏 hover 抑制。三个 A11 专项、TSC、完整 `verify-all.ps1` 和 Tauri Release 构建均通过。最终 Release 为 `dist-artifacts/01B-section-submenu-keyboard-close-20261031/CodexNative.exe`，SHA-256 `CCFD415EB7764495ABD812BBB3F8AB27618CD08AA611F655F45D9EF2A10D125F`。前一构建 `5B4BF51D…A98BFDD` 已有隔离菜单层级/条目原生观察；最终构建的原生输入因 Computer Use 拒绝（输入点位于其他 WebView 窗口）而未执行，故此修复尚无绑定最终哈希的原生 UIA 证据。官方同条件截图缺失，视觉不可评分。详见[本轮结构化记录](../../../.ref/parity/01/runs/20261031-codex-01b-section-create/actual/submenu-structure-followup.json)。未读/项目移动条件动作仍受真实状态/接口缺失阻塞；IME、官方运行时、像素与用户验收未完成，01B 未验收，不放行 01C。

本轮项目移动事务增量见[项目移动合同与预检查](../runs/20261101-codex-01b-project-move.md)：后端现已实现确认后的 sources 写入与读回、workspace stage、membership 写后读、revision rollback、未知结果持久化/reconcile，以及同会话发送互斥；旧版不完整 applied 快照回退也已覆盖。当前会话操作菜单已接入已映射本地项目和 Chats 目标，缺失 sources 时显示确认框。15 项移动合同测试、完整 `verify-all.ps1` 与隔离 app-server 根扩展探针通过，Tauri Release 构建已生成并记录哈希。未在 Release/原生 UI 实际操作菜单、确认、取消和恢复，IME 及官方实际入口/同条件像素也未核验；不宣称整页验收。

2026-11-01 续验更新：上段“未在 Release/原生 UI 实际操作菜单、确认、取消”已由[原生确认与读回记录](../runs/20261101-codex-01b-project-move.md#2026-11-01-原生确认与读回续验)部分覆盖。隔离 Release 已完成移至项目菜单、缺失文件夹确认、取消零写入，以及确认后的项目 roots、会话 membership 和 workspace 快照读回；PM-NATIVE-01–03 均通过。修复了前端 server project ID 与后端映射解析的接线错误。最新 Rust 预检查回归 13/13、项目移动/Worktree 回归 27/27，完整标准检查退出 0。仍缺官方运行时对照、确认框 Escape/焦点返回、同条件像素比较及 01B 其余项目；App 缩放未知，01B 仍开发中、不放行 01C、待用户验收。

A11 最新原生状态补充（2026-10-31）：最终 Release `CCFD415EB7764495ABD812BBB3F8AB27618CD08AA611F655F45D9EF2A10D125F` 已在唯一窗口完成纯键盘 Home/Down/Down→Right 打开分区子菜单→Left 回父项→Down 移到归档并收起子菜单→Escape 关闭菜单。旧版重叠窗口导致的输入误路由已排除。该结果只闭环这一菜单键盘路径；条件未读/项目归属能力、官方运行时和同条件视觉比较、IME、其他 A11 用例与用户验收仍未完成，01B 不放行 01C。完整逐步证据见[结构化验收记录](../../../.ref/parity/01/runs/20261031-codex-01b-section-create/actual/submenu-structure-followup.json)。
