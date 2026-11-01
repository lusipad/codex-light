# 01B A08：Codex-only 模式入口

日期：2026-10-31。修改前调研与动作合同。范围仅为侧栏品牌区的产品模式入口；01B 整页仍待用户验收。

## 官方静态依据

固定官方 Codex App `26.928.21956`，asar SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。前端 chunk `app-initial-fd3c4b862660.js` SHA-256 `577a50e29502f573e2fbccf4940b9bd875339db420d6d5a9798a0d201ee0aff1`，定位均为从文件头起算的 0-based UTF-16 字符偏移。

- `U6o`（约 8,157,493）：模式菜单只有 `Work` 与 `Codex` 两项；工作模式显示标签取决于 `workModeAccess`，可呈现 ChatGPT 或 ChatGPT Work。
- 同一组件的 disabled 分支：只渲染当前模式标题的静态 `div`，不渲染可操作的模式菜单；调用处以全局模式 gate 或 `codexOnly` 令 `disabled` 为真。该静态分支是代码已证行为，不等于已观察目标账号当前是否进入该分支。
- `xds`（约 8,609,679）：Codex-only 状态参与禁用判断；工作模式能力另从独立 capability 读取。`account/read` 的账号类型/连接状态不能替代该 capability。
- 当前项目没有 ChatGPT/Work 产品模式路由或官方切换协议；因此在本产品当前仅实现 Codex 的范围下，应映射到官方 Codex-only 静态标题分支。不得保留三个看似可选但实际无效的 Codex / ChatGPT / ChatGPT Work 条目，也不得伪造 Work capability。

以上是固定包的静态实现与本项目当前支持范围，不证明官方 GUI 当前账号的实际门控、运行时标题尺寸、图标或像素结果。该官方运行时与同条件参考截图仍未采证。

## 修改前动作合同

| ID | 操作 | 预期 |
|---|---|---|
| MS01 | 打开本项目当前 Codex-only 侧栏首页 | 品牌区显示静态 Codex 标题，无模式切换按钮、下拉箭头或弹层 |
| MS02 | 鼠标点击、Enter、Space、ArrowDown 作用于品牌标题 | 不打开菜单、不改变模式、不触发路由或 toast |
| MS03 | 遍历品牌区无障碍树 | 标题是静态文本，不暴露 `button`、`menu`、`menuitemradio` 或“切换模式”动作 |
| MS04 | 与官方 Codex-only disabled 分支对照 | 仅行为结构采用“静态当前模式标题”合同；无官方运行时/配对截图时不得报告像素通过 |

开发前本地组件回归应先因旧三项占位失败，随后执行真实 `CodexSidebar` 组件级 L2 用例与类型/前端构建检查。若仅替换按钮为静态标题，无产品协议改动，也无需完整 Tauri release；该验收单元仍需纳入后续统一原生与用户验收。

## 取舍与限制

- 不构造 ChatGPT、Work 模式切换，不把“尚未接入”的按钮伪装为官方禁用态。
- 复用现有品牌文字与侧栏布局，只移除模式下拉交互和仅服务该下拉的样式。
- 运行时账号 capability、官方菜单视觉、窄窗及系统/DPI 缩放仍需采证；不据此扩展或隐藏其他入口。

## 实施与验证

- 修改前将 MS01–MS03 加入真实 Sidebar 组件回归；旧实现退出码 1，失败断言为仍缺少静态 heading。
- 将品牌区改为静态 `Codex` 标题，移除三个占位模式项及仅服务该弹层的样式；没有新增依赖或协议。
- `node scripts/verify-sidebar-projects.mjs`：退出码 0，包含实际 `CodexSidebar` 渲染用例。
- `npx tsc --noEmit`：退出码 0。
- `npm run build`：退出码 0。保留既有 Vite 提示：SettingsView 同时静态/动态导入、单一前端 chunk 超 500 kB；与本轮变更无关。
- `npm run tauri build`：退出码 0；Release 复制到 `dist-artifacts/01B-mode-selector-20261031/CodexNative.exe`，13,306,880 字节，SHA-256 `00C6EE804076143045A336A08441A44C10E8A567B03A1DAA97D229B782F67767`。
- 隔离 `CODEX_HOME` 下启动本轮 Release，PID `175852` / 窗口 ID `229773770`；1442×914 中文深色窗口的原生 Accessibility 树显示侧栏品牌区为普通 `组 Codex` / `文本 Codex`，没有模式触发按钮、产品模式菜单、ChatGPT/Work 占位。Composer 的“添加文件、照片或切换模式”按钮仍存在，与品牌区模式入口无关。没有账号登录或模型请求。
- `pwsh -NoProfile -File scripts/verify-all.ps1 -Fast`：退出码 0，明确跳过协议探针。
- `pwsh -NoProfile -File scripts/verify-all.ps1`：退出码 0；包含全量登记回归、TypeScript、前端构建、Cargo check、17 项 `automations` Rust 测试和 6 组隔离协议探针。标准脚本不是全量 Rust 测试入口。
- `git diff --check`：退出码 0（仅报告仓库既有 LF/CRLF 转换提示）。
- 未保存原生截图；没有官方同条件参考图，visual verdict 为未评估且 `score=null`。本增量待用户验收，01B 整页仍开发中。
