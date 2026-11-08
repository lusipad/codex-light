# 15E-A 设置内归档：本地投影增量自验记录

2026-11-06。状态：本地开发增量、聚焦回归、宽窄浏览器及真实Tauri容器闭环已验证，完整标准结果见下；待官方像素对照及用户验收。**不是完整归档页完成，也不是严格1:1通过。** 官方来源、资格和服务链见 [15E规格](../specs/15E-settings-archive.md)。

## 范围与数据

仅 `surface="settings"` 使用新结构；全局归档保持旧搜索/平铺/相对日期工作面。设置入口实际传入 workspaces、projectMembership、workspaceHints；默认global不调用新增项目投影。组件仍只读真实 `thread/list archived=true` 全分页，保留迟到回包、重复cursor、卸载、mutation同步锁、真实删除ID/部分失败和不明结果读回。

设置新增同一菜单内类型与排序（类型/排序方式标题、勾选、全部聊天/本地/云端、更新时间/创建时间/按字母顺序），按项目筛选、默认项目分组，选项目后隐藏组头。项目身份使用实体ID，不以名称合并；同名选项携带真实根路径title供共享选择器显示，仍需核对官方自定义tooltip形态。

归属优先显式projectless与持久workspace null override；非null workspace override覆盖旧thread assignment。本地assignment按实体ID或显式serverProjectId映射；失配依次hint/cwd规范化路径精确相等，且只接受唯一项目。子目录前缀、remote同ID、同根多个项目不得任选一个。复用 `buildSidebarProjectGroups` 的实体数据，不复用其侧栏前缀归属函数。workspace override属于本项目已存在真实持久状态适配，不能把其字段名声称为官方内部字段。

行标题为非链接span；使用中文资源“无标题聊天”，中文年月日/时分与全角逗号；更新时间构造日期无效才退创建日期，两者都无效不显示虚构日期。分组不重复repo，单组追加根名简写。排序严格使用有限原始秒时间与官方fallback，0有效，不套04E秒/毫秒启发式。时间降序→标题；字母标题升序→更新时间降序；组按成员最大所选时间降序→label→ID，字母模式label→ID。

## 有意义的回归与结果

先新增整生产组件执行的 `scripts/verify-archive-settings-projection.mjs`，旧源码真实红灯 `AS01: settings has an explicit isolated surface`，再实现。测试保留 Object.is 依赖缓存，不用每次强算useMemo掩盖缺依赖；读桥隔离且拒绝额外方法，不请求HTTP、不发模型。

| 检查 | 本轮结果 |
|---|---|
| AS01–AS10新生产回归 | 退出0：工作面隔离、默认/三排序与平局、同名ID、server映射、hint多根与props变更、精确唯一/子目录拒绝/remote隔离、projectless及workspace覆盖、搜索与刷新保留选择、只读投影、真实恢复回调及读回 |
| 组合菜单生产JSX/handler | 退出0：六项及双组选中、分组标题、Home/End/方向键循环、IME不改焦点、Escape回触发器、选择排序与关闭；共享触发器样式与嵌套radio样式有回归 |
| `node scripts/verify-archive-actions.mjs` | 退出0，AA01–AA06：全分页、重复cursor、迟到、取消、不明删除读回、恢复与卸载 |
| `node scripts/verify-archive-bulk.mjs` | 退出0，AB01–AB02/AB04–AB09：真实组件批量范围、确认、部分失败、不明结果与卸载；初次发现global无条件调用新项目函数后已修正，未用mock掩盖 |
| `node scripts/verify-archive-service.mjs` | 退出0，既有App真实服务动作与删除范围/锁/失败保护 |
| `node scripts/verify-archive.mjs` | 退出0 |
| `node scripts/verify-archived-settings.mjs` | 退出0，主线程维护的入口/回调/props接线回归 |
| `npx tsc --noEmit` | 退出0 |

本记录不把上述隔离hook回放当浏览器DOM、原生焦点、物理IME或官方运行时证据；完整标准、原生构建及截图对比由主线程统一补充，不重复运行Cargo或Git。

## 已知兼容差异与未测项

- 仅有本地app-server归档。云端菜单不隐藏，但选择后明确“云端归档尚未实现”，不显示空态或0计数；全部聊天明确当前仅本地、来源不完整。没有把本地thread ID当cloud task/ChatGPT ID，也没有新增云端HTTP/写入。
- 本地菜单可读能力沿用当前真实本地桥，尚未复刻官方local/workLocal资格和账号/gate状态；不能称API key、签出、全部计划资格已与官方一致。
- 定时任务菜单保留，但缺完整真实runs映射，明确映射未接入，不按标题/cwd猜身份、不显示伪空计数。尚无durable/remote/dot来源。
- 搜索为已登记的子串兼容，覆盖本地标题、项目名、repo简名；未引入Fuse，未宣称threshold=.4模糊匹配一致。标题markdown清理/rollout-path搜索仍未完全一致。
- 项目菜单复用共享选择器，官方分隔线/图标、宽度/高度token、自定义同名tooltip尚需校准。官方项目批量删除菜单未实现，保留真实单删/全本地删除，不能视为完整动作覆盖。
- “全部删除”始终原完整本地集合；云端模式按钮明确写“删除全部本地归档”，确认文案也明确本地，不因搜索/项目筛选缩小。这是防止来源误导的兼容呈现，并非官方原图像素结论。
- 真实恢复后状态“查看”、刷新/全删位置、兼容来源提示、页尾本地数量与官方仍有呈现差异。中文日期固定当前中文UI，未完成应用其他语言动态映射。
- 未作官方同DPI/缩放/语言/主题/客户区配对，视觉分数 **null**。浏览器与真实Tauri、焦点/物理中文IME及用户验收另行记录；没有借用E预览构建或04E结果。

## 主线程浏览器与原生闭环

证据根为`.ref/parity/15/actual/15E-settings-archive/`。真实React组件的隔离浏览器夹具在1280×800和640×800均无document横向溢出；宽窗内容768px、类型/项目控件150/180px、菜单220px。验证Home/End/方向键与Escape焦点返回、创建时间排序刷新保留、同名项目按ID仅显示所选组并含真实路径提示、云端/历史定时任务缺口不显示伪0结果、切回全局工作面不出现设置菜单。原始JPEG、输入哈希和结果在`browser/`。

主线程最后重新读取已安装Store版本并计算整包SHA-256，仍为26.1027.3384.0及`6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`，见`official-baseline-recheck.json`。官方DPI与App缩放仍未知，没有将本项目CSS尺寸作为官方物理像素测量。

首次原生集成发现SettingsView外层标题与归档内层标题重复，已先红后绿移除设置内层标题；最终浏览器和原生截图均只保留外层标题。原生采用当前生产dist加既有debug Tauri后端（Rust未改），不是新发行安装包；最终输入与EXE哈希见`native-verification.json`。

在私有CODEX_HOME通过真实app-server创建两条离线归档，无认证、无turn/start。原生设置入口读取到两条；实际点击取消归档后剩一条，独立app-server再次读取证明已恢复记录位于真实sessions且文件存在。未执行永久删除或真实账户写入。最终菜单与Escape关闭已复验，AX仍报告RootWebArea，精确原生焦点节点及物理IME未独立证实。窗口与私有服务器已关闭。原生数据/动作证据不等于官方配对像素或用户验收。

构建对应性核对另发现早期`index-B8WAxyRL.js`编译时点遗漏最后根目录判断调整；早期截图与2→1恢复证据保留为该产物的限定结果，不能冒充最后完整源码。随后将标准检查生成的`index-BLPnHVo5.js`及CSS固定复制到`native-dist-final/`，保存全部src与产物哈希后重新启动原生容器：单标题读取剩余1条、实际取消归档至0条、菜单/Escape通过；独立app-server重新读取确认两条rollout均位于sessions且真实存在。`native-final-current.jpg`、`native-final-empty.jpg`、`native-final-readback.json`及`native-final-inputs.json`为最终证据，关闭后再次校验输入与冻结产物哈希不变。没有将构建完成时间晚于源码修改时间当作必然包含该修改的证明。

## 原生集成发现后的最小修正

真实原生集成截图发现设置外层与ArchiveView内层重复标题。新增AS01结构回归先真实红灯（1个内层标题，预期0）后，仅settings不再渲染内层标题/副标题容器，header保留动作并右对齐；global标题与说明保持。聚焦AS/ARS/AA/AB回归重验通过。最终单标题截图与构建范围见上文主线程记录。

## 最后来源核对：归属路径身份

研究确认官方Pa为app-shared的EY（UTF-16锚点与原文见spec）：归一反斜杠并小写、合法扩展前缀、Windows盘符映射/mnt、WSL UNC去发行版；xDn再去尾斜杠。新增settings专用archiveProjectPath，显示repo继续使用原大小写路径函数，global不受影响。AS05先在d:/extra大小写用例红灯后，大小写、盘符与/mnt别名、扩展前缀、WSL及归一后碰撞唯一性全部绿；AA/AB/ARS重验通过，tsc退出0。未扩展其他服务或UI。

## 完整标准收尾

`pwsh -NoProfile -File scripts/verify-all.ps1`非Fast最终退出0，32个真实隔离协议探针全部通过，日志374条双空格PASS记录、零FAIL，见`verify-all.log/exit`及`final-result.json`。其中含最终AS/ARS、共享选择器与受影响页面回归、TypeScript和生产前端构建。Rust为脚本指定的分组回归，未另跑全库cargo test；没有新增独立lint配置，不编造lint结果。存在既有Rust dead_code与Vite大chunk警告，未当成失败或静音。

最终生产构建、冻结产物与原生复验已闭环；没有新打MSI/NSIS、没有推送或更新下载版，也没有宣称官方像素、完整云端功能或用户验收通过。后续较大阶段统一决定推送与新版本，本单元仍为15E-A本地增量。

## 26.1103.4239.0 本地删除范围

- 核对新版官方只对本地宿主展示归档会话的永久删除，并在本地类型、所有项目及空搜索时显示全部删除。普通云端会话仍可恢复。
- 设置的具名项目组提供项目删除菜单。确认时复核当下可见的本地 ID，原生将它们与最新本地归档集合求交。回归覆盖取消、筛选变化、同 ID 的云端条目、已恢复的会话、重复 ID 和部分失败。
- 1280×720 隔离浏览器验证取消零模拟写并回焦，确认后仅提交项目一的目标 ID，项目二及同 ID 云端行保留。证据在 `.ref/parity/22/actual/22J-cloud-publish/archive-project-delete-browser/`。没有对真实会话执行删除，Windows 原生 GUI 与官方同条件像素待验。
