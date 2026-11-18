# 16.04B Windows 通知原生适配合同与实现

2026-11-03。开发实现，**未做 Windows 可见 toast/通知中心点击/原生像素验收**。官方依据沿用 [16.04B 调研合同](16-04-next-closure.md)，不将 SDK 单测当作官方行为对照。

## 无新增依赖方案

使用本机 Windows SDK 10.0.26100 的 C++/WinRT 头与系统 `windowsapp/ole32/propsys/shell32/uuid`；MSVC 18 C++17 编译静态适配库。Rust 仅通过 JSON C ABI 调用，Windows 返回内存由同模块 CoTaskMemFree 释放，异常不跨 FFI。没有复制官方 Electron 代码、声音或第三方源码。

`scripts/build-desktop-notifications.ps1 -OutDir <OUT_DIR>` 编译静态库；`-Test` 另外编译执行原生专项。build.rs 需要在 Windows 目标执行脚本，输出 native link-search 与上述库链接指令；非 Windows 编译模块返回真实不支持错误。需完整 Windows SDK 和 MSVC，不在运行时调用编译器。

## 原生对象与身份

- EXE 使用 Tauri identifier 注册本产品的 AUMID，通过开始菜单快捷方式设置 `PKEY_AppUserModel_ID`。本轮记录中的快捷方式为 `Codex Native Notifications.lnk`，当前名称为 `Codex Light Notifications.lnk`。注册逻辑见[通知适配器](../../../src-tauri/src/desktop_notifications.rs)。
- Tag 为完整业务 ID 的 SHA-256 前 16 hex，Group 固定 `codex-native`，符合 Windows 长度限制。活动登记检查同 Tag 不同业务 ID 冲突并拒绝覆盖。Tag 稳定，可跨进程精确移除已知 ID；截断哈希不是数学无碰撞保证。
- 保留 ToastNotification 对象及 Activated/Dismissed/Failed 事件 token。相同 ID 替换先释放旧 token，Rust generation 再过滤晚到事件。
- TimedOut 仅代表 banner 结束，保留对象供 Action Center 激活；UserCanceled/ApplicationHidden 与 Failed 释放原生及 Rust 登记。显式 hide 先解绑回调，Hide 对象，再 History.Remove(tag,group,AUMID)。全清使用 History.Clear(AUMID)，包含前一进程的中心条目，只清本产品身份。
- Show 返回 `submitted`，**不声称 `shown`**。WinRT 不提供可靠可见回执，免打扰/系统设置可影响展示。同步/异步错误分别返回真实错误/failed 事件，XML 转义后交由系统解析，通知始终 silent，声音由统一真实音频链负责。

## Rust API

- `desktop_notification_show(window,payload)`：必填非空 `id/hostId/threadId/title/accountKey`、正文字符串、正有限毫秒 `createdAt`；窗口身份由 Tauri 注入。可选 persistent、requestId、navigationPath、actions、replyPlaceholder。最多四个明确 approve/approve-for-session/decline 动作；不执行路由、shell 或审批。
- `desktop_notification_hide(app,id)`：精确撤回；记录 createdAt 截止 tombstone，阻止先解决后晚到 show。
- `desktop_notification_hide_conversation(app,hostId,threadId,messageCreatedAtOrBefore?)`：仅撤回匹配会话且不晚于截止时间的登记，保留其他会话与较新通知；截止记录抑制晚到旧通知。
- `desktop_notification_hide_all(app)`：清本 AUMID 历史及登记。
- `notification_account_context(app)`：读取宿主共享 `AppState.chatgpt_service.generation()` 作为 accountKey；相同 epoch 无操作，不同 epoch 失效旧登记并清历史。show 和 callback 均重新核对该权威 epoch，不注册 renderer 任意 setter。父在真实身份失效路径调用普通 Rust `invalidate_context(app,newGeneration)`，方法在锁内再次读取权威值，不信任晚到调用参数。ABA 换回原账户仍是新 epoch；清理失败保留 pending，重试时不清同 epoch tombstone。
- `notification_permission_read(app)`：实际 ToastNotifier.Setting，返回 enabled/disabled，附原始 setting 枚举区分 application/user/group policy/manifest；初始化/查询失败为 unknown。不是插件恒 Granted，也不等同免打扰状态。首次 show 前同样可通过独立 `CreateToastNotifier(identifier).Setting` 只读查询，OS 返回错误才为 unknown+真实错误；不会因未初始化而固定 unknown。Setting=Enabled 不证明身份已注册、toast 已显示或免打扰关闭。只读查询、账号同步与未初始化的 hide/tombstone 不创建开始菜单链接；注册仅首次真实 show 执行。
- `notification_settings_open()`：仅被用户动作调用，打开固定 `ms-settings:notifications`，不接受任意 URI，不修改系统配置。

事件 `desktop-notification-event` 仅发送给一个窗口：优先正常源窗，次选 main，再按 label 排序选一个现存正常窗；quick-chat 永远不是导航目标。仅剩 quick-chat 时明确记录缺少正常窗口并不投递导航，创建正常窗口能力仍待宿主补齐。Activated 恢复、显示、聚焦该窗口后发事件。载荷含 kind/id/generation/payload/sourceWindow 和可选 action/reply/reason/error。App 消费者仍需核当前真实请求、generation、账号 token；原生适配器**绝不直接批准/拒绝/发送 turn**。

## 验证与限制

原生独立编译及 `-Test` 已执行退出 0：验证真实 C++ XML 转义、SHA-256 稳定 Tag 与不同 ID、坏 JSON 的真实错误返回、未初始化 Show 拒绝。该测试不注册开始菜单、不发 toast、不改系统配置。Rust 五项回归已写入模块，需由主集成串行 Cargo 运行，子任务没有运行 Cargo。

未完成/未验证：应用退出后的 COM 冷启动激活、安装/卸载 identity 清理、Windows 中心实际点击与回复按钮表现、最小化/双窗/无窗口运行实测、同步 Show 到真实可见性的证明、完整原生与官方像素对照。内存中的会话时间索引不跨进程持久化；重启后按 conversation 的精确撤回无法恢复旧进程所有业务元数据，已知 ID 及全 AUMID 清理仍可用。不得把本阶段标为完整通知中心 1:1。

权限专项补验：Windows PowerShell 5 命令构建并执行 `native-permission-read/desktop_notifications_test.exe`，退出 0。首次初始化前实际系统结果为 `{"ok":true,"status":"enabled","setting":0}`；测试同时断言宿主 notifier/app_id/entries 保持未初始化，不发 toast、不注册快捷方式、不设置进程 AUMID。该结果仅代表本机此次 Setting 读取，不代表其他机器或完整 OS 可见性验收。

权限禁用投递门槛补充：原生 show 在分配 Entry、替换登记或调用 Windows Show 之前读取 ToastNotifier.Setting。非 Enabled 返回 `suppressed / permission-disabled`，Rust 移除该 generation 的未投递记录，前端不得播放提示音。Enabled 仍仅是 submitted 前置资格，不是实际可见证明。`native-permission-suppression` 独立 PS5 编译/专项退出 0，覆盖 Enabled 和四类 Disabled 纯规则及真实只读 Setting 一致性；未修改 Windows 许可、未发送 OS 通知。
