# 13J 技能搜索结果布局

2026-11-09 完成阶段开发与限定自验。[开发前合同](../specs/13J-skill-search-layout.md)

- `SkillsMcpView.tsx` 将已安装和推荐结果聚合到单一区块，标题计数来自当前查询的两组数据。仅在两组读完且均无匹配时呈现单一空态。
- `RecommendedSkillsPanel.tsx` 在搜索中省去浏览专用标题和来源提示，保留读取失败及重试。切换查询继续使用同一个目录组件和安装状态。样式仅用于技能结果区。
- 两个生产组件回归覆盖结果合并、计数、当前查询归属、加载、错误重试、空态、恢复浏览及既有键盘预览。改动前的回归首先失败于缺少统一结果区。

发布元数据、125 项前端回放、TypeScript、Vite、`git diff --check` 和 Windows EXE、MSI、NSIS 构建通过。本轮无 Rust 源码改动，未重跑 Rust 全量。

隔离 Tauri EXE SHA-256 为 `3ea3336d1d7c512bad1b1dc77f98a6a5517ff0ce495d3f6782b38d818070ac7b`。1442×914 和 949×866 窗口均验证一个已装与九个推荐结果共用“技能 10”标题。宽窗下键加回车打开 Doc 的临时文件正文，窄窗无匹配时只显示一次“找不到技能”。清空后恢复浏览控件。截图、无障碍树、日志及 asar 补证保存在 `.ref/parity/13/actual/13J-skill-search-layout/`。app-server 为隔离夹具。

官方条件页头与建议服务待验证。缺少同环境的官方配对截图，像素分数为 null。物理中文 IME、用户验收和当前提交的 GitHub Windows CI 待完成。
