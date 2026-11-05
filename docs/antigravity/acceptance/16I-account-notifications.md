# 16I 独立 ChatGPT 账户通知阶段记录

合同：[16I](../specs/16I-account-notifications.md)。状态：本阶段已执行范围自验完成、待用户验收；不表示通知整页或整个 App 已达到 1:1。

## 来源与实现

固定 Store 26.1027.3384.0 整包 SHA-256 重新核验一致。resolver 追踪确认默认完整路由、desktop supportedSurface、28 项计划枚举、accounts/check 原始字典与归一化边界。原始锚点、资源哈希及提取纯函数回放在 `.ref/parity/16/actual/16I-account-notifications/reference/`。静态资格合同不是当前账号获准访问的证明。

- `chatgpt_service/account_notifications.rs` 使用专用固定读取与单渠道 PATCH，复用现有认证、网络策略、401 刷新、取消和 generation；不开放 renderer 任意 URL。每次写前重新核个人资格、服务端动态字段和联系方式，写后 GET 对照。只有明确 401 才允许同身份刷新重试；网络/5xx 不盲重放。
- `accountNotifications.ts` 与 `chatgptService.ts` 校验响应身份、数组、重复渠道和布尔值；API key/未登录不发通知 HTTP。UI 仅得到 email/sms 资格布尔值，不暴露联系方式。
- `AccountNotificationSettings.tsx/.css` 由真实服务数组渲染行与顺序，按渠道隔离乐观更新和晚到响应，全部在途写结束后 GET 收敛；失败后先只读核验。账户变更、连接变化、卸载与 ABA 都使旧操作失效。
- `AccountNotificationMenu.tsx/.css` 复用已有菜单样式与定位方式，实现真正 CheckboxItem 多选；选择后不关闭。`SettingsView.tsx` 替换独立通知页占位，本地通知仍在常规；tasks 行复用 scheduled 内部路由。

额外严格的 raw 库存类型/唯一性检查属于本项目保守写入边界，不声称官方归一化函数执行了完全相同的检查。错误暂用 inline alert，未还原官方 toast 的动画和时序。无新增依赖或全局配置修改。

## 定向验证与发现

- 前端生产代码回放：动态类别/未来渠道、重复与损坏拒绝、联系人隐私、身份 generation、API key 无请求、取消、读回值、专用 IPC 形状与响应身份检查通过。
- 页面回放：不同渠道与同渠道乱序、最后一个写结束再 GET、未知写锁定、读失败重试、pending/unknown 成功收敛、账户资格错误、失效事件、scope ABA/旧菜单回调和监听释放通过。
- 审查发现 P2：权威 GET 已成功却残留旧“结果未确认”提示。已补回归并修复，成功收敛清除过期错误。旧设置导航测试依赖占位文字，已改为检查专用组件挂载，保留导航焦点断言。
- 第一轮 Cargo 定向实际运行 8 项通过，随后代理补入第 9 项身份刷新回归；完整非 Fast 标准日志已包含最终 9 项通过，不能把首轮 8 项记为 9 项。

## 浏览器证据

`.ref/parity/settings-16I-20261106/browser/` 是生产独立组件、数据模块、IPC 包装和菜单加内存传输；CSP 禁外网。样本值仅用于验证，不进入产品。它不包含完整设置壳，不代表真实服务器 GET/PATCH。

- 1280×800 与 640×800 无横向溢出；菜单宽 240 CSS px，窄窗在视口内。
- 点击电子邮件后菜单保持展开；摘要 `推送通知, 电子邮件`，按样本服务端次序。
- Escape 返回触发按钮；End 到最后一个渠道；没有手机号时隐藏 sms、保留其他渠道；管理任务回调为 scheduled。
- 原始 JPEG 保存为 wide-menu、narrow-menu、narrow-final；没有官方同条件参考图，score=null，不提供像素通过结论。

## 最终构建与原生

`pwsh -NoProfile -File scripts/verify-all.ps1` 非 Fast 单次完整退出 0，包含新数据/UI回放、共享页面、类型、前端构建、脚本列出的 Rust 分组及隔离 CLI 协议探针；不是全库 cargo test 或原生界面验收。已有 Vite chunk 和 Rust dead_code 警告保留，未配置独立 lint 命令，不编造 lint 结果。

提交前 staged diff 检查发现原未跟踪菜单文件多余尾部空行，之后仅规范该文件末尾空白（去尾空白后内容严格相同），重新类型/数据/UI回放与打包，保留首轮输入/构建日志及 formatting-followup.json；未重跑整轮协议探针，不把首次完整标准改称为规范后重新完整执行。

`npm run tauri build` 退出 0，EXE/MSI/NSIS 及 5 项许可文件共 8 项产物归档，584 项冻结输入构建前后哈希一致。证据位于 `.ref/parity/settings-16I-20261106/`；来源为 418ecd3 加本阶段未提交源码，输入清单绑定最终产品，提交后不因仅记录提交而重建。`Get-AppxPackage` 另核当前安装仍为 26.1027.3384.0。

运行版本：`dist-artifacts/settings-16I-20261106/CodexNative.exe`，SHA-256 `e974c42f9f8a50b7699ec57a67f8232ce479b81b67a09f831032d1a83a022db9`。

使用独立 CODEX_HOME、WebView 数据目录和工作区，移除进程 API key，未登录资料目录无 auth.json；只操作精确匹配该 EXE 的窗口。Ctrl+, 打开设置、点击通知、等待加载退出后，仅保留通知标题，不出现账户远端控件或常规本地五项；无错误提示。截图与 UIA 存档，窗口关闭后 PID 已退出。原有沙箱未配置提示保持原样，未安装/更改沙箱；这次没有发送模型消息、系统通知或更改真实账户偏好。

原生仅验证未登录入口与资格不展示路径；已登录菜单、真实服务保存/读回和重启持久化仍未验证。不能把内存 fixture 更新值算作原生服务器保存成功。

## 未验证与剩余差异

真实账号通知 HTTP、实际授权与服务器持久化未验证；Transport 回放不能替代。官方同 DPI/缩放/语言/主题配对、原生物理 IME、已登录菜单、长列表/超长本地化文字和跨窗口同步未验证；新 IPC 尚未补跨窗口刷新广播，官方广播合同也未取证。当前每次进入重新读取，尚未复刻官方一分钟查询缓存与后台刷新的时序。部分初始账户读取故障仍落入通用设置错误容器，错误细节与官方 toast 时序尚未完全校准。不自动强开 gate，不改真实账户来补测试。
