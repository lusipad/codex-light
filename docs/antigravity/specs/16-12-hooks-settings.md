# 16.12 Hooks：调研与真实状态变更合同

2026-11-01 初始只读调查（产品开发见下方16.12A）。固定包 hooks-settings-d3762dd6a01d.js 存在来源导航、逐项启停、信任新/变更项、批量Trust all、托管覆盖错误。回调提交{key,enabled}或{key,trustedHash:currentHash}；不能把这些等同本地hooksEnabled偏好。模型按source/projectRoot/pluginId过滤并统计active/needsReview；需要读取真实hash、托管约束及读回。初始证据见.ref/parity/16.12/reference/initial-contract.json。

当前hooks/list wrapper已有定义、警告/错误和实时事件；SettingsView旧loadHooks缺请求代次，通知始终订阅且工作区变化未隔离，公共保存仍保存本地hooksEnabled。初始调查阶段未修改这些产品链，16.12A在下方记录替换范围。

下一步追原包L/Be mutation真正消费者及config层写法；核当前协议config键和HooksList原始schema，建立隔离真实fixture。若当前服务不支持trust写入，明确保留缺口，不做假本地信任。验收覆盖来源/托管、启停与trust版本冲突读回、旧响应/离页隔离、实时运行不跨工作区污染、实际错误重试。

已追到写合同：app-initial 的nNo（zB导出）通过config/batchWrite写hooks.state.${JSON.stringify(key)}.enabled或.trusted_hash，mergeStrategy:upsert，filePath:null、expectedVersion:null、reloadUserConfig:true；okOverridden明确抛HookStateOverriddenError，不能当成功。见write-contract.json。下一步实现应增加版本保护及实际读回，不直接复制乐观更新当真实成功；托管项不可修改，信任只提交当前原始hash，不推测/重算。

## 16.12A 修改前验收合同（2026-11-02）

隔离真实app-server探针已通过hooks.json PreToolUse fixture禁用/启用/trusted_hash有效读回、用户层版本冲突拒绝，无命令执行和模型轮次。证据actual/protocol-hook-state.json。

HK01：原始key/currentHash规范化不丢失；写前重读hooks/list，缺失/托管/定义hash已变拒绝。HK02：仅写用户配置层精确key，expectedVersion，reload；写后hooks/list核enabled/trustStatus/currentHash，覆盖或失败不得提示成功。HK03：生产UI单飞，刷新/切工作区/离页旧响应隔离，失败明确可重试。HK04：逐项启停/信任及来源/事件筛选，批量信任仅当前来源和事件可见项；旧本地hooksEnabled入口撤下，保留旧数据。

本轮新增独立HooksSettings复用hooksClient/configBatchWrite，旧全局实时记录移除，原包当前页面未发现该展示合同；将来恢复须有工作区/会话归属证据，不将跨工作区事件当本页执行结果。不重构全局SettingsView。视觉/原生完整页面继续待验。
