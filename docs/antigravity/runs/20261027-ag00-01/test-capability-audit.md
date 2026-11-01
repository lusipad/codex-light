# 测试能力层级审计报告 (Test Capability Audit) - R6 修正版

- 审计 Run ID: `20261027-ag00-01`
- 审计时间：2026-10-27T23:44:30+08:00 (Asia/Shanghai)
- 审计目的：清点仓库中全部现有测试脚本（涵盖 `scripts/` 下全部 31 个 `verify-*.mjs` 脚本及 6 组协议探针），客观界定其“实际证明的能力层级”，既纠正“静态代码检查充当像素/原生通过”的夸大，也不将有效的纯函数/状态回放一概抹煞。

---

## 1. 测试能力分层定义标准

依据 `ACCEPTANCE-STANDARD.md`，测试能力划分为 7 个层级：

1. **L1 静态结构检查 (Structure Check)**：检查源码字符串、AST 节点、正则匹配、文件是否存在。只能证明“代码写在源码文件中”，不能证明“运行时能正确执行”。
2. **L2 纯函数与状态机回放 (Deterministic Replay)**：导入实际模块（如快捷键解析器、时间线归并器、Markdown 词法规则等），向函数传入样本数据并断言返回值或状态。**能证明实际业务逻辑处理，但不能证明浏览器/WebView 真实事件链、原生系统权限或真实外部服务**。
3. **L3 真实协议探针 (Protocol Probe)**：启动隔离的真实后台服务（如 `codex app-server`），验证 JSON-RPC 请求与响应字段。证明前后端通信协议契约，不能证明前端 UI 呈现与像素。
4. **L4 组件与浏览器 DOM 行为 (Browser Action)**：在真实 DOM/无头浏览器中派发事件（点击、键盘、输入），断言 activeElement、焦点环与 UI 更新。
5. **L5 真实服务写后读回 (Real Service Roundtrip)**：在隔离工作区完成真实数据写入（如文件保存、配置修改），并通过独立通道读回，验证持久化与故障回退。
6. **L6 原生桌面实测 (Native Interaction)**：在 Tauri 编译的原生 EXE 窗口中操作真实键鼠、Windows 物理输入法候选字、窗口拖拽、原生系统菜单。
7. **L7 像素与视觉对照 (Visual Verdict)**：在完全相同的物理客户区分辨率、DPI、缩放与数据场景下，比对无损 PNG 截图的关键几何边界（1 物理像素误差以内）与残余色差。

---

## 2. 仓库现有全部 31 个验证脚本及协议探针完整能力清点总表

| 脚本文件 | 实际执行机制 | 已证实的最高层级 | 单独不能证明的内容 (需纠正的旧声明) | 审计结论与升级方向 |
|---|---|---|---|---|
| `scripts/verify-shortcuts.mjs` | 导入 `src/shortcuts.ts` 的 `matchShortcut` 与 `matchRecentThreadIndex` 函数，执行 39 项断言 | **L2 纯函数回放** | 不能证明原生窗口全局热键捕获，不能证明未被系统抢占 | 认可 L2 键盘逻辑回放有效；需补充 L6 原生窗口热键实测 |
| `scripts/verify-composer-keys.mjs` | 导入 `ComposerBox.tsx` 键盘处理函数，测试 Enter/Ctrl+Enter/Alt+Enter 修饰键分流 | **L2 纯函数回放** | 不能证明 Windows 物理 IME 或原生键盘消息 | 认可 L2 回调逻辑分流有效；需补充 L6 物理输入法实测 |
| `scripts/verify-execution-items.mjs` | 导入 `threadTimeline.ts`，传入 reasoning/command 流式增量与快照样本验证合并 | **L2 纯函数回放** | 不能证明真实 CLI 命令流式回传 | 认可 L2 时间线合并有效；需配合 L3/L5 验证真实任务流 |
| `scripts/verify-duplicate-message-fix.mjs` | 导入时间线模块，测试 `mergeTimelineItem` 针对 optimistic 消息与完成轮次的去重 | **L2 纯函数回放** | 不能证明网络重试或乱序网络丢包 | 认可 L2 消息去重有效 |
| `scripts/verify-thread-timeline.mjs` | 导入时间线模块，测试 A→B 会话切换、代次隔离与陈旧数据抑制 | **L2 纯函数回放** | 不能证明浏览器实际渲染 DOM | 认可 L2 会话隔离逻辑有效 |
| `scripts/verify-thread-content.mjs` | 传入复杂 Markdown 代码块、未闭合 block、搜索匹配等 17 组用例断言词法行为 | **L2 纯函数回放** | 不能证明 KaTeX 或复杂 HTML 渲染几何 | 认可 L2 文本解析逻辑有效 |
| `scripts/verify-approval.mjs` | 导入审批状态机，测试审批创建、处理、拒绝及 generation 隔离 | **L2 纯函数回放** | 不能证明真实 CLI 权限阻塞与继续执行 | 认可 L2 审批状态机有效；需配合真实 app-server 验证 |
| `scripts/verify-queue.mjs` | 导入队列处理函数，测试分页、Steer 状态与排队删除逻辑 | **L2 纯函数回放** | 不能证明原生 UI 排队卡片交互 | 认可 L2 队列状态处理有效 |
| `scripts/verify-turn-controls.mjs` | 导入轮次控制函数，测试中断、重试及状态机流转 | **L2 纯函数回放** | 不能证明真实取消信号送达 CLI | 认可 L2 轮次控制有效 |
| `scripts/verify-clipboard.mjs` | 模拟 Clipboard API 失败，测试 textarea 降级与错误恢复 | **L2 纯函数回放** | 不能证明系统剪贴板原生写操作 | 认可 L2 降级逻辑有效 |
| `scripts/verify-reasoning-rendering.mjs` | 导入实际 `threadTimeline.ts` 执行时间线回放，但折叠/Accordion 决策使用测试内复制的本地样本函数，并配合 App.tsx 静态正则检查 | **L2 (复合：实际 timeline 回放 + 复制决策样本 + 静态检查)** | 不能直接证明当前 `App.tsx` 运行时分支的折叠动画与排版 | 需标清其构成，未来升级为对 App 真实组件的渲染测试 |
| `scripts/verify-tool-cards.mjs` | 测试各类工具卡片的状态解析与渲染参数格式化 | **L2 纯函数回放** | 不能证明真实工具执行与终端输出 | 认可 L2 卡片数据流有效 |
| `scripts/verify-plan-goal.mjs` | 测试 Plan 与 Goal 生命周期的阶段状态合并与更新 | **L2 纯函数回放** | 不能证明持久化与多轮任务联动 | 认可 L2 状态流转有效 |
| `scripts/verify-unit-01a-shell.mjs` | 读取 `styles.css` 和 `AppTitleBar.css`，正则检查 54px 高度、60px 宽度与 drag 声明 | **L1 静态结构检查** | **不能证明真实 DOM 渲染高度、不能证明贴顶、不能证明像素一致**（1px 反证可验证此限制） | 定位为 L1 样式规则检查，撤销其像素证明声明 |
| `scripts/verify-unit-01-home-shell.mjs` | AST 检索 `handleKeyDown` 中 `isComposing` 文本及 CSS 属性包含 | **L1 静态结构检查** | 不能证明真实物理中文输入法选字上屏，不能证明像素一致 | 属于静态代码检索，需升级真实输入测试 |
| `scripts/verify-unit-02-thread-basics.mjs` | AST 检索 `MarkdownView.tsx` 中是否包含数学/表格处理代码 | **L1 静态结构检查** | 不能证明会话渲染与剪贴板真实功能 | 属于静态检查，待 02 单元升级 |
| `scripts/verify-files-worksurface.mjs` | AST 检查 `DiffDrawer.tsx` 中是否出现 `ctrlKey`、`'s'`、`'Tab'` | **L1 静态结构检查** | 不能证明文件真正保存到磁盘或外部文件监听生效 | 属于静态检查，待 05 单元升级真实磁盘读写 |
| `scripts/verify-git-worksurface.mjs` | AST 检查 `DiffDrawer.tsx` 中 Git 暂存/提交相关函数名 | **L1 静态结构检查** | 不能证明真实 Git 仓库暂存与提交操作成功 | 属于静态检查，待 06 单元升级 |
| `scripts/verify-terminal-layout.mjs` | 检查终端大小拖拽调节器相关的 CSS 与 JSX | **L1 静态结构检查** | 不能证明 PTY 真实交互与终端平滑缩放 | 属于静态检查，待 07 单元升级 |
| `scripts/verify-search-palette.mjs` | 检查搜索模态框中的组件引用与快捷键声明 | **L1 静态结构检查** | 不能证明全局搜索索引与键盘焦点穿梭 | 属于静态检查，待 08 单元升级 |
| `scripts/verify-activity-inbox.mjs` | 检查收件箱相关的路由与组件声明 | **L1 静态结构检查** | 不能证明真实通知推送与已读持久化 | 属于静态检查，待 09 单元升级 |
| `scripts/verify-scheduled-automations.mjs` | 检查定时任务界面相关的 JSX 与状态声明 | **L1 静态结构检查** | 不能证明底层调度器实际运行历史 | 属于静态检查，待 10 单元升级 |
| `scripts/verify-worktrees.mjs` | 检查 Worktree 视图的组件与方法声明 | **L1 静态结构检查** | 不能证明真实 Git worktree 创建与交接 | 属于静态检查，待 11 单元升级 |
| `scripts/verify-plugins.mjs` | 检查插件市场视图的卡片与事件声明 | **L1 静态结构检查** | 不能证明真实插件安装、卸载与网络加载 | 属于静态检查，待 12 单元升级 |
| `scripts/verify-skills.mjs` | 检查技能管理界面的组件结构与声明 | **L1 静态结构检查** | 不能证明真实技能文件读取与生效 | 属于静态检查，待 13 单元升级 |
| `scripts/verify-code-review.mjs` | 检查代码审查目标选择相关的界面声明 | **L1 静态结构检查** | 不能证明真实代码审查模型运行与行级评论 | 属于静态检查，待 14 单元升级 |
| `scripts/verify-archive.mjs` | 检查归档会话界面的组件结构 | **L1 静态结构检查** | 不能证明会话真实归档与恢复往返 | 属于静态检查，待 15 单元升级 |
| `scripts/verify-settings-partitions.mjs` | 检查 26 个分区 slug 与 config RPC 声明 | **L1 静态结构检查** | 不能证明 26 个设置分区的真实表单交互与持久化 | 属于静态检查，待 16 分区逐项验收 |
| `scripts/verify-extended-worksurfaces.mjs` | 检查 6 个扩展视图文件存在及 JSX 挂载 | **L1 静态结构检查** | 不能证明真实图像生成、站点发布或云环境管理 | 属于静态检查，服务缺失项标记外部依赖阻塞 |
| `scripts/verify-misc-tools.mjs` | 从 `src/App.tsx` 提取渲染回调，使用 `node:vm` 隔离上下文真实执行生成 HTML 并断言属性 | **L2 (VM 隔离执行组件渲染回调)** | 不能证明浏览器实际渲染样式与真实工具执行 | 认可其函数回放能力；未来升级为组件级渲染测试 |
| `scripts/verify-projects-sections.mjs` | 检查侧边栏项目分组代码片段 | **L1 静态结构检查** | 不能证明真实项目增删改查与折叠状态保留 | 属于静态检查，待 04 单元升级 |
| `scripts/protocol-verify/*.mjs` (6组探针) | 启动隔离 `CODEX_HOME` 真实运行 `codex app-server` 进行 RPC 交互 | **L3 真实协议** | 不能证明前端界面渲染与像素呈现 | 真实验证后端协议契约，属于高可信边界测试 |

---

## 3. 审计总结与纠偏原则

1. **客观承认 L2 函数回放测试的价值**：仓库中关于快捷键判定、时间线合并、审批状态机、轮次控制等 13 个脚本，是真实导入代码并断言执行逻辑的纯函数/状态回放，具备明确的逻辑回归价值，不应被一概抹煞为“纯静态字符串查找”；
2. **严禁越级宣称**：
   - L1 静态检查只能声明“代码与规则已声明”，绝不能声称“功能通过”或“像素一致”；
   - L2 函数回放只能声明“内部逻辑与数据流处理通过”，绝不能声称“原生键盘通过”或“真实服务通过”；
3. **消除自证式缺陷**：后续针对各单元的验收测试，必须引入真实的 DOM 几何测量或反证逻辑，杜绝“修改高度为 1px 依然输出全部通过”的假测试。
