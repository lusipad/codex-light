# 16.12B Hooks 来源审阅闭环：下一阶段修改前合同

状态：调研完成，尚未实施。本文只定义下一主要切片；不代表官方运行时、像素或原生验收通过。16.12A 的平铺列表和隔离协议探针保留为历史阶段证据，不等于本合同已满足。

## 1. 基准与证据

固定 Windows Store 包：`OpenAI.Codex_26.1027.3384.0_x64__2p2nqsd0c76g0`，`app/resources/app.asar` SHA-256：`6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。

本次只读提取 6 个 Hooks 资源，文件大小、SHA-256、asar header integrity 核对结果见 [manifest](../../../.ref/parity/16.12/actual/16-12B-research/manifest.json)。精确片段见 [anchors](../../../.ref/parity/16.12/actual/16-12B-research/anchors.json)，偏移为 0-based UTF-16 code units、结束位置不含本字符。

关键来源：`hooks-settings-85da073b1720.js`（来源索引、详情抽屉、批量信任）、`hooks-settings-model-139d6975b199.js`（分组、去重、统计及选择校验）、`hooks-settings-source-label-1eaa4dae5aa2.js`（逐行审阅和开关约束）、route/navigation/copy 同版本资源。中文使用固定包 `zh-CN-88ebb426d686.js`，不是依据英文自行翻译；风险提示为“Hook 在沙盒外运行，可能存在安全风险”。

协议结构参照 `.ref/parity/16.07/actual/16-07C-research/schema-store/v2/HooksListParams.json` 及同目录响应：无 thread 时按 `cwds` 读取；有 threadId 时不能同时附带 cwds。当前切片沿用设置页项目读取，不新增 thread 模式。

## 2. 一个主要切片

将当前“来源/事件 select + 全量平铺详情”纠偏为 **来源索引 → 来源详情抽屉 → 事件分组 → 单 hook 折叠审阅 → 真实信任/启停读回**。这是一次完整可操作流程，避免仅补边角字段。

复用 `hooksClient.ts` 与 `hookState.ts` 已有的写前重读、hash 防变更、用户层 expectedVersion、`config/batchWrite`、写后真实读取和 overridden 错误，不重写后端，不增加依赖。产品实现预计集中在 `HooksSettings.tsx`、相应 CSS、必要的 Hooks 纯模型/回归及 SettingsView 的连接身份传递。只在确有需要时新增一个纯模型文件。

本轮不纳入运行历史、hook 执行器、真实命令执行、新建/编辑/删除 hook、远程主机能力。插件详情跳转、打开定义文件需已有真实安全入口才接入；缺入口登记未实现，不用空动作伪装。官方抽屉 `size: xwide` 已静态证实，具体物理宽度与动画需运行时/同尺寸截图取证，不能按名称猜像素值。

## 3. 修改前动作与验收合同

| ID | 操作与官方预期 | 最小可验证证据 |
|---|---|---|
| HB01 | 加载来源索引。顺序 plugin、user、admin、project、sessionFlags、unknown；system/mdm/cloudRequirements/cloudManagedConfig/legacyManagedConfigFile/legacyManagedConfigMdm 归 admin。project 保留每个真实 cwd；plugin 按 pluginId 分组，null 身份单独保留且排末尾。来源选择不得读取真实 roots 之外的任意 projectRoot。 | 多 cwd、同名不同路径、多个 pluginId/null、管理来源 fixture；切换来源不混项。 |
| HB02 | 汇总按真实 hook key 去重、首项优先；warnings 去重、errors 按 path:message 去重。无 hook 但有诊断的 entry 保留在 unknown，不误报空态。active 为 managed 或 enabled 且 trusted；needsReview 仅 untrusted/modified。 | 同 key 重复、诊断独占 entry、enabled 但未信任、managed disabled 原始值的模型回归。 |
| HB03 | 点击来源打开详情抽屉，按事件分组；事件 installed>0 才出现，组内按 displayOrder 升序。行默认收起，点击显示详情并更新 aria-expanded；关闭后回到来源入口。加载/失败/重试保持可辨。 | 来源→抽屉→展开→关闭的组件回归；Tab、Escape、焦点返回的原生手测。 |
| HB04 | untrusted/modified 行先审阅并信任：开关显示关闭且禁用，不能调用 enabled 写入；managed 开关始终显示开、只读，不展示可写信任入口。信任只提交真实 currentHash，成功必须读回。 | 未信任/变更/托管/可信四类行；按钮状态、无错误写入调用、真实写读回回归。 |
| HB05 | “全部信任”作用于当前打开来源 entry 中全部 needsReview 且非 managed 的项，不受某个事件筛选限制；不得跨来源、项目或插件身份信任。写前哈希已变则拒绝，不能自动信任新版本。 | 一个来源两个事件、其他来源待审项、managed、重复 key、操作中 hash 变化；捕获精确写集合与读回。**纠正 16.12A 中按来源和事件可见项批量信任的旧合同。** |
| HB06 | 单项启停/信任沿用真实 CAS 链：写前重读，missing/managed/缺 hash/raw key/hash 变化拒绝；精确用户层 key、expectedVersion、reload；写后核 hash、enabled/trustStatus。覆盖、冲突、失败不得提示成功。 | 复用并补足既有 hookState 回归及隔离协议证据；不运行 hook 或模型轮次。 |
| HB07 | 项目/连接身份变化、离页、关闭抽屉后，晚到读取/写回不得污染另一来源或新连接；写操作保持单飞。刷新必须实际重读。 | 可控延迟回放旧响应、快速切换 roots、连接代次改变、失败重试；不得只靠初次 mount 的请求保护。 |
| HB08 | 折叠详情分别表达事件、handler 类型、command 完整代码、mcp server/tool、非 null matcher、timeoutSec 秒和来源；缺字段不捏造。标题优先 statusMessage 对应官方编号规则，无则 Hook 编号；中文逐 key 对照固定包。 | command/prompt/agent/mcpTool、长命令/长路径、空 matcher、有无 timeout 的 fixtures；原生窄窗无溢出。 |

HB04 的两项是当前源码明确差异：现有未信任项可进入 enabled 写入；managed checkbox 跟随原始 enabled。应在本阶段一并修正，不等待像素校准。

## 4. 阶段交付与未验边界

实现前按本合同补针对行为的回归；优先验证来源隔离、真实写集合和审阅前不可启用，避免只检查源码字符串。运行直接回归、TypeScript、前端构建及标准检查；涉及 Rust 才补相应 Cargo 范围，不凭前端通过推断原生通过。

交付应提供当前源码对应构建、来源索引与抽屉截图、操作步骤及失败/未验清单。固定官方与本应用的语言、主题、客户区像素、DPI 和缩放后，再比宽窄窗、抽屉、展开详情、错误及焦点状态；每轮视觉修改保存 structured verdict 与差异证据。当前缺这些对照，状态只能是待自验/待用户验收，不能标为 1:1。

阶段足够完整且相关验证通过后，由主代理按用户授权提交阶段版本；是否推送按分支/远程与阶段完整性判断。用户明确验收前不将本单元写成已验收。
