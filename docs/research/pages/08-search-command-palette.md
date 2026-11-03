# 08 搜索与命令面板 (Search & Command Palette) 调研与实现

日期：2026-10-27。状态：调研、先红断言、最小代码实现、全量标准检查与 Release 构建完成；待原生操作体验与整页用户验收。

2026-11-01 复核：下文属于历史声明，不证明当前官方对齐。当前发现 slash 被接到终端、文件入口未区分模式、IME 与焦点计时器缺陷；按 [08A 合同](../../antigravity/specs/08-search-routing.md)修正。最新证据及未验项见 [08A 记录](../../antigravity/runs/20261101-codex-search-routing.md)，完整官方命令清单/排序/原生/像素仍待验。

## 1. 范围与证据

本单元覆盖全局快速搜索与命令面板的核心能力：
- 全局快捷键与呼出集成：`Ctrl+K` / `Ctrl+P` 全局呼出面板；
- 焦点恢复（Focus Return）：打开时自动记录前序活动 DOM 元素，关闭（`Escape` 键或点击遮罩）后精准将焦点恢复回先前的元素（聊天框、代码编辑器等）；
- 多维度综合搜索与索引：
  - 会话搜索：本地 `threads` 模糊匹配 + 协议并行 `thread/search` 检索历史消息与预览；
  - 文件搜索：本地 `workspaceFileHits` + 协议并行 `fuzzyFileSearch` 检索工作区文件；
  - 技能索引：本地 `skills` 列表检索并支持快捷填入 `$skill`；
  - 设置分区导航：26 个设置分区的模糊检索与一键跳转；
  - 快捷操作：新建会话、启动 dev 服务、运行单元测试、打包构建等；
  - 官方斜杠命令索引：全面引入 `src/slashCommands.ts` 的 32 条官方命令，输入以 `/` 开头时智能置顶命令匹配；
- 键盘导航与状态反馈：
  - `ArrowUp` / `ArrowDown` 高亮导航与滚动跟随；
  - `Enter` 触发选中项执行；
  - `Escape` 退出并恢复焦点；
  - 协议搜索 150ms 防抖与结果缓存（最多 40 条查询）；
  - 加载态与空结果明确反馈。

### 官方基准与协议依据
- 官方固定版本：`26.928.21956 / build 12404`。
- 本机 app-server 实际版本：CLI `0.159.2`。
- 协议 Schema 依据（`.ref/protocol/ServerNotification.json` 与 `codex_app_server_protocol.schemas.json`）：
  - `fuzzyFileSearch`: `{ roots: string[], query: string, limit?: number } -> { files: FuzzyFileSearchHit[] }`；
  - `thread/search`: `{ searchTerm: string, limit?: number } -> { data: ThreadSearchResult[] }`。

## 2. 源码差距与问题清单

| ID | 问题描述 | 影响 | 状态 |
|---|---|---|---|
| S01 | `QuickSearchModal.tsx` 未索引 `SLASH_COMMANDS` 注册表中的官方命令 | 用户在快速命令面板输入斜杠命令（如 `/fork`、`/compact`、`/review`）时无法检索和执行命令 | 已修复 |
| S02 | `QuickSearchModal.tsx` 关闭时未恢复焦点 | 用户通过 `Ctrl+K` 打开命令面板并按 `Escape` 退出后，焦点丢失在 `document.body`，无法连续键盘输入 | 已修复 |
| S03 | 输入以 `/` 开头时未优先置顶斜杠命令列表 | 用户明确输入 `/` 时期望直接进行命令过滤，其他分区干扰了纯命令视图 | 已修复 |

## 3. 先红验证与回归设计

设计先红回归脚本 `scripts/verify-search-palette.mjs`，包含：
1. **S01 验证**：断言 `QuickSearchModal.tsx` 导入了 `SLASH_COMMANDS`，并在搜索匹配项中包含“斜杠命令 (Slash commands)”；
2. **S02 验证**：断言 `QuickSearchModal.tsx` 维护了 `lastActiveElementRef` 并在 `open` 变为 false 时执行焦点恢复；
3. **S03 验证**：断言当输入以 `/` 开头时，斜杠命令分区被优先置于结果列表前部。

修改前运行结果：真实先红断言失败，保存日志至 `.ref/parity/08/search-palette-before.log`。

## 4. 实施与验证结果

- `src/components/QuickSearchModal.tsx`：
  - 导入 `SLASH_COMMANDS` 并建立命令索引与 action/insert 执行；
  - 增加 `lastActiveElementRef` 焦点记录并在 `open === false` 时恢复焦点；
  - 优化以 `/` 开头时的分区过滤与排序。
- `scripts/verify-all.ps1`：集成 `verify-search-palette.mjs`。

### 自动化测试与全量标准检查
- `node scripts/verify-search-palette.mjs`：3 项检查全部通过（PASS）；
- `npx tsc --noEmit`：0 错误通过；
- `pwsh -NoProfile -File scripts/verify-all.ps1`：**ALL CHECKS PASSED**，退出码 0，日志保存至 `.ref/parity/08/verify-search-palette-final.log`；
- Release 原生构建：退出码 0，日志保存至 `.ref/parity/08/release-search-palette.log`；
  - 可执行文件：`dist-artifacts/08-search-palette-20261027/CodexNative.exe`；
  - SHA-256 哈希：`704718B85D5E3C5705952CBBAF5F3340DA627B4DAD8561BA24B87B9945422D62`；
  - 指纹记录文件：`.ref/parity/08/build-search-palette.json`。

## 5. 限制与待用户验收说明

- **外部依赖与索引评分**：跨大规模工作区的大量深层文件的实时打分目前依赖 app-server 后端 fuzzy 算法；
- **视觉像素对齐**：原生窗口下的快捷键徽标（kbd）与各分区表头排版在不同屏幕缩放下的像素对比仍待进一步比对；
- **验收结论**：目前已通过先红自动化回归、全量协议探针验证及 Release 构建，处于“待用户验收”状态。未经验收前不标为“已验收”。

## 2026-11-03 08B更新

见[08B验收记录](../../antigravity/acceptance/08B.md)及[搜索生命周期合同](../../antigravity/specs/08-search-lifecycle.md)。完成root/files边界、真实session生命周期和两版CLI隔离协议复验；194输入稳定、原生包已归档。浏览器焦点夹具不等于Tauri验收，无配对像素；整页仍未验收。
