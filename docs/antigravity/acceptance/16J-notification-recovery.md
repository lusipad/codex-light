# 16J 通知页错误与失效监听恢复

合同：[16J](../specs/16J-notification-recovery.md)。本轮为故障恢复增量，不是整页验收。固定官方安装版本仍为 26.1027.3384.0。

## 实现与依据

- `accountNotifications.ts` 对初始及读后校验的 account/read 错误标记 `notifications_account_unavailable`；取消仍返回取消，不伪装成账户错误，不继续通知读取。
- `AccountNotificationSettings.tsx` 三条失效监听全部注册成功后才读取/允许写入；部分注册失败时释放已成功项，晚到成功也立即释放。重试重新注册并清除旧警告，离页和 scope 变化取消旧读写并释放订阅。
- 已观察断线时读取、写入、重试解锁都受同步守卫；普通重试不能把成功读回当作重连。`SettingsView.tsx` 显式传入当前 connected 状态，补上监听空档错过重连后的恢复路径，不解析 scope JSON。
- 复用现有 IPC、错误容器、取消和 epoch，不新增依赖、接口或全局配置。

官方一分钟 settings 查询参数不等于可复用个人账户资格；资格有独立 focus/reconnect/identity 失效链。本轮只记录该差异，保留每次重新校验的行为。更新错误的 danger toast 调用已证，但未指定 duration，完整全局生命周期尚未证明，未编造定时消失动画。

## 失败与回归

证据根 `.ref/parity/settings-16J-20261106/`。

1. `account-red.log`：原 account/read 直接抛原始错误，分类断言失败；修复后两处账户错误和取消回归通过。
2. `listener-red.log`：原监听失败仍发起数据读取，断言实际 1 次、预期 0 次；修复后失败/部分成功/晚到注册释放、重试恢复通过。
3. 独立审查复现 P2：断线后手动重试可读回解锁；`disconnect-red.log` 保留实际 2 次、预期 1 次读取失败。加入连接守卫后，断线不读写、真实重连恢复通过。
4. 再补父级当前状态测试：监听空档错过重连事件，connected 更新仍能恢复；设置包装层验证状态真实透传。
5. 保留不同/相同渠道乱序、未知写只读收敛、scope ABA/旧回调、卸载取消及联系人过滤等已有回放。因现在先等待订阅完成，回放同步入口改为等待真实 Promise 完成，不把 harness 初期 resolve(undefined) 当作产品缺陷。

三项 Node 定向回放（账户数据/IPC、通知组件、设置包装层）与 `npx tsc --noEmit` 退出 0。独立只读复核最终无阻断问题。Rust/HTTP/协议未改，本轮没有重新执行完整 verify-all 或全库 Cargo；16I 完整检查仅为历史基线。

## 浏览器与原生

生产组件与数据模块、专用 IPC 包装加隔离内存桥，CSP 禁外网；首次故意拒绝一条监听。实际点击重试后警告消失、ChatGPT 行出现、多选菜单可展开，无横向溢出。截图 `browser/listener-failure.jpg` 与 `browser/recovered-menu.jpg`；此为 fixture，未请求真实账号。

`npm run tauri build` 退出 0，EXE/MSI/NSIS 与许可共 8 项产物，584 项冻结产品/脚本输入构建前后哈希一致。源码为 12fcdd7 加本轮修改，按输入清单绑定最终产品。

运行版本 `dist-artifacts/settings-16J-20261106/CodexNative.exe`，SHA-256 `13149cd728f8b4bc4e312390e41dabe7e4c276e7c7e92308a92a841fe024152b`。

精确匹配新 EXE，使用独立 CODEX_HOME/WebView/工作区并移除进程 API key。Ctrl+, → 通知，加载退出后不显示本地五项或监听错误；未登录 gate 隐藏账户控件。截图/UIA存档，CLI 确认 Not logged in，测试进程关闭。没有原生故障注入、真实账号读写或模型 turn；已有沙箱未配置提示保持原样，未修改系统设置。无同环境官方截图，score=null；不将自身截图当官方基准。

## 剩余边界

真实账号 HTTP/持久化、原生监听故障注入、已登录菜单/物理 IME、多窗口及官方配对像素未验证。缓存/资格两条刷新链尚未映射等价，错误 toast 及全局查询 GC 仍待取证。用户尚未验收。
