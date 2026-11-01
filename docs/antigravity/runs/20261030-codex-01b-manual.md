# 01B续：手动排序

日期：2026-10-30。上一轮排序缺陷已有源码、回归与原生证据，本轮继续01B手动排序；目标仍为逐页推进，不放行01C。

## 修改前合同

固定initial SHA577a50e29502f573e2fbccf4940b9bd875339db420d6d5a9798a0d201ee0aff1、shared SHA1ffb0654bdfcba23be50c06c8698e665bdb17330d923758001d01262aa81cb5b，位置均为0-based UTF-16。

- 菜单n4o8060830仅updated_at/manual；b_n2050016将旧created_at/priority归一为updated_at。中文语言包经archive integrity核验，分别为“最近更新”“手动排序”“聊天排序方式”。
- Mlo6786199、J2o8059726、q2o8059515：仅manual模式提供重排/保存；拖动不能偷偷把updated_at切manual。
- shared Xjt2001749按可见项原slot替换，保留隐藏和未加载ID位置；不能以当前可见5条覆盖完整历史order。
- initial $O1982451：pointerY小于目标行中线为before，否则after；本轮只做同列表内排序，不借拖动实现跨项目迁移。
- 项目历史未存项TIn2375538追加尾，Recent dmn1988503未存项放头。显式新建xUs9290671仅成功created回调执行W0n2707230→Qjt2002141 prepend，不因普通历史读取或thread/started通知前置。
- 切manual时G2o80589xx初始化缺失可见order，已有order不覆盖。

计划：新增项目/Recent共用纯排序函数→实际组件失败用例→模式、拖动、存储、隐藏项和新建回归→标准检查→原生隔离回放鼠标拖动及重启。沿用本应用localStorage偏好作用域，不写官方设置；不新增依赖。

允许产品文件：sidebarOrder.ts、CodexSidebar.tsx、App.tsx。置顶维持前轮独立存序；本轮不增加跨项目迁移或置顶重排，不改CSS。菜单布局、拖动指示器与键盘重排仍需独立原生/视觉核查，不预先标1:1通过。

## 实现与验证结果

状态：本轮限定功能自验通过，待用户验收；01B整体开发中，未放行01C。

- `src/sidebarOrder.ts`复用同一组纯函数处理完整存序、可见槽位替换、历史发现与成功新建。隐藏/未加载ID不因当前只显示5条而被删除。
- `CodexSidebar.tsx`提供“最近更新”“手动排序”，旧模式归一；项目与Recent分别保存顺序。仅手动模式允许主指针左键拖动，欧氏移动距离大于6才激活，按目标中线判定前后。拖动完成抑制误点击，取消不改顺序；输入框和子按钮的排除是本项目事件隔离措施，不宣称已证实官方统一过滤器。
- `App.tsx`仅在真实创建/派生成功路径记录新ID，移除发送路径缺ID时伪造thread ID的回退。普通历史读取或通用通知不触发显式新建前置。新建路径本轮覆盖组件合同，未请求模型生成验证完整发送链。
- 保持Tauri原生拖放配置，使用Pointer Events，未新增依赖或CSS。原有菜单布局与分组结构的差异未在本轮扩展修复。

证据根目录：`.ref/parity/01/runs/20261030-codex-01b-manual/`。`reference/static-evidence.json`保存官方原文件定位片段；中文语言包沿用前轮已核验integrity的文件。`reference/environment-status.json`保存用户答复“未知”，官方缩放、DPI、语言、主题不据本应用截图推定。

| 检查 | 结果与证据 |
|---|---|
| 修改前失败 | `cases/before.log`缺少手动模式；`cases/menu-close-before.log`捕获选项未关闭菜单 |
| 排序纯函数 | `node scripts/verify-sidebar-order.mjs`退出0，`cases/after-order.log`；保留隐藏槽位、未知项头/尾、非变异、无效移动 |
| 实际Sidebar组件 | `node scripts/verify-sidebar-projects.mjs`退出0，`cases/after-sidebar.log`；模式、存储、重启重建、发现历史、新建、阈值、取消、跨组拒绝及既有折叠/分页/排序回归 |
| 完整标准检查 | `cases/verify-all-delivery.log`退出0；含类型、前端构建、Rust检查、17项automations单测及现有协议探针。13项Rust被过滤，不能称全量Rust通过 |
| 最终release | `cases/release-delivery.log`成功；`build.json`对应115项源码输入和5项dist哈希，归档为`delivery-source/`、`delivery-frontend-dist/` |
| 原生拖动与重启 | `actual/delivery-start`顺序05/01/02/03/04 → `delivery-drag`顺序01/05/02/03/04 → 完整退出并新进程启动`delivery-restart`顺序不变；拖动未打开聊天 |
| 原生模式切换 | `delivery-updated`恢复01/02/03/04/05；`delivery-manual-return`恢复01/05/02/03/04；两个选项均关闭菜单 |
| 原生展开 | `delivery-expanded`显示15条，06–15保持完整顺序；每项均保存JPEG截图和可访问性树TXT |

原生使用真实官方CLI与28条明确离线回放历史，见`native-fixture.json`、`cases/native-fixture-setup.json`。这不是模型生成对话；没有发送付费任务。仅进程内设置隔离`CODEX_HOME`及`WEBVIEW2_USER_DATA_FOLDER`，不改全局环境或官方配置。后者的覆盖行为见[Microsoft WebView2文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl?view=webview2-1.0.4258.31)，隔离profile实际目录记录在`reference/webview-profile-isolation.json`。

最终可运行构建：`dist-artifacts/01B-manual-20261030/CodexNative.exe`，SHA-256：`5621551f8ad12c098602b38ca057590763de1b1e8acf76db3ff9d9c20460b05c`。`pre-menu-close.exe`和旧`source/`是保留的前迭代证据，不是最终构建身份。基准提交仍为`380c32c7b6e3d1ce6cabcf49c7b5ca07b1b76ec7`，包含已有未提交改动，不能把全部diff归为本轮修改；未提交或推送。

## 剩余门槛与下一步

没有同条件官方无损参考，无法进行有效像素相减或评分；本轮JPEG只作动作证据，不支持1物理像素一致结论。结构化状态记为不可评分/需继续，0是缺少基准的占位信号，不是实测相似度。

继续调研并逐项实现键盘重排、拖动指示/中间态及菜单结构；多项目assignment/projectless归属、跨组迁移、置顶拖动和共享偏好跨窗口/主机行为仍需各自合同和验证。不得以当前同列表重排替代这些要求。用户尚未验收本轮或01B整体。
