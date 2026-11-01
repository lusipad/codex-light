# 01B：客户端归属与显式无项目优先级

2026-10-31，修改前合同。上一轮既有工作区映射及原生旧/新对照已完成，本轮继续01B，未进入01C。

固定shared SHA1ffb0654bdfcba23be50c06c8698e665bdb17330d923758001d01262aa81cb5b：GRn3657285用workspace state覆盖threadProjectAssignments和projectless集合；Man2931479按projectMembership??project取归属；xP2007608定义thread-workspace-state-v1:<id>。rL2232320和lq3513172通过persisted atom store读取/发布，并不是裸localStorage key。

main SHAd33ed281dc58766cbbccb8e92a7149268a528901de8858c2d69750d12c6c205b的sendPersistedAtomState2102118从electron-persisted-atom-state读取并同步给窗口；updatePersistedAtomState2102551写回其嵌套记录。因此本轮从当前DesktopStateManager的嵌套atom快照提取相关归属，不扫描官方WebView或用户浏览器存储，不写入迁移/归属数据。所有定位0-based UTF-16。

实施顺序：Rust只读提取全局assignment/projectless及有效workspace state→既有threads_meta_get附加紧凑成员快照→App按既有generation接收并传Sidebar→Sidebar用workspace state覆盖全局assignment/无项目，再走canonical映射与legacy路径回退。

验收合同：workspace projectMembership优先且nullish回退project；有效无归属state显式projectless；匹配assignment胜过旧projectless标记；remote/未知本地assignment不得落入任意本地cwd；无客户端标记的canonical null仍走既有legacy路径，不自动视为projectless。无效缓存不伪造“无项目”。成功创建/派生的显式新项继续走同一归属解析。

先实际Sidebar/元数据回归失败→实现→Rust全量、实际刷新回归、完整标准、release和专用离线历史的真实原生旧/新对照。产品限state/lib/types/App/Sidebar所需读取与传递，无新依赖/CSS，不实现新的移动/新建归属写入流程。完整项目实体、多root、客户端归属写入、跨窗口文件监听和官方同条件像素仍未完成，01B不因此验收。

## 实施与测试

- Rust只读提取有效assignment、字符串projectless ID和嵌套atom归属；输出仅含成员信息，不传递applied/pending等无关运行时数据。无效缓存不生成无项目标记，顶层同名decoy不被当作atom。
- 既有threads_meta_get附加projectMembership；App和Sidebar复用该快照及现有归属解析，客户端workspace条目通过“key存在且值null”区分明确无项目与不存在。workspace覆盖全局assignment/无项目，匹配assignment胜过旧无项目标记，其后才走canonical映射与legacy cwd。
- App等待元数据成功后同步发布工作区身份与成员快照，防止新身份/旧成员混用。任一IPC失败保留上一整份快照，不再部分发布；旧generation仍拒绝。此处有意收紧上一轮“单边成功仍发布”的行为，回归已对应这一一致性要求更新，没有忽略失败。
- 产品仅state.rs、lib.rs、types.ts、App.tsx及CodexSidebar.tsx，无新依赖/CSS或数据写入API。两个现有测试脚本扩充，无新标准入口。

证据根目录`.ref/parity/01/runs/20261031-codex-01b-client-membership/`，官方原片段/哈希在`reference/static-evidence.json`。

| 层级 | 结果和证据 |
|---|---|
| 实际Sidebar回归 | `cases/sidebar-before.log`退出1，workspace/global/projectless被旧canonical/cwd覆盖；after退出0。覆盖workspace优先、明确null、global匹配、旧projectless、remote隔离、legacy null及快照替换 |
| 实际App刷新回归 | `refresh-before.log`退出1，新workspace在metadata未返回时已暴露；after退出0。既有stale、失败及新快照一致性检查通过，错误时整份保留 |
| Rust全量 | `rust.log`退出0，34 passed、0 filtered。新增原始嵌套atom、projectMembership/nullish兼容、无归属、remote、坏缓存/空记录和top-level decoy断言；非仅标准automations过滤 |
| 完整标准 | `verify-all.log`退出0，非Fast，含类型、前端构建、cargo check、标准Rust过滤及原有真实协议探针。无独立lint配置不报通过。独立CODEX_HOME/空API keys |
| release | `release.log`退出0，115输入、5dist、4检查脚本归档并在构建后核对，见source/frontend-dist/checks/build-inputs/build.json |

## 原生相同数据旧/新对照

`make-native-setup.mjs`基于前轮已核验fixture脚本生成本轮脚本，检查每个替换锚点存在；最终native-setup.mjs与请求记录均保留。只复制明确离线回放sessions，真实CLI创建三个canonical项目并分配同cwd历史，未调用turn/*、未生成回复，服务正常退出。全局assignment/projectless和嵌套atom是本轮专用home中的明确测试场景，不冒充官方运行时采集；复用本应用专用WebView profile，Recent项目包含关闭。

| 样本 | 旧workspace-identity构建 | 当前构建 |
|---|---|---|
| STATE-OVERRIDE：canonical A/global A/旧projectless，atom legacy project A但projectMembership B | A | B |
| STATE-NONE：canonical B/global A，atom project null | B | Recent |
| GLOBAL-ASSIGN：canonical C、global A且旧projectless，未设atom | Recent | A |
| PROJECTLESS-LEGACY：canonical null、cwd Legacy、显式projectless | Legacy | Recent |
| REMOTE-ASSIGN：canonical null、cwd Legacy、远程assignment | Legacy | Recent |

`actual/old.jpg/.txt`和`new.jpg/.txt`保存结果；对UIA以项目标题/Recent边界独立断言，见native-verification.json。普通无标记legacy历史仍显示。核对两个workspace atom的关键值保持原样；读取路径没有新增写入操作。测试先定向Raise并核对截图目标，旧/新进程均正常退出。

当前EXE：`dist-artifacts/01B-client-membership-20261031/CodexNative.exe`，SHA-256 `7387f31bbc4db38fc2ba8682dbb56cf6e3a0ab33588c49d944ce9ffe38de18d1`，13,286,400字节。HEAD380c32c7加归档未提交工作树，不能仅用HEAD代表全部源码。未提交推送。

## 验收边界与下一步

限定的客户端成员读取、优先级与上述原生场景自验通过；01B整体仍开发中、未用户验收。本轮只消费已有缓存，不表示已实现移动/创建项目的客户端写入、事件广播或另一进程文件变更监听。归属仍针对既有目录行ID；完整local-projects实体、多root、共享roots、导航/新建项目选择仍须继续。

官方运行时同场景尚未对照；原生样本是明确构造的缓存冲突，不宣称官方gate/账号行为通过。窗口截图JPEG仅功能证据，无同条件官方无损参考，不评分像素一致。下一步按local-projects真实ID接完整实体，不能用目录投影去重来合并项目身份。
