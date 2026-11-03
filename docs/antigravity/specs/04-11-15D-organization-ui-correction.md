# 04/11/15D 项目、工作树、归档纠偏合同

日期：2026-11-04。状态：本轮有据增量开发完成、定向自验通过；不是整页验收。

## 基准与边界

Store 26.1027.3384.0，asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。本轮显式读取 Store 安装包并复核完整哈希，不使用硬编码旧包路径的 `scripts/extract-asar-file.mjs`。证据在 `.ref/parity/04/actual/04-11-15D/reference/manifest.json`、`raw/`，偏移均为 0-based UTF-16 字符偏移。DPI、缩放、运行时 gate、官方成对截图未知。

## 页面归属与原文

- 04：`projects-index-page-d7692dfef6eb.js` 的 `zr` 是 `grid-cols-[minmax(0,1fr)_4rem_8rem]`，680px 以下隐藏更新时间；列只有名称、已更新、动作。`Oi/Ri` 的单击展开、双击新聊天与当前入口方向一致。首屏搜索和紧凑标题由 `SearchablePageLayout` 承载。没有路径/聊天数独立列。保留多根目录身份和真实 project CRUD，路径改为名称 tooltip，不删除底层能力；完整官方 overflow、置顶及项目编辑弹窗仍缺。
- 11：`worktrees-settings-page-e0a8009c3aa2.js` 是设置页；`ri` 组合 preferences 和 inventory，inventory 按仓库分组。`ii` 明确互斥加载、错误、空、列表状态；`Fr` 删除包含归档关联聊天/未提交更改风险及取消保护。当前独立管理页不等同该设置 surface；只同步可证中文及互斥状态，不把其常驻创建表单改造成猜测的官方整页。
- 15：`app-primary-998934e837fc.js` 同时含 `sidebarElectron.archivedTasks` 和 `settings.dataControls.archivedChats`；不能混为一个 surface。当前独立 Archive 使用设置型永久删除与恢复链，暂保留该能力。中文搜索/空/无匹配文案采用设置字典；空态仅文字，不使用原来无证的文件柜 emoji 和侧栏操作说明。恢复查看仍为页内 status，官方 toast action 待公共层集成。

中文原文：`zh-CN-88ebb426d686.js`，项目列“名称/已更新”，搜索“搜索项目”，有数据创建按钮“创建”、空页“新建项目”；工作树“尚无工作树/正在获取工作树详细信息…/无法加载工作树/刷新”；归档搜索“搜索已归档的聊天”、空“暂无已归档的聊天”、无匹配“未找到匹配的归档聊天”。新 worktrees inventory/delete 键未出现在当前中文字典的必须保持未证，不能自行宣称官方中文。

## 本轮可验证合同（修改前定义）

| ID | 操作 | 预期与保护 | 验证 |
|---|---|---|---|
| O04-01 | 项目列表普通/窄窗 | 三列；680px 以下隐藏更新时间；路径不独占一列；全部根目录仍可获知 | 生产 JSX/CSS 回归；像素未验 |
| O04-02 | 选同根不同项目、开始聊天/创建取消 | 项目 ID 与根目录不混；原异步与中文输入法保护不退化 | verify-project-index |
| O11-01 | 列表请求 pending/reject/成功空 | 依次加载/错误/空；不在 pending 或错误时假称尚无工作树 | 生产组件隔离 IPC 回归 |
| O11-02 | 切上下文后晚到回包、删除取消 | 不污染新上下文；取消不删除；置顶关联聊天不允许删除 | verify-worktree-context/removal |
| O15-01 | 空数据/有搜索但无命中 | 显示分别对应官方中文；不出现未经证实说明 | 生产 JSX 回归 |
| O15-02 | 恢复、删除、取消、部分失败 | 真实结果与列表一致，取消零写；原恢复查看保留 | verify-archive-actions/bulk |

## 未完成

全页容器/公共壳几何、项目排序与完整搜索/分页、官方菜单及编辑/创建弹层、工作树设置和独立页入口整合/分组、归档 sidebar/设置边界和全局 toast action、官方模糊搜索及云端、原生交互与像素均未验。本轮不新增依赖、不运行账号 HTTP/模型、不写真实数据、不改 Rust。

## 实施说明

项目正常列表采用三列及70px行/40px表头最小高度候选，来自当前官方 utility；窄窗680px以下隐藏时间。原上移/下移、重命名、目录和删除移入复用的 `ThreadActionsMenu`，不复制菜单键盘/portal实现；这些兼容动作不等于官方完整菜单内容已恢复。新增展开按钮支持键盘，双击按钮不再冒泡为开始聊天。workspace fallback明确保持旧视图，不能把它算正常官方项目页。工作树加载状态只对当前request生效，旧请求finally不得清除新请求loading。归档删除按钮补真实可访问名称，原取消/部分失败链不改。

结构与中文来自静态证据；当前未取得同环境官方/实际截图，无法执行有意义的visual-verdict比较。状态记录为未测、score=null，不能伪造90分或像素通过。
