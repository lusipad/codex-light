# 16.10 MCP连接 修改前合同

2026-11-01。固定包bootstrap listMcpServers/ZS调用mcpServerStatus/list；返回实际authStatus/serverInfo，startupSucceeded不是随意执行--help或HTTP HEAD。原始定位见.ref/parity/16.10/reference/status-trace.json，原包沿用16.07哈希闭环。当前schema支持serverName、cursor、limit和detail，返回runtimeStatus/toolsError/tools/resourceTemplates/resources。

首批改动：用生产mcpServerStatus/list定向完整分页替代当前no-cors HEAD与shell --help测试；runtimeStatus明确连接时才能写已连接，其他状态原样/中文明确，目录发现不得冒充连接。测试读取旧请求/离页保护、禁用/无条目/服务失败、工具发现错误。列表名称“已配置”替代“已连接”，不承诺智能体必定调用。

用例MCN01定向分页/游标/格式错误，MCN02connected/starting/failed/disabled/缺状态与toolsError不误报；MCN03生产点击回调单飞/离页丢弃/重试；MCN04无HEAD/exec副作用。真实隔离空配置status探针、完整检查/构建留证。写入CRUD/OAuth/远程目录/官方分区入口和原生像素继续保留缺口；本增量不宣称完整页。
