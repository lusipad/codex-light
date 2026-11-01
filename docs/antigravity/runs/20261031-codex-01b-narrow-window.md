# 01B A12：有效最小窗口与悬停卡片重排续验

日期：2026-10-31。沿用固定官方 asar `26.928.21956` 的 A12 碰撞定位合同；本轮先确认当前构建、受支持的最小窗口尺寸及此前未验证项，再执行当前 Release 原生 UI 验证。没有官方运行时窗口和同条件参考截图，因此本报告只记录本项目的实际布局，不得表述为官方一致或像素通过。

## 基准与来源

- 官方静态定位合同、源文件哈希、middleware 顺序及 L2 修改前红/修改后绿记录见[hoverCard 定位调研与实现记录](20261031-codex-01b-hovercard-position.md)。
- `src-tauri/tauri.conf.json` 主窗口最小宽高为 960×640 logical pixel。本轮用当前附件竞态修复版 `CodexNative.exe`，大小 13,306,880 bytes，SHA-256 `059933C06129E82FB6E46DB1D68885994C0ECFFBC5ED18A4C23C0F61317ED2F3`。
- UI fixture 由本轮 `cases/prepare-native-home.mjs` 使用真实 `codex app-server` 建立两条显式离线回放会话。使用一次性 CODEX_HOME、空 API key、未复制认证；未调用 `turn/start`、未发模型请求。为了使 CLI 的 `thread/list` 可列出离线 fixture，rollout 中仅写入声明用途的 `user_message` 投影事件，无 assistant 回复。
- 官方基准图对应条件为 Windows 缩放 100%、中文深色、客户区 960×640；本轮窗口 DPI API 返回 168 DPI（175%），Windows 缩放设置与 App 缩放设置未知。两者条件不相同。

## 操作和观察

| ID | 操作 | 观察结果 | 证据 |
|---|---|---|---|
| NW01 | 从隔离 CODEX_HOME 启动当前修复版 Release | 匹配了本轮 EXE 路径和 SHA；两个回放条目在项目与 Recent 可见 | `actual/native-verification.json` |
| NW02 | 以窗口 DPI 168 调整到约 960×640 CSS 客户区并查看布局 | 侧栏、导航、Home Hero 与 Composer 仍可见；Home Hero 标题在此高度换行并被底部 Composer 部分遮挡，记录为布局观察，不推断官方预期 | `actual/native-narrow-window.jpg` |
| NW03 | 在项目会话行悬停 | 原生 Accessibility tree 检出 `sidebar-thread-hover-card`；测得卡片边界在 WebView 视口范围内，右侧可用空间足够，因此本次未触发水平左翻转 | `actual/native-narrow-hovercard.jpg` |
| NW04 | 减少窗口高度并悬停较低的 Recent 行 | 卡片向上重排，卡片底边仍处于窗口内；记录到 15 physical-pixel 的底边空间 | `actual/native-narrow-bottom-hovercard.jpg` |

结构化窗口/PID、显示环境、证据文件哈希和 UIA 边界见 `.ref/parity/01/runs/20261101-codex-01b-narrow-window/actual/native-verification.json`。原生捕获文件为 JPEG，仅作路径与功能证据；不据此计算视觉分数。

## 结论与边界

- 本项目当前构建的有效最小布局可实际进入原生窗口并交互。长名称卡片在可达右侧空间内保持可见；底边空间不足时会向上移动。
- 没有发现需要修改的 A12 定位缺陷。本轮没有改产品代码，只增加一次性本地 fixture 准备器、原生证据及验收记录。
- 未验证：官方运行时行为、固定/滚动区官方合同、同条件官方参考图、水平左翻转（最小可达窗口仍有足够右侧空间）、系统与应用缩放设置、窄窗精确 CSS viewport、窄窗像素差、该构建上长线程标题而非回放 preview 文案的卡片内容、键盘/touch 路径。
- 没有官方参考图时无法按 `visual-verdict` 生成有意义的对比 JSON 或分数；评分保持 `null`，不得使用自截图充当基准。依据 [visual-verdict skill](../../../C:/Users/lus/.codex/skills/visual-verdict/SKILL.md) 的输入合同，本轮跳过图像相似度评分。

状态：A12 本项目原生有效窄窗悬停/垂直重排增量自验完成；官方对照与像素待采证。01B 仍开发中，待用户验收，未放行 01C。
