# 16.07B 本机指令存储与执行主机

实施范围见 [修改前合同](16-07-next-closure.md)。本阶段仅本机文件指令；不实现或冒充账号同步指令、Memory、WSL 或远程主机。

## 官方来源与适配

固定 Store 26.1027.3384.0，archive SHA256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。原文件和完整哈希/UTF-16锚点在本机 ignored `.ref/parity/16.07/actual/16-07B-research/`。

- `early-bootstrap-339-096ec1020e8592e0.js:700401` 按执行主机派生 codexHome/AGENTS.md，读取编辑器时创建缺失文件；700757 读取原文和非空 override；701053 写原文。
- `personalization-queries-819ec43da4ce.js:442` 以 hostId 隔离缓存，使用宿主真实文件服务。
- Tauri 没有上述远程/WSL适配，本阶段从当前 app-server `config/read({includeLayers:true,cwd:null})` 的最后 user layer `name.file` 父目录派生执行home。无真实层、非Windows本地磁盘路径明确失败，不回退进程环境或 `state::codex_home_dir()`。

## IPC

```text
personal_instructions_read()
  -> {path, contents, hasOverride, hostId}

personal_instructions_write({
  contents, expectedContents,
  expectedPath?: string,
  expectedHostId?: string
}) -> 同read
```

write 必须至少携带一项已观察上下文；生产页面传 path 和 hostId 两项。每次命令重新解析真实服务执行home；客户端没有指定任意路径写入入口。hostId 是 canonical home 与目录物理身份的稳定不透明标识，目录在同一路径被替换后也变化；它不是账号ID，不表示支持任意远程host。

先匹配上下文，再允许读取过程中创建缺失AGENTS.md。缺上下文、旧host、旧path在正文写入前拒绝；旧目录替换且新目录没有文件时，不创建新AGENTS.md。成功后向其它窗口发送 `personal-instructions-changed`，只含 `{hostId,path}`，不广播正文。

## 文件闭环与保护

复用16.06 `reject_links` / `directory_identity` 的crate内部可见性；只补Hash能力派生hostId，未改变项目配置行为。不建立新的通用文件框架或依赖。

- 保留文本全部内容、空白、CRLF/LF、BOM；不自动trim正文。
- AGENTS.override.md 仅检查非空trim，不改写它。覆盖文件缺失正常；不可读、目录、非法UTF-8等失败时拒绝正文保存。
- 所有路径组件拒绝symlink/Windows reparse；文件句柄使用 OPEN_REPARSE_POINT、share_mode(0)，检查普通文件，避免读/写之间外部覆写。
- 本页命令共用Tokio mutex跨窗口串行；文件原文在同一独占句柄内再次比较 expectedContents，拒绝外部冲突。
- 保存前后比较目录物理identity；写入seek/write/set_len/sync_all后句柄读回，释放后再次从路径重读正文与override，确认context一致才返回成功。
- 写入IO失败尝试恢复原文，错误明确恢复是否成功；写后验证失败不伪装成功。

直接文件写入不是断电原子事务；进程在write与sync之间异常终止仍有部分写入风险。同步失败后恢复可能也失败，错误不会隐瞒这一点。此适配提供的CAS与路径防护强于已观察官方静态简单写法，但不据此宣称原生/像素等价已验收。

## 验证范围与未验项

保留原两项真实临时文件测试，新增四项：旧home/path与目录替换在缺文件创建前拒绝、原样字节/BOM/换行与外部修改/坏override拒写、跨线程复用实际命令mutex的单一revision写入、真实user层来源与无默认home fallback。Windows磁盘路径/WSL拒绝在对应平台验证。

本分工仅执行归属文件rustfmt/空白检查，未启动Cargo；模块、全量Rust与完整标准由父任务串行运行，最终结果应在阶段验收记录补充。实际原生窗口事件/文件打开、WSL/远程宿主、账号同步/Memory、真实新模型turn消费以及官方同条件截图没有由上述单测证明，必须分别取证。
