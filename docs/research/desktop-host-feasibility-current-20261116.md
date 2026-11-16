# R3 当前版 Windows 宿主增量研究与最小探针合同

日期：2026-11-16。任务范围：独立只读研究，供 R2 插件整页之后执行 R3；本报告不放行整页、不把探针计划写成运行结果。未改产品、未构建或执行控制/捕获、未强开 gate、未操作官方 GUI/隐私权限、未新增依赖。

基准：固定快照 `26.1111.2228.0`，独立读取 `.ref/parity/12/whole-page/reference/r1-20261116-current/snapshot/app.asar` 并重算 SHA-256 **2551cba1057a05cdc5cf5d75b146fac4092bff4ce77a10c43e3286c88d24c82d**。本次独立证据目录 `.ref/parity/16/desktop-host-r1-20261116-current/`，未修改或混入 R2 manifest。

已读旧[宿主矩阵](desktop-host-feasibility-20261116.md)与[16.22](../antigravity/specs/16.22-computer-use-settings.md)、[16.23](../antigravity/specs/16.23-appshots-settings.md)、[16.24](../antigravity/specs/16.24-browser-use-settings.md)。旧规格的“撤无效开关、保留真实能力边界”仍适用；其旧离线补丁包不作为当前版本来源。

## 1. 当前版核对：哪些保持、哪些变了

| 旧矩阵结论 | 当前版直接证据 | 结论 |
|---|---|---|
| Windows应用批准来自 `computer_use.windows.always_allowed_app_ids` | `early-bootstrap-331-29198f5b57adf59a.js` 2081850、`qw` 2084160；返回CODEX_HOME/config.toml，删除真实批准并重读 | 保持；单纯增加前端白名单不等价于执行授权 |
| 声音和locked use不能无条件做成Windows开关 | 同文件 `getSoundMode` 2090438 仍darwin限定，`getLockedUseState` 同样平台限定 | 保持；null不能误报off/保存成功 |
| Appshots Windows默认双Alt/可双Shift | 同文件4728348，`795202.d8340effb5.js` 7613 | 保持；注册失败回滚、supported/isActive仍由真实服务决定 |
| Windows helper v1和windows_appshots_v2握手 | 主进程4736389 schema、4959628 service_info | 保持；文件存在不等于运行成功 |
| Automatic依据60秒最近聚焦，支持最近/新聊天/Mini | 主进程4733195，QrD.destination/alwaysSendToMini消费者 | **仅在未委派companion时保持** |
| Appshots仅走上述聊天/Mini路由 | 主进程新增 `companionHandler`、`setCompanionHandler`，`#ct` 的 `native-companion`分支优先执行并return（Windows down若已直接派发则up会提前返回） | **旧描述不完整，需新增native companion分支及生命周期**；存在/是否当前账号启用仍未实测 |
| 浏览器按in_app_browser/host门控设置能力 | `581241.9f0e11770b.js` 75998，enabled且非loading | 保持，**当前矩阵新增bookmarks**；不可从旧6项矩阵漏掉书签 |
| 浏览器数据须真实native session/权限服务 | 主进程1927173 getBrowsingDataSummary；设置appServices.browserProfileImport及真实清理/下载消费者 | 保持；普通WebView不证明完整管理能力 |

当前提取4个asar条目逐项核integrity；另登记当前安装目录helper/transport 3个文件hash；29个 UTF-16 字符偏移锚点。旧混淆符号不可沿用。未发现足以推导Windows账号gate、完整支持状态或像素一致的静态证据。

## 2. 优先复用本机已有实现基础

### 2.1 自有Windows宿主优先，不依赖官方二进制分发

本机 Windows SDK `10.0.26100.0` 已有 `UIAutomationClient.h`、`windows.graphics.capture.interop.h`、C++/WinRT `Windows.Graphics.Capture.h`，已登记路径/hash。项目已经用 `scripts/build-desktop-notifications.ps1` 与 `src-tauri/build.rs` 编译链接自有 C++20 SDK 适配器（desktop_notifications/system_fonts）；因此可以沿用**独立C++20私有探针→有证据后再纳入小型原生适配器**，不先加Rust/Node依赖。

- 窗口身份：Win32 HWND/PID + 自有测试窗口注册nonce，所有请求复核PID、HWND有效性与当前前台目标；不枚举用户窗口作为首次探针。
- 窗口像素：Windows Graphics Capture `IGraphicsCaptureItemInterop::CreateForWindow`（Windows10 1903起）+ D3D11帧池，保留系统捕获边框；不调用Borderless权限请求。先检测GraphicsCaptureSession.IsSupported，不把API头存在当本机支持。[Microsoft CreateForWindow](https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/nf-windows-graphics-capture-interop-igraphicscaptureiteminterop-createforwindow)、[捕获支持](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturesession?view=winrt-26100)、[边框权限](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturesession.isborderrequired?view=winrt-26100)。
- 窗口文本：UIAutomation ElementFromHandle，递归限深/限数/超时；TextPattern.DocumentRange可返回整个文档范围，**是否含屏外文本取决于控件provider**，不能保证任意应用。对不支持返回unavailable，不把截图OCR或空串冒充AX。[Microsoft DocumentRange](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nf-uiautomationclient-iuiautomationtextpattern-get_documentrange)、[文本模型](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-understandingtheuiautomationtextobjectmodel)。
- 动作：先在自有窗口尝试UIA Invoke/Value，必要时SendInput；每次动作前校验显式批准及前台目标，取消优先。SendInput受UIPI限制，只能注入同等或更低完整性应用；返回成功数量仍需读回可观察结果。[Microsoft SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)。不申请提权/更改uiAccess解决探针失败。

上述是基于官方SDK与本机资源的**实现候选**，本任务没有编译/执行，未证明WGC帧采集、UIA provider、输入法或取消已成功。

### 2.2 浏览器复用锁定Tauri，而非另起Electron

当前Cargo.lock：tauri `2.12.4`、wry `0.57.0`、webview2-com `0.39.1`。本机该锁定版本源码已确认WebviewWindowBuilder的 `on_navigation`（266）、`on_download`（384）、`data_directory`（1089）、`browser_extensions_enabled`（1177）、`with_webview`（2498）。这些可供私有profile和下载/导航原型使用，无需新增依赖。

Tauri层没有因此自动提供官方完整历史/下载库/密码/书签/导入服务。WebView2 Profile有清数据与扩展API，但须逐项核运行时接口及产品适用性，不把Chrome/Edge用户profile直接挂载到我们窗口。[Tauri接口](https://docs.rs/tauri/2.12.4/tauri/webview/struct.WebviewWindowBuilder.html)、[Microsoft Profile](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/winrt/microsoft_web_webview2_core/corewebview2profile?view=webview2-winrt-1.0.3650.58)。

## 3. 每能力最小可逆探针：明确执行器、输入、预期和消费者

以下均为**待执行合同**，不是本轮通过结果；未来实现仅在私有目录，例如 `.ref/parity/16/desktop-host-probes/<run>/`，不修改当前产品。先P0→P1→P2→P3，不并行控制桌面。

### P0 自有宿主编译/握手，不访问桌面

- 执行器：本机SDK编译的自有 `host-probe.exe`（复用现有MSVC发现/C++20编译方法，不复制官方helper）。
- 输入：`{"id":1,"method":"service_info","params":{}}`；随后 `{"id":2,"method":"close","params":{}}`，stdio JSONL。
- 预期：只报告自身协议版本/可检测但未激活的能力；不能在尚无实现时宣称windows_appshots_v2。超时、非JSON、进程退出均失败，5秒内清理子进程。
- 权限/数据：无UIA、无窗口枚举、无hotkey、无网络、无官方配置。仅私有日志；比对目录前后变化。
- 消费者：后续Tauri host-status服务才能据握手显示真实状态；**不能仅因此恢复三个设置页开关**。
- 阻塞：无SDK/链接失败/cleanup失败；修复探针而非安装新依赖或开启特权。

### P1 Appshots：先单窗口目标/像素/可用文本

- 执行器：自有host-probe与自有Win32测试窗口，同一私有进程族。窗口显示固定色块、唯一nonce以及可滚动多行Edit，末行含屏外哨兵；窗口显式返回HWND/PID/nonce给父进程。
- 输入：`{"id":3,"method":"capture_fixture_window","params":{"fixturePid":123,"fixtureHwnd":"<运行时句柄>","nonce":"<运行时nonce>","includeAccessibility":true,"outputDirectory":"<本轮私有绝对目录>"}}`。示例PID只是形状，执行必须取真实值，不接任意客户端传入的其他PID。
- 预期：目标metadata吻合；只生成该窗口像素与其可用文本、bounded状态/时间。图像尺寸/固定色块/nonce由测试窗口已知场景验证；文本若provider支持DocumentRange则含末行哨兵，否则明确unavailable并登记限制。目标关闭/取消/重用句柄不返旧图或其他窗口图。
- 权限/数据：不读用户前台/后台窗口，不请求Borderless/屏幕录制权限改变，不自动选择系统隐私dialog。用保留系统边框WGC；若系统明确要求新授权，停在待用户交互，不擅自改权限。
- 消费者：先接私有验收窗的本地附件草稿，校验metadata/图片/文本归属；成功后才移植产品Composer附件管道。现有主屏PNG入口继续明确称截屏，不升级标签冒充Appshots。
- 阻塞：WGC不支持、目标不可捕获、AXprovider无屏外文本、DPI坐标不明、取消/资源释放失败。不同能力分别报告，不将AX不可用伪装为整体失败或空文本通过。

### P2 Appshots：路由/快捷键与新增companion

- 执行器：P1已通过的自有宿主+私有应用profile，无模型服务。
- 具体路由输入：私有确定性状态 `destination=automatic/last-chat/new-chat`、`lastPrimaryFocusAgeMs=59999/60001`、`canAccept=true/false`、`isNewChat=true/false`、`miniVisible=true/false`、`preferMini=true/false`、`companionAttached=true/false`。时间使用注入的测试clock验证边界，不把固定计时器当产品执行。
- 预期：未附companion时按官方合同投递到当前/新草稿/Mini；进入普通快捷键dispatch（`#ct`）且附companion时先交companion且不同时追加两次；companion失败只记录错误，不能自行回退新草稿。另测Windows down已在可接收当前窗口直接派发时，up不再进入`#ct`，避免错误地把所有Windows按键都强制送companion。目标窗口destroy、服务晚回、导航/换账号均不把附件附到新目标。companion接线条件尚未完全核定，**当前只锁定优先分支，未授权自行新增开关**。
- 快捷键先验证自有窗口局部事件的双Alt/双Shift down/up去重；下一步才在独立可退出进程注册临时hook并即时注销，**不写用户全局快捷键**。只使用已获授权的测试窗口，Esc取消优先、进程退出不能残留hook；注册冲突回滚并读回旧值。
- 消费者：真实attachment reducer/草稿选择/Mini与companion生命周期；设置写入必须只在执行器注册成功后持久化。
- 阻塞：companion账户适用性未知、hook冲突/未释放、路由重复/错投、原生IME验证不足。可先交付不依赖companion的已证路径，不能将整项记通过。

### P3 Computer Use：明确拒绝零副作用，再允许一次动作

- 执行器：自有host-probe，仅控制上述自有nonce窗口；不运行模型，也不发远端tool调用。
- 输入序列：`request_action({fixtureId,action:"setValue",value:"fixture-已批准"})`→测试批准桥返回deny；再次同请求→allow-once；再发无新批准同请求。nonce/目标PID必须全程一致。
- 预期：deny时窗口值、允许配置及动作计数均不变；allow-once只执行一次，UIA读回确为该值；第三次重新询问，不能复用一次许可。可后续补持久allow/revoke再重启读回，但仅写**私有**`config.toml`，无执行消费者前不启用设置UI。
- 权限/数据：同完整性自有窗口；无提权、无任意app白名单、无默认持久许可。目标失焦、关闭、取消、Esc、晚批准均中止。文本输入与物理IME是不同验收项。
- 消费者：Task→审批→宿主动作→观测读回→结果通知；设置投影/撤销必须由同宿主查询。成功toast不是动作结果。
- 阻塞：审批桥缺失、UIPI、目标变更、取消后仍动作或可重复执行。此阶段不能从应用列表/插件已安装推出“电脑可操控”。

### P4 浏览器：私有profile、离线导航/下载/清理

- 执行器：现有Tauri 2.12.4独立临时窗口/最小私有测试入口，`data_directory=<私有绝对路径>`；另用已有Node内置HTTP服务仅监听127.0.0.1随机端口，服务两个本轮生成HTML和一个小下载文件。无外网、无登录、无用户浏览器数据。
- 输入：创建A/B两个隔离profile；A导航`/one→/two→back→forward`并下载`/fixture.txt`；B查询其自有历史/下载投影；A执行“清指定类型/时间范围”并重新查询/重启。
- 预期：A导航事件/标题/完整URL/下载开始与完成关联同session，文件hash匹配；B无A数据；取消下载不能完成；清理后对应数据真实消失，其他类型保留。关闭窗口、异步下载晚回、重启profile都必须收尾，不能用内存列表当持久历史。
- 权限/消费者：允许127.0.0.1本轮测试server，其余导航拒绝；对测试浏览页**不给Tauri产品IPC能力**，WebView2权限请求默认拒绝/明确错误。设置历史/下载/站点权限页读取真实session服务。书签单独增删/重启探针，不拿导航历史代替。
- 阻塞：WebView2运行时缺所需接口、profile隔离失败、外部网页可调用产品IPC、清理不含真实数据、下载路径无法限制。不擅自安装runtime、更改用户调试口或导入真实密码。
- 后续独立项目：扩展API/权限/存储适用性、密码管理、导入、自动填充、证书/站点权限。官方有这些页面不证明WebView2原生提供全等价，不能隐藏为“已完成”。

## 4. 下一步与证明门槛

R2仍主线。建议紧接R2的第一个R3开发单元选 **P0+P1 自有Windows Appshots宿主**，因为本机SDK和既有C++适配构建可复用，且可先不接任何模型/账户/全局hook即证明像素和可用文本真实能力。另两能力先保持明示缺口，继续有界只读研究，不同时开三个执行器。

本报告为“研究完成、探针待执行”：原生控制/捕获零次、Cargo零次，未证明运行时可用、账户gate、官方同环境GUI/像素、物理IME或用户验收。官方helper/transport已读取并hash但未运行、未复制binary入产品、未确认可再分发许可；自有宿主是当前建议路径。
