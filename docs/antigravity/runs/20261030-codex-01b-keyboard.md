# 01B续：键盘相邻排序

日期2026-10-30。修改前合同；01B整体仍开发中。

官方固定initial SHA-256 `577a50e29502f573e2fbccf4940b9bd875339db420d6d5a9798a0d201ee0aff1`，原始证据见前轮`reference/keyboard-call-chain.json`：Flo（6788865，0-based UTF-16）在capture阶段仅接受未被处理、Alt且无Ctrl/Meta/Shift的ArrowUp/ArrowDown。匹配时阻止默认/冒泡，仅目标显式role=button才调用moveThread；子输入与原生操作按钮不重排。内层传感器包装禁用onKeyDown，不能据通用Space/Enter传感器推断聊天快捷键。

moveThread（7247002附近）以显示可见列表索引向前/后移一位，越界不提交；J2o/$2o保证仅手动模式保存。沿用完整存序可见槽位替换，不删除隐藏/未加载ID。

本轮映射：本项目既有可聚焦聊天行承担官方主激活button语义，增加role=button；capture处理按键，只有焦点在主行时移动，子操作不移动。已有Enter/Space打开行为保留；不增加Space/Enter“抓起”模式。React稳定key保留移动后焦点，需原生验证。

计划：实际组件先失败→只改CodexSidebar按键处理并复用sidebarOrder→回归上下边界、修饰键、子控件、最近/项目、存储隐藏项→完整标准检查→当前release原生焦点/连续移动与重启。无新依赖、不改CSS、不扩展置顶或跨组迁移。官方运行时按键与同条件像素仍需采证，不凭静态证明整体1:1。

## 本轮结果

限定功能自验通过，待用户验收；01B整体仍开发中。

- 产品仅修改`src/components/CodexSidebar.tsx`：主行补button语义，capture处理Alt相邻移动，复用既有`moveVisibleSidebarThread`和存储路径。没有新增依赖、CSS或新排序抽象。
- `scripts/verify-sidebar-projects.mjs`新增实际组件回归。`cases/before.log`退出1（主行缺button语义）；`cases/after.log`退出0，覆盖项目/Recent上下移动、可见边界、修饰键与子控件隔离、已处理事件、隐藏/未加载ID保留及重建恢复。受控React/window边界仅证明L2合同。
- `cases/verify-all.log`完整标准检查退出0，类型、前端构建、Rust检查、17项automations单测和现有真实协议探针通过；13项Rust被过滤，不能称全量Rust通过。探针显式使用隔离CODEX_HOME并清空API keys，未发起模型生成。没有配置的额外lint未报告通过。
- `cases/release.log`退出0。`build.json`记录EXE SHA及基准提交；`build-inputs.json`的115项源码输入和5项dist均匹配构建前/后磁盘，`source/`与`frontend-dist/`保存归档。基准380c32c7包含现有未提交改动，不能把整份diff归为本轮改动；未提交推送。

## 原生动作证据

当前EXE：`dist-artifacts/01B-keyboard-20261030/CodexNative.exe`，SHA-256 `ac55724b293eba75d45f9bf1d7e368aca4571c5594f98f4e045f2b039623dfd5`。

使用前轮本应用专用`native-home`与`native-webview-profile`（路径见01b-manual/native-fixture.json），28条明确离线回放语料、真实官方CLI读取，不是模型生成对话。只通过进程环境隔离，不写官方配置。

| 操作 | 预期/观察 | 证据（本轮actual/下JPEG和TXT） |
|---|---|---|
| 项目展开后Tab经过项目子操作到首条01 | 主行获得可见焦点环，仍在首页 | before：01/05/02/03/04 |
| Alt+Down | 01只下移一位，焦点保留01 | down-once：05/01/02/03/04 |
| 不重新聚焦，再Alt+Down | 同一01继续下移一位，未打开聊天 | down-twice：05/02/01/03/04 |
| Alt+Shift+Up | 不移动 | extra-shift：05/02/01/03/04 |
| Tab到01的置顶子按钮，再Alt+Up | 不移动、不执行置顶 | child-isolation：05/02/01/03/04；焦点环在子按钮 |
| Shift+Tab回主行，Alt+Up | 01上移一位 | up-once：05/01/02/03/04 |
| 完整退出，再启动同一EXE | 顺序保留 | restart：05/01/02/03/04 |

可访问性focused_element在这些采样持续返回外层“窗格 Codex Native”，不能据该字段证明DOM焦点；焦点保留依据是截图焦点环和未重新定位的连续键盘动作。UIA树用于核对顺序，事件后必要二次采样消除旧树滞后。截图为JPEG动作证据，不是无损像素基准。

## 仍未完成

官方运行时快捷键同条件对照、完整无障碍树结构、拖动ghost/指示器/动画、菜单结构、多项目归属与跨组、置顶重排仍需继续。最新构建包含上一轮取消修复，但未补原生在途取消实测。官方环境参数用户答复未知，不能作有效逐像素评分。限定键盘功能通过不代表01B整体或首页已验收。
