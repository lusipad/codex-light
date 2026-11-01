# 01B A12：local 会话悬停卡片

日期：2026-10-31。修改前动作合同。01B 开发中，不放行 01C。

## 基准与调研

固定官方 26.928.21956，asar SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。本轮重新核包并保存有界定位片段、文件哈希，见 `.ref/parity/01/runs/20261031-codex-01b-hovercard/reference/`；数字均为 0-based UTF-16 字符偏移。

- initial `Txo` 7105255 → `Sxo/vxo` 7096013 → `jmo` 6932892：local 行提供 rich 卡片，不是浏览器 title 或消息预览。普通路径有标题、时间、环境图标及项目；特殊云端、语音、自动化、错误与远程连接等 metadata 另有门控。
- `Mdo` 6830559 默认 right/start/sideOffset 2，交互式 rich；未向 `Vs` 传 `delayOpen/delayDuration`，`getDelayDuration` 保留默认参数。shared `Pli` 5717332 使用 `D??0`，仅显式 delayOpen 才置 250；provider `Nli.getOpenDelay` 只对近期同 key 改为 0，没有把 provider 的 200 自动注入此路径。因此本路径静态默认立即打开，不能凭 provider 常量武断加 200ms。
- shared `Pli/Fli`：touch 不触发；focus-visible 立即开；鼠标由行到卡片、卡片到行使用三角走廊，边缘扩展 8px，离开后 100ms 以 elementFromPoint 检查；移出走廊则关闭。窗口失焦、全局 Escape、`codex:dismiss-tooltips` 关闭；contextmenu 关闭悬停；卡片不自动抢焦点。blur 到卡片内部保留，blur 到其他区域关闭。
- `jmo`：width min(20rem,viewport−16px)、min-width14rem、gap1、px-row-x/py1.5；标题栏 gap3，标题 font14/medium/line20，允许三行，右侧紧凑时间与 unread dot。项目行 `Gfo` 6875742：icon16、gap6、font13/line20，截断而非强行换行。
- `Tmo` 6930076：标题是真实 button，点击进入行内 input 并全选。Enter 走 blur 保存；Escape 标记取消；blur 保存 trim 后的非空且不同标题。此入口与菜单弹窗的原始值保存合同不同，不能复用弹窗来冒充。
- `UQ/Zro/oio` 6655658 起：默认 compact/calendar；最少 1 分，60 分转小时，24 小时后按当地日历差；7 天转周，30 天转月，365 天转年。实际 zh-CN 为 `{value} 分/小时/天/周/个月/年`，不带“前”。server thread/list 给秒；官方 UI summary 已转毫秒，本项目需要在数据边界换算，不直接照搬其单位。
- 项目 label 优先已知显式名称，否则 cwd 末段，缺失时“聊天”；不编造消息、仓库或执行环境。现有 ThreadSummary 不能证明远程/worktree/自动化的完整字段，不能把所有会话硬标为某一特殊环境。

## 实施范围与取舍

增加 Sidebar 专用卡片，复用已有真实 ThreadSummary、项目归属工具、rename 回调和图标。一次只开一个卡片；不引入通用 tooltip 系统、不增加依赖、不新增服务端请求。使用实际 anchor/card 边界定位与 right/left 翻转、视口 8px 保护；极窄窗及官方完整 floating 中间件的精确结果仍需实图核验。环境图标只在当前数据能证明的普通 local 路径使用既有 LaptopIcon；特殊环境图标与额外字段保留差异，不推断未知类型。

没有官方同条件卡片截图，颜色/阴影复用现有 token，静态有证据的几何单独实现。无配对输入，visual-verdict 不运行评分，score=null。不能将“形态和功能更接近”写为像素通过。

允许文件：CodexSidebar、专用卡片与样式、实际组件专项及现有 fixture 最小扩展、标准入口和本轮资料。共享项目列表及其他页面不改。

## 修改前动作合同

| ID | 操作/状态 | 预期与验证范围 |
|---|---|---|
| HC01 | mouse 进入普通 local 行、keyboard focus-visible、touch | mouse/focus-visible 开；touch 不开；不切路由、不执行保存、不抢焦点 |
| HC02 | 比较内容 | 标题与真实名称/既有行 fallback 一致；时间按真实 recencyAt→updatedAt→createdAt（nullish），无 preview 消息段；项目取实际归属/路径末段 |
| HC03 | 右侧/底部/窄视口、滚动或 resize | 默认右侧 start+2，必要时翻左/位移，按当前元素实测尺寸；跟随重排布局，未对齐的极端结果登记 |
| HC04 | 指针行→卡片→行、离开两者 | 走廊内允许移入，不因 2px 间隙立刻消失；离开走廊关闭，100ms 外部落点检查；清计时器/监听 |
| HC05 | 点击卡片标题→编辑→Enter/blur/Escape | 打开行内输入并全选；trim、非空且改名才保存一次；空/同值/Escape不写；IME Enter/229不保存 |
| HC06 | 右键/更多/拖动/菜单重命名、折叠/筛选/移除行、卸载 | 不与菜单/弹窗/拖动叠加；清理失效 anchor、全局监听与计时器，不跨会话写入 |
| HC07 | 当前 release，隔离 home/profile | 不登录、不请求模型；验证可到卡片、编辑/取消/保存与独立真实CLI读回。缺少可用 hover 注入时明确未测，不能用 click 代替 hover证明 |

先留实际组件失败回归，再开发；原生浏览器事件、布局、物理 IME 与官方配对图需要独立证据。

## 实施与原生验证结果

实现见 `src/components/SidebarThreadHoverCard.tsx/.css` 与 `src/components/CodexSidebar.tsx`；新增 `scripts/verify-sidebar-hovercard.mjs` 并接入 `scripts/verify-all.ps1`。本轮真实 hover 卡片包含隔离会话标题“重命名验收 B”、紧凑时间“1 小时”、Laptop 图标及项目名 `codex-desktop-native`。没有消息预览；未改动项目实体或会话数据。

| 验证 | 结果 | 证据/边界 |
|---|---|---|
| L2 专项与组件动作合同 | 通过 | `scripts/verify-sidebar-hovercard.mjs`；覆盖显示内容、定位、走廊、保存/取消和清理 |
| TypeScript、完整标准检查 | 通过 | `npx tsc --noEmit`；`verify-all.log` 与 `standard-result.json`（退出码 0） |
| Release | 通过 | `build-final.log` 与 `build-final-result.json`（退出码 0）；EXE 为 `dist-artifacts/01B-hovercard-20261031/CodexNative.exe`，13,307,392 bytes，SHA-256 `61B736DE1D7BFBA1C3ECED5CDC1CE17D93CB55FE7D61022159636D4CC0CA6937` |
| 构建输入哈希 | 通过 | `build-inputs-before-final.json` 对比 `build-inputs-after-final.json`，123/123 个输入匹配 |
| 当前 release 原生 hover | 通过限定路径 | 隔离窗口实际鼠标移入会话行显示卡片；移入卡片仍显示；返回会话行再移出两者，等待 250ms 后卡片关闭。现场截图见 `actual/native-hover-open.jpg`、`actual/native-hover-closed.jpg`，机器记录见 `.ref/parity/01/runs/20261031-codex-01b-hovercard/actual/native-observations.json` |
| 视觉对照 | 未评分 | 当前只有实际 JPEG；无同版本、同窗口/缩放/主题/语言的官方卡片参考，设置仍未知。因此 `score=null`；不以截图生成视觉相似度，也不把实际图当基准 |

这组原生操作证明当前 release 的鼠标入口、卡片显示和离开关闭路径；不证明官方运行时像素一致、窄窗翻转、极端视口、键盘 focus-visible、touch、物理 IME 或重命名对话框路径。重命名另见[重命名增量](20261031-codex-01b-rename.md)。服务端/账号特殊会话、官方 hover 延迟及动态布局仍需官方运行时对照。

状态：本增量自验通过，待用户验收；01B 整体仍开发中，不放行 01C。
