# 01B A11：本地会话重命名弹窗

日期：2026-10-31。修改前合同。01B 开发中，不放行 01C。

## 官方依据与适用范围

固定参考为本机 26.928.21956，asar SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。本轮有界片段及哈希存于 `.ref/parity/01/runs/20261031-codex-01b-rename/reference/`。定位均为 0-based UTF-16 字符偏移。

- initial `rTo` 7195036：菜单重命名回调打开 `Tho`；只有当前行、目标位于 `data-thread-title` 内的双击进入同一回调。初值取真实 title，缺失时空串；不是 preview。
- 同回调设置 `saveInBackground:true`、`showColorPicker:false`。普通 local 的 `requireNonEmpty` 为 false，未传 `trimOnSave`、长度或 pattern；Aeon 的特殊约束不适用于本轮。
- initial `Eho` 6957322：打开 focus/select，input 获焦全选；form 提交防重复，后台模式先关闭再 await 保存，失败 toast。取消/外部关闭不调用保存；没有 input blur 自动提交。
- shared `Bg→lbi→mbi`：模态 compact，`cbi` 给 `w-105`，默认 max-width 92vw、rounded-3xl、0.5px ring、elevated-secondary/90、backdrop blur。`Ef/fs/Io` 为表单、分区、标题；body padding 5 spacing、section padding-top 3 spacing，标题/副标题间 gap1，footer gap3。颜色、字体、原生焦点与实际物理像素仍需运行时采证。
- 实际 zh-CN：重命名聊天 / 保持简短且易于识别 / 添加标题… / 聊天标题 / 取消 / 保存 / 无法保存更改。请重试。

当前问题：Sidebar 行内输入在 Enter 和 blur 都提交、trim 且拒空；取消可能被 blur 覆盖，没有弹窗。App 在真实请求前就显示新名称，失败静默吞掉。

## 范围与取舍

只改 Sidebar 的重命名入口与弹窗、共享 App 保存回调的失败结果、对应专项和资料。使用现有原生 HTML dialog 模式及 CloseIcon，复用真实 `thread/name/set`，不加依赖、不改后端。以原生 dialog 提供模态焦点限制和 Escape；这是 Tauri 的等价实现选择，不能据此宣称官方内部使用 dialog。

后台保存立即关闭符合静态分支。共享 App 回调改为收到成功响应后才更新列表，失败显示官方中文错误且保留原名；这是避免假成功的保守实现，尚未证明官方相同的乐观更新时序。header/项目页的重命名入口不在本轮改为弹窗。emoji feature gate、Aeon、hoverCard 内编辑及完整菜单结构均不在本轮。

## 修改前动作合同

| ID | 操作 | 预期 |
|---|---|---|
| RN01 | 右键/更多→重命名 | 菜单关闭，不切换会话；显示标题、副标题、真实名称输入、关闭/取消/保存，打开全选 |
| RN02 | 双击当前行标题 / 非当前标题 / 行其他位置 | 仅当前标题进入同一弹窗，其他双击不触发重命名 |
| RN03 | 编辑后失焦、取消、关闭、Escape、点击遮罩 | 不发送保存；弹窗关闭恢复仍连接的原焦点，模态 Tab 不进入底层 |
| RN04 | 普通 local 保存带空格、空字符串、同名、Enter/按钮 | 只调用一次目标 thread/name/set，保留原始输入；关闭后后台等待，名称仅随真实成功更新 |
| RN05 | 中文组合中 Enter / keyCode229 | 不提交、不关闭、不触发底层全局快捷键；物理 IME 另行实测 |
| RN06 | 请求失败 | 不留下假成功名称，显示“无法保存更改。请重试”；不产生未处理 Promise 拒绝 |
| RN07 | 当前 release，隔离 home/profile | 不登录、不发送模型任务，验证打开/全选/Tab/取消/保存和真实读回；旧窗口不操作 |

先运行失败回归，再实现，随后专项、标准检查、release与可用原生路径。无同条件官方图，不运行虚构的 visual-verdict 分数；score=null，保留样式与运行时差异。

## 实施与验证结果

已按合同移除 Sidebar 行内输入，新增局部 `RenameThreadDialog.tsx/.css`，复用项目已有的 HTML dialog 焦点生命周期模式、CloseIcon、真实保存回调和样式 token。未新增依赖、Rust 命令、协议字段或通用弹窗框架。菜单与当前行标题双击共用此入口；普通输入不 trim，取消/失焦不保存，IME Enter/229 不提交，ref 阻止同一弹窗重复提交。App 在真实 RPC 成功后更新目标名称，失败显示错误而非静默成功。

| 验证 | 结果及可证明边界 | 证据 |
|---|---|---|
| 修改前专项 | 失败：仍为行内编辑，没有弹窗 | `before.log` |
| 实际组件/回调专项 | 通过：入口、不导航、缺失名称不使用 preview、原始空格/空值/同名、关闭/取消/遮罩、IME、重复提交、焦点清理，以及 App RPC 成功/失败 | `focused.log`、`scripts/verify-sidebar-rename.mjs` |
| 完整标准 | 退出 0，含类型/构建/Rust check、automations 过滤单测及六个隔离协议探针 | `verify-all.log`、`standard-result.json` |
| release | 退出 0，121 个输入构建前后无变化 | `build.log`、`build-result.json`、`build-inputs-before.json`、`actual/build-inputs-after.json` |
| 当前原生 EXE | 隔离 home/profile；右键不导航→弹窗、中文文案、初值全选、取消关闭、保存后项目和最近列表均显示新名 | `actual/native-observations.json`、`actual/native-saved-tree.txt` |
| 真实数据读回 | 独立 app-server 只读 `thread/list`，同一隔离 thread ID 的 name 为“原生保存验收” | `actual/real-readback.json` |

产物为 `dist-artifacts/01B-rename-20261031/CodexNative.exe`，13,305,344 字节，SHA-256 `19236ca41d2140572de6281e1dcea141b56a88e34ec5b8addf733eb4e5c880d7`。未登录、未请求模型，未控制旧窗口。原生工具即时 accessibility 存在滞后，已稳定重读；首次缺少 screenshot geometry 的右键未执行，刷新截图后成功。截图仅工具现场显示，没有保存 payload，不能作为可复算的像素差异证据。

原生 `set_value` 请求带前后空格，实际读回无空格，因此本轮只能证明普通名称的真实持久化；保留空格/空值的保证仅覆盖组件→RPC 参数边界，不能声称服务端也保留。未实测物理 IME、Tab 环绕、Escape/遮罩、当前标题双击、失败 toast 的原生路径，也未证明官方乐观更新时序。header/项目页入口不在此次弹窗范围，但共用回调的失败反馈已改变；专项验证了回调，原生未覆盖这两个入口。

本轮没有新增全量 Rust 单测，无独立 lint 配置；标准不能替代原生和视觉。菜单仍为旧 HTML 结构，hoverCard、长列表/窄窗、官方同条件弹窗图以及用户验收仍未完成。01B 继续开发中，本增量待用户验收，不放行 01C，未提交推送。
