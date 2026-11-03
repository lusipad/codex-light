# 16.10B MCP 定点配置存储合同

2026-11-03。修改前合同，先核协议与固定包，再实现客户端。当前只覆盖本机已证实的用户配置写入；不将项目、插件或管理员服务器复制为全局服务器。

## 来源与纠偏

固定 Store 26.1027.3384.0，asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。同包 initial 的 0-based UTF-16 锚点：iNn @3452823 `config/read(includeLayers:true,cwd)`；aNn @3453464 读取完整 `config.mcp_servers`；TNn @3460690 优先用户写层、无用户才按 origins 回退并拒 managed；mNn @3455473 新增/卸载单 server，编辑只写变更字段，env/http_headers/env_http_headers 按键 diff；gNn @3456804 启禁只写单 enabled。官方写入 expectedVersion=null；本项目使用已读取用户层版本 CAS，冲突不自动覆盖，属于明确的并发保护适配。

旧 `config_skills.rs` 的 McpServerConfigItem 只投影 command/args/url/env/enabled，且读时跳过 codex_app，再在写时重建整个 mcp_servers。普通启禁也可能删除隐藏服务器和 cwd、headers、env_vars、timeouts、tool filters 等字段。因此本阶段新客户端不调用这条整表写入路径。

## 拟定接口与不变量

- `readMcpSettings(cwd?)`：读取真实有效配置、origins、完整 layers 及 requirements；保留每个 server 的完整 raw 值，并区分用户局部配置和有效配置。
- `writeMcpServer(snapshot, action)`：只接受添加、更新、移除、启禁四类动作。目标固定为真实可写 user 层的 filePath/version；非本层来源必须清楚标注，不擅自变更来源。
- 添加只写不存在的单 server；同名已存在不当作覆盖式添加。编辑只写指定字段及实际改变的 map 子键；启禁只写 enabled；移除只移除明确的用户 server。未知字段和其他服务器不由投影对象重建。
- 点、引号、反斜线与 Unicode server/map key 必须先由隔离真实 CLI 验证 quoted keyPath 语法；不能拼未引用的 dotted keyPath。
- 写前校验来源/管理员限制/用户层版本；一次提交，未知送达不自动重写。写后读回局部值和有效值，分开显示被覆盖、未确认、保存与连接状态。
- `config/mcpServer/reload` 只表示重读配置接口成功，不表示 MCP 连接、工具发现或 OAuth 成功。本客户端 CRUD 不调用此接口；真实探针中的显式调用仅用于验证协议返回形状。
- 官方写后主要 invalidate 配置/状态，未见 CRUD 自动调用 mcpServer/refresh；产品保存后返回 requiresRestart，重启由父级独立动作执行。

OAuth 登录协议另为 `mcpServer/oauth/login`：name 必需，scopes/threadId/timeoutSecs/clientRegistration 可选；响应 authorizationUrl、可选 loginId；completion 绑定 name/threadId/loginId，success 真实 boolean。没有 cancel RPC 证据时不能发明取消方法，关闭本地 UI 不等于撤销服务器授权。

## 修改前验证

1. 隔离 CODEX_HOME、无模型 turn、无真实 OAuth/网络服务器：quoted name/map keys 写入读回、单字段修改、空值移除、旧版本冲突。
2. config.toml 放入 codex_app、第二服务器、未知字段和敏感字段替代值；每次改动只影响指定字段，未知键与兄弟服务器不丢失。
3. 前端生产逻辑夹具：effective/user 分离、managed/非用户来源不可编辑、添加同名拒绝、复杂未知值不重写、失败不乐观成功、读回不符/未知结果不重放、reload 失败独立状态。
4. OAuth/连接状态留独立资格和生命周期合同；本文件不证明其已实现。原生行为、固定中文与官方像素验收分别留证。

本合同最初发布时 keyPath 真实探针尚待执行；以下为随后取得的结果。不修改真实用户配置、不新增依赖、不运行 Cargo。

## 协议实测与实施注记

2026-11-03 实测：`node scripts/protocol-verify/verify-mcp-settings-b.mjs` 退出 0；当前 CLI 与固定 Store CLI 分别留下 `.ref/parity/16.10/actual/16-10B/protocol/mcp-settings-protocol.json`、`protocol-store/mcp-settings-protocol.json`。Store 实际输出版本为 `codex-cli 0.166.0-alpha.5.1`，不是根据安装包名称推算。

- JSON.stringify 引用的所有 dotted path 段可用于真实 config/batchWrite，包括 server/map key 内的点、双引号、反斜线；原值准确读回。null 删除 map 子键和单 server。`origins` 返回键则是未引用的扁平字符串：`mcp_servers.${literalName}.env.${literalMapKey}`；不将其直接用作写路径。
- 每次写入使用上次实际 user layer filePath/version，旧版本写入返回 `configVersionConflict`，未修改 enabled。codex_app、HTTP siblings、未知键、timeouts、headers、tool filters 与 TOML fixture heading 保留。
- 所有 fixture disabled、全新私有 CODEX_HOME、零模型 turn、无真实 OAuth；显式 reload 返回对象仅证明该 RPC 成功。第一次 probe 失败源于探针自身 JS 字符串反斜线转义，修正为 String.raw 后重新实测通过，不把失败记录作通过依据。

客户端 `src/mcpSettings.ts` 直接复用 configRead/configRequirementsRead/configBatchWrite；取最后一个有效 user 层作为写目标。读取保留完整 raw 与 userRaw；来源包含 mcp_servers 顶层和服务器字段 origins，非用户来源只读。添加同名拒绝，更新点写变化字段，map 按键差分；未知字段和兄弟服务器不重建。UI 序列化保留未呈现的非字符串 map 值，避免表单投影导致误删除。

`node scripts/verify-mcp-settings-b.mjs` 退出 0，生产代码夹具覆盖保留性、quoted paths、空字符串、map 删除、同名拒绝、最后 user 层、project 来源、CAS、读回被覆盖、明确拒绝、未知送达、已送达但响应丢失、写后读取失败。未知结果一次写入后只读，不重放；保存与需要重启/服务状态独立。此专项不代表官方原生 UI、实际连接或像素验收通过；这些由父级/页面交付记录单列。
