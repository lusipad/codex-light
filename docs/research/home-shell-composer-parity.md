# Codex Local 首页、侧栏与 Composer 对标调研（Round 11）

> 调研日期：2026-10-25
> 官方基线：Windows Codex App 26.928.21956 / build 12404（Electron）
> 当前实现：Tauri v2 + React 19，工作树起始为 `5472178` 后的干净状态
> 范围：本地 Codex 首页、导航壳、会话侧栏、Composer。本文先于本轮产品代码修改编写。

## 1. 调研方法与边界

本轮先阅读 `codex-app-full-surface.md` §1–3、§7–9，再对本机官方窗口做只读实测，并与当前应用截图对照。随后直接读取官方 `app.asar` 内 CSS，核对当前变体的设计 token。

已执行的官方操作仅包括：激活窗口、查看首页、打开/关闭模型菜单、模型选择器和权限菜单。未选择新模型或权限，未发送任务，未修改设置，未登录/退出，未触发付费功能。

证据分三层，不能混用：

- **[实测]** 官方当前窗口的 UIA 区域、控件名称和截图。
- **[代码]** 官方 asar 中当前版本的 CSS、Tailwind class、协议返回和文案。
- **[推断]** 需要在实现后由同尺寸截图验证的几何换算，不作为已完成证据。

参考材料：

- 官方功能总表：`docs/research/codex-app-full-surface.md`。
- 官方运行时模型返回：`.ref/protocol-probe/model_list.json`。
- 抽取 CSS：`.ref/reference/css/`（官方路径使用 `webview\assets\...`）。
- 基准截图：`.ref/reference/round11/official-home-before.png`、`native-home-before.png`、`official-model-compact.png`、`official-permissions.png`。

初始官方截图为 1568×934，当前应用为 1568×1003；窗口高度及可能的缩放状态不同，**初始截图不能直接做逐像素差值**。最终验收必须统一为 100% 缩放、相同窗口尺寸、相同主题与 Home 场景。

## 2. 官方首页与导航功能基线

来自功能总表与本次实测：

- 主窗口由应用菜单/标题栏、左侧导航轨、会话侧栏、主工作区和底部或右侧工作面板组成。
- 首页包含模式切换、活动、搜索、新聊天、Quick Chat、项目/会话组织、问候语、项目选择、工作位置、Worktree、附件、权限、模型、推理强度、速度、听写和语音能力。
- 模型和推理档必须由运行时能力与账号返回决定，禁止把本次看见的模型名当成前端常量。
- 设置、页面和入口受产品模式、平台、账号和 feature gate 影响；不能把云端能力做成无条件可用的本地假页面。
- 所有页面都应按适用性覆盖加载、空、错误、重试、不可用、无权限等状态。

### 实测几何与控件

以下为当前官方窗口的屏幕/UIA 证据，包含窗口边框坐标；实现时用同场景截图复核，不直接与其他 CSS 变体混算。

| 区域 | 当前官方证据 | 当前实现差异 |
|---|---|---|
| 导航轨按钮 | 首页按钮 38×38；首页/定时/资料库/图像 y 间距约 47px | 已有入口图标和间距需统一；不把模拟 P3 页面提升为真实入口 |
| 会话侧栏 | `Navigation` 区域宽 340px；新聊天 293×32；项目、最近独立分区 | 当前有额外时间/数量徽标、空“自定义分区”和过多行内按钮 |
| 应用菜单 | 文件/编辑/视图/帮助；返回/前进/侧栏；右上窗口控制 | 基本结构已存在，需校准尺寸与间距 |
| 首页顶栏 | 当前 Home 只有“新建标签页”30×30 | 当前还显示用量、线程菜单、项目设置等线程控件 |
| Hero | 标题“你想让我们在 {project} 中构建什么？”；项目名虚线按钮 | 当前标题和 Composer 被放在同一垂直居中组 |
| Composer | 位于主区域底部；项目/此计算机在顶部上下文条，Worktree 在右侧 | 当前整体跟随 Hero 居中，未形成独立底部 dock |
| 新聊天旁 | 实测有“快速聊天”26×26 | 当前缺少入口；现有 HotkeyWindow 仍有非流式与占位行为，本轮不伪装完成 |

## 3. 官方 Composer 功能与交互

### 3.1 模型紧凑主菜单

**[实测]** 主菜单约 271×90，包含：

1. 顶部模型行：当前模型及当前推理档，进入下一层模型相关界面。
2. “启用快速模式”开关和“用量更多”提示。
3. 推理强度滑块；本次账号/模型为 5 个可见刻度中的第 3 项，但档数与档位必须随模型变化。

因此当前大表单（搜索框、模型列表、说明、分段按钮、Fast 行）不是官方当前交互。实现应采用紧凑主菜单 + 动态模型列表，并保留键盘操作和选中语义。

### 3.2 模型选择器

**[实测]** 模型列表包含“默认 / 推荐模型集”和运行时模型项。当前官方“默认”被选中时，具体默认模型项不会同时显示为选中，因此需要单独记录默认模式与显式选择，不能只用模型 id 猜测。

**[代码]** `.ref/protocol-probe/model_list.json` 的实际结构：

- `isDefault` 标识默认模型。
- `supportedReasoningEfforts[]` 是 `{ reasoningEffort, description }` 对象，不是字符串。
- `defaultReasoningEffort` 给出模型默认档。
- `additionalSpeedTiers[]` 与 `serviceTiers[]` 描述速度能力。
- `hidden`、`displayName`、`description` 控制展示。

当前 `ComposerBox.tsx` 对该对象数组执行字符串 `includes`，过滤失效；`App.tsx` 还硬编码初始模型名。两项都属于功能问题，应先修复再做菜单外观。

### 3.3 权限菜单

**[实测]** 菜单约 340×172，标题为“应如何批准 ChatGPT 操作？”，三档为：

| 选项 | 官方说明 | 当前协议映射（沿用已有合法实现） |
|---|---|---|
| 请求批准 | 编辑外部文件和使用互联网时始终询问 | `on-request` + `user`，工作区沙箱 |
| 帮我批准 | 仅对检测到的风险操作请求批准 | `on-request` + `auto_review` |
| 完全访问权限 | 可不受限制地访问互联网和你电脑上的任何文件 | `never` + `dangerFullAccess` |

“完全访问权限”使用风险色和选中勾。不得为追求截图一致而改变审批语义或自动越过风险确认。

### 3.4 输入与状态

- 当前官方 Home 空输入占位为“随心输入”；`@`、`/` 能力由自动补全承载，不需要全部塞进占位文本。
- 官方空输入右侧包含听写和语音聊天；当前实时语音尚未接入，不能用假语音或假回复冒充完成。
- Fast 只在当前模型支持时可用；不支持的模型不能继续发送 `serviceTier: "priority"`。

## 4. 官方 CSS 证据与变体约束

已从官方 asar 抽取：

- `app-shared-342447930c78.css`：全局 token、sidebar、字体、灰阶。
- `app-initial-e55cd978d577.css`：应用壳和 Composer 布局。
- `composer-controls-146a0c4fef05.css`、`inline-composer-3f819053103b.css`：Composer 控件和输入。
- `home-49f9c30a8c63.css`、`home-suggestion-list-10e83e13e141.css`：Home 相关变体。
- `hotkey-window-home-page-d251d4c00c51.css`：Quick Chat 后续调研。

直接代码证据：

- 4px spacing 网格：`--spacing: .25rem`。
- Electron UI 字号：正文 13px、辅助 12px；中等字重 500，UI 字重变量存在 430 档。
- 字体链优先 `OpenAI Sans`，后接系统 sans-serif；本轮不复制官方专有字体文件。
- 当前 Hero class 为 `heading-xl ... font-normal`：32px / 38px / 400，项目名为 dotted underline button。
- Hero 内层使用 `gap-6`（24px）；进入动画 `.28s cubic-bezier(.23,1,.32,1)`。
- Electron Composer 默认圆角 22px、输入行高 20px、placeholder 约 50% 不透明；表面和阴影使用语义 token。
- 标题栏静态规则存在 44px（PageSurface）与 46px（FullHeight）变体；Windows 原生 caption overlay 为 36px。

**变体约束**：`home-*.css` 中有 ChatGPT Welcome 规则，Browser 与 Electron 的 Composer 圆角也不同，不能将 578px Welcome 内容宽或 Browser 28px 圆角直接套到当前 Codex Local Home。以本次实测场景 + 对应 data variant 为准。

## 5. 当前“完成报告”与代码的矛盾

旧报告把路由/页面存在当作全量完成，但当前代码仍有明确模拟行为：

| 文件 | 复核证据 | 正确口径 |
|---|---|---|
| `src/components/LibraryView.tsx` | 默认演示资料、`Mock quick upload` 生成本地假文件 | 本地演示/本地偏好，不是官方云端 Library |
| `src/components/ImagesView.tsx` | 定时生成本地 SVG 并提示“图像生成完成” | 模拟生成，不是真实图像模型链路 |
| `src/components/SitesView.tsx` | 本地数组新增记录即提示“创建并部署成功” | 模拟部署，不是真实 Sites 托管 |
| `src/components/HotkeyWindow.tsx` | 固定 1500ms 后读取；无 thread id 时生成“已收到”占位回复 | 不是完整流式 Quick Chat，更不是原生独立窗口闭环 |

因此本轮不宣称整个 App 已完成 1:1，也不把 Library/Images/Sites 作为已验证真实能力推广。后续需分别完成云端数据源/能力门控、真实图像生成链路和独立窗口流式协议整改。

## 6. 本轮实现与验收映射

| 优先级 | 差距 | 实现方向 | 验收证据 |
|---|---|---|---|
| P0 | 模型能力过滤错误、硬编码模型 | 运行时默认模型、对象档归一化、speed 能力过滤 | 不同模型只显示支持档；Fast 不可用时禁用；协议参数合法 |
| P0 | 模型菜单不是官方交互 | 紧凑主菜单 + 动态模型列表 + 原生 range | 鼠标和键盘均可调整；ARIA 值、焦点、Escape 正确 |
| P0 | 权限文案与视觉不符 | 三档实测文案、340px、风险态 | 三档选择和已有协议映射不回归 |
| P0 | Hero 与 Composer 一起居中 | 独立居中 Hero + 底部 Composer dock | 同尺寸截图核对标题位置、Composer 底边与宽度 |
| P0 | Home 顶栏混入线程控件 | Home 只保留新建标签 | 线程页控件保持完整，Home 不多出按钮 |
| P1 | 侧栏信息过载 | 移除时间/数量，收口行内动作和空分区 | 置顶/归档/重命名/删除/项目操作仍可用 |
| P1 | 写死颜色与旧覆盖 | 语义 token、统一几何、清理替代规则 | 暗色实测与亮色 token 静态检查；主题模式入口另行补齐 |

## 7. 后续独立任务（不在本轮假装完成）

1. Library / Images / Sites：真实服务端数据源、账号能力门控、错误/空态；移除模拟成功链路。
2. Quick Chat：原生独立窗口、完整通知流、审批与错误恢复、主窗口跳转；去掉固定延时和占位回复。
3. 实时语音：协议、设备权限、录音与转写状态，不能以图标替代功能。
4. Appearance：补齐 Light / Dark / System 主题模式入口与持久化；当前只有深色配色主题，亮色 token 不能视为已验收功能。
5. 全 App 其他工作面：按功能总表逐页建立同样的“功能证据 → 实现 → 实测”闭环。

## 8. 验证约束

- 最终截图使用 100% 缩放和相同暗色 Home；高度差在比较中显式扣除，不直接比较不同尺寸截图的绝对 y 值。
- 真实 UI 操作覆盖模型、推理滑块、Fast、权限、项目/会话菜单、侧栏整理、新建标签和原生缩放。
- 不向真实账号发送付费任务；标准协议写验证继续使用隔离 `CODEX_HOME` 的既有脚本。
- 最终必须运行 `scripts/verify-all.ps1`，并记录真实结果与未验证项。

## 9. 本轮实际验证结果

### 9.1 标准验证

最终源码执行 `pwsh -NoProfile -File ./scripts/verify-all.ps1`，结果 **ALL CHECKS PASSED**：

- TypeScript `tsc --noEmit`：0 error。
- Vite production build：1680 个模块转换成功。
- `cargo check`：0 error / 0 warning。
- `cargo test automations`：17 passed / 0 failed。
- 5 套隔离协议探针：9 + 22 + 28 + 16 + 12 = **87/87 passed**。
- `cargo build` 与最终原生嵌入资源构建均成功。

构建仍有已有的 bundle 大小与 SettingsView 动静态导入提示；协议脚本有 Node DEP0190 提示，均非本轮新增失败。

### 9.2 真实 UI 与辅助函数

- 在 GPT-6.1 Sol 与 GPT-6 Luna 间切换：分别显示 6 档与 5 档，Luna 默认“中”；随后恢复原模型与第 5 档。
- 原生 range 键盘操作：`ArrowLeft` / `ArrowRight` / `End` 能改变档位，`aria-valuetext` 同步，焦点环可见。
- Fast 开关实测 on/off 并恢复 off；当前账号所有可见模型都支持 Fast，因此无 Fast 分支使用同一 `modelCapabilities.ts` 做隔离验证，未伪造账号能力。
- 辅助函数验证：推理档对象/字符串归一化、无 Fast 返回 false、`priority` 检测、默认模型解析、23 项快捷键匹配。
- 权限三档“请求批准 / 帮我批准 / 完全访问权限”均可切换，未执行任务，最终恢复“请求批准”。
- 项目菜单、会话上下文菜单、侧栏整理、新建标签工作台均可达；行焦点与 `:focus-within` 已补齐。
- 原生关闭按钮已验证退出；最大化/还原与 `Ctrl+=` 放大、`Ctrl+0` 恢复 100% 均已实测。

### 9.3 几何与截图

最终原生截图为 1568×1003，官方初始截图为 1568×934，高度差 69px。比较时只扣除这个已知的窗口高度差，不把不同框架的 UIA 缩放当成 CSS 改动依据。

| 区域 | 官方 y | 当前 y | 当前减 69px 后与官方差值 |
|---|---:|---:|---:|
| Composer 外框顶部 | 762 | 830 | -1px |
| Composer 内层顶部 | 804 | 872 | -1px |
| Composer 底部 | 908 | 976 | -1px |

Hero 图标和标题经最后一轮 40px 顶部留白校准后，与官方按高度差归一化的视觉位置也约为 1px 级。960×640 受控视口下，侧栏按断点收窄、标题换行、Composer 控件均在可视区域内；没有把系统最大化窗口无法拖拽的问题写成原生窄窗口验证通过。

证据文件：`.ref/reference/round11/native-home-after.png`、`native-model-compact.png`、`native-permissions.png`、`native-narrow-960x640.png`。

### 9.4 尚未完成或不能宣称完成

- Light / Dark / System 主题模式：当前无入口，只有深色配色主题；本轮仅完成 token 改造，未宣称亮色已验收。
- Library / Images / Sites、Quick Chat、实时语音仍存在前文列出的模拟或缺失，未在本轮包装成真实能力。
- 原生窗口最大化时无法通过边框完成最小尺寸拖拽，因此窄布局证据来自受控 960×640 视口。
- 启动时可看到用户现有配置中 `computer_use.windows.always_allowed_app_ids` 的未知键警告；本轮未修改用户配置，该环境问题与本轮改动分开记录。
