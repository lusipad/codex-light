# 16.11C 固定远程插件宿主合同

2026-11-03，实施前合同。来源与消费字段见 `16-11C-remote-plugin-contract.md`；仅扩展固定 ChatGPT 服务边界，不开放任意 URL/headers/token，不执行真实账号请求。

- inventory 专用请求只含 requestId、expectedIdentity、真实 browser profile、可选 includeExtensions（标准默认 true）。宿主 GET `/backend-api/ps/plugins/installed?limit=1000&includeExtensions=true`，跟随不透明 pageToken，所有页同身份，重复 cursor/坏分页/损坏核心字段/重复 raw id 不返回部分成功。
- mutation 专用请求只含上述身份/profile、真实 raw pluginId、enable/disable/uninstall 枚举。先完整库存核目标真实 id、installed、管理员禁用与适用策略；不根据 renderer 的布尔/复合名称作授权。
- 固定 POST `/backend-api/ps/plugins/<encoded raw id>/<operation>` 无请求正文；读取 OAI-Product-Sku=CODEX，写入 CONNECTOR_SETTING，两者 X-Codex-Surface=other。沿既有身份/网络策略、路由、完整性、取消与 bounded transport。
- 200 空/204 空合法为 Null，仅 mutation 放宽。非空坏 JSON、5xx/网络中断为未知送达，不自动重放。显式 401 限同身份刷新一次；IP 拒绝不刷新。写后只读完整库存；目标 enabled 对应或完整库存不含卸载目标才 confirmed，否则 pending。未知传输与最终观察事实分别返回 delivery/verification。
- 每次 await 与发送前核 generation/cancel；取消/身份改变不接受晚到结果。不接受 renderer 的任意权限/own 推断；remote 已安装默认策略仅禁止卸载，不禁止启禁；未知安装/认证策略不能静默默认放权。
- 既有宿主 request lifecycle 与凭证系统复用。同 raw id 变更锁由父级命令接线持有并覆盖前读、POST、读回；本模块不复制锁或创建真实账号测试。

验证计划：受控 transport 运行生产实现，覆盖完整分页、双 SKU/固定路由、无 body、空/坏 JSON、准入政策、401/IP/403/429/5xx、网络未知不重放、读回缺页/滞后、取消/身份切换。只有测试通过后补结果；真实服务、官方运行时与像素不属于该受控验收。

## 实施结果与证据

宿主已导出 RemotePluginInventoryRequest/Response、RemotePluginMutationRequest/Response 与 enable/disable/uninstall 枚举；两个固定 public 方法复用 CurlTransport、prepare、Registration、真实 session identity、workspace 路由、网络策略与 bounded body。库存完整分页后才返回；保留 raw 未知字段，核心标识/布尔/列表/分页结构损坏不当作空列表。累计 JSON 超过既有 MAX_RESPONSE 时明确报错，不截断成完整库存。

变更前库存查真实 raw id，未安装、管理员禁启禁、远程默认安装卸载、未知认证/安装策略都不能绕过。没有添加 creator 必须等当前 user 的自造 own 门槛。200空/204空与其它合法 JSON 写响应均可接收；非空坏 JSON、5xx、网络中断标 delivery=unknown，并且仅 GET 读回。verification 反映后续完整真实库存是否已达目标：因此 delivery=unknown 与 verification=confirmed 可以同时出现，分别表示写响应未知、最终状态已有独立证据。

取消或身份改变中止返回 ServiceError，绝不返回旧账号晚到成功；如果 POST 已经送达，这不证明服务器未应用。调用方应保留未知送达状态并在当前身份下纯读检查，不能自动重新 POST。401仅同身份刷新一次，第二个401直接拒绝；刷新改变 account 后不会重发原账号操作；IP拒绝不刷新。

2026-11-03：`cargo test --manifest-path src-tauri/Cargo.toml remote_plugin -- --nocapture` 退出0，**9组测试通过，0失败**；同次编译覆盖父级 lib 命令接线。日志 `.ref/parity/16.11/actual/16-11C/host/remote-plugin-tests.log`。生产受控测试包括多页 raw 保留与不透明 cursor 编码、重复cursor/id、损坏分页/核心类型、GET空正文拒绝、全部3种固定无body写与双SKU、200/204、有效/无效JSON、策略区分、无虚构ownership、读回滞后/缺页、403/429/IP、401仅一次/刷新跨账号阻断、真正transport网络中断不重POST、写在途取消/失效无后续读。

未访问真实账号服务、未取得真实远程响应样本，未验证原生UI或配对像素。父级专用 raw id 在途锁不等于 CLI 复合 id 安装/卸载锁已建立跨协议别名关系；同逻辑插件的服务与CLI操作竞争仍需单列，不能声称已实现服务端事务或跨协议原子性。未修改已有通用 decode_response、profile 写入语义或其它产品文件。
