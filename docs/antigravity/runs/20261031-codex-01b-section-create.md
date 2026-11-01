# 01B A11：从会话菜单新建分区

日期：2026-10-31。修改前验收合同；01B 开发中，不放行 01C。

## 调研依据

固定候选官方版本 26.928.21956。以下文件与对应候选基准一致：

| 证据 | 定位 | 结论 |
|---|---|---|
| `.ref/scratch/files/app-initial-fd3c4b862660.js`，SHA-256 `577a50e29502f573e2fbccf4940b9bd875339db420d6d5a9798a0d201ee0aff1` | `$$` around offset 6895185 | 会话分区子菜单末项的 ID 为 `new-custom-section`，文案资源为 `sidebarCustomSections.newSection`；不要与侧栏整理菜单中的 `new-section` / `sidebarCustomSections.createSection` 混为一项。 |
| 同上 | `Fpo` offset 6889965 | 新建态使用对话框；标题、说明、输入、取消、创建按钮分别绑定独立中文资源。名称先 trim；空名称使用 `sidebarElectron.customSections.defaultName`；创建按钮在新建态不因空名称而禁用。 |
| 同上 | `Fpo` offset 6889965 | 对话框提交检查分区 capability、可选的异步 `onBeforeMove` 和账号身份稳定性，再调用创建动作；当入口带有会话 key 时，该 key 随创建动作传入，创建后选中新分区并关闭对话框。 |
| 同上 | `$$` around offset 6895185 | 会话菜单“移至分区”父项只有固定标签与子菜单；通过已有分区 checkbox 项切换移动/移出；分区集合为空时不插入 checkbox 分隔线，直接显示创建项；不显示当前分区徽标、独立“移出分区”行或空列表占位。 |
| 同上 | `LSo` offset 7150970；`o1` offset 6919038；分组组装片段约 offset 7155200 | 官方 local sidebar 菜单将组织动作按重命名→置顶→读状态→项目移动→分区移动排列，再以分隔组承载归档/删除等生命周期动作；该 builder 没有“打开聊天”动作，也没有可见的“会话操作”组标题。其他身份、能力、状态组受 gate 影响，不能仅凭静态存在断言当前普遍显示。 |
| `.ref/parity/01/runs/20261031-codex-01b-rename/reference/zh-CN-3ed9eb1db28a.js`，SHA-256 `C6AC10A9FB407A393EA002D9AA818A4C7ED0E215E9C8BF0CFE2B798A98E3756F` | `sidebarCustomSections.newSection` offset 1649994；对话框资源 offset 1656492–1657054 | 简体中文菜单文案为“新建分区…”；对话框资源为“新建分区”、“随心整理聊天和项目”、“分区名称”、“取消”、“创建分区”；空名称默认值也是“新建分区”。 |
| 本机 `codex-cli 0.165.0` 运行 `codex app-server generate-ts --experimental` 的结果 | `.ref/scratch/app-server-protocol-ts/v2/ThreadSectionCreateParams.ts` / `ThreadSectionMoveParams.ts`；schema SHA-256 见本轮 evidence/reference | 当前 CLI 协议创建参数只含 `name` / `appearance`；移动参数含 `threadId`、`sectionId`、`beforeThreadId`，没有 `itemKey`、`afterSectionId` 或原子 create+membership 参数。该 CLI 与固定 GUI 候选不是同一版本，作为本项目所用运行时交叉证据，不能单独证明官方配套 CLI 结构。 |

以上是固定 asar 与 locale bundle 的静态证据，不证明当前账号 capability、服务端创建语义或 Windows 对话框运行时细节。官方静态 UI 将名称、目标会话 key 与目标插入分区交给 `hHe` helper；helper 内部实际如何拆分服务调用，当前片段未解出。本项目实现为先创建再移动，已覆盖目标会话归入新分区；分两次调用无法构成与 helper 相同的原子服务事务，放置到指定分区位置尚无已验证 API。

## 修改前验收合同

| ID | 操作 | 预期 |
|---|---|---|
| SC01 | 会话菜单→“移至分区”→“新建分区…” | 菜单关闭，出现标题“新建分区”、副标题“随心整理聊天和项目”、命名输入、取消与创建分区按钮；输入取得焦点。 |
| SC02 | 对话框输入前后空格后提交 | 名称 trim；只创建一个分区，再把发起菜单操作的会话移动到该分区；移动成功后关窗并刷新侧栏。 |
| SC03 | 空输入提交 | 创建默认名称“新建分区”，随后移动当前会话；提交按钮保持可用。 |
| SC04 | 取消或 Escape | 不创建分区、不移动会话；关闭后焦点返回打开菜单的会话行。 |
| SC05 | 创建请求失败 | 对话框保留，显示实际错误；不得调用移动请求，可再次提交。 |
| SC06 | 创建成功、移动失败 | 保留已创建分区，报告部分失败并刷新侧栏；关闭对话框，避免重试产生重复分区；不宣称会话已移动。 |
| SC07 | 快速重复提交 | 单次对话框生命周期只执行一次创建/移动事务；等待时禁用提交与取消。 |
| SC08 | 已有分区时展开菜单 | 每个分区各一个 checkbox；选中当前分区即移出；不出现单独“移出分区”菜单项。 |
| SC09 | 没有分区时展开菜单 | 子菜单仅显示“新建分区…”；不显示空状态占位、分隔线或移出动作。 |
| SC10 | 当前会话已归属分区时观察父项 | 父项只显示“移至分区”及展开箭头；当前归属仅由对应 checkbox 表达，不出现名称徽标。 |
| SC11 | 展开普通 local 会话行菜单 | 本项目已有动作按官方组织→生命周期顺序显示；不出现官方 builder 未声明的“打开聊天”动作、可见“会话操作”组标题或 emoji 文案。 |

自动组件验证只证明本项目组件和 RPC 包装行为；浏览器/原生对话框、官方运行时、焦点栈、像素与真实账号 capability 另行验收。

## 本轮后续复核

- 针对 SC08/SC09 的修改前回归在生产组件发现独立“移出分区”菜单项时失败；修复后选择当前 `menuitemcheckbox` 仍发 `sectionId: null`，子菜单不再暴露独立移出动作。分区为空时仅有“新建分区…”，不显示空状态或分隔线。
- 继续对照发现父项额外显示的当前分区名称徽标无官方依据；修改前回归以实际 DOM 文本“移至分区Section A”失败，删除徽标后父项精确标签断言通过。
- SC11 修改前回归捕获当前主层级次序为“分区→打开聊天→置顶→重命名→归档聊天”，且存在可见“会话操作”标题和 emoji 文案；修复后的已实现本地动作按官方分组顺序显示为“重命名→置顶→分区→归档”，移除重复打开项/标题并使用 locale 短标签。
- 官方未读标记和项目移动属于条件动作；本项目当前 Sidebar props 没有等价的会话级读状态回调，项目归属 API 也不是该官方移动路径，本轮不合成回调或模拟状态。这两类官方条件动作仍未实现。
- `codex-cli 0.165.0 app-server generate-ts --experimental` 的精确参数定义快照已保存至 `reference/ThreadSectionCreateParams.ts`、`reference/ThreadSectionMoveParams.ts`，manifest 含哈希。它用于说明本项目当前服务端 create/move 参数形状，不充当候选 GUI 版本的配套服务端证据。
- 新建/切换专项、完整 `verify-all.ps1`（所有配置检查及 6 个隔离协议探针）、TSC/Vite、Cargo check、筛选的 17 项 automations Rust 测试及 Tauri Release 构建均通过；摘要保存在 `actual/standard-result.json` 和 `actual/final-build-result.json`。
- 最终 Release：`dist-artifacts/01B-section-menu-parity-20261031/CodexNative.exe`，13,307,392 bytes，SHA-256 `345A02F25779A393331A1C4AB1E1A5C1CA8245F2F7FF4999B692C2DD781CEFEF`。
- Computer Use 初始化成功，但 `sky.list_apps()` 报 `sky.list_apps is not a function`。未选择目标窗口或执行桌面输入；当前 Release 的实际原生对话框、焦点返回、官方运行时与同条件像素仍未验证。记录在 `actual/native-tool-limitation.json`。

## A11 菜单主层级收敛与最新构建（2026-10-31）

- 依据上方 `LSo` / `o1` 官方静态 builder 与中文 locale 证据，对实际会话行菜单移除无官方依据的“打开聊天”重复动作、可见组标题和 emoji 文案；已实现动作现按“重命名 → 置顶 → 移至分区 → 归档”排列，并使用短标签。专项回归 `scripts/verify-sidebar-thread-menu.mjs` 通过。未读状态及项目移动条件动作因缺少当前已验证的等价回调，仍不显示、不模拟。
- 在本次源码上重新运行 `pwsh -NoProfile -File scripts/verify-all.ps1`，退出码 0；覆盖已配置专项、TSC/Vite、Cargo check、17 项 `automations` 筛选 Rust 测试及 6 组隔离协议探针。之后运行 `npm run tauri build`，退出码 0，Release、MSI、NSIS 产物均生成。`git diff --check` 退出码 0（有现存行尾转换提示，无空白错误）。
- 最新 Release 归档为 `dist-artifacts/01B-thread-menu-order-20261031/CodexNative.exe`，13,307,392 bytes，SHA-256 `7CAAB303852DA96DDD9892E7A43F69E4391B0FD72851BCE5B53BD8C256EE0106`，文件时间 `2026-10-31T21:19:05.1381776+08:00`。源码 HEAD 为 `380c32c7b6e3d1ce6cabcf49c7b5ca07b1b76ec7`，构建时工作树包含既有未提交改动；因此此 EXE 取代前面“最终 Release”记录作为本轮菜单顺序增量的最新构建，但不声称来自干净提交。构建/专项退出码和未测项记录在 `.ref/parity/01/runs/20261031-codex-01b-section-create/actual/menu-order-build-result.json`。
- 尚未对该最新 EXE 做原生菜单、键盘焦点/IME、官方 GUI 运行时或同条件截图比较；官方版本和窗口环境候选也不足以补齐这些证据。该轮只交付局部代码及构建自验，A11 与 01B 仍待用户验收，01C 不放行。

## A11 新建分区取消焦点修复与原生续验（2026-10-31）

- 在旧菜单顺序版 Release 上原生操作“移至分区 → 新建分区… → Escape”，对话框关闭后 UIA 焦点落在 WebView 文档，而不是触发菜单的会话行；该行为违反 SC04。该测试未创建分区、未选择会话、未启动 turn。
- 为 `sectionCreatorThreadId` 记录菜单触发时的返回焦点，在对话框关闭并由 effect 清理后显式恢复。把已观察到的 WebView2 modal 关闭焦点状态写入组件回归 harness；SC04 取消按钮和 Escape 均在修改前失败，成功关闭路径也核验会返回同一会话行。修复仅限 `CodexSidebar` 与现有专项 harness/用例。
- `node scripts/verify-sidebar-section-create.mjs`、`verify-sidebar-thread-menu.mjs`、`verify-sidebar-section-toggle.mjs` 以及完整 `verify-all.ps1` 均退出码 0；Tauri Release 构建退出码 0。Rust 测试由标准入口按 `automations` 筛选，17 项通过；Vite 仍报告 SettingsView 动静态导入及大 chunk 警告，协议探针仍有 Node DEP0190 警告。
- 最新归档为 `dist-artifacts/01B-thread-menu-focus-20261031/CodexNative.exe`，13,307,392 bytes，SHA-256 `A43BF9DB5986ABECB4961288E9D4B772E1966A4007175B09026642084C50F2A2`。在只读取消 profile 中分别按 Escape 和点“取消”关闭对话框，均不发服务写入且焦点回到触发操作的 Recent 会话行。另一个全新复制的离线 `CODEX_HOME` 中通过原生 UI 提交“原生会话分区验收”，UI 显示新分区和会话；关闭 UI 后用新 app-server 进程读取 `threadSection/list` 与 `thread/list`，两者 ID/归属一致；再启动 UI 冷加载仍显示该分区。测试数据无凭证，API key 为空，没有登录或模型 turn。
- 原生 UIA、RPC 读回和操作截图哈希见 `.ref/parity/01/runs/20261031-codex-01b-section-create/actual/native-menu-focus-verification.json`。DPI=168、深色、屏幕 2560×1600、中文；应用缩放仍未知。没有官方同条件截图或官方 GUI 运行时比较，不给像素评分。IME、未读/项目移动动作与用户验收仍未完成；01B 继续开发中，不放行 01C。
