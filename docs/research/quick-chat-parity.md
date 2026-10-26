# Quick Chat 功能与界面对标调研（Round 12）

> 调研日期：2026-10-25
> 官方基线：Windows Codex App 26.928.21956 / build 12404
> 范围：Quick Chat 浮层、可分离原生窗口、真实本地线程与流式通知。本文先于本轮产品代码修改编写。

## 1. 调研方法与证据边界

本轮先读取 `codex-app-full-surface.md` §2、§3、§7，再对官方“快速聊天”入口和浮层做只读操作，并检查官方 renderer、CSS 与 Tauri 2.12.4 API。

已执行的官方操作：点击“新聊天”所在行以显示“快速聊天”，打开 Quick Chat 浮层，再点击“在新窗口中打开”。未发送消息、未改变模型/权限、未修改设置、未登录/退出、未运行任务。

证据分级：

- **[实测]** 官方浮层的入口、可见控件、最近聊天和约 560×640 的初始尺寸。
- **[代码]** 官方 `/hotkey-window`、独立 new-thread/thread 页面、local thread、项目/模型/权限/run-location 和分离窗口能力。
- **[限制]** 点击分离后，主窗口内浮层关闭，但当前 CU 枚举没有返回可截图的独立官方窗口。因此本轮可以实现并验证原生分离窗口的功能，不能把官方独立窗口的像素对比写成已完成。

参考材料：

- `.ref/reference/round12/official-quick-chat-overlay.png`：官方浮层实测。
- `.ref/reference/round12/hotkey-window-home-page.css`：官方 hotkey Home 表面样式。
- `.ref/scratch/files/page-codex-quick-chat-composer-c480f48e0bfc.js`：官方 Quick Chat Composer 真实状态与提交流程。
- `.ref/scratch/catalog-full.tsv`：`composer.hotkeyWindow.*`、`hotkeyWindow.*` 官方文案。
- Tauri 2.12.4 `WebviewWindowBuilder`、`WebviewUrl::App` 与 window/capability API。

## 2. 官方 Quick Chat 形态

### 2.1 浮层

**[实测]** 点击“快速聊天”后，先出现右侧浮层，而不是居中模态或立即独立窗口。浮层包含：

- 标题“新聊天”。
- “最近聊天”及真实会话项。
- “选择项目”。
- “在新窗口中打开”和“关闭聊天”。
- 宽度和高度调整手柄。
- 底部 Composer、模型/推理控制、发送按钮。

官方初始尺寸约 560×640，位置在主窗口右侧。浮层不是旧版 `hotkey-modal-overlay` 那种全屏遮罩 + 居中卡片。

### 2.2 分离窗口与主窗口恢复

**[实测]** 浮层有“在新窗口中打开”。**[代码]** 官方还存在 `/hotkey-window`、独立 new-thread/thread 工作面及 detached window 能力。

实现需要两个窗口角色：

- `main`：完整工作台，可打开/关闭右侧 Quick Chat 浮层。
- `quick-chat`：独立原生窗口，与浮层复用同一 React 工作面，可调整大小、置顶、关闭并恢复主窗口。

分离窗口必须为单例，恢复主窗口必须通过原生事件定位线程，不能把主应用地址加载到 Quick Chat 自己内部。

### 2.3 数据与设置

官方 Composer 使用真实 local thread、模型、service tier、项目/cwd 和权限配置。运行时返回决定可用模型与档位，不能用前端硬编码替代。

当前本地实现可采用同一 app-server 的：

- `thread/start`、`thread/read`、`thread/list`、`thread/turns/list`。
- `turn/start`、`turn/interrupt`、`turn/completed`。
- `item/agentMessage/delta`。
- `model/list`、`config_read`、`workspaces_list` 与 `workspace_set_active`。
- `app-server:notification`、审批请求与状态通知。

ChatGPT 云端 Quick Chat、实时语音、云端会话和完整富附件不属于本轮本地实现，不能伪造成已接入。

## 3. 当前实现的具体问题

| 当前位置 | 问题 | 必须改为 |
|---|---|---|
| `HotkeyWindow.tsx` | `thread/start` 后固定 1500ms 再 `thread/read` | 真实通知流 + turn 完成权威合并 |
| 同上 | 没有 `activeTurnId`，不能合法停止 | 跟踪 `turn/started`，用 `turn/interrupt {threadId,turnId}` |
| 同上 | 无 thread id 时生成“已收到”占位回复 | 显示真实错误，不生成任何模型占位文本 |
| 同上 | 主窗口内居中 Overlay | 右侧可调整大小浮层 + 可分离原生窗口 |
| 同上 | 最近会话仅 `/resume`，没有列表 | 最近三条真实 `thread/list`，点击恢复 |
| 同上 | 无跨会话通知过滤和异步代次 | threadId 过滤 + 代次丢弃旧返回 |
| 同上 | `isActive` 读取工作区 | 使用实际返回的 `active` 字段 |
| `main.tsx` | `onOpenMainApp` 把主应用地址加载到 Quick Chat 内部 | 原生 `quick-chat:restore-main` 事件 + 主窗口聚焦 |
| 窗口/capability | 只有 `main` | 单例 `quick-chat` 窗口及独立 capability |

## 4. 本轮功能合同

### 4.1 必须有

1. 侧栏“快速聊天”入口与应用内 `Ctrl+Alt+O`。
2. 右侧浮层和单例独立原生窗口，共用同一 React 工作面。
3. 最近三条真实会话、点击恢复、清空新建、项目/权限/模型设置。
4. `turn/started` 跟踪 turnId，`item/agentMessage/delta` 流式累积，`turn/completed` 权威合并并结束 loading。
5. 停止、错误展示、重试、连接失败状态。
6. 按 threadId 过滤事件，旧异步返回不能覆盖新会话；关闭浮层不自动取消后台任务。
7. 审批请求只移交主窗口，不自动批准，不绕过风险确认。
8. 浮层分离、独立窗口关闭、恢复主窗口并定位线程。

### 4.2 明确不做或不得宣称

- 系统级全局热键：本轮保证应用内快捷键，未接入全局热键插件。
- ChatGPT 云端会话、实时语音、云端 Quick Chat 和完整富附件。
- 官方独立窗口像素对比：当前没有可获取的官方独立窗口截图。
- live model 生成验收：不向真实账号发送付费任务。协议历史、通知归并和真实窗口交互分别验证。

## 5. 状态与并发规则

- `threadId` 是事件归属的第一约束；其他会话的 delta/completed 不得改变当前 Quick Chat。
- 每次恢复/清空/新发送增加代次；旧 `thread/read`、`thread/start` 或 `turn/start` 返回只能被忽略，不能回滚新选择。
- `turn/started` 保存真实 turnId；`turn/interrupt` 只在有 turnId 时调用，不乐观伪造停止完成。
- `turn/completed` 合并权威 agent items，清除 `activeTurnId` 与 streaming；失败进入错误态并提供重试。
- 关闭浮层只卸载 UI 与监听，不自动中断后台 turn；重新打开用真实历史恢复。
- 多窗口共享同一 Rust app-server 状态和通知，不另起一套假数据通道。

## 6. 视觉与可访问性

- 浮层以 560×640 为上限，受视口约束，允许原生 CSS resize；独立窗口充满自身内容区。
- 使用 Round 11 的语义色、字号、边框和 Composer 风格，不再自绘一套灰色值。
- 输入区使用 `field-sizing: content`，同时保留固定最小/最大高度与滚动回退，避免旧 WebView 不支持时布局崩坏。
- 最近会话、设置、发送/停止、分离、恢复均可键盘访问；Escape 关闭，状态有可读文本。
- 审批不能在 Quick Chat 中静默放行；用户必须能一键到主窗口处理。

## 7. 验证口径

- 纯函数：连续 delta、完成合并、历史恢复、其他 thread 忽略、错误与旧代次。
- 真实 app-server：隔离 `CODEX_HOME` 的 initialize、thread/start、thread/inject_items、thread/read、thread/turns/list、thread/delete。
- 真实 Tauri：侧栏入口、最近会话读取、模型/权限/项目、浮层调整大小、分离、独立窗口关闭、恢复主窗口。
- 标准命令：`scripts/verify-all.ps1` + `cargo build`。
- 最终报告明确区分“真实协议历史/归并”“真实窗口交互”“未执行 live model 生成”和“未获取官方独立窗口像素证据”。
