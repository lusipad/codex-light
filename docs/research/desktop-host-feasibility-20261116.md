# R1 Windows桌面能力可行性与待实现依赖

2026-11-16。固定官方26.1103.4239.0，主线程重新核整包SHA-256 `fb47d6491dc3006b708cb1e14de479b882bf50f88b7daa81818f154c253266aa`。同版9条asar资源integrity、5条外部资源hash、32个UTF-16锚点及完整链路在`.ref/parity/16/whole-page/reference/host-r1-20261116/`。没有运行官方helper、采集窗口、注册热键或修改用户配置。

[总计划](../FULL-REPLICA-PLAN.md)R1仍为静态研究完成/运行时探针待做，R3未放行完整实现；不能把旧离线补丁包的16.22–24合同当同版依据。

| 能力 | 固定版真实消费者 | 本项目可复用 | 必须补齐/尚未证明 |
|---|---|---|---|
| Computer Use | Windows执行器、应用授权及任务动作；配置投影`computer_use.windows.always_allowed_app_ids` | 插件/配置通信、任务/审批基础设施 | 自有执行器、应用身份/批准桥、实际动作与结果。声音/locked use有macOS分支，不能在Windows硬加开关 |
| Appshots | 前台目标→helper握手(protocolVersion=1和windows_appshots_v2)→捕获/文本→草稿路由；DoubleAlt，自定义热键；Automatic考虑60秒最近交互 | 现有图片附件/草稿、主屏PNG命令，但后者不等价 | 目标窗口与像素/可用文本、自有适用Windows宿主、实际热键及注销、捕获失败/取消、目标关闭、路由消费者与资源生命周期 |
| 浏览器 | in_app_browser及host门控、原生session、浏览数据/下载/导入/权限服务 | Tauri WebView和已存在的普通网页入口 | 完整会话/历史/下载、权限消费者；扩展/密码/导入适用性分别验证；普通WebView不等价于官方管理工作面 |

官方安装资源中存在`resources/cua_node/bin/node_modules/@oai/sky/bin/windows/codex-computer-use.exe`，JS transport惰性spawn并使用stdio JSONL。资源存在只证明本机有官方实现，**不证明它可供本产品再分发、可稳定依赖或可直接替代自有宿主**。不复制官方binary入产品，也不通过操作官方应用来绕过现有工具限制。

## 后续可执行研究

1. 优先完成R2插件主线；桌面原型作为独立有界任务，避免因三个说明页同时引入多个执行器。
2. Appshots自有宿主先在私有离线测试窗口验证目标/像素/文本和生命周期，再接路由/热键，最后设置页。候选使用现有Windows SDK及项目原生适配器构建方式，先核官方SDK文档，不默认引入新依赖。
3. Computer Use在自有执行器和批准桥有真实消费者后，才开发可交互的应用授权管理；没有消费者不再添加可保存但不生效的白名单。
4. 浏览器先私有profile+离线HTML验证会话、导航、历史和下载事件，再核每个管理项；不接用户现有调试端口/profile，不为测试改安全/隐私设置。
5. 任何运行时探针先列出请求、期望、不触及的用户数据及进程清理。涉及官方helper初始化副作用或许可不明确时不执行该路径，继续自有原型与无依赖产品单元。

## 文档交叉核对

当前[Computer Use文档](https://learn.chatgpt.com/docs/computer-use)与[Appshots文档](https://learn.chatgpt.com/docs/appshots)支持Windows前台操控、应用授权、前台窗口上下文、双Alt和路由偏好这一功能区分。当前文档可能更新，具体固定版门控/时序仍使用上述同版静态来源；没有官方GUI、真实捕获/操控、物理IME、多屏DPI或像素通过结论。
