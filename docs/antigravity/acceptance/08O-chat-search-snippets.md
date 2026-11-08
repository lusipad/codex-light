# 08O 独立聊天搜索命中片段

沿用 [08K 基准](08K-chat-search.md) 的 Windows Store `26.1103.4239.0`。以下位置是从零开始的 UTF-16 偏移。

- `182735.bb2cb0d2af.js` 1031550–1032150 将本地 `thread/search` 返回的 `snippet` 作为正文命中片段。同版协议 `ThreadSearchResponse` 将它定义为字符串。
- `515947.71d674afb6.js` 42680–48200 将命中片段放在标题下，匹配部分高亮，来源另置于右侧。普通目录来源回退到工作目录 basename。

验收覆盖保留协议原始命中片段、标题和片段中的字面查询高亮、无片段时无占位副标题、目录 basename、缺失目录时隐藏来源，以及仍打开同一会话。专用项目名称与 projectless 来源、分支命中和同环境像素另验。

## 本轮实测

- TypeScript、113 项前端回放、发布元数据及 Windows EXE、MSI、NSIS 构建通过。本轮未重复运行完整 Rust 测试。
- 真实协议探针改用当前的文件根数组与聊天分页形状。隔离 `codex-cli 0.165.0` 和 Store 自带 `0.167.0-alpha.3.2` 均通过 Unicode 文件新增/移除、会话停止与空聊天页读取。
- 隔离 Windows EXE 输入「测」后显示协议返回的正文片段、高亮及右侧 `workspace`。按 Enter 打开命中会话，`thread/read` 和 `thread/resume` 均确认目标 ID。EXE SHA-256 为 `9b8313c2e33483798a4bba93ef80b3227b44b7c7a21ca29d847e08bae19ac948`，记录位于 `.ref/parity/08/actual/08O-chat-search-snippets/`。
- 官方同环境截图、真实账号与用户验收待完成。远端 Windows 作业仍因账户付款或支出限额未启动。
