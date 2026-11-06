# 模型偏好探针即时快照失败

2026-11-07。21G验证期间发现，直接CLI协议探针失败，不是Sites页面执行失败。

## 已观察

- 完整非Fast检查337段/32协议探针中，仅`verify-model-preferences.mjs`失败，原始退出码1保留。`thread/settings/update`返回空ACK，随后`thread/read`期望`changed-model/high`，实际仍为`probe-model/null`。
- 原失败与未改源码的定向重跑都使用既有`CODEX_CLI_PATH`的CLI 0.159.2；重跑退出0。另在私有子进程显式选择CLI 0.165.0，定向探针也退出0。未修改全局环境、配置或安装依赖。
- 两份0.159.2请求顺序一致，都包含空会话resume被拒；不能把该拒绝认定为状态重置原因。失败记录没有settings更新通知，成功记录有；旧证据把请求响应与通知分开记录，没有共同接收序号，无法证明两者精确先后。

## 推断与修复边界

空ACK的schema不能证明会话快照已应用。即时断言存在时序依赖是有证据的候选解释，尚未定位CLI内部调度根因。验证应等待对应会话的更新确认，并使用有截止时间的严格模型/推理档断言；不固定sleep、不接受旧值、不重发写操作。服务档位原本仅为live/cold观察，不能顺手改称逐字持久化通过。

保留首次失败与每次定向结果，补收包顺序；只修此探针，不修改产品的模型状态处理。协议操作仅在临时CODEX_HOME内，无模型轮次、真实账号或用户配置写入。

## 实施与限制

最小实现先发一次原写请求，再读取真实thread快照确认原本严格断言的model/effort；尚未匹配时，等待对应会话、本次操作之后的settings通知，20秒未确认则失败。收到通知后继续原严格快照/live/cold断言。保留所有响应与通知的统一接收序号，不重发写请求，不加入服务档位规范化映射或新的tier成功声明。

曾仅等待通知，在CLI 0.165.0同值更新下实际超时，已保留`cli-0165-notification-only-red.*`；因此不能要求每次同值设置必发通知。最终“真实快照或新通知”的确认路径在0.159.2与0.165.0定向退出0。完整标准首次退出1保持不变，修后没有重复整套337段检查，不报告成同一轮全绿。

另有一次0.159.2定向运行在更早的`config/batchWrite`返回`failed to persist config.toml`，发生于独立临时home，未到设置确认代码。磁盘仍有约7GB空间，文件非只读；无足够证据确定内部IO原因。原失败记录保留为`cli-0159-config-persist-failure.*`，未加入写重试；后续独立运行通过不能证明该外部故障已根治。

## 证据

`.ref/parity/21/actual/21G-sites-url-domains/verification/`中的`standard-original.log/.exit`、`model-preferences-standard-failure.json`、`model-preferences-rerun.{log,exit,json}`、`model-preferences-cli-0165.{log,exit,json}`及`standard-recovery.json`。后续修复结果追加，不覆盖原始失败。
