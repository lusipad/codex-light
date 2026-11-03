# 2026-11-01 — 16.04A 通知分类、本地偏好和派发

状态：功能增量自动自验与构建记录见本文末尾；完整分区、原生交互与像素未验收。

## 调研先行

沿用固定官方包，重新核验 SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。修改前已有 settings 草案；随后追完 app-shared 独立 schema／存储和 app-initial 消费者的类别、焦点、可见聊天、quiet、请求取消和去重条件。偏移均为原始文件 0-based UTF-16。

[设置取证](../../../.ref/parity/16.04/runs/20261101-codex-notifications-research/reference/trace.json)、[消费者取证](../../../.ref/parity/16.04/runs/20261101-codex-notifications-research/reference/consumer-trace.json)、[中文取证](../../../.ref/parity/16.04/runs/20261101-codex-notifications-research/reference/locale-trace.json)保留文件哈希和定位。中文资源重新从该原包读取，SHA-256 与 archive integrity 相同。Windows 的声音选项过滤为 default/classic/none，不能把 macOS 系统音名称当作 Windows 可用声音。

## 改动与复用

- `src/notificationPreferences.ts` 定义五项独立 key、默认和规范化，复用 desktop_state 读写。设置即时保存并读回，写失败回滚，写成功但确认失败保留新值并提示，可重读。
- `src/components/NotificationSettings.tsx` 接通完成时机、权限／问题开关和声音菜单；`SettingsView.tsx` 去除旧混合设置，`App.tsx` 与设置页共享同一个 hook。
- 完成通知按 off/unfocused/always 判定；权限和提问不再被完成总开关抑制。应用聚焦且当前聊天可见才抑制该聊天请求，设置页打开时不误判聊天可见。
- 实际 server-request 分类支持 requestUserInput、ask_user 和 questions。发送前重查请求仍存在；resolved 同步更新请求 ref，避免 React 下一次渲染前迟发。
- 完成 ID 使用 thread/turn，请求 ID 保留 generation，最多记住 1000 个最近 ID。已有自动化桥按 id/finishedAt 去重，继续显示真实完成／失败结果。
- 移除目标完成分支的额外系统提示音，避免和轮次完成重复。`src/sound.ts` 复用合成音，关闭前一次 AudioContext 并定时释放；不支持音频时向调用者报错。
- `scripts/verify-notification-preferences.mjs` 注册进完整检查，执行生产模型、持久化 hook、JSX、App 请求监听及播放器。无新依赖。

旧 `desktopPreferences` 通知字段不再读取、写入或竞争新 key。缺失新 key 时采用官方默认，未将旧 never 或旧总开关跨类别迁移；该差异明确记录，旧磁盘字段没有被主动删除。

## 验证边界与剩余缺口

NT01–NT08 覆盖默认／无效值、焦点可见性矩阵、quiet／取消、类别独立、去重边界、发送错误、保存回滚、部分成功、重读、并发写保护、实际组件回调、请求 generation 和音频释放。

以下未完成，不能将本分区标为 1:1：

1. dot 仅有独立偏好模型与判定回归，没有真实事件源；不显示一个无法使用的开关。
2. 声音仍为原有合成音，未导入官方音频，自定义声音对象可保留但暂不能播放／导入。界面对此有可见说明。
3. 官方通知点击、快捷回复、审批按钮和已显示通知撤回尚未接通。派发前取消保护不能替代系统通知撤回。
4. 账户切换／gate、远程 ChatGPT 通知设置、Windows 系统权限与通知中心可见性、实际音频、IME／焦点和退出重启尚未实测。
5. 当前 Tauri 通知依赖内部异步调用展示；桥返回成功仅表示提交，不保证后续操作系统展示成功。
6. 初始偏好读取成功前不发送系统提醒。自动化桥尚无完整 quiet decision，普通 turn 过滤不证明静默调度完整对齐。
7. 无成对官方／本批原生截图。按 visual-verdict 输入条件记 `not_executed`、`score: null`；没有生成评分或像素通过结论。

完整检查首轮内部通过，但外层日志封装转义错误使进程返回 1。保留 `pre-final-wrapper-verify-all.log`；修正封装后重新执行完整检查，不把错误退出当作通过。

默认 target 的 Release 构建尝试覆盖旧 `codex-tauri.exe` 时被 Windows 拒绝访问，保留 `pre-final-tauri-build.log`。未关闭现有应用，最终改用已有备用 target `C:/Users/lus/.cargo-target/codex-desktop-native-send-button-20261101`。最后两项提示文案修正后重新冻结全部输入并重跑，前次产物不作最终交付。

最终检查、构建标识和输入指纹见[核验记录](../../../.ref/parity/16.04/verification.md)。本轮未提交、未推送。[用户待验步骤](../acceptance/16-04A.md)不是通过记录。

## 最终结果

最终完整标准检查退出0，104项Rust通过，Release/MSI/NSIS退出0，237项构建输入前后哈希一致。NT01–NT08、类型检查通过。无独立lint；既有打包／DEP0190／Git换行提示保留。

[本批EXE](../../../dist-artifacts/16-04-notifications-20261101/CodexNative.exe)：14,232,576 bytes，SHA-256 `BB08F0508162375B72927BD3A9F25AEAA1E0D9C007BEBA632C3FF52DCF9B82D3`。源码HEAD `97a4eca9f0a3bb529620c610f273b14057a4470c`，dirty状态与完整输入见build-manifest；功能自验不表示原生通知、视觉或用户验收通过。
