# 16.13B 临时 Git 文案生成宿主合同

2026-11-03。修改前依据为 `16-13-next-closure.md` 与固定 Store 原始 prompt-contract；本文件明确专用宿主边界，不代表真实模型或原生/像素已验。

- 专用 git_message_generate 仅接 operationId/cwd/mode/prompt；prompt是UI构造的真实Git上下文，宿主按20k/30k/40k UTF-16字符上限截上下文后包裹官方完整 builder。取消只按operationId，调用窗口是宿主取得的owner，不接任意threadId/model/权限。
- 实际模型目录分页读取、验证可见/普通/low候选；固定Store seed gpt-6-luna仅在实际目录中存在时使用，不能写死当前主会话模型。自定义提供者保留真实配置模型；没有可证模型则失败，不生成占位文字。
- 两版已保存schema共同支持sandbox read-only与turn sandboxPolicy readOnly，本适配仅发送这一组，不与Store较新的named permissions混发；ephemeral、never、low、serviceTier null、无动态工具；保留官方禁codex_app/fanout/multi-agent/web_search配置与Make 0 tool calls提示。
- AppServerManager内部先登记私有start请求；start响应在同代锁内先认领thread再交付结果。响应前thread消息暂存，归属判定后私有流独占；普通消息恢复原路。私有tool/approval直接返回JSONRPC错误，不进入全局审批/时间线。监听结束后只保留同代hidden tombstone阻晚到事件，重连清空。
- operationId记录真实窗口owner；同ID并发拒绝、跨窗取消拒绝、窗口销毁取消。取消/超时绝不重发模型请求；仅同connection generation尽力interrupt/unsubscribe，旧取消不发到新连接。30s提交、45s PR/组合截止；请求drop清理pending并认领晚到临时创建，避免泄到用户列表。
- 仅同thread/turn、completed且结构化JSON与字段边界合法才返回；工具项/错误/failed/interrupted/空/坏schema都失败。不产生stage/commit/push/createPR。生成无工具实测不能仅靠提示宣称已证明；观察到工具项立即失败并中断，入站请求拒绝。

计划通过mock实际协议/事件路由验证创建前通知、completed早于turn响应、delta/final、跨线程、失败后completed、工具/审批拒绝、取消/超时/重连/晚响应与清理。真实模型/账号请求与Git写入禁止在自动探针执行；父级单列标准检查、原生构建和剩余限制。

## 实施与限定验证

已实现 `git_message_generation.rs`、AppServerManager 私有通知/请求保护和 lib 三个命令/窗口状态接线。父级的只读 `git_message_context` 使用 spawn_blocking 调用实际上下文函数；生成没有经过通用 turn/start 工作区绑定，也没有复用自动化 workspace-write。命令不接受 renderer threadId、模型、权限或窗口owner。

生成事件与 turn/start 响应竞速：同临时线程的 turn/started/completed 可先确认实际 turn ID，最终完成不必等待迟到的 start 响应；无响应但已收到合法 completed 的场景已有回归。未知/取消的请求不重发；晚到创建/turn 响应由 manager 在同代认领并清理。入站工具/审批 JSONRPC request 直接拒绝；观察到工具 item、错误、非 completed 终态均拒绝结果。成功前和清理后再次核当前 connected generation，排队的旧 completed 不能在重连后返回成功。

结果运行时复核对象允许键集、字段类型、UTF-16长度、提交subject正则边界和单行PR标题，额外字段/CRLF标题不会先作为宿主成功返回。对上下文截断后才加完整官方host提示；三份完整 builder 黄金输出均逐字匹配可提交的 `scripts/fixtures/git-message-golden.json`。没有把当前实现输出更新成官方基准。

本地兼容适配：旧0.159 schema没有 named permissions/runtimeWorkspaceRoots，本实现仅发送两版已证的 sandbox read-only/turn sandboxPolicy readOnly，不按版本字符串猜测、不混发互斥字段。模型使用固定Store已证seed与真实分页目录/low能力选择，自定义provider保留真实配置模型；尚未接入官方远程evaluation对ephemeralGenerationModel的覆盖，不能宣称该远程覆盖机制1:1。

2026-11-03 限定结果：

- `CARGO_TARGET_DIR=C:/Users/lus/.cargo-target/codex-desktop-native-send-button-20261101`、`RUST_TEST_THREADS=4`，`cargo test --manifest-path src-tauri/Cargo.toml git_generation -- --nocapture`：最新退出0，12组通过，0失败。日志 `.ref/parity/16.13/actual/16-13B/host/git-generation-tests.log`。覆盖生产生成流程、实际目录参数、只读ephemeral/schema、完整prompt黄金、事件竞速与范围、失败/工具/审批、字段边界、超时/取消/提前取消/已结束ID不重放、监听清理、manager私有捕获/早通知/晚创建/旧代cleanup。
- 同阶段 `cargo test --manifest-path src-tauri/Cargo.toml message_context -- --nocapture`：退出0，2组父级tempdir上下文测试通过。日志 `host/git-message-context-tests.log`；验证index与tracked工作区、untracked不内联、unborn staged与PR真实基线。本lane未修改这些context函数。
- 首次增加实际 request Drop 测试后，两target都出现Windows测试进程加载错误 `0xc0000139 STATUS_ENTRYPOINT_NOT_FOUND`，没有运行测试断言，不能当作通过。PE imports +系统GetProcAddress确证 `comctl32.dll!TaskDialogIndirect` 缺失（127）；直接持有AppHandle的cleanup析构使单测拉入无CommonControls v6 manifest的native dialog路径。改为生产事件replay回调持有AppHandle，cleanup核心与原Drop回归完整保留，修后同target真实12组通过。失败原日志 `host/git-generation-loader-failure.log`、`host/pe-imports.json`、`host/missing-imports.json` 保留；没有删除/跳过失败测试或改全局manifest。

本lane没有发送真实 turn/start、模型、账号服务、用户仓库stage/commit/push或PR写入。只读thread参数协议探针、完整标准/原生构建由父级另列。Make 0 tool calls 与只读策略不能单独证明真实模型绝无内建只读工具尝试；受控回归只证明本客户端会拒入站工具请求并在观察到工具项后失败/中断，真实零工具生成仍未验。原生焦点、配对像素和用户验收未通过，不能把这些限定测试写成整页1:1完成。
