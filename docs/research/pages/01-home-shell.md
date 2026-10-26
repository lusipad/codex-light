# 01 公共外壳与首页

状态：开发中，原生复测被用户中止；尚未用户验收。日期：2026-10-25。

## 基准与证据

- 官方安装包：`C:/Users/lus/Codex/_internal/app/resources/app.asar`，26.928.21956 / build 12404。
- SHA-256：`17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。
- 本轮重新只读提取 package.json 与 5 个 CSS；路径、哈希与时间在 `.ref/parity/00/manifest.json`。
- 官方功能文档已读取：https://learn.chatgpt.com/docs/reference/commands#keyboard-shortcuts 。
- 历史官方截图：`.ref/reference/round11/official-home-before.png`（1568×934）；当前原生初始截图：`.ref/parity/01/actual/native-home-before.png`（1442×866），尺寸不同，只能作为差距定位，不能逐像素判定通过。
- 官方运行进程为 ChatGPT.exe；Computer Use guidance 禁止自动化 ChatGPT 桌面 UI。本轮不操作官方 UI，新的同尺寸官方实测待补。当前应用可进行原生操作验证。

## 静态结论与边界

1. 官方 `app-shared-342447930c78.css` 的 `:where(:root:not([data-codex-window-type=extension]))` 把 dark surface 设为 `--gray-fixed-900`（#181818），覆盖普通主题 #212121；当前 `--bg-main` 没有对齐这个 Electron 分支。
2. 当前模型菜单没有打开后焦点进入、trigger ArrowDown/ArrowUp 打开、aria-controls 关联；点击 Composer 内的输入区域也不会关闭模型菜单。复用现有组件修复，不新增菜单系统。
3. 导航轨 Library/Images/Projects 存在账号/模式 gate 和导航定制，不能仅凭旧截图无条件增加入口；保留为待运行时确认差距。
4. Hero 代码链已确认：`app-primary-84ad97f06929.js` 的 `PAt` → 非 everydayWork 的 `yAt` → 静态 `D9`，SVG 锚点 `var E9,D9;function O9`；`mAt` 容器为 size-14、opacity-30 / hover opacity-40。本轮用同轮廓路径和裁剪描边重建静态图标；点击旋转、hover hello/loader 动画仍待验证与实现。
5. 模型、Fast、推理档继续来自真实 model/list，不改变既有权限协议映射。
6. 首页原生验证发现连接标识假离线。后端 `ensure_connected` 并发时会重复 `restart`，旧 stdout EOF 无连接身份判断地清除当前 stdin/status；需串行化生命周期并隔离旧连接事件，增加可复现回归。
7. 深入追踪模型数据发现后端 `post_process_result("model/list")` 强制注入 Astra 并解除部分模型 hidden，前端即使读取运行时列表仍会获得被伪造的能力。该行为不符合本页真实模型基线，需先用原样保留列表/hidden/能力与空列表的断言复现，再移除注入及孤立函数；不能据此保留未经服务端返回的模型。

## 本轮开发范围

- 校准已证实的主表面颜色；不根据猜测调整侧栏材质。
- 替换为 asar 确认的 Codex 首页静态标识，恢复 56px 容器与 30% / 40% 透明度；不宣称动态动画完成。
- 修复模型菜单键盘打开、焦点进入/返回、菜单内导航及点击外部关闭。
- 保存本轮原生截图与状态，不修改真实账号设置，不发送付费任务。

## 验收用例

| ID | 操作 | 预期 |
|---|---|---|
| H01 | 打开首页 | 主区 Electron dark surface 为 #181818；无额外线程控件 |
| H02 | 模型 trigger 按 ArrowDown / ArrowUp | 菜单打开，焦点进入第一/最后可操作项 |
| H03 | 模型菜单 Escape | 菜单关闭、焦点回到 trigger，事件不关闭其他工作面 |
| H04 | 菜单内 ArrowDown / ArrowUp / Home / End | 按可操作项导航，边界循环，无焦点丢失 |
| H05 | 推理滑块 Left / Right / Home / End | 档位仅在支持范围变化，不被菜单导航截获 |
| H06 | 打开菜单后点击输入框 | 菜单关闭，输入框保留焦点 |
| H07 | Ctrl+Shift+M | 聚焦并打开模型菜单，不发生双重切换 |
| H08 | 首页侧栏折叠/展开 | 内容与 Composer 不溢出，焦点仍可操作 |
| H09 | 宽/窄窗 | Hero、Composer、菜单在视口内；同尺寸参考缺失时不判像素通过 |
| H10 | 中文组合输入 Enter | 选字不发送，后续正常 Enter 按用户偏好处理 |

## 验证记录

- 首轮标准 `verify-all.ps1`：exit 0，39 项快捷键断言、TypeScript、Vite、Cargo check、17 项调度测试及 87 项隔离协议探针通过。
- 随后补充静态 Hero 修改，重新 `npm run build` 与 `cargo build --manifest-path src-tauri/Cargo.toml` 均 exit 0；`git diff --check` 无空白错误。
- 原生验证：Ctrl+Shift+M 打开；打开后 Enter 进入模型列表（可见“默认”焦点环）；Escape 关闭回到模型触发按钮（可见焦点环）；上箭头打开并聚焦滑块；Left/Right 调整并恢复原档；点击输入框关闭菜单。
- Fast 开启后 UIA 标签变为“启用标准模式”，随后关闭恢复原状态；未发送任务。模型数据来自本进程指定的已安装 CLI，不修改全局配置。
- H08 原生侧栏快捷键折叠/展开已操作并恢复，布局未溢出；截图 `sidebar-collapsed.png`。H04 完整 Home/End/循环、H10 原生中文组合输入尚未完成本轮回归，不写通过。
- 原生截图实际尺寸 1442×914，旧官方参考 1568×934；已生成 `.ref/parity/01/diff/side-by-side.png` 与 `measurements.json`，仅无缩放并排展示，不计算虚假整页像素通过率。
- 两图主区 (1100,600) 颜色均为 RGB(24,24,24)。只能证明该处表面色一致，不能证明全部视觉一致。
- 通过拖拽验证最小窗口未成功调整尺寸，未记为原生窄窗通过。
- 原生测试发现的连接竞态已在 `app_server.rs` 修复：串行化 ensure/restart、按代次隔离旧 reader EOF/通知/stderr；初始化写失败显式返回错误。新增旧连接退出不影响新请求的回归，并在独立夹具移除保护验证断言真实失败。
- 已删除模型列表注入和解除 hidden 的后处理。新增原始 data/数组、隐藏标记、推理/速度能力与空列表不变回归，先确认旧实现断言失败后修复。
- 最终源码全量 `cargo test`：22 passed / 0 failed；重新运行完整 `verify-all.ps1`：exit 0，ALL CHECKS PASSED，完整日志在 `.ref/parity/01/verify-all.log`。
- 准备关闭旧构建并重建时，Computer Use 报告用户按物理 Escape 中止；之后未再执行任何界面输入。连接与模型后端修复的最终原生构建/复测尚未完成，不能宣称已在原生窗口验证这两项修复。
- 构建和源码指纹在 `.ref/parity/01/build.json`；首轮 EXE 保存在 `dist-artifacts/01-home-shell/codex-tauri.exe`，如后续修复重新构建则更新指纹和产物。

## 待关闭差距

1. 官方同尺寸截图、DPI 和账号门控的最新实测仍缺。当前静态标识、表面与模型菜单修复不代表整页 1:1。
2. Hero hover/点击动画、侧栏字体/材质、标题栏几何及导航 gate 待对照。
3. 连接状态和原始模型列表修复需完成最终原生构建及复测；现有产物只是前一轮首页视觉/菜单构建，不包含最后的后端修复。其他用例按上述记录补齐。保持在 01 单元，不进入 02。
