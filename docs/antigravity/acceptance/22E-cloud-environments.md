# 22E Codex 云端设置：准入、目录和同页配置纠偏

2026-11-07。本轮本地检查、最终构建与生产EXE未登录入口验证完成，待用户验收；不是整页完成。基准与开发前动作合同见[规格](../specs/22E-cloud-environments.md)。本阶段不包含在已推送的preview.7候选6ecee66160df74b0a89d89ccf6b4d8ae347d2436中。

## 来源与改动

- fresh官方55资源/74锚点/75中文及schema的hash、完整函数、UTF16定位已核。新页使用svt/Tv直接cloudAccess；不是Legacy wham hook或GPT入口权限。标题补证为实际settings.nav.codexCloud“Codex 云端”。未访问官方GUI/账号，未重启或修改官方安装包。
- 新cloudEnvironmentAccess复用真实身份、原始accounts map、Statsig读取和最终身份确认。六个人计划、rollout关闭、workspace permission/wham分支按原函数分开；RBAC/manage独立。未知/外来/增量快照不可升级为允许；完整快照限制属于适配边界，不声称官方必需has_updates。固定cloud_workspace_settings GET由身份生成路径，不接受renderer账号/URL/header。
- 数据summary保留description/versionRevision/isOwner，显示四分享状态和真实未发布标记。草稿仅覆盖配置字段，根名称/说明不从草稿伪字段取；继续保留已有真实network/repositories/cwd/script/startSkill/secret元数据，不展示secret值。
- 双scope每轮Promise.all共同成功才推进，已结束scope不重复读；任一范围或后续页失败整体reject，不再返回部分目录为成功。空页游标、轮次覆盖去重、重复cursor、取消均保留或纠正。
- 云页面改为768内容上限的设置行、128共享列、32操作列、512容器断点（官方32rem按16px换算）、搜索/环境页签和菜单；从菜单查看切到同页配置，取消返回原行操作焦点，不再使用dialog/inert。复用真实读桥和仓库解析，不新建dashboard卡片或假运行状态。
- 现设置增加codex-cloud真实入口，与已有云端偏好设置分开；保留Explore入口，App仅修本页额外route padding/960宽限制。wrapper对云设置不再重复渲染外层标题，原其他设置入口/别名/导航guard回归保留。
- 监听确认后才读，失败可重试，迟到退订正确；目录与旧仓库名异步按请求序列隔离，避免仓库名未解析时阻塞无匹配刷新或晚到覆盖新结果。无匹配300ms刷新保持稳定query只一次。

## 实际验证与失败记录

证据根为`.ref/parity/22/actual/22E-cloud-environments/`，未提交脱敏fixture之外的真实账号数据。

- 准入：旧workspace incomplete路径实际红exit1；修后7组真实wrapper/rawmap离线回归exit0；新增固定GET/参数先于认证/网络拒绝不发包的Rust聚焦1过、562过滤、exit0。未将聚焦测试当全库。
- 数据：第一红2过6失败，补分页屏障红9过1失败，最终11组通过；保留真实字段、全范围失败、页序、去重、取消、仓库名搜索及secret omission断言。
- UI：保留原数据不变量；旧partial-success期待在新合同下先失败，再改正确整体reject；新11组真实JSX/hook回归覆盖listener确认与失败/晚退订、gate拒绝/未知不手动绕过、空/错/加载、四状态、骨架、搜索、同页错ID/重试/draft、取消/换号/卸载和IME Escape保护。补仓库名刷新用例以仅撤销本次序列修复的前版本快照先红（第二目录期待2实际1）后绿，旧name不能覆盖新name。
- Settings实际wrapper回归先红26!=25（新增已取证入口），补第26路由、实际Codex云端中文、专用组件和唯一标题断言后通过，不删除原25入口/别名/guard验证。
- 浏览器运行真实CloudEnvironmentsView、准入、decoder/client/service wrapper和CSS，仅IPC/event为明确离线host。CSP connect-src none，无HTTP/模型/写操作。1571产品/依赖输入收据与输出hash留存；不是ASB真实集成。
- 1280×800最终页宽1280、内容768；640内容577保持横排，540内容477按512断点纵排，共享列头隐藏；均无横向溢出。4行、四共享状态、description、revision1、首仓库+N和草稿仓库实测。夹具初始缺flex父容器造成底部55px空隙，仅修夹具匹配真实App上下文，最终页底800；旧测量保留。
- 菜单查看→同页草稿→取消，dialog0/inert0、焦点返回原行；详情错误/显式重试恢复；暂停旧详情后改变身份/资格，释放旧结果，form0/row0且不可用状态不被覆盖。控制台error为空。JPEG截图`browser/final-wide.jpg`、`narrow640.jpg`、`detail.jpg`只作结构证据，不是无损配对像素。
- 原生独立组件宿主已准备但未完成交互：自己的测试窗口被最小化，工具检测到用户输入后停止操作；未把文件目录入口当组件通过。临时进程已清理、原index恢复并核hash。对应结果记录not-completed，后续重验原生生产EXE。

## 明确差距

本阶段配置展示仍只读；创建setup聊天、createDraft编辑、配置保存/冲突、删除及保险库未接完，控件明确禁用。查看菜单即使编辑权限允许仍可读，是当前适配差异，不能说已复刻完整官方编辑菜单。配置分组/表单字段、图标轮廓、Tooltip、菜单跟随滚动、详细权限/说明状态及Legacy迁移尚未完整对齐。新增设置入口未按完整官方设置导航门槛隐藏，直接页面读取仍严格按资格控制。

真实账号HTTP、官方同环境配对图/DPI/zoom、物理中文IME、多窗、最终原生交互和用户验收尚缺；visual score=null。自动回归、发布成功与阶段提交不能替代整页1:1。

## 最终验证和交付候选

当前668产品/检查输入在全库、标准和构建前后稳定。全库Rust **563通过，0失败/忽略/过滤**，324.62秒；累计前端75回放exit0；完整非Fast标准**330段/32协议探针**exit0；类型/Vite、通知适配器及原生debug构建均通过。现存unused cancel_owner及Vite chunk提示非本轮错误，未为消除提示改动无关代码。

最终EXE：`dist-artifacts/cloud-22E-20261107/CodexNative.exe`，SHA256 `884effe0eb79e4827b2d0f2c1b6d5c820019bbe425d3c2292de2132f75456d63`，3构建资产/5许可及668输入收据同目录。生产EXE使用私有CODEX_HOME/WebView与CLI0.165.0，实际Control+,打开设置，Unicode设置搜索找到Codex云端、新设置入口与Explore独立路由均显示真实未登录错误，两处重试保持错误，未产生伪造目录。Alt+F4正常关闭、PID消失；只读SQLite确认0会话。截图为JPEG且UIA曾短暂返回上一页树，实际视觉与稳定后树交叉核对；没有用旧元素索引冒充成功。

该生产错误路径通过不补成独立正常原生组件通过；早先组件宿主中止记录保留。正常配置/菜单/Tab顺序的原生场景、真实账号HTTP、物理IME、多窗、官方配对像素及用户验收仍待完成。本阶段可交付待用户验收，整页写链和完整1:1未完成。
