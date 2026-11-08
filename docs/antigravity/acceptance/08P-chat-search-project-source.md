# 08P 独立聊天搜索的项目来源

沿用 [08K 基准](08K-chat-search.md) 的 Windows Store `26.1103.4239.0`。以下位置为从零开始的 UTF-16 偏移。

`515947.71d674afb6.js` 43390–43600 优先显示本地命中的项目名称，普通目录回退到 basename，`projectless` 隐藏目录。50215–50535 将当前会话元数据的 `workspaceKind` 传给行组件。同版协议 `ThreadSearchResponse` 含可空的 `Thread.projectId`。

复用侧栏的归属解析与项目目录。验收覆盖重命名后的项目、非当前项目、未加载聊天的协议项目 ID、明确移出项目、目录回退和有同名目录时按会话分别处理。项目名解析只在独立聊天搜索使用。

## 本轮实测

- TypeScript、113 项前端回放、发布元数据、Store 自带 CLI 的隔离搜索探针和 Windows EXE、MSI、NSIS 构建通过。本轮未重复运行完整 Rust 测试。
- 隔离 Windows EXE 读取带项目名和无项目标记的本地状态。空查询和正文查询均验证项目聊天显示当前名称、移出项目的聊天不显示目录。尚未载入侧栏的协议命中按项目 ID 找到名称，Enter 后核对 `thread/read` 与 `thread/resume` 指向该会话。
- EXE SHA-256 为 `89efd742ed4db1b0baf241c383a8532119e02899c57498c20e88ff0510f8a7ff`。记录位于 `.ref/parity/08/actual/08P-chat-search-project-source/`。长名称当前按列宽截断，完整名称可由可访问性树读出。官方悬停提示、同环境像素、真实账号和用户验收仍待验证。
