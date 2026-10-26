# 键盘交互对齐调研（2026-10-25）

## 来源与范围

开发前已搜索并读取 OpenAI 官方 Commands / Keyboard shortcuts：
https://learn.chatgpt.com/docs/reference/commands#keyboard-shortcuts

沿用当前 Windows 客户端、已有首页与 Composer，不改变已有视觉布局。本轮补齐可由现有功能承载的键盘入口；整体像素复刻仍需逐页同尺寸截图验收。

## 官方行为与代码差距

| 行为 | 官方 Windows 按键 | 当前差距 |
|---|---|---|
| 新聊天 | Ctrl+N / Ctrl+Shift+O | 缺少后者 |
| 侧栏 | Ctrl+B / Ctrl+Shift+S | 缺少后者 |
| 终端 | Ctrl+` | 当前只有 Ctrl+J |
| 模型选择器 | Ctrl+Shift+M | 缺少入口 |
| 最近聊天 1–6 | Ctrl+Alt+1–6 | 当前错误使用 Alt+1–9（官方用于切换产品模式） |
| 组合键精确匹配 | 每个命令只消费规定组合 | 部分 Alt 命令未排除 Shift，可能抢占其他命令 |

## 实现与验证计划

1. 保留现有命令 ID，补充别名；修复修饰键冲突和最近聊天组合 → 用真实 KeyboardEvent 形状做正反例回归。
2. 模型快捷键通过现有全局动作注册表处理，聚焦并打开已挂载 Composer 的模型菜单；无 Composer 时不操作 → 类型检查与 UI 事件链检查。
3. 输入法组合期间不发送 Enter、不执行全局命令 → 回归输入法事件保护。
4. 执行项目 verify-all，记录实际通过项与限制。不新增依赖、不改动未提交的既有布局。

## 验证结果

- `node scripts/verify-shortcuts.mjs`：39 条断言通过，覆盖别名、修饰键冲突、最近聊天范围和输入法保护；已接入 `verify-all.ps1`。
- `pwsh -NoProfile -File scripts/verify-all.ps1`：ALL CHECKS PASSED。TypeScript、Vite、Cargo check、17 项 Rust 测试和 87 项隔离协议探针通过。
- `git diff --check`：无空白错误。
- 模型菜单复用现有按钮、焦点与 aria-expanded 状态；本轮未完成原生 UI 手动验证。输入法保护经过代码检查，尚需原生中文输入法实测。
- 本轮没有视觉样式改动，没有新增同尺寸截图证据；不宣称像素级复刻完成。既有 bundle 大小、SettingsView 混合导入和 Node DEP0190 提示仍存在。
