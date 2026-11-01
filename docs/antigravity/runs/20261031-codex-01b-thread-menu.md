# 01B A11/A12：会话行菜单键盘入口与关闭行为

日期：2026-10-31。修改前合同，01B 开发中，不放行 01C。

## 调研、依据与边界

固定本机官方安装包 26.928.21956，asar SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`；initial/shared 已重核。路径、完整哈希、有界定位片段保存于 `.ref/parity/01/runs/20261031-codex-01b-thread-menu/reference/`。以下数字为 0-based UTF-16 字符偏移，不是行号。

- initial `bAa`，5849466：行是可聚焦 button 语义，Enter/Space 仅目标为当前行且未被阻止时选择。
- initial `Mdo`，6830559：独立 ariaLabel、onContextMenu 与 renderActions；hoverCard 有内容/方向/延迟等参数，不能以浏览器 title 代替。
- initial `kwo`，7189635：更多按钮有 aria-haspopup/expanded，点击与 Enter/Space 阻止冒泡，通过 `Ra` 打开。
- initial import `KS as Ra`；shared 导出 `kyi as KS`，7670795 附近，`kyi` 起于 6423628：统一处理 ContextMenu/Shift+F10，排除嵌套目标、已阻止事件及 Alt/Ctrl/Meta；右键独立于点击。若有 electronBridge.showContextMenu，优先原生分支；结束后恢复仍连接的此前 activeElement，允许动作覆盖。
- shared 同一实现也有 HTML fallback，不能由其存在推断 Windows 当前运行时使用 HTML。初始包内部分其他 gate 包含 `codex-offline` 注记，本轮不使用这些分支证明账号能力或真实可用性。

当前实现：会话行右键已有独立回调，但没有键盘菜单入口；菜单动作都是不可聚焦 div，没有初始焦点/导航/返回；捕获任意 scroll 会关闭菜单自身的滚动。完整动作列表、二级分区菜单与原生形态仍存在差距，属于后续对照及 04 管理动作，不在本轮宣称完成。

## 实施范围与假设

本轮仅修补现有 HTML 菜单的键盘可达、事件隔离、关闭焦点与内部滚动，不扩大动作内容，不更改真实管理协议。使用原生 button 和既有样式；必要的 button 样式只局限该菜单。没有官方同条件配对图，不能评分或宣称像素一致；原生菜单等价仍待验证。

允许修改：CodexSidebar.tsx、必要的局部 CSS、实际组件专项及 fixture 的最小扩展、标准检查入口、本轮资料。复用现有 Sidebar、服务回调和测试 harness；不扩展共享 ThreadActionsMenu 的公共 API。

## 修改前动作合同

| ID | 操作 | 预期及证据 |
|---|---|---|
| TM01 | 右键非当前会话 / 点击更多 | 不选择会话，不触发父行点击；菜单具有 role/name，进入首个可操作项 |
| TM02 | 行获得焦点→菜单键 / Shift+F10 | 打开同一菜单；带 Alt/Ctrl/Meta、子控件目标、IME、已阻止事件不接管 |
| TM03 | 菜单内上下/Home/End→Enter/Space | 焦点按可操作项移动；由真实 button 执行动作，生产回调只调用一次，L2 与原生分别记录 |
| TM04 | Escape / Tab / 外点 | Escape 消费事件并恢复之前仍连接的焦点；Tab 关闭且不阻止浏览器默认移焦；外点不抢焦点 |
| TM05 | 菜单自身滚动 / 侧栏滚动 / resize | 内部滚动保持菜单；外部滚动/resize 关闭且不抢焦点；不是官方动画/滚动策略已实测结论 |
| TM06 | 菜单打开时折叠侧栏 / 删除所属行 / 卸载 | 关闭并释放监听，不留下不可见的全局 Escape 捕获，不执行动作 |
| TM07 | 当前 release，独立 home/profile | 只使用隔离离线会话样本验证入口/导航/关闭/焦点；不登录，不请求模型，不操作已有用户窗口 |

TM05/TM06 是当前 HTML 实现必需的不变量修复，未实测官方相同行为。先留失败回归，再改代码；初始焦点、浏览器 button 激活/Tab、事件冒泡需原生补验，L2 不替代。长名称丰富 hoverCard、窄窗固定头尾和官方精确滚动布局本轮继续取证，不凭猜测加样式。

## 实施结果与复用

会话行提供完整 aria-label；菜单键/Shift+F10 按静态合同进入原入口，子控件、其他修饰键、已阻止及 IME 事件不接管。更多按钮补 menu/expanded 语义，保持独立点击回调。现有 div 动作改为真实 button/menuitem，打开后聚焦首项，支持上下/Home/End；使用原生 button 的 Enter/Space 激活，不额外注册重复执行逻辑。

新增一个关闭回调统一处理状态和焦点：Escape 消费事件并恢复打开前仍连接的元素；外点、Tab、外部滚动/resize 不强行返回。内部滚动保留菜单，侧栏折叠或所属会话消失时清理菜单与监听。CSS 仅补本菜单 button 的布局、继承字体和原有 hover/selected 色，保留浏览器可见焦点框，未按未知官方图调整像素。

复用原 Sidebar、服务动作与 `verify-sidebar-projects.mjs` 的组件 harness，只补 DOM/ref/focus fixture 并导出 mount；没有新依赖、Rust、协议字段或共享菜单 API。分区仍是旧内联展开，动作文案/emoji/原生形态不因此成为官方一致。

## 验证

证据根目录 `.ref/parity/01/runs/20261031-codex-01b-thread-menu/`。

| 项目 | 结果与范围 | 证据 |
|---|---|---|
| 修改前专项 | 失败：右键菜单缺少可访问的 menu 语义 | `before.log` |
| TM01–TM06 L2 | 实际组件回调、DOM/ref 边界受控回归通过；含上下环绕、修饰键/子控件/IME、动作只调一次、内外滚动、折叠/移除/卸载清理 | `focused.log`、`scripts/verify-sidebar-thread-menu.mjs` |
| 反证 | 移除键盘入口、焦点恢复、内部滚动过滤三项内存变异均被断言捕获；未改磁盘产品代码 | `actual/mutation-checks.json` |
| 完整标准 | 退出 0；类型检查、前端构建、Rust check、automations 过滤单测、六个隔离协议探针 | `verify-all.log`、`standard-result.json` |
| release | 退出 0；118 个输入构建前后重核一致 | `build.log`、`build-result.json`、`build-identity.json` |
| TM01–TM04/TM07 原生限定路径 | 右键不导航、Home/End/Down、Enter 展开/打开会话、Escape、Shift+F10、更多关闭后 Space 重开、Space 展开、Tab 关闭、外点后直接输入通过 | `actual/native-observations.json` |
| TM06 原生限定路径 | Ctrl+B 折叠时关闭；重开侧栏没有残留菜单；草稿仍在 | 同上 `collapse-with-menu` / `expand-without-stale-menu` |

原生使用独立 home/profile、两条明确离线样本，未调用 turn/start/模型或认证操作，未控制此前窗口。UIA 即时树有滞后，记录稳定重读；focused_element 只返回窗格/RootWebArea，焦点通过可见框和下一次按键结果佐证。截图仅工具现场观察，没有保存 payload，不能将这些记录当作可复算的像素差异图。未在本轮原生验证真实长菜单滚动、resize、所属行删除、全量动作写入、IME 或 ContextMenu 物理键；其中键盘入口的 ContextMenu 分支只有 L2。

本轮无 Rust 产品改动，没有新增全量 cargo test 结果；标准脚本的过滤单测不能写成全量 Rust 测试。没有独立 lint 配置；构建有既有大 chunk 警告，未为消除警告改动分包。

产物：`dist-artifacts/01B-thread-menu-20261031/CodexNative.exe`，13,304,832 字节，SHA-256 `7c855eaaf635c6077e331ad0d59d50e1e7c5e009da651049fe0e772f6ab0d8f9`。原生记录属于此文件，不沿用旧 EXE 结论；未宣称二进制可复现。

## 剩余差异与下一步

官方菜单优先原生分支，本项目仍为 HTML；真实 Windows 分支、项目/分区二级层级、文案/图标/尺寸/位置/焦点框、完整管理动作没有 1:1 结论。旧定位仍使用估计宽高，没有在本轮假装已做几何校准。长名称 hoverCard 的字段、延迟和布局、长列表/固定头尾/窄窗，以及用户未知的官方缩放环境继续取证。

下一项仍在 01B：追 local 会话行到菜单 builder/hoverCard 的具体绑定与适用状态，补真实滚动场景，再按合同修复；完整管理动作单独归 04。视觉缺少同条件配对图，visual-verdict 无输入，score=null。增量待用户验收，01B 开发中，不放行 01C，没有提交推送。
