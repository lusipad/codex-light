# 01B A11：项目移动确认框键盘隔离

## 修改前合同与范围

沿用[项目移动固定版本调研](20261101-codex-01b-project-move.md)中的 RA / EM / Ezt 确认合同及取消零写入约束。当前确认框的 Escape、焦点返回和官方运行时细节仍未实测，本轮不宣称这些行为已与官方一致。目标是先修复本项目模态框自身缺失的键盘隔离，符合既有通用验收标准和重命名对话框的处理方式。

当前缺口：`aria-modal` 不会自动限制 HTML 浮层的焦点；Tab 可离开确认框，按键仍可触发 App 全局快捷键；关闭时没有显式返回此前焦点；输入法组合期间 Escape 会取消。

1. 执行生产确认框 JSX 与焦点 effect，先用回归复现。
2. 保持现有布局、文案和后端事务，仅补按键隔离、Tab 循环与关闭焦点恢复。
3. 运行专项、TypeScript 和构建，记录自动测试与原生/官方对照边界。

| ID | 操作 | 预期 |
|---|---|---|
| PMK01 | 打开确认框，随后关闭 | 首焦点为取消；此前控件仍连接时恢复其焦点 |
| PMK02 | 继续上 Tab；取消上 Shift+Tab | 分别循环至取消、继续，不离开确认框 |
| PMK03 | Escape / Ctrl+N | Escape 关闭且阻止冒泡；全局快捷键不从确认框冒泡 |
| PMK04 | IME Escape（isComposing / 229） | 不取消；阻止默认 Escape 行为 |
| PMK05 | 移动提交中 Escape / Tab、背景点击 | 不关闭；没有可用按钮时 Tab 不穿透 |
| PMK06 | 点击取消/背景，或点内容 | 取消与背景可关闭；内容不关闭；均不直接提交移动 |

以上为 L2 JSX/副作用回归，浏览器焦点实际行为、原生输入、官方运行时及像素另行验证。01B 保持开发中。

## 原生命令入口补充合同

续查 `nativeShell.ts` 与 `App.tsx` 的菜单/托盘注册：`native-menu`、托盘新聊天和标题栏菜单都进入 `handleAppCommand`，不经过确认框的 DOM 冒泡。仅有 `stopPropagation` 无法保护这条路径。这是本项目源码证据，尚非物理 accelerator 的运行时复现，也不证明官方原生确认框的具体按键策略。

修复范围限定为：确认框打开或提交中，命令分发器不得执行背景快捷动作（缩放除外）、打开工作区、进入设置或重新加载；关闭后恢复原有分发。保留缩放、主题、帮助和窗口控制原有路径。PMK07 直接执行生产分发器及实际菜单/托盘回调，检查弹窗打开、提交中与关闭三种状态，不复制命令处理逻辑。原生按键、busy 焦点和官方精确行为仍单独待验。

## 实施与验证

- 修改前专项退出 1，断言 `closing must restore the connected launcher` 失败；修复后 PMK01–PMK06 通过。测试直接执行 `App.tsx` 的实际确认框 JSX 和焦点 effect，没有复制事件处理逻辑。
- 复用原有取消按钮 ref、确认状态和浮层，没有新组件、依赖、布局或样式。Tab 查询现有可用按钮；Escape 阻止默认行为并区分 IME / 提交中；effect 清理只恢复仍连接的先前控件。
- 已接入 `verify-all.ps1`；专项、Composer 键盘回归及独立 TypeScript 检查退出 0。
- 隔离范围为 WebView 内从确认框冒泡的键盘事件；Tauri 原生菜单 accelerator、提交中禁用按钮后的真实焦点行为，以及先前菜单 launcher 已移除/焦点回到 body 的情形，仍需原生观测。不能将本次 `stopPropagation` 说成已证明所有原生快捷键都被阻止。
- 完整 `verify-all.ps1` 退出 0，含 TypeScript/Vite、Cargo check、`automations` / `workspace` / `project_` 过滤测试和 8 组隔离协议探针；不等于全量 Rust 或整页通过。Vite 既有大 chunk/混合导入与 Node DEP0190 警告仍存在，package.json 未配置独立 lint。
- 独立目录 `npm run tauri build` 退出 0，EXE/MSI/NSIS 均生成。[当前可运行 EXE](../../../dist-artifacts/01B-project-move-keyboard-20261101/CodexNative.exe) 为 14,032,384 bytes，SHA-256 `C5B80DAE9A8856AED8C32CE54449EF89F354850FD67F7C4E58CA03D1ECDD095F`。修改文件在检查/构建后哈希一致；[构建清单](../../../.ref/parity/01/runs/20261101-codex-01b-project-move-keyboard/actual/build-manifest.json)记录父提交、未提交差异及验证输入。
- 当前 EXE 尚未原生操作确认框；只交付开发增量，不报告官方对照、原生完整通过、视觉评分或用户验收。未自动提交/推送。

## 原生命令入口修复结果

- PMK07 修改前退出 1：`open-recent-thread: confirmation=true, busy=false`，实际执行 1 次，预期 0 次。修复后 PMK01–PMK07 通过，覆盖所有当前注册的快捷动作及工作区、设置、重载，并实际调用菜单/托盘接线；关闭状态仍正常分发，缩放及主题路径保留。
- 产品增量只在 `handleAppCommand` 增加状态检查和对应 callback 依赖；复用现有命令注册，没有新依赖、状态、布局或后端改动。
- 初次完整检查发现帮助菜单 VM 夹具缺少 `projectMoveConfirmation`，报 `ReferenceError`。补充关闭状态后帮助菜单专项通过；保留首次失败日志，重跑完整检查，不跳过失败步骤。
- 本次资料沿用的两个官方 chunk 已重新核验 SHA-256，与项目移动调研表一致。原生命令物理输入、忙碌态焦点、官方运行时与像素均未验证；此项只交付 L2 入口保护，不作原生通过结论。
- 重跑完整 `verify-all.ps1` 退出 0（含 8 组隔离协议探针及过滤的 Rust 回归，并非全量 Rust）；独立目标目录的 Tauri Release/MSI/NSIS 构建退出 0。未配置独立 lint，Vite 大 chunk/混合导入等已有警告仍在。
- 本次可运行产物为 [命令隔离版 EXE](../../../dist-artifacts/01B-project-move-command-guard-20261101/CodexNative.exe)，14,032,384 bytes，SHA-256 `82F0D5D88D3ECFB5466714BFFCCD68CB2B85ABB5B68B194BA120685969BB2123`；它取代上节旧 EXE 作为本次源码的构建。首次失败、重跑成功、构建和输入哈希分别保留于 [native-command-guard 证据目录](../../../.ref/parity/01/runs/20261101-codex-01b-project-move-keyboard/actual/native-command-guard/)。仍未在该 EXE 执行原生交互，未提交/推送。
