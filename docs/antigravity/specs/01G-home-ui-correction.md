# 01G 首页结构纠偏：修改前合同

2026-11-04，按用户反馈和`docs/UI-CORRECTION-PLAN.md`执行。目标先修首页结构，再校准像素；不扩大新页面功能。

第一项UI-001：当前`ComposerBox`左侧运行位置菜单和右侧“工作树”checkbox均写`onSetUseWorktree`，右侧只按首页条件显示。新取证发现固定官方包`composer-utility-bar-23a8a57c560e.js::Bc`确有Worktree控件：受项目、远程/云状态、可用性及gate2785238453约束，并区分inline checkbox/menu switch。此前“官方没有独立控件”的判断撤回；本轮无条件删除的尝试已撤回，不能仅凭重复入口删除官方条件分支。先补齐运行位置菜单与该控件的关系，再按条件/样式纠偏。真实创建/发送路径保留。

调用链补证：Gc在se=true时渲染新Lc位置选择器及Bc(menu)；se=false渲染旧lc本地/工作树选择器且不渲染Bc。当前项目只实现旧lc形态，没有新Lc分支，因此移除此旧形态上拼接的首页inline checkbox；这不表示官方所有模式都没有独立控件。不强开或伪造未知gate，其他新工具栏形态保留待实现。

中文菜单按固定zh-CN资源及实际消费：header“工作位置”、旧Gs菜单local项“本地”、单仓库动作“新建本地工作树”、trigger tooltip“选择聊天的运行位置”；顶部短标签仍为“本地/新工作树”。“在本地处理”用于其他动作标题，不移植到Gs菜单。去除英文括注和没有该菜单依据的常驻两行说明，不把官方tooltip改作常驻description。多仓库命名、远程分支及完整门控尚未闭环。

修改前验收：

- 首页运行位置触发器及Worktree控件按官方适用条件显示；未知条件不伪造为已确认，不用无条件隐藏绕开取证。
- 菜单仍能切本地→新工作树→本地，每次只调用一次既有回调；选中状态、触发器文字更新，选择后菜单关闭。
- Escape、Tab、方向键和IME保护维持现有回归，发送仍按所选位置创建/复用真实工作树，不另加模拟路径。
- 运行位置菜单存在并不证明完整菜单内容已对齐；当前中英括注、说明、适用条件继续核对固定Store包，未证实前不凭个人理解改文案。

官方基准沿当前Store26.1027.3384.0、asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`；本轮新取证放`.ref/parity/01/actual/ui-correction-20261104/reference/`。旧offline图不作当前同环境像素通过依据；用户图是缺陷反馈，不是官方图。

后续本页结构检查范围：标题栏/导航轨/侧栏/主区及Composer上下文、输入、动作区；逐项建立多出/缺失/错误层级/待证清单。没有配对官方图时不输出相似度或1px通过。原生GUI/IME和用户验收仍独立待验。

## 第二批：计划footer指示器（修改前合同）

范围仅将现有激活计划状态从顶部emoji span纠正为footer按钮，不增加模式或修改真实发送参数，Fast未知徽标不动。

固定`composer-content-e36dff9dfe56.js::OL`仅在`activeMode.mode===plan`时渲染`jL`。`jL`原文使用`size=composer/color=ghostActive`，`aria-label=计划`、tooltip“创建计划”，布局`flex items-center gap-1 text-tertiary`及narrow FooterLabel；点击`setSelectedMode(hasDefaultMode ? default : null)`，即退出当前计划模式。本项目bool状态继续复用`onTogglePlanMode`退出，不伪造额外default/null配置。顶部“🗺️ 计划模式”span移除。

图标源已追到shared：`Vw→ZGn`资源名`lightbulb-rays-light-16`，hover的`pg→c4n`为`circle-xmark-fill-light-16`；jL通过group-hover显隐切换。本批使用既有lucide依赖的Lightbulb/CircleX表达已证语义并实现hover切换，不复制官方资源、不宣称SVG路径/填充像素相同；官方精确资源、FooterLabel截断、tooltip延迟和ghostActive token仍待对照。

修改前用例：激活plan的home/thread均只有footer中的button（type=button、名称计划、title创建计划）；关闭时不显示；点击只调用一次原回调并退出，不发送消息/不修改工作位置；顶部不再出现该span，Fast保持原行为。原生button提供Enter/Space语义，保留现有菜单方向键/Escape/Tab/IME回归；真实原生键盘及配对截图另验，不以Node回放替代。

实施与定向自验：先新增生产组件回放，再运行`node scripts/verify-composer-menus.mjs`退出1，失败为`home: active plan must be a keyboard-accessible footer button`；随后移除顶部span，在既有footer左区加入原生button，复用原回调，回放退出0。home/thread激活/退出、单次回调、保留Fast以及既有菜单焦点/Escape/Tab/IME均通过。`node node_modules/typescript/bin/tsc --noEmit`与所属文件`git diff --check`退出0。没有Cargo、原生打包或真实模型请求。

样式复用现有composer-inline-pill，只加计划专用gap/tertiary文字、hover图标切换与focus-visible。shared按钮`ghostActive`原文为默认透明、hover/open采用primary-ghost-hover，本批不将激活状态画成旧蓝色badge。删除的`.composer-mode-badge.plan`仅服务被移除span；公共badge及Fast样式保留。当前tooltip使用原生title，官方tooltip组件时序/定位未还原；lucide图标与官方SVG、完整footer几何/截断、原生键盘和同环境像素均未验。视觉记录为not_evaluated、score=null，不报告页面通过。
