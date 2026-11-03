# 16.02B：独立浅深主题与实际颜色消费闭环

2026-11-03。修改前只读调研合同。承接 [16.02 原合同](16-02-appearance.md) 与 [16.02A 待验表](../acceptance/16-02A.md)，本轮只新增资料，不修改产品、测试、依赖或用户偏好，不启动官方 GUI，不运行 Cargo。外观分区仍未验收。

## 下一主要动作与范围

下一阶段应做“选择/编辑当前浅色或深色主题 → 实际页面颜色与代码主题变化 → 保存 → 切模式/重开读回”的完整主题闭环。当前缺少整个主题操作与消费链，不能用新增一个指针开关、修一个字号细节或再次跑构建代替此主要动作。

三态模式、双字号、系统 motion 订阅已有实现；本次没有发现证据证明这些现有动作需要全部重写。主要功能差距是真实主题数据、独立浅/深值、颜色/字体/preset 控件与主题变量消费者。单纯把当前页面 CSS 调得更像仍不能补齐它们。视觉校准与原生验证须另留独立结论。

## 固定来源与边界

主要新增来源为已独立核验的 Store 包：

- `C:/Program Files/WindowsApps/OpenAI.Codex_26.1021.3705.0_x64__2p2nqsd0c76g0/app/resources/app.asar`
- 640129388 bytes；SHA-256 `04862a659c6a90fc50514d8c0b8016709d97dece58839726c57495ed72f1d9f0`。
- 本次重新读取原包、核对整包哈希，并独立提取 14 个 entry；每项 SHA-256 均与原包 entry integrity 相同。
- [manifest](../../../.ref/parity/16.02/actual/16-02B-research/manifest.json)、[47 个定位锚点](../../../.ref/parity/16.02/actual/16-02B-research/anchors.json)、[当前产品输入快照](../../../.ref/parity/16.02/actual/16-02B-research/product-snapshot.json)；原始字节保存在同目录 `raw/`。
- 父任务另存的 Store 签名/AppxBlockMap 证据见 `.ref/reference/store-26.1021.3705-20261103/`。本合同的静态提取不替代运行时和像素验收。

所有下述数字均为对应 Store 原始文件解码后的 **0-based UTF-16 字符偏移**。不能套用 16.02A 的旧离线候选文件/偏移。旧候选包 SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb` 含已知 offline 补丁，仅保留历史来源意义。

## Store 链路证实的行为

| 原始文件/锚点 | 已证实行为与实现约束 |
| --- | --- |
| `app-shared-955d52676f9c.js` @1748455 附近 `dst` schema | chromeTheme 包含六位十六进制 `accent/ink/surface`、0–100 整数 `contrast`、`opaqueWindows`、`fonts`、`semanticColors.diffAdded/diffRemoved/skill`；`accentSource` 可为 chatgpt/custom。不能随意保存少量未验证字段并声称完整主题合同已实现 |
| shared @1809765 起 | `appearanceTheme` 三态；`appearanceLightChromeTheme` / `appearanceDarkChromeTheme` 和 `appearanceLightCodeThemeId` / `appearanceDarkCodeThemeId` 分别存储，code preset 默认 CODEX |
| shared `function IX` / `function LX` | 上述模式/主题/双字号/指针为 `hostStorage.kind:"configuration"`，`reduced-motion-preference` 为 `global-state`。这是宿主存储分类证据，**尚不证明对应 CLI config 的字段映射、作用域或通知合同**；开发前须追踪宿主配置适配，不能自行把它们写入任意 app-server 字段 |
| `general-settings-72933accc786.js` `function tc(e)`，精确偏移见 anchors | 外观先显示 Visual style，模式与当前 variant 主题；Advanced 折叠区另外包含分别设置浅/深的开关。锚点文件保存精确起点，不依赖猜测行号 |
| general @49600 附近 `$a` | separateModes 为 false 时只编辑有效 variant；为 true 时同时展示 light/dark 两组；切换展示本身不是复制、清空或重置另一组 |
| general @50k–58k `eo` / `ce=(e,t)=>` | 主题卡提供 accent/surface/ink、UI font；Advanced 包含 UI font style、content/code font、contrast 和平台允许的透明侧栏。修改 accent 设置 `accentSource:"custom"`，不是账户主题同步已成功 |
| `code-theme-20b725ca5561.js` `u/ee/te/y` | preset 按 variant 过滤，标签排序；实际懒加载对应 theme seed，衍生 chrome/semantic colors。不可只改 preset 标签或仅着色菜单预览。catalog 中存在 ayu、github、dracula 等不证明全部 variant 均可用 |
| `app-theme-settings-77e2fe59e621.js` `P`、`await u(o,t.theme)`、`await u(s,t.codeThemeId)` | 保存队列、pending snapshot、部分写入恢复；preset/theme 组合保存失败要处理已成功的一部分，晚到旧 preset 加载以 editRevision 防止覆盖新编辑。UI 更新不等于写入成功 |
| theme-settings `Te/L/Ee/R` | theme/code preset 独立按 light/dark 读写；分享格式 `codex-theme-v1:`，导入校验 variant/schema/preset。拷贝失败不报成功；导入空/非法/variant 不符不可写入 |
| `app-theme-c4609c25be6b.js` `a/o/u` | 规范化颜色、contrast、字体；颜色为完整 #RRGGBB；contrast 四舍五入并限定0–100；fonts 空串转 null。默认值来自 defaults，不从当前 CSS 反推 |
| `defaults-930c9f21f410.js` | dark 默认 surface `#181818`、ink `#ffffff`、contrast60；light surface `#ffffff`、ink `#1a1c1f`、contrast45；默认accent `#339cff`。这些是 theme seed，不等于所有最终控件背景或账户有效强调色 |
| `app-theme-c850e3c1c24c.js` `p/h/Y/X/Z` 与 `style-vars-200c1bccafff.js` `t/r` | 实际生成 semantic CSS 变量，包括背景、文字、composer、用户消息、selection、focus、图表等；注入 `[data-theme=light/dark]` 的 style，并设置实际 document theme。不是四个全局颜色字符串替换 |
| `general-settings` @87k `Xo` 与 theme-settings `contrast:Y.contrast` | Advanced 恢复用 Promise.allSettled，部分失败有错误；恢复 contrast/opaqueWindows、code/content font 与 UI font face 等，高级重置**并不重置所有颜色、UI family、模式和 preset**。不能做成“清空全部外观” |
| `app-initial-438d1df57f70.js` @6429k | 系统模式优先宿主 `getSystemThemeVariant/subscribeToSystemThemeVariant`，浏览器 matchMedia 为 fallback。当前 matchMedia 实现不等于 Windows 原生宿主变化已验 |
| `zh-CN-bd2cd8444335.js` | 真实中文包括“分别设置浅色和深色模式”“重置为默认设置”“背景”“强调色”“导入主题”；完整键值见 raw/anchors。不得由 defaultMessage 自译冒充官方中文 |

表中的相对范围只便于阅读；开发引用以 anchors 中精确 term、UTF-16 offset、原文件哈希为准。`function tc(e)` 的精确 offset 已入 anchors；没有原始运行时尺寸数据，不凭 chunk className 推定物理像素。

## 当前源码核对

1. `src/appearancePreferences.ts` 当前只定义模式、双字号与 motion 四键，`applyAppearance` 设置 document theme/字号/motion并订阅 matchMedia，已有真实 CSS 消费。没有 light/dark chromeTheme、preset 或 theme seed。
2. `AppearanceSettings.tsx` 只有模式 radio、motion select 和双字号输入，没有真实主题卡、颜色/字体/preset、独立浅深展示、导入导出及精确 Advanced 恢复。
3. `src/styles.css` 保留固定 light/dark 颜色表，部分 palette override 仅覆盖主背景/主文字/accent。不存在 Store 的完整 semantic 变量生成与账户/自定义 accent 区分，因此修改几个 CSS token 不能声称主题已等价。
4. 当前 App 调用一次 `useAppearancePreferences`；每个独立 Tauri webview 都从 `main.tsx` 挂载 App。hook 只在挂载/手动 reload 时 `desktop_state_get`；保存只更新本地 React state，`desktop_state_set` 未广播外观变更。跨窗口实时同步当前没有闭环；**官方跨窗口具体时序仍须补运行时证据**，不得把推测的毫秒阈值写成官方事实。
5. 现有保存有读回确认/失败状态，已有系统监听清理，不应丢弃这些边界重写成只更新 UI。现有代码字体CSS消费者真实存在；尚未重做本次全部 computedStyle/native/视觉对照。

## 开发前必须补齐的依赖

- 追踪 Store configuration/global-state 的读写/广播适配与当前配置作用域，明确本项目等价持久化与跨窗口读取边界；无证据时保留“存储语义待证”，不得凭字段名称直接发送新协议。
- 提取选择阶段实际使用的 preset 原始资源与许可/哈希，列出完整 variant 目录和失败行为；本次14项证据没有提取每个懒加载 preset 的完整资源，不可当作已具备全部配色数据。
- 确认本地自定义 accent 与账号色同步的职责；账号/远程保存能力受限时明确列待验。不得请求付费模型、写用户真实配置或把本地颜色当作已跨设备同步。

## 修改前可测试合同

| ID | 操作及预期 | 验证证据 |
| --- | --- | --- |
| AB01 | light/dark 保存不同 theme 与 preset；system 根据真实系统variant选择，切模式不覆写另一组 | 隔离存储读写/重启，状态机与实际computedStyle |
| AB02 | 编辑当前主题的背景/文字/强调色，首页、侧栏、聊天、composer、菜单、diff、选区/focus实际消费；preview与正文一致 | 同一输入theme到token的确定性样本；真实DOM消费者截图/样式，不只检查变量存在 |
| AB03 | preset按实际variant可用目录展示；选择加载真实seed并改变代码/应用主题；加载失败保留已确认主题且可重试；旧慢请求不覆盖新选择 | 成功/失败/乱序/离页回放；原资源哈希；代码块/diff真实颜色 |
| AB04 | separateModes只影响两组展示；切换开关不改变已保存两组数据；两种模式均可编辑，inactive variant 不误改当前 | 保存前后真实数据比较，窄窗/长标签交互 |
| AB05 | 写入/读回失败可见；组合写部分失败记录真实结果与恢复失败，不能弹成功或让旧回调覆盖新编辑 | 隔离状态故障注入/重新读取，保留失败原始输出 |
| AB06 | 主题导出保留正确variant/preset/规范字段；有效导入真实写入，空/非法/错误variant/preset不可写；复制失败无成功提示 | 真实clipboard受控fixture与格式往返；取消不改变数据 |
| AB07 | Advanced恢复只改官方定义的高级字段；颜色/UI family/mode/preset保留，部分失败有提示和重读 | before/after逐键比较；官方字段清单对照，不测试实现自选清单 |
| AB08 | 主窗修改后独立会话窗读取一致；新窗/重启一致；旧读响应不盖新值，监听随销毁释放；用户输入中的未提交字号草稿不被无关事件吞掉 | 两个隔离webview/受控hook，再补原生两窗；官方实时延迟未测不设虚构阈值 |
| AB09 | 系统variant/motion变化及固定覆盖、双字号/IME保存、已有文件/聊天/diff/终端不回退 | 复用16.02A回归，额外保存计算样式与原生结论 |
| AB10 | 输出同源码构建，真实设置页宽/窄窗、展开/折叠/颜色弹层/导入弹窗，鼠标Tab/Escape与焦点返回 | 原生证据与官方同环境配对截图、overlay/diff、几何测量；没有配对不标像素通过 |

以上合同不表示已实现或已运行。建议一次推进独立主题数据/存储、preset/颜色编辑、实际CSS消费这条主要闭环，再补原生/视觉验收；若因完整 preset 或配置映射证据缺口拆阶段，必须明确缺项，不能称整页完成。完整字体枚举/字形安装、账户跨设备accent、原生透明背景、全部高级平台差异仍需专门证据。
