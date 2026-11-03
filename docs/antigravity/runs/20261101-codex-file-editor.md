# 05A 文件编辑异步身份与草稿

日期：2026-11-01。功能修复已实现，专项和组件回放通过；完整检查和构建结果见本轮证据。官方编辑器、多标签、原生与像素未验收。

## 取证与实现

先建立 [FE01–FE06 合同](../specs/05-file-editor.md)。从固定原包提取校验 6 项资源，见 [清单](../../../.ref/parity/05/runs/20261101-codex-file-editor/reference/manifest.json)。本地编辑器依据为 text-file-editor-tab-content 和 text-file-storage；初次检索的 file-preview 为 ChatGPT library 分支，明确排除为本地编辑依据。

官方存储读取检查 AbortSignal；写入 expectedMtimeMs 并返回 saved/conflict；编辑器保留基础换行并有丢弃草稿确认。这些用于识别当前缺口，不声称本轮实现了全部行为。

- DiffDrawer 读取预览增加请求代次和编辑修订号，只有当前请求且期间无新编辑时应用结果；过期请求不再启动 fallback 或显示错误。卸载和关闭使读取失效。
- 普通输入和 Tab 缩进同步更新 revision/isDirty ref，防止 watcher 刷新开始后新编辑被覆盖；脏草稿打开其他文件会提示先保存。
- 保存使用同步单飞锁；实际写入固定 path/content 快照，完成后只更新该预览的基础内容；期间的新编辑仍为脏状态。失败保留内容并释放重试锁。
- 关闭脏预览明确阻止，不静默丢弃；干净关闭、删除当前文件会清 ref 并使旧读取失效。完整保存/放弃弹窗未实现。
- 复用原 read/write 协议、离线 fallback 和 UI，未新增依赖、权限或存储层。

## 验证

- `verify-file-editor-lifecycle.mjs` 直接执行生产 open/save/textarea/close 回调，覆盖逆序读取、过期失败、刷新期间编辑、保存期间编辑、重复保存、失败保留和重试锁释放、关闭后异步隔离。
- 原 files-worksurface 和 TypeScript 专项通过；原文件功能断言保留。
- [最终标准检查结果](../../../.ref/parity/05/runs/20261101-codex-file-editor/actual/verify-all-result.json)和 [日志](../../../.ref/parity/05/runs/20261101-codex-file-editor/actual/verify-all.log)包含隔离协议探针；不是原生真实保存或磁盘冲突测试。
- 浏览器从生产源码提取 editor JSX 与 open/save 回调，使用可控延迟 IO 样本。B 先返回、A 后返回时仍显示 B；保存 first snapshot 时继续输入 newer edit，完成后内容及脏标记保留，保存按钮仍可用。
- 脏内容关闭被拦截且提示可见。960×680、600×680 截图及 [DOM 记录](../../../.ref/parity/05/runs/20261101-codex-file-editor/actual/browser-verification.json)保留；fixture 未读写真实文件，也不包含完整文件工作面布局。
- [构建结果](../../../.ref/parity/05/runs/20261101-codex-file-editor/actual/build-result.json)、[输入绑定](../../../.ref/parity/05/runs/20261101-codex-file-editor/actual/build-inputs.json)与 [产物身份](../../../.ref/parity/05/runs/20261101-codex-file-editor/actual/build-manifest.json)记录当前 EXE。既有 Vite chunk 警告保留。

## 已知缺口和下一项

磁盘 expectedMtimeMs 冲突检测尚未实现，外部进程与用户同时编辑仍有覆盖风险；没有以本轮的 UI 修订号代替磁盘版本。保存后的磁盘回读、BOM/CRLF 完整往返也需单独验证。

关闭时目前要求先保存，没有官方保存/放弃确认流程或自动保存；多文件标签/每文件草稿、编辑器完整搜索、语法与官方布局仍有差距。真实原生路径、目录/文件故障、官方配对像素及用户验收待完成，05 整页未验收。

下一批进入 06 变更与 Git 工作面主要路径复核，当前缺口保留在队列，不把页面轮换当作完成。未提交或推送。
