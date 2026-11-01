# 01B A12：悬停卡片碰撞定位续

日期：2026-10-31。官方固定包静态调研先于实现；本增量只修改 Sidebar 会话悬停卡片的定位和对应几何回归。官方运行时窄窗无法取得，故本轮结论限于固定 asar 合同与 L2 回归。

## 官方依据

固定 Codex App `26.928.21956`，asar SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。

- `app-initial-fd3c4b862660.js`，SHA-256 `577a50e29502f573e2fbccf4940b9bd875339db420d6d5a9798a0d201ee0aff1`，`Mdo` 在 6,830,559 附近；调用点 UTF-16 offset 6,849,582 为 `side=right`、`align=start`、`sideOffset=2`、`interactive=true`。
- `app-shared-a906948d8868.js`，SHA-256 `1ffb0654bdfcba23be50c06c8698e665bdb17330d923758001d01262aa81cb5b`，`Fli` 从 UTF-16 offset 5,725,560 起。其定位 middleware 依次执行 `offset`、`flip({padding: 8, flipAlignment: true})`、`shift({padding: 8})`、`size({padding: 8})`；`size.apply` 将 `availableWidth` 与 `availableHeight` 写入浮层内容 CSS 变量。shared `Pli` 未给此路径指定自定义延迟。
- 精确有界片段及源文件哈希保存在 `.ref/parity/01/runs/20261031-codex-01b-hovercard-position/reference/positioning-evidence.txt`，片段 SHA-256 `3d4902cdbd2e2d254479aca7ef7489784130999f9bb20c77f65b0d217772e4fa`。
- 官方运行时窗口仍不可用；这组静态代码不能证明安装环境的实际窄窗结果或像素。

## 修改前验收与发现

更新 `scripts/verify-sidebar-hovercard.mjs`，先新增窄可用区域宽度收缩、左侧翻转用例。修改前执行退出码 1：450px viewport 与锚点 `right=250` 时没有 `maxWidth/minWidth` 定位值，未能满足侧边可用空间和8px碰撞内边距合同。该失败来自当前实际 Sidebar HoverCard 渲染路径，而非 mock 独立算法。

## 实现

- 保留默认 right/start、2px 锚点间距；以官方 8px 安全内边距计算两侧空间。自然宽度无法放下时选空间较大的一侧。
- 将可用宽度写入卡片 `maxWidth`，同时将 `minWidth` 限制在可用范围内；保留原生 224px 最小宽度（空间足够时）和 320px 自然宽度。可用高度限制为 viewport 减去上下各8px。
- 监听卡片 `ResizeObserver`，使收缩后换行造成的高度变化以及空间增大时卡片恢复自然宽度后重新校正位置；窗口 resize、滚动仍会重算，卸载时断开观察。
- 未新增依赖；未更改悬停打开、走廊、会话数据或其他页面。

## 验证

- 修改前专项红：`node scripts/verify-sidebar-hovercard.mjs`，退出码 1，宽度断言失败。
- 修改后专项绿：`node scripts/verify-sidebar-hovercard.mjs`，退出码 0；涵盖 450px 视口右侧宽度限制、足宽时左翻转、空间增大后卡片恢复自然宽度并重新定位、底边位置、指针走廊、编辑、监听器和 `ResizeObserver` 卸载清理。此为 L2 几何验证，非官方运行时或 Tauri 窄窗实测。
- `npx tsc --noEmit` 与完整 `pwsh -NoProfile -File scripts/verify-all.ps1`：退出码 0；标准入口中全部专项、TS、构建、Cargo check、17 项 automations Rust 测试和6组隔离协议探针通过。Vite 仍报告既有 SettingsView 重复导入与大 chunk 警告。
- `npm run tauri build`：退出码 0。Release 为 `dist-artifacts/01B-hovercard-position-20261031/CodexNative.exe`，13,306,880 bytes，SHA-256 `A093B4E913B8502B8B3D06D11C84940B7399D7E6C80681630513FAAD580CDB72`。
- 该 Release 使用从明确离线回放会话复制出的隔离 CODEX_HOME 启动。1442×914宽窗原生鼠标路径显示悬停卡片，截图见 `.ref/parity/01/runs/20261031-codex-01b-hovercard-position/actual/release-wide-hovercard.jpg`；卡片当时显示“新聊天”、`2 小时`和项目名。该样本没有提交模型请求。结构化记录见同目录 `actual/native-verification.json`。
- 当前 Computer Use 窗口 API 无直接尺寸设置能力；边缘拖动再次未能调整宽度，Release 最小宽度为960px。无官方配对参考图，不评分，`score=null`；物理窄窗和官方像素仍未验证。

## 状态

本增量代码、完整标准、Release 和宽窗原生悬停自验完成，待用户验收；01B整页仍开发中，不进入01C。后续仍需官方运行时窄窗对照、hoverCard真实宽度下的水平翻转/滚动定位、匹配参考截图与用户验收。
