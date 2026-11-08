# 03F 聊天内逐文件变更

基准为 Windows Store `26.1103.4239.0`。偏移采用从零开始的 UTF-16 字符计数。官方提取资源位于本地证据目录 `.ref/parity/08/actual/08C-selection/`。

| 官方来源 | 行为与验证 |
| --- | --- |
| `async__182735.bb2cb0d2af.js` 5106980、5120371 | 新增和删除使用原始内容，更新使用统一补丁。回放验证原始文本行数及补丁中形似文件头的正文。 |
| `async__225284.63835849b6.js` 361043、371870 | 每个文件单独显示。回放验证独立展开、单独打开以及已停止、已拒绝状态。 |
| `async__1561.0f4c0bdc0f.js` 的 `codex.patch.change.*` | 状态及差异展开按钮使用官方中文文案。 |

使用对应 Windows 构建在隔离工作区载入一个三文件变更。展开第二个文件只显示该文件补丁，协议记录没有文件读取。点击改名后的 `第二个🚀.ts`，协议只读取目标路径，右侧编辑器显示磁盘正文。关闭窗口后进程退出，两份测试文件的 SHA-256 保持一致。协议使用隔离样本，文件预览使用磁盘上的实际内容。

- `node scripts/verify-tool-cards.mjs`、`npx tsc --noEmit`、`node scripts/verify-ui-parity-release.mjs`（113 项）、`node scripts/verify-release-metadata.mjs` 和 `npm run tauri build -- --ci` 均退出 0。Windows EXE、MSI、NSIS 构建成功。本轮未重跑 Rust 全量单测。
- Windows EXE 的 SHA-256 为 `1f1f7161ef2b6476d3f2d2217fc14f03ce828c4e7b7ab3026fa05a6b6aff44d4`。本地日志和原生记录位于 `.ref/parity/03/actual/03F-per-file-patch/`。
- 本地预览在字符阈值之外另设 5000 行上限。自动审核拒绝、审批等待和编辑器行号定位待单独对照。缺少同环境官方配对截图，像素未评分，用户验收待定。
