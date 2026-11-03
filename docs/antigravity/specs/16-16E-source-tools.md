# 16.16E 私人审查源码工具与协议接线合同

状态：前置调研完成，完整文件阅读与真实能力预检开发/自验中；私人审查仍未闭环。接续[固定比较](16-16D-pinned-comparison.md)；不以自有工具替代官方全部功能的最终验收。

## 当前证据

`.ref/parity/16.16/actual/16-16E-research/` 保存原始schema、完整请求/响应与23项文件SHA manifest。CLI 0.159.2，二进制SHA-256为 `cbafb6422bca005b94c12d105b1a16a0474219e24ea4893f85846409c464f5a1`。全新临时CODEX_HOME，清理凭据环境，零模型轮次、零工具执行、零账号HTTP；子进程已退出0。

- 实验ThreadStartParams含dynamicTools，稳定版不含；function必需type/name/description/inputSchema，namespace必需type/name/description/tools。真实ephemeral/read-only thread/start接受定义，后unsubscribe；这不证明模型会调用或调用返回能恢复。
- app/installed、app/read(includeTools)、mcpServerStatus/list(含threadId/detail)与collaborationMode/list实际接受。隔离账号为null，apps/MCP为空；协作模式为Plan/Default，未发现reviewer预置，不能硬编码专门reviewer能力。
- InstalledApp.callable描述为committed runtime中的有效非synthetic、model-visible工具，enabled与callable不同。app/read(includeTools)仅返回display-only公开摘要，不能把摘要当授权。
- 当前App.tsx与app_server.rs未有dynamicTools或item/tool/call业务处理。不能只把字段塞进thread/start就把私人审查标成可用。

上述为调研时状态。16.16E现已新增单独的私有动态回调桥，但生产预检不注册自有源码工具、不会创建turn；只能读取真实运行时，明确报告尚缺账号/完整清单与分页/补丁覆盖/独立审查者流程证据。已有三个pinned读取操作不足以证明完整源码覆盖，不据此启动一个已知无法完整执行的模型任务。完整私人审查仍须实现并独立验收。

当前预检不覆盖用户MCP或multi-agent/fanout配置；仅设置临时只读/never上下文，保留真实disabledPluginIds和线程目录。目录为空只说明本次读取未见，不把未读MCP分页或目录摘要当作全量能力结论。按钮标为“检查审查可用性”，不会标成“开始审查”或“审查成功”。

## 接线与安全边界

1. 先按实际threadId枚举runtime MCP/installed apps，保留disabledPluginIds、toolsError/authStatus，区分可见描述与可调用状态。只有成功核定选定源码账号与固定PR/三SHA后才允许用户启动私人审查；空目录/失权明确不可用。
2. 若自行注册已实现的pinned只读工具，必须明示其为本项目的受限工具，使用16.16D宿主snapshotId能力、当前账号和取消机制，不声称官方GitHub connector已存在。禁止模型提供任意HTTP路由、任意账号或本机路径。
3. 服务端以JSON-RPC请求 `item/tool/call` 发起调用，params必需threadId/turnId/callId/tool/arguments，namespace可选。它不同于MCP调用，也不是notification。按JSON-RPC request id回复，不能拿callId替代。
4. result形状为 `{success:boolean,contentItems:[{type:"inputText",text:string}]}`（schema另允许图片/音频）。失败必须success:false并给真实错误，不返回成功空内容。arguments即使上游接受任意JSON，也须按注册schema在宿主重新核验。
5. 处理器绑定thread/turn/call、账号代次、PR和快照；未知工具、旧thread/turn、重复call、取消与归档必须受控。不能通过客户端注入绕过后端权限、服务端gate或disabledPluginIds。
6. 完整分页、遗漏patch、重命名/删除/二进制/大文件不可读均要如实返回。仅收到unifiedDiff不证明已覆盖PR全部文件或私有源码。RZn提示中的工具名字仅是要求，不是可凭空构造的接口。

## 修改前验收

- 使用隔离fixture实际驱动app-server请求转发与响应，验证同request id、参数校验、重复/取消/晚到、身份切换和只读边界；不为测试启动真实模型任务。
- 注册schema通过不算真实调用通过；动态工具调用通过不算源码账号/全量patch通过；这些层次分别留证。
- 无真实能力时私人审查仍明确未完成，不输出“无问题”。真实turn由用户运行产品时明确触发，成功/失败/取消由真实通知驱动。
- 官方运行时、真实账号HTTP、原生GUI及同环境像素继续独立验收；本合同发布不放行未知gate或伪造工具。
