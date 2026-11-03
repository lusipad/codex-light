# 16.12B Hooks UI 静态来源补充合同

2026-11-03，只读调研，产品尚待实现/验证。固定基准为 Windows Store `26.1027.3384.0`，asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。本文件补足开发所需的来源形状、事件和文案，不代替官方运行时、像素或原生验收。

资源、哈希见 [manifest](../../../.ref/parity/16.12/actual/16-12B-research/manifest.json)；本次片段见 [ui-anchors](../../../.ref/parity/16.12/actual/16-12B-research/ui-anchors.json)；固定中文包全部 75 项 Hooks 文案及精确定位见 [zh-copy](../../../.ref/parity/16.12/actual/16-12B-research/zh-copy.json)。数字均为 0-based UTF-16 code units，end exclusive。

## 1. 来源索引的实际显示形状

`hooks-settings-model` 的内部 section 顺序为 plugin/user/admin/project/sessionFlags/unknown；**主页面 Dt 的显示顺序另行分组**，不能直接拿内部数组渲染：

| 显示分组 | 内部成员与入口 |
|---|---|
| 来自配置（source.globalConfig） | user、admin 各一行，名称“用户配置”“管理员配置”。 |
| 来自插件（source.plugins） | `section.pluginEntries.map`，每 pluginId 一行；null 单独一行并排末尾，名称回退“未知插件”。 |
| 来自项目配置文件（source.projects） | `projectEntries.map`，每 cwd 一行；真实项目 label 优先，再路径 basename，再完整路径。 |
| 其他来源（source.otherSources） | sessionFlags、unknown 各一行，名称“会话标记”“未知来源”。 |

空分组隐藏。每行使用 surface 圆角 row：左图标＋名称，下方“{count} 个钩子”，右侧待审核/问题摘要＋指向右侧的 chevron。插件优先真实插件 display name，再 pluginId 的 `@` 前缀，再“未知插件”；logo 可用真实插件logo，无则通用图标。问题与待审核计数均为零时不显示摘要。摘要文本在 `max-[30rem]` 隐藏，图标保留。没有 hook 但有加载问题的 entry 仍能进入 unknown 来源查看问题。

点击入口打开 `size: xwide` 居中详情对话框（几何见第 6 节，早期“抽屉”称谓不准确）；项目副标题是完整 projectRoot，其他来源是“所有项目”。已知 pluginId 的官方对话框标题可链接真实插件详情；未知插件不伪造详情链接。

### plugin aggregate 的边界澄清

官方常规索引 Mt 仅展示每 pluginId 的行，未发现“全部插件”聚合可点击入口。模型仍有 `section.entry` 聚合，路由允许 `source=plugin` 且不带 pluginId；这种选择返回聚合 entry，对话框 Trust all 会覆盖其全部待审非 managed hook，可能跨插件。普通插件行选择 `{source: plugin, pluginId}`，null 身份也精确保留。

因此，批量信任的准确合同是 **当前选中 entry 的全部待审非 managed hook**，不是一律“禁止跨 pluginId”。`16-12-next-closure.md` 的 HB05 中“不跨…插件身份”仅适用于索引中选定具体插件的场景；若支持无 pluginId 深链接必须遵守 aggregate 语义。本阶段无需新增官方索引中不存在的聚合按钮。

## 2. 事件与行标题

事件顺序**没有固定生命周期数组排序**：模型 `t(hooks)` 使用 `Array.from(new Set(hooks.map(hook => hook.eventName)))`，保留当前 entry 中事件首次出现顺序。只显示 installed>0 的事件；组内 `displayOrder` 升序。不能按事件名字母排序或按当前客户端 union 顺序排序。

每事件组内编号从 1 开始。`statusMessage?.trim()` 非空时标题为 `{index} - {statusMessage}`，否则“钩子 {index}”。不要沿用客户端 deriveHookName 的命令 basename 或 server.tool 作为官方标题。

固定中文事件名/描述在 zh-copy 中逐 key 提供：例如 PreToolUse、PostToolUse、SessionStart、UserPromptSubmit、Stop 等仍为英文；sessionEnd 为“会话结束”、subagentStart 为“子智能体启动”、subagentStop 为“子智能体停止”、interrupt 为“中断”，pre/postModelRequest 为“模型请求前/后”。不能把所有事件自行中文化。静态 copy 包具有 pre/postModelRequest，即使当前客户端 union 未列出，也不应丢失服务返回的这些 string 事件。

## 3. 开关、审阅和详情字段

- `needsReview = trustStatus === untrusted || modified`。非 managed 行开关 `checked = enabled && !needsReview`，`disabled = needsReview`；待审有“信任”按钮。未信任提示“新钩子”，变更提示“钩子自上次标记为可信后已更改”；禁用提示“钩子在标记为可信之前保持禁用”。
- managed 行始终 `aria-checked=true`、`aria-disabled=true`，内部开关 checked=true、disabled=true；提示“受管理的钩子始终处于开启状态”。禁用包装仍可 Tab 聚焦，用于读出提示。
- 活跃统计为 `trustStatus === managed || enabled && trustStatus === trusted`；不能用 enabled 单独计算。
- Trust all 从整个当前 entry 取 `!isManaged && needsReview`，不按事件筛选。真实写读回继续使用既有 hookState，错误不可当成功。
- 一组中至多一个展开项，行 button `aria-expanded`；事件边框容器 `border-t ... px-3`，行 `py-2 ps-7`，展开详情左缩进 ps-7。具体物理像素仍待测，不把 utility 名称当像素验收。

展开使用 dl/dt/dd，顺序为来源（仅调用方提供时）、Hook 类型、条件性处理程序/命令/MCP字段、非 null matcher、超时。字段如下：

| handlerType | 官方详情 |
|---|---|
| command | “命令”＋原始完整 command，monospace text-xs、break-all、whitespace-pre-wrap。 |
| mcpTool | 独立“MCP 服务器” server、“工具” tool，不能拼成一条命令。 |
| prompt | “处理程序”→“提示”；此组件未显示 prompt 本文，不添加猜测字段。 |
| agent | “处理程序”→“智能体”；此组件未显示 agent 本文。 |

“Hook 类型”显示事件名称；“匹配器”仅 matcher != null 时显示，空字符串不是 null；“超时”使用 timeoutSec 数值并通过本地化秒单位格式化。正常 schema 有 timeoutSec；损坏样本不得捏造默认超时。

现有 `hooksClient.normalizeHook` 会 trim command，并将 mcp server/tool 合成为 commandLabel；完整详情应保留/读取 raw.command、raw.server、raw.tool，不能拆合成字符串还原。statusMessage/displayOrder 已保留。

主要中文键还包括：`settings.hooks.review.summary`=“Hook 在沙盒外运行，可能存在安全风险”；`trustAll`=“全部信任”；`refresh`=“重新加载钩子”；`loading.label`=“正在加载钩子…”；`emptyHooks.label`=“未找到钩子”；`loadError.label`=“无法加载钩子”。完整值以 zh-copy 为准。

## 4. 已有真实入口的复用边界

只读仓库调查：

- `src-tauri/src/lib.rs` 已注册 `open_path_external`，调用 `desktop_open::open_external`；后者检查路径存在，读取真实用户首选文件目标并调用 execute_target，参数不拼 shell。`src/App.tsx` 已有真实调用。可复用这个 IPC 打开服务返回的 sourcePath，但必须仅 local、非 managed、有效真实 sourcePath 的显式用户点击；不可把 URL/query 任意值直接当文件路径。最终编辑器实际打开仍须原生手测，不把 IPC resolve 当编辑器可见。
- 官方行打开配置文件仅 `!isRemoteHost && !isManaged`，项目 hook 另带其 projectRoot，上下文不是任意跨项目文件浏览。当前 open_path_external 不表达官方 host/cwd 导航上下文，因此至多证明本地等价文件打开，不能宣称完整官方工作区定位一致。
- `SkillsMcpView.tsx` 已有真实 `readPlugin(pluginRefFor(plugin, marketplace))` 的详情加载和身份/请求代次保护，但当前 props 没有 initialPluginId，也没有可直接从 Hooks 调用的打开指定插件详情接口；App 的 plugins 路由只携带目录模式。不能只切换插件目录便宣称已打开指定插件详情。若本阶段不加完整定位参数与真实 ID 解析，明确登记此链接缺口。

本次未改产品/测试、未运行 Cargo、真实命令、模型轮次、安装或账号请求。取证仅支持以上静态行为与仓库复用分析。

## 5. 请求 cwds 的真实来源（接线补充）

官方不是只请求 activeWorkspaceRoot。完整静态链见 [roots-query-chain](../../../.ref/parity/16.12/actual/16-12B-research/roots-query-chain.json)：

1. Hooks `qt` 通过 `nVn`/`gO` 查询选中 host 的 workspace root options；底层 `LMn` 调 `Qi.workspaceRoots.read(requestId, {hostId})`，得到 `{roots, labels}`。
2. local host 另从 `SELECTED_PROJECT` 对应 `LOCAL_PROJECTS[projectId].rootPaths` 取全部根；remote 分支为对应选中 remote project 的 remotePath，本阶段不拓展远程。
3. 模型 `i(hostRoots, selectedProjectRoots, queryProjectRoot)` 先保留 selectedProjectRoots 去重后的顺序，再追加 hostRoots 中未出现的路径并以 localeCompare 排序；存在不在列表中的 queryProjectRoot 时附在末尾。来源选择再使用该最终列表校验。
4. 最终列表 `w` 原样送入 `Fjn`/`AYn`，真实请求为 `hooks/list {cwds: w}`；列表不存在或长度为零时 query 禁用，不以空数组退回 session cwd。

因此产品接线必须让 Hooks 接到真实已登记 roots 列表，不能仅在测试 fixture 中支持多 cwd，而生产一直传 activeWorkspaceRoot。选中项目多根与 host workspace options 都应保留；当前仓库只有已登记工作区模型时应明确它与官方宿主模型的对应边界。本次未继续追宿主 workspaceRoots.read 的全量库存实现，不把这里的 roots 无依据称为全部文件系统/所有配置目录。

## 6. 详情是居中对话框：静态几何纠偏

直接追共享组件后确认，前期资料“抽屉”用词不准确，**不是右侧滑出面板**。证据见 [dialog-geometry](../../../.ref/parity/16.12/actual/16-12B-research/dialog-geometry.json)。Hooks 导入的 `yP` 是 shared `LSn`，其 `contentPosition` 默认 `centered`；Hooks `ht` 仅传 `size: xwide`、`open/onOpenChange` 和 aria-describedby，不覆盖位置或 variant。

- `ISn(xwide)` 返回 `w-[680px]`，默认 surface 具有 `max-w-[92vw]`。这是 680 CSS px 宽且受视口约束，不是右侧占满高度，也不能直接等同 680 物理像素。
- `HSn` 的默认中心位置为 `fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2`。未提供 portalContainer，使用 fixed 分支。
- 默认 surface 为 `rounded-3xl`、`overflow-hidden`、`text-default ring-[0.5px] ring-border shadow-lg bg-surface-elevated-secondary/90 backdrop-blur-xl`；默认 overlay 使用 `--color-dialog-overlay`，全视口 fixed inset-0。
- Hooks 内层是 `max-h-[min(680px,calc(100dvh/var(--codex-window-zoom)-4rem))] min-h-0 overflow-hidden`。标题与批量信任在上，列表区域 `min-h-0 flex-1 gap-3 overflow-y-auto pe-1 [&>*]:shrink-0`，附 vertical-scroll-fade-mask。
- 通用 dialog 样式在 window zoom 非 1 且无 portalContainer 时设置 CSS `zoom`；最大高度公式也显式使用 `--codex-window-zoom`。窄屏宽度上限和缩放不可独立忽略。`xwide` 不进入 responsiveSheet 分支，未发现此 size 自动改底部 sheet 的条件。

上述是固定 Store 静态 class/公式；实际 CSS token 求值、DPI、浏览器缩放、屏幕物理像素与动画效果仍需同场景截图/原生实测。不得以本节代替像素通过。
