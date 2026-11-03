# 16.05B 模型默认值、最近使用与真实协议

2026-11-03。承接 [修改前合同](16-05-next-closure.md)。本文是静态链、隔离零模型轮次协议探针与本地实现边界，不代表官方运行时、原生、像素或用户验收通过。

## 来源与版本边界

新 Store `26.1027.3384.0` 的 asar 清单见 [manifest](../../../.ref/parity/16.05/actual/16-05B-research/manifest.json)。新增定位片段见 [model-storage-anchors](../../../.ref/parity/16.05/actual/16-05B-research/model-storage-anchors.json)，偏移为 0-based UTF-16 code units。宿主物理桥复用同包已提取 `early-bootstrap-133-27035703de164763.js`、`early-bootstrap-491-e75c34fa1b2c0832.js`；文件来源与哈希见 [16.04B 存储补证](16-04B-storage.md)，不混用旧包片段。

当前新 Store CLI 为 `0.166.0-alpha.5.1`；环境默认 CLI 为 `0.159.2`。探针各自设置全新已创建 `CODEX_HOME`，清空 API key 环境变量，不复制用户认证、不创建模型 turn、不修改真实项目。schema 从新 Store CLI `app-server generate-json-schema --experimental` 独立生成到 `.ref/parity/16.05/actual/16-05B/protocol/schema/`。这证明客户端可接受形状，不证明账户有相应服务资格。

## 当前会话下一轮设置

真实公开方法为 `thread/settings/update`，不是官方内部对象方法名 `updateThreadSettingsForNextTurn`：

```json
{"threadId":"...","model":"catalog-model-value","effort":"high","serviceTier":"actual-tier-id"}
```

`serviceTier:null` 清除线程速度覆盖，省略则保持；`effort` 是公开字段，不能写成 `reasoningEffort`。schema 允许任意非空 runtime effort，不等于菜单应该无条件展示任意字符串。返回 `{}`，不是更新后的配置快照。

隔离探针真实 `thread/start` 后改 model/effort/tier：设置获 ACK，`thread/read {includeTurns:false}` 证实 `thread.model` 与 `thread.reasoningEffort` 改变；该响应不含可直接用于断言的 serviceTier。无 turn 的 thread 尚无可恢复 rollout，`thread/resume` 返回 `no rollout found`。

随后使用真实 `thread/inject_items` 写入文字明确标注 **Offline model preference persistence probe fixture. No model execution.** 的 user message，仅令隔离测试 rollout 可持久化，绝不是用户真实发送或模型生成成功。每种 tier 设置后分别在同进程与停止/重启 app-server 后 `thread/resume` 读取。两版各八个阶段 model=`persisted-probe-model`、reasoningEffort=`medium` 均有严格断言并通过；tier 以下表为实际观察，不把不同结果断言成一致：

| 写入 serviceTier | CLI 0.159.2 同进程 / 重启 | Store CLI 0.166.0-alpha.5.1 同进程 / 重启 |
| --- | --- | --- |
| `priority` | `priority` / null | null / null |
| `fast` | `priority` / null | null / null |
| `default` | `default` / null | `default` / `default` |
| null | `default` / null | `default` / `default` |

报告 `observations[].matchesExpected` 如实保留 false。探针通过指 model/effort、配置往返断言与观察采集完成，**不表示全部 tier 同值持久恢复通过**。此环境没有登录认证，不将 Store 的 null 归因为已证实的账户限制，也不从离线注入推断模型执行时实际速度。探针 allowlist 不含 `turn/start` 等执行方法，通知断言不存在 `turn/started`；两版均为零模型轮次。对应原始调用、响应及通知分别保存 `protocol-cli-0.159.2.json`、`protocol-store-cli.json`。

## 默认配置的读、版本与写

`model_preferences_read` 从真实 `config/read {includeLayers:true,cwd}` 返回有效配置、origins、layers，再取 `configRequirements/read`。用户层 version 是 CAS revision，用户层 file 是唯一写文件；不猜 `~/.codex/config.toml` 路径，不重写整个配置。写入仅 root `model`、`model_reasoning_effort`、`service_tier`，`config/batchWrite` 携 `filePath/expectedVersion/reloadUserConfig:true`。成功后重新读取有效值，覆盖或不一致显示错误，不能用菜单高亮替代落盘。

真实探针通过 root 三键写→读、磁盘内容、陈旧 version 拒绝、`service_tier:"default"` 写→读回原字符串、三键 null 删除→读回 null；null 作为整个 edit 的值是删除，不等于 TOML 内可保存任意嵌套 null。未知键与无关作用域不参与写入。

因此显式 model 配置选择标准速度时，宿主将逻辑 null 写成 `service_tier:"default"`，读取 defaults 时再归 null；原始 `config.service_tier` 保留 `"default"` 供前端区分“明确标准”与“未配置、使用模型目录默认”。选择整个默认模式（model=null）才删除 tier。否则目录默认 fast 的模型在重启后会把标准选择误恢复为 fast。此规则有真实配置探针与 write_params 专项断言，不能用线程速度持久化差异代替 root 默认配置写读事实。

**profile 是当前版本明确差异，不能编造支持。** 官方静态 `Mst` 使用旧 `profiles.<name>.*`，而上述两个当前 CLI 实测均拒绝写 `profile` / `profiles.*`（`configValidationError`）。新 Store CLI 还明确拒绝 `--profile probe app-server` 启动，说明其新独立 `<name>.config.toml` profile 选择并未通过该 app-server 入口开放。实现遇旧有效 `config.profile` 直接报错，保留原始 profile 与根默认值；不偷偷降级改根。新独立 profile 文件的 app-server 编辑/重启能力仍未验证，不能称 MC-B06 全部通过。

## 最近使用的真实物理层

最近三元组消费者 `X_`（initial @1850881）→ `U_`（@1847866）→ 持久 atom publisher，不是统一设置目录的通知字段。宿主 `updatePersistedAtomState` 在 `early-bootstrap-491` @2796272 附近明确读改 `globalState["electron-persisted-atom-state"]`，再广播 `persisted-atom-updated`。`composer-recent-model-configurations-v1` 未出现在本次提取的共享统一设置目录，不能因为通知迁移到 desktop.* 就把最近模型也迁入 TOML。含 null 三元组写 `desktop.*` 的真实探针被 TOML 明确拒绝，记录此负面证据。

本项目复用 `DesktopStateManager.update_value_persisted` 的现有统一 mutex，在同一锁内读取 atom 容器、合并、持久化成功后再更新内存。保存于统一 JSON 中 `electron-persisted-atom-state["composer-recent-model-configurations-v1"]`。不覆盖其他 atom，不新增第二套文件；Windows 进程内多窗口共享此锁，不宣称多进程/断电原子性。

`model_recent_record` 仅接已实际确认 userMessage 对应配置；不是 picker 点击计数。父调用链负责来源/线程排除。三元组按 model/effort/tier 去重，default→null，fast 与 priority 等价合并，最多三项；自定义 tier 不凭 name 猜等价。无关未来记录保留原值直到正常三项上限淘汰，坏容器拒绝覆盖；读取给 warning，不能清空坏存储后伪称成功。当前只提供本地 app-server host，不把 Work 云服务或远程 host 混入这份历史。

## 速度资格的真实推导

initial @7837549 外层仅 authMethod=`chatgpt/personalAccessToken/amazonBedrock`、非 loading 且已有 requirements 响应时生成 serviceTierAccess，其余为 null。shared `tht` @1850930：

```text
fast = requirements.featureRequirements.fast_mode !== false
ultrafast = (supportsIndependentSpeedModes === true || fast)
            && requirements.featureRequirements.ultrafast_mode !== false
```

因此真实 `{supportsIndependentSpeedModes:true,requirements:null}` 是**已读到响应且无禁止要求**，对应上述官方允许默认；它与未获得响应的 null access 不同。`nht` 允许 null/default；access=null 时拒绝其他 tier；flex 有独立允许分支，其余映射 fast/ultrafast（未知 tier 默认 fast）。模型目录有 tier 是目录能力；响应和 auth 分支是准入，必须两者同时核对。

## 前端宿主接口

- `model_preferences_read({cwd?})` → `{config,origins,layers,requirements,revision,userFile,profile,defaults:{model,reasoningEffort,serviceTier},recents,warning}`。requirements 保留完整真实响应。
- `model_preferences_write_default({cwd?,expectedVersion,configuration:{model,reasoningEffort,serviceTier}})` → 同上；模型为空/null 表示移除 root 显式默认，目录回退由前端有效能力链处理。
- `model_recent_record({configuration:{model,reasoningEffort,serviceTier}})` → `{recents}`，model 必须非空。
- 成功持久写入向其他窗口发 `model-preferences-changed {changed:true}`，其他窗口重新读取。写后读失败也广播，防其他窗继续显示已过期值；当前窗呈现明确错误。

专项 Rust 测试覆盖 CAS 参数、拒绝旧 profile、最近归并/上限/未来字段/坏容器。实际运行结果以父阶段验证日志为准。协议脚本为 `scripts/protocol-verify/verify-model-preferences.mjs`；分版本输出保存在本阶段 protocol 目录。未验证 Work `/wham/work/settings`，未以本地成功替代其 revision 远程写入。
