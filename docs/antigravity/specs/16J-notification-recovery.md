# 16J 账户通知错误与监听恢复

状态：本轮增量定向自验与构建完成，未获用户整页验收。结果见 [16J阶段记录](../acceptance/16J-notification-recovery.md)。承接 [16I](16I-account-notifications.md)，本轮不新增远端写入权限或依赖。

## 修改前依据与取舍

固定 Store 26.1027.3384.0。官方 notification chunk UTF-16 偏移 15886：staleTime ONE_MINUTE、refetchOnMount true；15419：存在在途写时离页标 stale 并 abort；16868：更新错误调用 danger toast，未传 duration；17685：读取错误为页内 alert。personal-settings-access 的资格 gate 独立读取当前账户结构，accounts-check 有独立 focus/reconnect/identity 刷新链。取证目录沿用 16I reference。

因此保留当前每次进入重新校验资格的保守实现：尚未证明本项目 generation 与官方整条失效链等价，不用通知缓存代替个人资格。toast 的完整全局生命周期、GC 和退场时序尚未取证，不编造固定时长。

本轮已发现：初始 account/read 失败未标为账户信息错误；监听失败只提示重新读取，而重新读取不重建监听，旧警告还可跨 scope 遗留。修复应复用当前 IPC/错误容器，不造替代接口。

## 动作与验收

1. account/read 初始或读后校验失败 → `notifications_account_unavailable`，中文账户信息错误；取消仍为取消，不继续远端读取。
2. 三条身份/连接失效监听全部成功后才读取与允许写入；任一失败清理已成功监听，晚到成功也立即释放，不保留部分订阅。
3. 失败时有明确重试入口，重试重新注册监听；成功后清除旧警告并重新读取。离页/scope 变化释放监听、取消读写，晚到回调不能恢复旧页面。
4. 回归先复现错误分类、监听失败无法重试，再验证恢复、部分成功/晚到释放、失败期间旧菜单回调拒写及 scope ABA；保留既有并发和未知写收敛用例。
5. 已观察断线后重试不能启动读取或解锁；真实重连才恢复。SettingsView 显式传递当前 connected 状态，监听空档漏掉重连事件时按父级当前状态恢复，不反解 scope JSON 或把一次成功读回当作重连。

只修改账户通知数据/页面与对应回放和文档。该增量不是通知整页交付；真实账号 HTTP、原生已登录呈现、官方配对像素和物理 IME 仍未验证。

本轮 Rust、HTTP 合同及协议不变，执行数据/组件/设置挂载定向回放、TypeScript 和最终原生打包/隔离入口验证；不把 16I 的完整标准检查计为本轮重新执行，不标整页已验收。
