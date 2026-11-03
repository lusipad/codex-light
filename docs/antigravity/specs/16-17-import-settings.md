# 16.17 导入设置：初始只读调查

2026-11-02。本单元尚未修改产品代码。

app-initial lazy注册import → import-settings-42dbd4ca7932.js → ImportSettings。页面从detectedItems建立来源选择，区分检测/导入中/失败/不支持项目及再次检测，支持配置、项目与聊天记录；不是简单把.cursorrules内容写到本地人设。源定位/hash见.ref/parity/16.17/reference/initial-contract.json。

下一步追app-initial导出的Qpt检测与aw启动选择、use-external-agent-import-setup-actions组件，核协议与冲突/取消/回读。现有Cursor按钮用仅含customPersonaPrompt的对象覆盖整个desktopPreferences，而且该字段已无真实指令消费链；Claude按钮虽能检测MCP配置，尚需核实际导入的前置选择与读回。优先消除数据覆盖和假成功，不在真实用户配置中试写。

开发前需完成真实detect/import协议合同及隔离fixture。未确认来源/账号/主机/gate和原生像素，不宣称已经实现官方导入。

## 16.17A 修改前合同

官方主进程Wk/detectProvider → externalAgentConfig/detect；claude-code省略migrationSource，cursor传cursor。导入Jk传migrationItems、对应migrationSource、providerId和source:app；先注册通知，再接importId匹配progress/completed，缓存先于响应的完成通知。RPC只返回importId不代表完成。原包超时120秒。

真实隔离探针verify-external-import.mjs已证明CLAUDE.md检测→importId→completed→AGENTS.md目标文件含sentinel，源文件未删除、无模型turn。常规UI不实现自制规则转换，也不改desktopPreferences或旧人设。

本轮范围：两个原包app-server来源claude-code/cursor，真实检测、按检测项选择、确认/取消、导入前再次检测、逐来源串行执行、匹配通知、逐目标读取、部分失败与错误保留。App级持有导入状态，使离开设置后仍跟踪，不把离页当取消后台写入。真正后台取消协议未找到；只允许提交前取消选择，提交后显示继续处理。

验收IM01检测来源参数/格式与部分失败；IM02选择取消零写；IM03源变化拒绝写；IM04早到/重复/无关任务通知隔离；IM05接受不等于成功、目标读回失败单列；IM06重复点击单飞、离页后任务状态保留、断连/超时标结果未知且阻止重复导入；IM07隔离真实文件结果及原偏好保持。

尚缺官方逐子项选择、自动同步、Cowork adapter、会话项目注册/无项目会话专属目录、导入历史与完整焦点/视觉/原生。SESSIONS服务迁移可用，但会话/项目注册完整闭环不可因thread/read成功就记整页通过。
