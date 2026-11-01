# 01B：本地项目实体与多根目录

2026-10-31，修改前合同；01B仍开发中。

官方main ci63317读取local-projects；fi63723按project-order呈现项目，目录投影单独去重，不能用根目录去重合并实体。initial RA2267520、vkn2276730、qkn2286123建立roots及唯一目录owner；Ckn映射到shared PEt1936899：单根优先、当前root为首根优先、较早createdAt优先、同时间projectId.localeCompare更大者优先。现代G_n2056446对owned roots构造精确/prefix scope，显式assignment仍优先。各文件固定哈希沿用前轮证据，偏移0-based UTF-16。

范围：只读有效local-projects记录及project-order、当前local:home server映射；Sidebar按真实实体ID分组，根目录投影只作为未覆盖legacy回退。一个多root实体只出现一次，同root不同ID仍独立。折叠/分页/手动排序使用实体ID，不继承任意同root目录存序。已有assignment/workspace state/projectless优先级保留，未分配cwd通过owned root scope，第二root有效。

项目新聊天准备保留实体上下文；真实thread/start带明确server projectId与runtimeWorkspaceRoots，缺映射时仅允许按相同实体ID读取project/read确认，不能按roots推断UUID。失败不能清空当前聊天或冒充新建。普通legacy新聊天/目录切换/打开已有聊天应清除草稿上下文，避免串项目。工作树runtime roots替换首根的实际行为需单独验收，不宣称完整worktree对齐。

计划：纯分组/创建参数与实际Sidebar先失败→只读元数据/分组渲染/上下文传递→验证同roots不同ID、多root、root owner、显式归属、独立折叠/存序和上下文清理→全量Rust/完整标准/release→真实隔离项目数据的原生旧/新对照。无新依赖/CSS，不自动迁移/导入项目；实体删除/写入、Composer完整项目列表、外部文件监听、导航及官方像素仍需后续完整验收。

## 本轮实现与验证（2026-10-31）

### 实现结果

- `src-tauri/src/state.rs` 从 `electron-persisted-atom-state` 读取有效 `local-projects`、`project-order`、`selected-project`，并只用当前 `local:<CODEX_HOME>` 的显式 legacy→server 映射补充 `serverProjectId`；不按目录推断 UUID。
- `src/sidebarProjects.ts` 以实体 ID 作为 Sidebar 分组身份。同一根目录的不同实体保持独立；多根实体只显示一行；root scope 按官方 owner 规则计算；显式 workspace/global assignment 和 projectless 标记优先于 cwd；未覆盖目录继续作为 legacy Recent 回退。
- `src/components/CodexSidebar.tsx` 的折叠状态、分页上限、手动排序键均使用实体 key；项目标题的“在项目中开启新聊天”入口继续传递实体对象。
- `src/App.tsx` 的普通新聊天和 `/goal` 首次创建均以项目首根作为 `cwd` 兜底，并把真实 `projectId` 与 `runtimeWorkspaceRoots` 传给 `thread/start`；缺少 server 映射时拒绝伪造项目创建。

### 验证证据

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit` | 通过 |
| 01B 本地项目、Sidebar、workspace identity 回归 | 通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 36 passed |
| `pwsh -NoProfile -File scripts/verify-all.ps1 -Fast` | 退出 0，`ALL CHECKS PASSED` |
| `npm run tauri build` | 退出 0，生成 release EXE/MSI/NSIS |
| 当前 EXE | `dist-artifacts/01B-local-projects-20261031/CodexNative.exe`，13,266,944 字节，SHA-256 `CA7BAE171C072BE9B48B286545100F23BCA965DA9769F97F4EFAB6F72EAA667A` |
| 隔离原生冒烟 | 新 `CODEX_HOME` 与 WebView profile 启动成功；UIA 观察到实体 B、实体 A、Legacy 三个独立项目行及实体 B 的项目内新聊天按钮；未发送任务。证据：[native-verification.json](../../../.ref/parity/01/runs/20261031-codex-01b-local-projects-r2/actual/native-verification.json) |

### 边界与状态

- 本轮证明的是本地项目实体分组、root scope、身份优先级和新建参数合同；没有把组件回归或隔离回放扩张成官方运行时同场景通过。
- Windows 缩放、App 缩放、语言、主题仍为未知；没有同条件官方无损截图，因此本轮不评分像素一致，也不宣称 1:1。
- 本轮没有实现项目实体写入/删除、跨窗口文件监听、完整 Composer 项目选择、导航路由或官方同条件视觉验收。01B 仍处于“开发中 / 待用户验收”，不放行 01C。
