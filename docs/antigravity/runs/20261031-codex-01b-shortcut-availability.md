# 01B A08：快捷键列表按当前上下文筛选

日期：2026-10-31。此增量依据固定官方静态实现收敛本项目快捷键列表的上下文显隐，不代表本项目快捷键集合已与官方完整一致。

## 官方调研

- 基准为 Codex App `26.928.21956`，asar SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。
- 官方 `keyboard-shortcuts-dialog-881d97cb02e0.js` 文件哈希 `b37512ec84b9f0703cfc98ec778e86841f80db2be1cd86096254544a3482be68`，见[快捷键参考 manifest](../../../.ref/parity/01/runs/20261031-codex-01b-help/reference-manifest.json)。
- 组件中的 `De({keymapState, registeredCommands, hasBaseCommandHandler, isCommandAvailable, platform})` 先按官方命令顺序遍历；命令不可用时丢弃，没有当前平台的有效快捷键时丢弃；WebView 命令还需实际注册命令或基础 handler。此为固定包静态实现观察，不证明每个运行时 capability 结果。
- 同一 chunk 的 `isCommandAvailable` 输入包括本地/Work capability、dictation/browser/automation/voice、hotkey window、tab strip、sidebar collapsible、priority filter、mode switch 与平台等状态。这表明官方对话框随当前命令和 capability 动态筛选，静态全量列出并不等价。
- 当前本项目持有自己的 `SHORTCUTS` 注册表和 handler。本次只对已有本地动作按可直接观察的 thread/workspace 上下文筛选，不宣称复原官方未暴露的 capability，也不删除当前产品实际注册的本地快捷键。

## 修改前动作合同

| ID | 初始状态 | 操作 | 预期 |
|---|---|---|---|
| SC01 | 首页；无活动会话；无工作区 | 打开资料→帮助→键盘快捷键 | 仍显示通用键；不显示会话操作快捷键，也不显示复制工作区路径 |
| SC02 | 有活动会话；无工作区 | 打开对话框 | 显示会话查找、重命名、置顶、归档、派生、复制代码块；仍不显示工作区路径动作 |
| SC03 | 有活动会话和有效工作区 | 打开对话框 | 显示上述会话项及复制工作区路径 |
| SC04 | 任意上述上下文 | 搜索大小写词、无匹配词、Escape、在输入框按业务快捷键 | 既有搜索、清除/关闭和业务快捷键隔离行为不变 |

## 实现

- 在 `src/shortcuts.ts` 增加 `availableShortcuts`，以活动会话和工作区布尔上下文过滤既有动作 ID。
- 对话框从 App 接收 `activeThreadObj !== null` 和 `activeWorkspace?.path != null`；设置页继续展示快捷键注册表全量，未改变实际快捷键注册和执行路径。
- 没有新增依赖、协议字段或样式。

## 验证

- `node scripts/verify-help-menu.mjs`：通过；实际对话框组件回归覆盖首页无 thread/workspace、活动 thread、工作区缺失及原搜索/IME Escape/焦点和 shortcut dispatch 保持。
- `npx tsc --noEmit`：退出码 0。
- `pwsh -NoProfile -File scripts/verify-all.ps1`：退出码 0；专项、TypeScript、Vite、Cargo check、标准 automations Rust 筛选测试及六组协议探针通过。脚本报告既有 SettingsView 动静态双导入和大 chunk 警告。
- `npm run tauri build`：退出码 0；Release、MSI、NSIS bundle 均生成。当前增量 Release 为 `dist-artifacts/01B-shortcut-availability-20261031/CodexNative.exe`，13,307,392 bytes，SHA-256 `B9364E845484493148D1DADB60FC6B21E406520052F0E6960F8193B0FDF4C6BC`。
- 当前 Release 原生 UIA：隔离离线 CODEX_HOME 下，首页对话框隐藏六个 thread-only 动作；项目工作区已选时显示“复制当前工作目录”。选择离线会话后，同一对话框呈现六个 thread-only 动作及工作区动作。证据：[原生 UIA 记录](../../../.ref/parity/01/runs/20261101-codex-01b-shortcut-availability/actual/native-verification.json)及 [JPEG 功能截图](../../../.ref/parity/01/runs/20261101-codex-01b-shortcut-availability/actual/native-thread-shortcuts.jpg)。未认证、未发送消息、无模型调用；窗口功能截图不用于像素比较。
- 没有同条件官方快捷键对话框截图，不运行图像评分。官方完整快捷键集合、命令/平台/capability 对齐、物理 IME 仍未验证。

状态：A08 本地上下文筛选增量自验完成，待用户验收；官方命令集合/运行时与像素仍未验证。01B 未验收，不放行 01C。
