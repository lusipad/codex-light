# 23G 深链接接收开发计划

前置合同：[官方深链接调研](../specs/23-os-deep-link-receiver.md)。本轮继续整体复刻目标；23F已形成可审阅构建，本轮推进另一条未实现的原生能力，不据部分实现标整个App完成。

## 决定与假设

- 使用已有 Tokio 的 Windows named pipe 能力实现同一可执行文件/同一 Codex home 的第二实例转发；只显式启用已有依赖的 net feature，必须核对 lockfile没有新增包。不引入额外插件。
- 官方完整链接语法有更多分支。本轮对本产品已输出的 bare local thread URL 完成 argv→第二实例→最新请求队列→main监听握手→真实会话选择。未实现的query/remote/review/new明确拒绝，不偷偷降级。
- 不改变Windows协议注册表，不接管官方 `codex:`；用显式 argv 和隔离 named pipe 验证真正跨进程交付。安装器协议注册及Windows Shell全链路保留未验。
- 主窗口尚未就绪时保留最新URL。主窗口就绪后查询pending；事件仅作唤醒，不能因事件先于监听而丢失。确认消费必须匹配generation。连续同URL未消费时去重。
- 新深链接优先于旧深链接；异步元数据读取期间的手动导航优先于该旧链接。会话读取不成功不切换，不创建会话或turn。身份/连接变化令旧操作失效。
- 第二实例默认只向现有实例请求恢复主窗口；传输失败不能假装已交付。不同EXE路径/不同Codex home隔离，保留多构建测试能力，此隔离范围与官方单实例分组的等价性未实测。

## 实施与验证

1. 严格URL解析与最新队列→Rust合法/非法URL、尾斜杠、重复/过期确认、main作用域测试。
2. named pipe限长帧/超时/拒绝远端/持续监听/确认→Windows实际管道与独立子进程往返、错误帧及单实例争用测试。
3. App握手、就绪与只读预检后复用selectThread→生产控制器回归，模拟A慢B快、手动导航、失效、重复、卸载及lookup失败。
4. 标准检查、Rust库全测和当前源码EXE/MSI/NSIS，记录输入哈希。原生UI/OS注册/官方像素缺证不转为通过。

## 平台依据

- [Tokio ServerOptions](https://docs.rs/tokio/latest/tokio/net/windows/named_pipe/struct.ServerOptions.html)：首次实例标志、默认拒绝远端客户端；连接后先创建下一个实例，避免接收空窗。
- [Tokio ClientOptions](https://docs.rs/tokio/latest/tokio/net/windows/named_pipe/struct.ClientOptions.html)：ERROR_PIPE_BUSY重试和错误边界。
- [Microsoft named pipe 权限](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights)：默认ACL仅creator owner/System/管理员完整权限，Everyone/anonymous只读；客户端要求读写权限，管道不返回会话内容或凭据。该IPC属于同用户桌面边界，不作为恶意同用户进程的安全隔离。

## 实施记录

已实现bare local URL parser/队列、Windows命名管道、main重建及握手、前端预检与真实selectThread接线。实际Windows管道/子进程专项已通过，最终检查与构建见23G归档，不据文档存在推断Tauri UI或OS协议交付通过。

独立复核指出main关闭后无消费者、失效后同generation重投卡住，已补main配置重建与重复pending唤醒/observed重置；另按目录实际创建往返修复scope的存在性依赖。监听丢失时受控退出，不维持无管道的孤儿primary。

实际Tauri main重建/焦点、Windows注册、完整链接语法、以及selectThread已进入后的全局账号生命周期仍保留未验，不把预检回归扩大成全链路证明。
