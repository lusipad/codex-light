# 16.20A 通用设置中的实验功能

2026-11-03，修改前合同。范围：本机Codex Beta功能的可见性、持久化写入/读回与重启提示。

## 官方依据

[参考清单](../../../.ref/parity/16.20/reference/manifest.json)直接从固定asar只读提取并核integrity；原包含已知offline补丁，运行时gate与官方同条件像素未验。[调用合同](../../../.ref/parity/16.20/reference/initial-contract.json)记录0-based UTF-16定位。

- experimental-feature-visibility的i：仅beta，排除memories/multi_agent/plugins/plugin/remote_control/realtime_*/chronicle/workspace_dependencies。
- configuration-panel的Bn/Hn再排除default_mode_request_user_input（它来自独立statsig gate和persisted preference，不能用普通feature开关替代），位置是通用设置中的Experimental features (Beta)，没有全部阶段管理页。
- shared U9r：experimentalFeature/list，100条分页；W9r：config/batchWrite写features.<name>，upsert，默认用户层，不调用enablement/set。成功invalidate list，Bn显示重启App提示。加载/空/错误不混淆，写入时整组开关禁用。

## 本轮目标与用例

| ID | 合同 | 验证 |
|---|---|---|
| EF01 | 仅显示官方允许Beta项；稳定/开发/删除/专属gate功能不能从本组启用；未知名称不写 | 与实际原包predicate对照执行、生产保存函数拒绝 |
| EF02 | 写默认用户配置features.<name> upsert，不用运行时enablement/set，不热重载假称即时生效；写后读回用户层值，受其他层覆盖明确告知 | 生产函数/隔离真实config与磁盘/重启读回 |
| EF03 | 单飞；提交前重新确认功能仍可见；读写失败不成功；写成功读回失败阻止继续写直到重新读取 | deferred回调/失败/读回不一致 |
| EF04 | 完整分页，重复游标/响应无效/超页数均报错，不能返回部分列表冒充完整 | 真实生产config客户端单元和隔离小分页 |
| EF05 | 通用设置承载；旧experimental路由映射通用，撤独立导航/全阶段/固定152项说明；保存后显示重启提示；连接变化重新读，卸载/旧请求不回填 | JSX接线与生命周期回归、标准检查/原生构建 |

复用configBatchWrite/configRead，不新增依赖或模拟gate。保留底层enablement/set API供其他真实协议能力使用，但本设置不调用。requestUserInput独立偏好/远程gate、多主机、App完整重启后运行效果、原生键鼠/焦点和像素另验。整个App既有其他设置差异不在本轮顺带重构。
