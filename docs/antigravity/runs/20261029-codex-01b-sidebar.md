# 01B：本地项目展开/收起

日期：2026-10-29。用户授权继续下一单元，按既定顺序推进01B；不等于用户已验收01A或首页整页。

## 开发前调研与动作合同

官方固定候选资源：initial SHA `577a50e29502f573e2fbccf4940b9bd875339db420d6d5a9798a0d201ee0aff1`，shared SHA `1ffb0654bdfcba23be50c06c8698e665bdb17330d923758001d01262aa81cb5b`。以下位置是零起始UTF-16字符偏移。

- initial2267116：本地项目group包含path、projectId、projectKind:local。8476544的Pos→qas明确传projectRowBehavior:expand，经8428390传给8434909的cos。普通点击分支执行Je→ODe，打开项目页是另一条件分支，不能混用。
- shared5422205的E0r切换本地项目展开存储，5424845的t2r仅把严格false判为折叠；未存储时默认展开。存储key为sidebar-project-expanded-v1-加项目身份。
- initial7300803的G0给项目行传onPress及aria-expanded，6815491的Guo使用role=button、tabIndex=0；5849466的bAa仅在事件目标为行本身时处理Enter/Space。
- 新建按钮8459095的xos独立调用onStartNewThread。不能把项目行展开操作变成选择工作区或新建会话。
- 未证实folder hover替换chevron，不实现猜测图标。当前背景、行高、侧栏宽度均不据截图换算改写。

## 差异与计划

1. A10-01：当前点击项目文本只选择工作区并强制展开，只有文件夹图标能折叠。改为整行统一toggle；回归：行/图标点击与Enter/Space均执行一次，不调用选择工作区或新建。
2. A10-02：当前只有活动项目默认展开，且重挂载后丢失折叠状态。改为默认展开，按规范化路径保存本应用的独立展开状态；不写官方存储或真实账号配置。回归：项目之间独立、切活动项目不改变展开、侧栏隐藏恢复及重挂载保留、坏存储回退。
3. A10-03：项目行缺role与展开语义。补充button、aria-expanded与项目名；子按钮按键不触发父行。

允许产品文件：CodexSidebar.tsx；测试新增verify-sidebar-projects.mjs并接入标准检查；仅移除本次造成的未使用函数。不改排序、分区协议、其他页面或CSS。

验证：实际组件先失败→修复→正反交互及持久化回归→标准检查→对应源码release真实侧栏折叠/展开与键盘验证→记录构建输入和证据，待用户验收。

## 本轮限制

官方每项目线程还有5→15→25条增量显示，且“仅剩一条”取决于后续页标志。当前App的thread/list仍截取首批50/100条，缺分页完整性，不能顺手把已加载数组当全部历史。本轮先修复A10，长列表/分页、排序与逐像素视觉仍未验收；不将局部修复报成01B整页完成。

## 自验结果

- `verify-sidebar-projects.mjs`执行实际组件及原处理函数，初次失败退出1（非当前项目错误默认收起），修复后退出0。覆盖默认展开、整行与键盘toggle、子按钮键盘隔离、新建动作独立、项目间独立、切工作区、隐藏/恢复侧栏、重挂载、Windows路径等价、快速重复点击和损坏缓存回退。测试边界的服务、React调度和存储由受控替身提供，属于L2，不能独立证明浏览器冒泡或真实服务。
- 临时目录反证：行点击改为空操作后失败；持久化改为空操作后失败。结果见cases/mutation-checks.json，未改工作树产品实现。
- 完整verify-all退出0，包括本轮组件及上一轮窗口状态回归、TypeScript、前端构建、cargo check、17项automations单测（13项过滤）、87项协议形状/附件检查与6项空闲边界。没有独立lint配置，不报告lint或全量Rust通过。
- release构建退出0。114份构建输入与dist均实存归档，构建前后及归档哈希一致，EXE路径/大小/SHA见build.json。归档包含已有脏修改，不全部归于本轮。
- 原生基线已复现点击项目名称仍保持展开。新EXE实际验证：默认展开→点击文本收起→Enter展开→Space收起→退出整个应用→重启仍收起→点击文件夹图标展开。首页与工作区上下文保持，没有发送模型任务或新建聊天。测试后恢复项目展开并退出。
- 原生使用独立CODEX_HOME和真实官方CLI，不复制认证，不触发沙箱安装。当前沙箱未配置提示原样保留。截图为工具生成JPEG，仅作操作结果证据，不能用作无损逐像素通过。

产物目录：`.ref/parity/01/runs/20261029-codex-01b-sidebar/`。

| 文件 | 证明内容 |
|---|---|
| reference/static-evidence.json | 固定官方文件哈希与调用链片段 |
| cases/before.log、after.log、mutation-checks.json | 组件失败/通过及反证 |
| cases/verify-all.log、release.log | 完整检查与原生构建退出结果 |
| actual/before-project-row-click.jpg及同名.txt | 基线点击项目文本不能收起 |
| actual/after-project-collapsed.jpg及同名.txt | 新版整行收起 |
| actual/after-keyboard-enter-expanded.jpg、after-keyboard-space-collapsed.jpg及同名.txt | 真实键盘展开/收起 |
| actual/after-process-restart-collapsed.jpg及同名.txt | 完整进程重启后保存收起状态 |
| actual/after-folder-expanded.jpg及同名.txt | 图标与整行同一展开动作 |
| build-inputs.json、build.json、source/、frontend-dist/ | 源码/前端资产/产物身份与实存归档 |

可运行构建：`dist-artifacts/01B-sidebar-20261029/CodexNative.exe`。

**交付状态：A10本地项目展开/收起自验通过，待用户验收；01B整单元仍开发中。** 原生只覆盖一个真实项目、空会话列表，多项目状态隔离由L2覆盖；未验证长列表分页、真实多项目排序/菜单及官方同环境像素，不进入01C。
