# 16.06B 本地配置宿主合同

修改前依据见 [阶段合同](16-06B-next-closure.md) 与 [新包静态调研](16-06B-local-research.md)。本文件描述宿主实现，不代表原生或官方像素验收。

## IPC 与真实来源

`src-tauri/src/agent_configuration.rs` 仅提供本地配置，所有范围来自当前 `config/read({cwd,includeLayers:true})` 返回的 layers。没有提供任意 filePath 写入入口，也不把 Work defaults 写到本地 TOML。

```text
agent_configuration_read({cwd?})
agent_configuration_write({cwd?, scopeId, keyPath, value, expectedVersion, expectedContents?})
agent_configuration_open({cwd?, scopeId})
```

read/write 返回相同数据：

```text
{
  snapshot: {config, origins, layers, ...},
  requirements: configRequirements/read.requirements | null,
  serverVersion: app_server.get_status().app_server_version | null,
  scopes: [{
    id, kind: user | project | managed, label,
    filePath, version, config, disabledReason, cwd, contents
  }]
}
```

scope id：user、`project:<dotCodexFolder原值>`、`managed:<layer index>`。项目保持真实 layers 顺序，随后 user 和当前 managed。project.cwd 是 dotCodexFolder 的父目录，不要求与读取 cwd 字符串相等。project.contents 是真实原文或文件不存在时 null。无 project layer 不创建伪 scope；有真实 project layer、文件缺失时允许通过 create_new 创建。

所有命令持有同一 `AgentConfigurationState` Tokio mutex，跨窗口串行；写后通知其它窗口 `agent-configuration-changed`。外部进程和其它配置入口仍由版本/原文 CAS 防止静默覆盖。open 根据当前真实 scope 再派生路径，调用已有 `desktop_open::open_external`；无路径或文件不存在时明确失败。

## 写入白名单、限制和结果

只支持审批、沙盒、网络、搜索、输出详细程度、推理摘要六键。拒绝空字符串、未知字符串/对象/类型、未知已有复杂策略；旧 untrusted/on-failure 仅可显示，不可作为新写入值。审批/沙盒/搜索按 requirements 过滤，indexed 须满足已知合法版本阈值；managed origin 和只读/disabled scope 不能覆盖。网络只在选定或继承有效 sandbox 为 workspace-write 时可改。

用户层走真实 `config/value/write`，传入宿主重读的 filePath、前端已观察的 expectedVersion，保留 stale-CAS 拒绝语义。null 使用 replace 删除；其它使用 upsert。成功状态只接受 ok/okOverridden；随后重读并检查目标配置层的 key 等于所选值或已删除。不能错误要求有效值等于用户层值，因为项目继承覆盖是合法现象。

当前 CLI 的 project RPC 实测返回 configLayerReadonly，因此项目使用独立文本路径，不是 RPC 失败后 fallback。toml_edit 修改单项并保留未知字段、多行字符串、原有注释；null 删除保留相关注释。inline sandbox table 的 network 明确拒绝。

项目先验证 layer version + 完整 expectedContents；重新读取原文比较后才编辑。所有路径组件拒绝 symlink/Windows reparse point。Windows 以 FILE_FLAG_OPEN_REPARSE_POINT、share_mode(0) 打开精确文件，检查普通文件/非reparse；目录身份由 canonical path、创建时间与 Win32 volume/file index 核验，防止目录替换。新文件用 create_new，已有文件不 truncate-open。

持有独占句柄完成 seek/write/set_len/sync_all，逐字读回后释放，再验证路径身份和磁盘原文；失败尝试恢复原文并如实报告恢复结果。此路径不是断电事务：写入中进程崩溃/断电仍可能留下部分文件，不能声称原子恢复。未引入依赖或改写其它 scope。

## 宿主验证范围

模块包含独立临时目录测试：白名单/复杂策略/managed origin、requirements/indexed版本、注释/多行/未知字段、删除继承、损坏TOML/inline拒绝、原文CAS、实际持久读回、真实缺文件创建、Windows同时写只成功一次、目录替换身份识别、相对路径拒绝。

真实协议探针 `scripts/protocol-verify/verify-agent-scopes.mjs` 由父任务维护，使用隔离 CODEX_HOME；需分别记录当前 CLI / Store CLI 的真实结果。模块测试、完整 Cargo 检查和原生构建由父任务统一串行运行，本分工未启动 Cargo，不能提前写为通过。

尚未验证：实际原生文件打开目标、OS异常终止中的恢复、官方同场景UI/像素、Work/实验依赖gate。上述限制不作为伪通过，也不扩展本地权限写入范围。

## 首轮验证发现与修复

父任务初次 Cargo 检查发现两个 E0308，均为同一根因：作用域读取错误分支混合了 `&str` 与 `String` 错误类型；已由父任务统一为 `String`。

随后模块六项测试中五项通过，项目保注释回归失败：已有 `# network` 注释丢失。根因不是 value decor，而是 toml_edit 的 `Table::insert` 会对已有 key 调用 fmt，清掉 key 的前导注释与引号表示。修复为已有键通过 `get_mut` 原位替换 Item，同时保留原 value decor；仅新增键使用 insert。保留原失败断言，并补充带引号 key 和前后注释的回归。修复后 rustfmt/空白检查通过，Cargo 重验由父任务统一执行，本文不提前将该重验写为通过。

父线程最终核验：agent_configuration六项生产Rust回归退出0，随后私有CODEX_HOME、4线程全量Rust299项退出0（rust-full.log）。两版CLI隔离scopes探针均退出0；用户六项CAS/删除/读回、项目RPC明确拒写及缺文件真实layer观察已记录，未发模型turn。宿主项目文件测试与app-server探针分开，不冒称Tauri命令端到端或原生文件打开已验证。
