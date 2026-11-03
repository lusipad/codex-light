# 04A 项目身份、刷新与创建保护

日期：2026-11-01。状态：功能增量开发和专项自验完成，最终检查及构建以本轮证据为准；04 整页、原生与官方像素未验收。

## 依据与改动

先建立 [PI01–PI06 合同](../specs/04-project-index.md)，直接从固定官方 app.asar 提取 projects-index-page chunk，校验 archive integrity、文件及包哈希，见 [参考清单](../../../.ref/parity/04/runs/20261101-codex-project-identity/reference/manifest.json)。官方区分 localProjectId/projectId，Ri(group) 保留 projectId 与 rootPaths。此为静态身份证据，不是官方所有按钮行为的运行时证明。

- ProjectsIndexView 的项目新聊天入口传完整 Project，App 按 serverProjectId 匹配本地实体，复用既有 startNewThread 的原生持久化选择和多根目录上下文；共享首目录不会据路径选错项目。
- 未同步实体映射时显示错误，不按首目录悄悄新建到其他项目。既有纯工作区回退入口仍使用路径。没有新增身份猜测或自动注册。
- loadProjects 使用请求代次，过期成功/失败均不写页面；effect 清理使卸载后返回无效。复用原列表、错误和重连监听，不新增通用请求层。
- 新建项目用同步 ref 防重复 create；失败保留输入并释放锁。两个表单输入的组合输入 Enter/keyCode229 不触发动作；请求进行中键盘不清表单。
- 只有上述接线和状态修改，没有新依赖、服务参数或样式调整。删除了“新聊天使用第一个根目录”的误导标题。

## 验证

- `verify-project-index.mjs` 执行实际 page/App 回调，覆盖共享目录第二实体、完整 roots、未知映射、legacy 路径、逆序成功/失败、真实 effect cleanup、单次 create、失败保留与重试、IME 和 busy Escape。
- 既有侧栏项目选择、首次发送项目上下文、projects/sections 和 TypeScript 回归通过，确保本次复用的后续链路仍工作。
- [完整标准检查](../../../.ref/parity/04/runs/20261101-codex-project-identity/actual/verify-all-result.json)及 [日志](../../../.ref/parity/04/runs/20261101-codex-project-identity/actual/verify-all.log)包含隔离协议探针，不作为项目页真实新增成功证明。
- 浏览器回放使用完整生产 ProjectsIndexView（仅替换 bridge/project API imports 为隔离样本），App 入口回调直接提取。点击 Beta 得到 local-b/server-b 和两个 roots；创建表单回车添加根目录，名称保留且未提交。
- [browser-verification.json](../../../.ref/parity/04/runs/20261101-codex-project-identity/actual/browser-verification.json)和 1100×760、680×760 截图保留；窄窗 document scrollWidth=680。回放没有真实项目写入、删除、重命名或系统目录操作；旧时间和 output 为测试数据。
- [构建结果](../../../.ref/parity/04/runs/20261101-codex-project-identity/actual/build-result.json)、[输入绑定](../../../.ref/parity/04/runs/20261101-codex-project-identity/actual/build-inputs.json)、[产物身份](../../../.ref/parity/04/runs/20261101-codex-project-identity/actual/build-manifest.json)记录对应 EXE 和源码。既有 Vite 大 chunk 警告保留。

## 保留差距

未映射的服务端项目仍不能从此入口新建聊天；需要补本地实体注册/同步流程，不可拿路径相同作为同一实体。新建 server 项目与本地实体同步尚未闭环，必须作为后续功能缺口保留。

项目表格、完整官方编辑/来源管理弹窗、重命名/删除原生提示和列表错误/重试呈现仍未完成官方对齐。本轮仅避免数据错误，不代表页面可逐像素验收。原生真实创建、共享目录项目切换、重启持久化、账号隔离和官方等价场景待验。

下一批进入 05 文件工作面复核主要功能缺口；04 保留问题继续登记，不以页面轮换代替完成。未提交或推送。
