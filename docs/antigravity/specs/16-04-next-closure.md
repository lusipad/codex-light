# 16.04B：Windows 原生通知、点击生命周期与真实音频闭环

2026-11-03。状态：**只读调研完成，尚未开发、构建或运行官方 GUI；整个通知分区未验收。**承接 [16.04 原合同](16-04-notifications.md)、[16.04A](../acceptance/16-04A.md) 与 [23C](../acceptance/23C.md)。不重复 23C 已实现的全窗口焦点仲裁和 1000 项去重；下一阶段应交付真实 Windows 通知生命周期及声音导入/播放整链，不能只加文案或测试 toast。

## 独立来源与版本更新边界

只读发现旧 `OpenAI.Codex_26.1021.3705.0` 安装路径已不存在；当前 `Get-AppxPackage OpenAI.Codex` 返回 `26.1027.3384.0`、Store、Status Ok。新原包：

`C:/Program Files/WindowsApps/OpenAI.Codex_26.1027.3384.0_x64__2p2nqsd0c76g0/app/resources/app.asar`

- 674296148 bytes，SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。
- AppxBlockMap 的 **10289 个 64 KiB 块全部匹配**，末块按真实剩余长度校验，剩余 0 字节；Codex.exe Authenticode Valid，签署者 OpenAI OpCo, LLC。
- 同目录官方 `codex.exe --version` 退出 0：`codex-cli 0.166.0-alpha.5.1`。只执行版本查询，不请求模型。
- 新包主进程改为 `early-bootstrap-491-e75c34fa1b2c0832.js`，不能把旧 main chunk 偏移套在新包上。
- 11 个相关 entry 分别校验原包 integrity 后只读提取。证据目录：[manifest](../../../.ref/parity/16.04/actual/16-04B-research/manifest.json)、[签名](../../../.ref/parity/16.04/actual/16-04B-research/signature.json)、[BlockMap](../../../.ref/parity/16.04/actual/16-04B-research/block-map-integrity.json)、[36 项锚点](../../../.ref/parity/16.04/actual/16-04B-research/anchors.json)、[中文](../../../.ref/parity/16.04/actual/16-04B-research/zh-labels.json)。数字均为 **0-based UTF-16 字符偏移**，不是行号。

这次自动更新**不构成当前开发/像素基准自动升级许可**。16.03B 及旧页面继续保留各自固定历史源；本合同独立记录新候选实现与版本差异，旧新版本运行时对照尚未做。签名、块哈希不能证明账号 gate、DPI、窗口行为或界面一致。未重写旧记录。

## 现状与主要缺口

当前 `notificationPreferences.ts` 已分类 turn/permission/question/dot，23C 的 `notification_broker.rs` 仲裁全应用真实窗口焦点、可见会话与去重。`App.tsx` 在 claim 后分别调用合成振荡器和 `show_desktop_notification(title,body)`；Rust 桥未传通知 ID、host/thread/navigation/request 标识，没有点击动作、撤回或原生失败生命周期回传。设置无导入；试听为自行合成音。

下一增量至少要同时闭合：**真实通知身份→投递→点击定位正确会话/请求→过期或解决后撤回→真实共享声音→导入/试听/保存读回**。保留已有 broker；通知中心不是应用内 toast，动作不能仅发成功提示。

## 官方原生服务与消费者

| 来源锚点 | 静态事实 | 开发约束 |
| --- | --- | --- |
| host `showNotification` @481074 | 先 supported/target-destroyed/deduplicate/suppression；同 ID 替换原对象；动作最多 4 个；permission/question 的 timeoutType=never | 通知须有稳定业务 ID，不能只传 title/body；同 ID 生命周期与 dedup 历史分开 |
| host @482800 起 | Windows 原生 notification `silent:true`；另起真实声音。show、failed、click、action、reply、close 分别有回调；failed 为 native-error | 不让系统默认音和自播音重复。提交返回与真正 show/failure 分开，不能把 prepare 成功当已显示 |
| host `show(e,t,r,n)` @3625000 附近 | 动作回调确认有效后 getOrCreateNavigationWindow；open 在 Windows restore/show/focus，必要时短暂 always-on-top，发送 navigate-to-route 与 host/conversation | 选择既有合适窗口或创建导航窗口；避免多窗口都响应一条点击。不能直接信任外部任意路由/会话 |
| host @489167/489600/489712 | 按 conversation（可限 messageCreatedAtOrBefore）、notification ID、navigationPath 撤回；close 删除登记，更新 completedThreads | 解决请求、打开会话、读取消息均使用精确撤回，不取消别的会话的新通知 |
| runtime `SU` @276100 附近、turn @277104 | 真实 turn-completed 事件、账号/host/thread/turn 联合去重 ID；过滤 quiet/continuation/隐藏后台来源；带导航路径与 replyPlaceholder | 复用真实协议事件；保留当前 quiet 判定，不能用定时器伪造任务完成 |
| runtime permission @278041 | command/file approval 可有 approve/approve-for-session/decline；permissionRequest 无同组按钮；回调再次找到仍有效 request 并按真实 method 回复 | OS 按钮不得批准已过期请求或把未知审批方法猜成旧方法。执行前核 ID/generation/current request |
| runtime resolved @279000 附近 | serverRequest/resolved 精确 hide approval/question ID；question 仍独立开关，点击导航到对应会话 | 即使窗口未聚焦也应撤回过期通知；不重复发送审批响应 |
| runtime `xU` @275900 附近 | turn reply trim 后真实启动新 turn，turnTrigger=notification_reply，失败记错误 | Windows OS 是否呈现输入框仍需实测；无底层支持时不得用本地假回复冒充 |
| runtime `FU` @286000 附近 | 路由/聚焦时 hide 当前 conversation/navigationPath；可见会话登记可 dispose | 登记与原生对象关闭应释放，不留下跨账号点击目标 |
| request-user-input-async @23462 | 异步问题通知再次核 account/host/client、turn 与待答问题，点击携 openRequestUserInputAsyncQuestion；解决后 hide | 不能用普通 question 导航丢失待答问题定位 |

host 片段实际位置以 anchors.json 为准；表中“附近”用于说明链路，不能代替精确锚点。事件、回调存在不证明 Windows OS 一定支持所有 reply/action 表现。

## 四类设置、平台权限与数据边界

`app-shared-b9a49a97ca55.js` @1871328：sound 默认 default；turn 默认 unfocused（off/unfocused/always）；permission/question/dot 默认 true。`_X` @1791768 登记 global-state，`vX` @1791937 登记 persisted-atom。**这是旧来源分类，不自动证明当前物理存储位置**；下一开发需追当前统一 settings store 是否迁到 desktop.*，不直接将所有通知写 CLI config 或沿用旧 desktop_state 就宣称一致。

- turn：off 抑制；unfocused 按应用焦点；always 允许前台。23C 已有主要矩阵，回归即可。
- permission/question：分别开关；应用聚焦且该 host/conversation 可见才抑制。审批与提问不能受 turn=off 连带关闭。
- dot/agent-message：真实来自 Orbit room unread message 或 Aeon assistant delivery；`app-runtime` @273744 包含 room/message、发送者、createdAt 与账号身份。host 的 agent-message 分支按 dot 开关和**相同可见会话**抑制，不能从旧 `dot && !focused` 推断所有前台均抑制。当前产品无完整 Dot 服务来源，不能凭开关制造本地 Dot 事件；新候选与旧 broker 该处差异须另记，不能顺手标已对齐。
- 远程 ChatGPT 账户通知设置和 parental/family websocket 是独立账户服务链，不能冒用本地四类设置或生成固定远程目录；未有真实账号能力时标未验。

**新候选新增 Windows 明确分支**：host `getNotificationPermissionStatus` @2846500 起把 Electron `granted/denied/not-determined` 映为 enabled/disabled/not-determined；`openNotificationSettings` @2848035 Windows 真正打开 `ms-settings:notifications`。设置读取返回后重新查询；语言包已有“打开 Windows 设置”“在 Windows 设置中开启通知，即可使用下方选项”。旧合同主要 macOS 的边界不能直接代表新版。

权限未知必须保持 unknown，不以 Tauri permission_state=Granted 冒称 OS 开关开启；系统免打扰与应用通知许可是不同层。打开设置应只在用户点击后执行，不自动改 Windows 全局设置。

## 真音频、导入与播放

host @479607 的 `gu={default:'codex-notification',classic:'codex-classic'}`；`gp` 优先 resources 两个 WAV，后备 asar assets/sounds。当前新包真实 resources 文件：

| 值 | 文件 | 大小 |
| --- | --- | --- |
| default | resources/codex-notification.wav | 109686 bytes |
| classic | resources/codex-classic.wav | 265994 bytes |
| none | 无播放 | 0 |

完整 SHA-256 见 [host-audio-hashes.json](../../../.ref/parity/16.04/actual/16-04B-research/host-audio-hashes.json)。asar 内另有 16 个散列 wav/ogg，清单仅证明存在，不能拿其中某段当默认通知音。**只读取证不等于资源复用许可**：未确认许可前不得把官方二进制声音搬进产品；不能继续把合成音声称相同音色。可先把真实文件播放/用户授权导入通路做好，资源分发条件单列。

- `notifications-settings` @12000 起：Windows 菜单 default/classic/none，macOS 才显示 Basso/Glass/Ping/Pop/Purr/Tink；平台通知桥存在时显示“选择自定义提示音…”。同一声音用于完成、权限和问题，不能 nudge 忽略用户选择改播另一合成振荡器。
- host `previewSound` @3621709：取消先前播放；none 成功且无音。WAV 读字节到前端真实 AudioContext decode/resume/play；其他系统格式仅平台支持路径。Windows 非 WAV 不假定 SoundPlayer 可播。
- host `importSound` @3622356：原生单文件选择，Windows mp3/wav/flac/ogg/oga；取消无保存。文件须 regular、大小 **≤10 MiB**，读后再校验。WebAudio 解码仅 mono/stereo，非空且时长 **严格 <30 秒**；locale“不超过30秒”不改变实现边界。
- `notification-sound-audio` @150/1000 附近：OfflineAudioContext 解码，输出两声道以内交错有符号16位 PCM；host 验 samples 非空、字节对齐、<30s，构造真实 RIFF/WAVE，按内容 SHA-256 命名 `codex-custom-<64hex>.wav`。
- host `gf` @480444：Windows 存 userData/notification-sounds；不是用户任意原文件路径。临时目录写完 rename，再清理临时目录，返回 `{fileName,name:basename}`，不把原路径写配置。导入失败不选中新项。
- 前端 abort controller：换选择/离页结束上次试听；导入 decode 可触发试听，不重复预览；试听/导入/保存错误各自显示真实中文，不能所有情况都返回成功。
- host Windows 播放 `gg` @480114 用隐藏 PowerShell `System.Media.SoundPlayer.PlaySync`，Unicode路径做安全编码；新通知播放期间保留单播放器。Tauri 可用等价原生文件播放，但不能直接执行官方模块。

## 现有平台能力与可开发方案

当前 Cargo.lock 已锁 `tauri-plugin-notification=2.7.0`。本机源码只读证据见 [tauri-notification-capabilities.json](../../../.ref/parity/16.04/actual/16-04B-research/tauri-notification-capabilities.json)。可复用现有 on_action、builder id/data/action_type 完成**屏幕上活动 toast 点击**，无需新增依赖；但该库明确：

1. Windows 进入 Action Center 后点击无回调。
2. Windows remove_active/remove_all_active 不移除已显示通知。
3. desktop permission_state/request_permission 恒 Granted，不能读取 OS 许可。
4. show 在后台分发，返回仅证明 payload 准备；不是 show/failed 回执。

因此仅把 builder 增加 data 再发 React 事件**不足以完成本合同**。完整 Windows 链需要可记录 Tag/Group 的通知对象、激活/操作/文本回复（实际支持时）、dismiss/failure 处理、NotificationHistory 精确删除、ToastNotifier Setting 实际权限、应用标识/安装注册与窗口生命周期。实现前评估现有锁定 WinRT/transitive 能力或局部 Windows 原生适配；不新增依赖的约束继续有效，确实需要依赖时先记录缺口。不得将PowerShell一次性弹窗/应用toast当成持久原生服务。

建议阶段拆分只用于并行归属，合并交付主要闭环：

1. 宿主通知服务接 broker winner，生成不含任意可执行路径的稳定 payload，统一显示/撤回/点击与窗口路由；复用23C仲裁，不新造owner选举。
2. 前端事件源/请求解决/已读路由驱动撤回；动作严格复核真实请求，点击只由宿主选择一个窗口处理；断开账号后旧payload不能提交回复或审批。
3. 真实音频存储、校验、播放消费者及设置页导入；复用现有文件选择与安全文件接口，不引新模拟声音。
4. 权限查询/系统设置入口与保存读回/跨窗更新；Dot与远程账户能力如缺失明确列为后续，不能隐藏差异后称通知全量完成。

## 修改前验收合同

| 用例 | 操作与官方预期 | 必须证明 |
| --- | --- | --- |
| NT-B01 | 完成/权限/问题来自真实现有事件链，传稳定ID+host/thread/request/导航；跨窗仍只有一次 | 复用23C矩阵回归；真实业务回放与隔离协议，不只新增callback mock |
| NT-B02 | 点击活动 toast 与进入通知中心后的同一提醒，恢复最小化/选择正确窗口并打开正确会话 | 同源码安装构建+Windows OS截图/日志，两个状态分别测；插件部分支持不得冒充两者通过 |
| NT-B03 | 审批/问题在OS显示后解决、取消、切会话已读，精确撤回；同会话较新的通知保留 | 精确ID及createdAt边界、宿主登记、OS中心实际消失；不能只删内存Map |
| NT-B04 | 通知按钮重复/晚到、请求ID复用或账号更换，执行前再次核资格；允许/拒绝真实后端结果一致 | 隔离真实审批响应；过期动作无写副作用，未知方法可见失败 |
| NT-B05 | 真实show/failed/close，失效窗口和权限关闭，应用不报虚假成功、不重复播放 | OS可见性与生命周期回执；准备成功不能作为显示结果 |
| NT-B06 | default/classic/none试听与通知同播放器，连续试听/离页取消，none仍显示通知 | 实际文件身份+播放结果；许可未解决不得标音色1:1 |
| NT-B07 | 导入有效MP3/WAV/FLAC/Ogg，取消、空文件、损坏、>10MiB、恰30秒、长中文/引号路径 | 真实decode+PCM/RIFF+内容hash+安全落盘；取消/错误不改偏好；读取文件复验 |
| NT-B08 | 自定义声音修改→离页→重开→退出重启→再次真实提醒；删除源文件仍可播，删除副本提示真实失败 | 存储读回和持久复制；无原路径依赖、不以toast证写入 |
| NT-B09 | Windows OS许可启用/关闭/未知与免打扰分开；点击设置打开准确URI后重新查询 | 安装标识/原生权限真实值；不使用恒Granted假通过，不自动改系统设置 |
| NT-B10 | turn off不阻断审批/问题；Dot按真实来源与会话焦点；静默自动化不提醒 | 四类独立矩阵，缺Dot账号/服务写未验；不造固定Dot消息 |
| NT-B11 | 关闭源窗/主窗/所有窗后通知点击、退出重启后中心点击、请求已过期 | 生命周期明确；应用未运行激活/COM注册能力若缺失单列，不宣称完整持久点击 |
| NT-B12 | 真中文、导入/错误/权限禁用/选择菜单，宽窄窗、Tab/Escape/离页焦点 | 固定官方版本与等环境配对原生截图、AX/几何/overlay，不评分缺失基准 |

## 当前冻结与未验状态

本次仅新增本合同与 `.ref/parity/16.04/actual/16-04B-research/`，未修改产品、测试、旧文档，未运行构建/Cargo，未打开官方 GUI、修改全局设置或发起模型调用。原包entry与BlockMap核验、中文静态取证、现有依赖源码检查属于本次证据；所有 OS 可见、点击、撤回、声音效果、权限与像素预期仍待实测。新源与既有固定源版本差异保持未对照状态。
