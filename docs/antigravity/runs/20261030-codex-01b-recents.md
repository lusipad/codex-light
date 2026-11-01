# 01B续：合并列表与最近项目包含

2026-10-30，修改前合同。01B整体仍开发中。

固定initial SHA577a50e29502f573e2fbccf4940b9bd875339db420d6d5a9798a0d201ee0aff1，shared SHA1ffb0654bdfcba23be50c06c8698e665bdb17330d923758001d01262aa81cb5b。0-based UTF-16。

- initial TZn2633582后：list返回全部threadKeys，加独立置顶/其他专门区域；“最近是否包含项目”不能过滤合并列表。
- sQn2649085：project模式的chats菜单提供recents-show-projects checkbox，文案中文“显示”“项目”；点击反转sidebarShowProjectsInRecents。shared1988572：该偏好default:true。
- n4o8060830：该复选项只在可按项目组织且mode=project的chats菜单出现。排序wZn2633582同时修改chatSortMode/projectSortMode，本项目当前统一切换没有该项语义分歧。
- 当前实现的“仅独立无项目会话/仅当前选定项目/显示全部聊天”三选项及其对合并列表的过滤不符合上述合同，应替换。

计划：实际组件先失败→复用现有getThreadWorkspace分组结果，合并模式无条件显示未置顶聊天，项目模式仅由包含开关决定Recent→本应用布尔偏好保存与旧显式选择迁移→回归模式往返、项目/独立/置顶、默认值/重建→标准检查与原生操作。

范围仅CodexSidebar及回归；不新增依赖或CSS。旧filter scope显式all迁移true，projectless/current迁移false；没有旧选择时采用官方true。偏好只写本应用新key，不写官方配置。项目assignment仍使用既有实现，归属的准确性不是本轮通过结论；活动视图维持既有独立列表。菜单二级结构、远程主机分组、账号专属过滤及视觉仍需后续完整对齐，不据本轮合同宣称菜单完成。

## 实现与结果

限定合同自验通过，待用户验收；01B整体仍开发中。

- 仅产品文件`src/components/CodexSidebar.tsx`：删除filterScope三分支，改为showProjectsInRecents布尔状态；合并列表不受开关影响，分组Recent按开关包含/排除项目副本。复用既有项目解析、置顶排除和排序。删除本轮失去用途的activeWsKey与“当前项目独立聊天”分支，无新依赖或CSS。
- 本应用新存储key为`codex_sidebar_show_projects_in_recents`，保存true/false；显式新值优先，旧选项按修改前合同迁移，不删除旧key，不写官方偏好。
- 菜单仅在项目模式提供“显示 / 项目”menuitemcheckbox、aria-checked与选中符号。原有菜单组织/排序仍是平铺布局，组切换后菜单仍开着；这些差异没有被本轮功能检查放行。

证据根目录`.ref/parity/01/runs/20261030-codex-01b-recents/`。`reference/static-evidence.json`含实际文件SHA与片段；中文来源SHA为c6ac10a9fb407a393ea002d9aa818a4c7ed0e215e9c8bf0cfe2b798a98e3756f，与前轮archive integrity证据一致。

| 检查 | 证据/结果 |
|---|---|
| 实际组件修改前 | cases/before.log退出1，默认Recent缺project-a/project-b副本 |
| 实际组件修复后 | cases/after.log退出0，覆盖官方默认、checkbox、合并列表独立、模式往返、置顶独立、保存重建和旧显式值迁移；受控React/服务边界仅L2 |
| 既有组件回归 | 同after.log：折叠、5/15/25分页、置顶存序、最近时间、手动拖动/取消、键盘相邻移动均通过；旧项目行样本显式配置包含=false以隔离重复展示，默认=true有独立断言 |
| 完整标准检查 | cases/verify-all.log退出0，含类型、前端构建、Rust检查、17项automations单测、现有真实协议探针；13项Rust被过滤，不是全量Rust。隔离CODEX_HOME并清空API keys，不请求模型生成；未配置额外lint不报通过 |
| release构建 | cases/release.log退出0；build-inputs.json记录115项源码与5项dist，source/和frontend-dist/归档；build.json核对身份 |

当前EXE：`dist-artifacts/01B-recents-20261030/CodexNative.exe`，SHA-256 `0e80c789fd5f6b02f534cdfcfdb46cf2eab21be0d60bbaef7dd204813db67650`。基准380c32c7及现有未提交改动构建，不能把整份diff算成本轮改动，未提交推送。

## 原生复测

使用前轮本应用专用native-home/native-webview-profile（01b-manual/native-fixture.json所列绝对路径），真实CLI读取28条明确离线回放语料，不是模型生成。未发送任务、未改官方配置。

- `actual/default-projects-included`：项目树5条+Recent28条，共33个聊天行，包含项目副本。
- 取消“显示 / 项目”后，`projects-hidden`仅保留项目树5条，Recent空。
- 切合并列表后，`merged-menu`与`merged-list`均为28条；菜单不再提供仅控制分组Recent的checkbox，列表没有被旧false偏好过滤。
- 完整退出，确认旧进程结束，再启动同一EXE：`restart-merged`仍28条；切回项目：`return-projects-off`仍仅项目树5条，checkbox未选中，证明包含偏好保留。
- 每项保存JPEG动作截图及UIA TXT。UIA包含滚动视口外的控件，33/28是可访问树中的总行数，不是声称一屏物理可见这么多行。菜单动画后取稳定截图，必要二次刷新消除UIA旧树滞后。

## 未完成与下一步

官方显示参数用户答复未知，无同条件官方无损图，不能进行有效像素评分；本轮没有声称几何/颜色一致。完整菜单需继续按n4o的组织/排序二级结构改造，并对共享菜单的radio/checkbox、焦点、子菜单、滚动/边缘定位逐项验证；中文“分项目显示 / 合并显示”等既有标签差异仍需一起修正。拖动ghost/指示器/动画、多项目assignment、跨组/置顶重排与官方运行时正反向对照仍未完成，01B和首页整体均未验收。
