# 05 文件工作面 (Files Worksurface) 调研与实现

日期：2026-10-27。状态：调研、先红断言、最小代码实现、全量标准检查与 Release 构建完成；待原生操作体验与整页用户验收。

## 1. 范围与证据

本单元覆盖文件工作面（Files 标签页、资源管理器与内联编辑器）的核心能力：
- 目录与文件树浏览：`fs/readDirectory` 与 `fs_list_dir`（名称、类型、大小、修改时间、多层目录导航、面包屑导航、返回上级）；
- 文件搜索与筛选：`fs_search_files` 快速文件命中列表与跳转；
- 内联文件预览与编辑：`fs/readFile` / `fs/writeFile` / `fs_read_preview` / `fs_write_file`（UTF-8 文本、图片 Base64 预览、二进制文件不可直接编辑提示、大文件限制）；
- 编辑器交互与快捷键：
  - `Ctrl+S` / `Cmd+S` 快速保存；
  - `Tab` 键缩进插入（2 个空格）与光标保持；
  - 未保存脏状态指示（标题小圆点标记）；
  - 关闭预览按钮（返回纯文件列表全宽视图）；
- 文件变动监听（Live Watch）：`fs/watch` 监听当前目录与 `fs/changed` 通知防抖刷新；
  - 外部修改时，无草稿（`!isDirty`）自动重新加载最新文件内容；
  - 有未保存草稿（`isDirty`）时，严格保护用户草稿不被覆盖；
- 目录失效状态（Invalid Directory Recovery）：
  - 目录被外部删除或无法访问时，提供明确的失效错误提示，并支持一键返回工作区根目录。

### 官方基准与协议依据
- 官方固定版本：`26.928.21956 / build 12404`。
- 本机 app-server 实际版本：CLI `0.159.2`。
- 协议 Schema 依据（`.ref/protocol/ServerNotification.json` 与 `codex_app_server_protocol.schemas.json`）：
  - `fs/readDirectory`: `{ path: string } -> { entries: Array<{ fileName: string, isDirectory: boolean, isFile: boolean }> }`；
  - `fs/readFile`: `{ path: string } -> { dataBase64: string }`；
  - `fs/writeFile`: `{ path: string, dataBase64: string } -> {}`；
  - `fs/watch`: `{ path: string } -> { path: string }`；
  - `fs/unwatch`: `{ watchId: string } -> {}`；
  - `fs/changed`: `{ watchId: string, changedPaths: string[] }`。

## 2. 源码差距与问题清单

| ID | 问题描述 | 影响 | 状态 |
|---|---|---|---|
| F01 | `DiffDrawer.tsx` 的文件编辑器 textarea 缺少 `onKeyDown` 快捷键处理 | 用户在文本框内按 `Ctrl+S` 会触发浏览器默认的网页另存为弹窗，无法保存文件 | 已修复 |
| F02 | `DiffDrawer.tsx` 的文件编辑器 textarea 未拦截 `Tab` 键 | 按 `Tab` 会导致焦点跳出文本框到其它控件，无法像常规编辑器一样进行代码缩进 | 已修复 |
| F03 | `DiffDrawer.tsx` 的文件编辑器头部缺少关闭按钮 | 用户打开文件后无法关闭当前文件预览，无法回到仅目录列表的整洁视图 | 已修复 |
| F04 | `DiffDrawer.tsx` 未记录目录加载失败状态 | 当目录被外部移动/删除或无权限时，仅显示空目录，缺少明确的失效提示与“返回工作区根目录”的恢复路径 | 已修复 |
| F05 | `DiffDrawer.tsx` 在收到 `fs/changed` 事件时仅刷新目录未刷新当前文件预览 | 外部修改当前文件时，即使用户没有未保存修改也无法自动看到最新内容 | 已修复 |

## 3. 先红验证与回归设计

设计先红回归脚本 `scripts/verify-files-worksurface.mjs`，包含：
1. **F01 验证**：断言 `DiffDrawer.tsx` 中的 `textarea.file-editor-textarea` 包含 `onKeyDown` 拦截 `(e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s"` 并触发 `saveEditedFile`；
2. **F02 验证**：断言 `textarea.file-editor-textarea` 处理 `Tab` 键缩进插入；
3. **F03 验证**：断言 `file-editor-header` 中包含关闭当前预览的按钮（触发 `setFilePreview(null)`）；
4. **F04 验证**：断言 `DiffDrawer.tsx` 记录目录加载异常并渲染 `fe-dir-error` 错误状态以及返回工作区根目录的恢复按钮；
5. **F05 验证**：断言 `DiffDrawer.tsx` 在 `fsWatchPath` 回调中，当 `!isDirty` 时自动重新拉取当前打开文件的最新内容。

修改前运行结果：真实先红断言失败，保存日志至 `.ref/parity/05/files-worksurface-before.log`。

## 4. 实施与验证结果

- `src/components/DiffDrawer.tsx`：
  - 新增 `dirError` 状态并在 `refreshDirectory` 发生异常时记录错误信息；
  - 在文件列表渲染中增加 `dirError` 失效状态卡片与“返回工作区根目录”一键恢复按钮；
  - 维护 `isDirtyRef` 与 `filePreviewRef`，在 `fsWatchPath` 防抖回调中实现实时刷新当前文件内容（有草稿时不覆盖）；
  - 在 `file-editor-header` 增加标题未保存脏标记（`•`）及关闭预览按钮；
  - 在 `file-editor-textarea` 增加 `Ctrl+S` / `Cmd+S` 快捷保存与 `Tab` 键 2 空格缩进处理。
- `src/components/FileExplorer.css`：
  - 增加 `.fe-dir-error` 居中错误信息样式。
- `scripts/verify-all.ps1`：集成 `verify-files-worksurface.mjs`。

### 自动化测试与全量标准检查
- `node scripts/verify-files-worksurface.mjs`：5 项检查全部通过（PASS）；
- `npx tsc --noEmit`：0 错误通过；
- `pwsh -NoProfile -File scripts/verify-all.ps1`：**ALL CHECKS PASSED**，退出码 0，日志保存至 `.ref/parity/05/verify-files-worksurface-final.log`；
- Release 原生构建：退出码 0，日志保存至 `.ref/parity/05/release-files-worksurface.log`；
  - 可执行文件：`dist-artifacts/05-files-worksurface-20261027/CodexNative.exe`；
  - SHA-256 哈希：`7F867FCBCED6CEFCCEC730B2787150AD6DBBF9A0B21F0C82D17617FCE4E52C12`；
  - 指纹记录文件：`.ref/parity/05/build-files-worksurface.json`。

## 5. 限制与待用户验收说明

- **外部依赖与超大文件**：超大二进制文件的十六进制只读查看目前使用回退提示；
- **视觉像素对齐**：原生窗口下的文件树双栏与编辑器排版在不同窗口宽高下的逐像素比对仍待进一步采集参考并实测；
- **验收结论**：目前已通过先红自动化回归、全量协议探针验证及 Release 构建，处于“待用户验收”状态。未经验收前不标为“已验收”。
