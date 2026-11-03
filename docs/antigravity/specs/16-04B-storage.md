# 16.04B 通知设置物理存储补证

2026-11-03，只读静态取证。承接 [16.04B 合同](16-04-next-closure.md)。不修改官方 GUI、官方配置或产品代码；未运行模型。本文不代表通知功能、原生或像素验收通过。

## 结论与来源

当前候选 Store `26.1027.3384.0` 已把这五项设置统一保存到 **`config.toml` 的 `[desktop]` 表**。`app-shared` 中 `global-state` / `persisted-atom` 是迁移来源分类，不能单独用来决定新版物理写入位置。声音对象也走 `desktop.notifications-sound`，不是继续写旧 persisted atom。

原包与完整来源边界见 [主合同](16-04-next-closure.md)。新增关键文件 `.vite/build/early-bootstrap-133-27035703de164763.js` 为 115949 bytes，SHA-256 `df82c9a76c02589e115937da6cc6016a85ad03b5ce171f5fe844e9694874c17d`；从已登记原包只读提取并匹配 asar entry integrity。独立登记在 [storage-extra-manifest.json](../../../.ref/parity/16.04/actual/16-04B-research/storage-extra-manifest.json)，未覆盖先前主清单。可重定位的精确片段见 [storage-anchors.json](../../../.ref/parity/16.04/actual/16-04B-research/storage-anchors.json)。本文所有 `@` 数字都是 **0-based UTF-16 code unit 偏移**，不是行号或字节偏移。

## 五项字段

`app-shared-b9a49a97ca55.js` 的 `igt` @1871261 注册以下字段；`_X` @1791768、`vX` @1791937 仅声明历史宿主分类。

| 逻辑字段 | 协议 keyPath / `[desktop]` 键 | 值与默认 | 注册偏移 / 旧来源 |
| --- | --- | --- | --- |
| sound | `desktop.notifications-sound` | 默认 `"default"`；`default/classic/none/Basso/Glass/Ping/Pop/Purr/Tink`，或 `{fileName,name}` | @1871639 / persisted-atom |
| turnMode | `desktop.notifications-turn-mode` | `off/unfocused/always`；默认 `unfocused` | @1871795 / global-state |
| permissionsEnabled | `desktop.notifications-permissions-enabled` | boolean；默认 true | @1871983 / global-state |
| questionsEnabled | `desktop.notifications-questions-enabled` | boolean；默认 true | @1872147 / global-state |
| dotEnabled | `desktop.notifications-dot-enabled` | boolean；默认 true | @1872306 / global-state |

自定义声音 `fileName` 必须匹配 `^codex-custom-[a-f0-9]{64}\.(wav|aiff|caf)$`、`name` 非空。Windows 导入的真实产物为 WAV；schema 兼容 aiff/caf 不意味着 Windows 提供对应播放能力。`fileName` 是宿主声音目录内文件名，不能把原导入路径保存为设置。macOS 声音枚举的存在也不意味着 Windows 菜单应显示它们。

## 读、迁移、写与消费的完整静态链

下面 `store` 均指 `early-bootstrap-133-27035703de164763.js` module 50135（模块起点 @21870）。

1. **初读**：store @22120 接受含可选 `desktop` 的配置；constructor @22648 用 TOML parser 读取传入文件的 `.desktop`。只保留可序列化值，已知键经注册 schema 校验，坏字段被记录并丢弃。Windows startup 同文件 @5052 构造 `new p.r(join(codexHome,"config.toml"), globalState)`，证明当前文件路径接线。
2. **缺键才迁移**：store @23191 遍历设置目录。当前 `desktop` 中已有有效键就不读旧值；缺键时按 `hostStorage` 从旧 global state 或 persisted-atom 容器查值，schema 有效才写 `state` 和 `pendingLegacyMigrations`。无有效值时依默认，不把默认误当已存配置。
3. **初始化再协调**：store `initialize` @24558 使用真实 app-server 的 `config.desktop` 更新；保留本地待写项与待迁移项，再持久化。host `early-bootstrap-491-e75c34fa1b2c0832.js` @4579159 将 `config`、storage requirements 和 `batchWriteConfigValues: e => sendAppServerRequest("config/batchWrite",e)` 注入该 store。
4. **有效值**：store `getEffective` @25795 返回保存/迁移的 state 值，否则使用注册默认。host @4489041、@4489092、@4489150 分别把该 store 的 sound、turnMode、dotEnabled 接给真实通知服务；不是从旧容器另读一份。
5. **写入**：store `setAndPersist` @25940 解析 schema、记录前值，等待真正保存；写失败恢复当前对应待写项的前值，并抛出错误。`persistPendingSettings` 的写对象 @27984 是 `{keyPath: \`desktop.${e}\`, mergeStrategy:"replace", value:...}`，通过真实 `config/batchWrite` 保存。其他未改字段不应整表覆盖。
6. **成功后清旧值**：store `g` @28741 仅在迁移写入成功后删除已迁移的旧 global-state 键或旧 persisted-atom 内键。失败时不先清除迁移源。不要把“兼容读取旧值”实现成每次回写旧容器与新配置两套来源。

上述证明当前候选的静态实现，不证明我们的用户主配置已成功迁移，也不证明旧固定版本具有相同写法。迁移源的整个容器实际落盘布局不需要靠读取用户真实文件确认；不得为补证访问用户现存配置。

## 本项目实施约束

- 五项同源读取、逐字段保存；等待真实写入结果并重新读回，失败保持原有效值并呈现错误。
- 用户层版本用于并发保护；其他窗口保存后重读，不向所有窗口直接广播未经确认的新值。
- 保留旧本地客户端配置作为兼容迁移来源时，仅对当前新配置缺失字段迁移；不得用旧值覆盖显式 false、`none`、`off` 或已有自定义声音对象。
- 默认缺失与显式保存区分处理；未改字段、无关配置、未来字段不能随当前页保存而清空。
- 同一声音设置服务于通知与试听；导入失败、取消或解码失败不保存新对象。

## 建议真实隔离协议探针（0 turn）

新增 [verify-notification-preferences.mjs](../../../scripts/protocol-verify/verify-notification-preferences.mjs) 覆盖下面第 1–3 项及磁盘核对，已通过 `node --check`，**尚未执行协议，不能写成通过**。探针自行创建并检查独立 `CODEX_HOME`，记录 CLI 路径/版本，启动真实 `codex app-server`；不复制账号令牌，不发送 `thread/start` 或 `turn/start`。先 `initialize`，然后 `config/read` 取得用户配置层 `version` / `filePath`。协议形状沿用已有 keyboard-number-target 探针，不假造版本字段。执行命令为 `node scripts/protocol-verify/verify-notification-preferences.mjs`，可用当前进程的 `CODEX_CLI_PATH` 指定独立版本；结果写入 `.ref/parity/16.04/actual/16-04B/protocol/protocol-notification-preferences.json`。

1. 在隔离目录保存无关 marker；`config/batchWrite` 分别 `replace` 五个 keyPath，样本为 `"classic"`、`"always"`、false、true、false。写请求用当前用户层版本，等待响应后重新 `config/read`，核对五值、无关 marker 和隔离磁盘 `config.toml`。
2. `config/batchWrite` 单项修改 sound 为合法自定义样本 `{fileName:"codex-custom-" + "a".repeat(64) + ".wav",name:"隔离探针"}`，只验证配置对象往返；**不宣称文件存在或声音播放成功**。确认未产生模型 turn。
3. 再用旧用户层版本尝试修改单项，期望真实版本冲突；读回确认未覆盖新值。不能只验证“请求发送成功”。
4. 重启同一隔离 app-server 后读回，核对持久化；新建另一空隔离 home 验证没有这五项物理值。默认值是桌面 store 的注册规则，不要求 CLI 自动把默认填进配置。
5. 如 CLI 接受 schema 外值，记录其为通用配置层行为；桌面端仍按官方字段 schema 拒绝，不能把 CLI 允许任意 TOML 等同于通知设置支持该值。

该探针能证明当前 CLI 的真实配置写读、并发与持久化；不能证明官方 GUI 的迁移执行、跨窗广播、权限、Windows 声音或通知中心行为。官方 GUI/原生验收继续按 16.04B 主合同单列。
