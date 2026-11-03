# 2026-11-01 — 16.10A MCP真实状态发现

先核固定包bootstrap listMcpServers/ZS与当前协议schema，来源见[修改前合同](../specs/16-10-connections.md)。固定包调用mcpServerStatus/list及serverInfo/authStatus，不能用HEAD/--help证明握手。

新增mcpStatus读取定向服务器全分页，校验格式和游标循环；输出实际runtimeStatus/authStatus/toolsError/工具数，缺运行状态保持未知。SettingsView替换原HEAD/命令执行测试，按服务器单飞、离页/工作区代次隔离，改名“已配置”和“读取状态”，不保证配置即自动可用。复用bridge，无依赖，其他CRUD/保存链未改且缺口保留。

MCN01–MCN04执行生产helper与SettingsView回调/effect，覆盖分页/空错/未知/失败/认证、单飞/离页和无shell/HEAD。真实CLI0.159.2在隔离home启动本地stdio fixture，成功initialize并发现parity_probe工具；没有外部网络服务或模型轮次。fixture只是协议验证，不冒充产品服务器。

完整标准检查/原生打包、指纹和产物见[核验记录](../../../.ref/parity/16.10/verification.md)，步骤见[待验表](../acceptance/16-10A.md)。原生实际操作/OAuth/写入持久化与回放/官方入口完整性/像素仍未验。没有配对截图，visual-verdict不评分。用户未验收，未提交推送。下一16.11插件设置先核现有本地开关的真实消费者，避免保存即生效误导。

最终完整标准检查与原生打包退出0，253项所选输入指纹相同。[本批EXE](../../../dist-artifacts/16-10-mcp-status-20261101/CodexNative.exe) SHA-256 `98D8A61CA19D8B0C42B74D390E3A17CA9FE6E355F2D5E4F024303B9449F26060`。
