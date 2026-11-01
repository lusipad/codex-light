# 01B续：会话分页与项目增量显示

日期：2026-10-30。持续目标为逐页推进，仍处理01B，不将前轮局部自验当作整页验收。

## 开发前合同

官方initial SHA577a50e29502f573e2fbccf4940b9bd875339db420d6d5a9798a0d201ee0aff1：gos8455764与Dos8468812定义每项目初始5条；Ofo6865500–6874300定义每次增加10条、限额外追加选中项、无后续数据且仅剩一条时全部显示，不默认提供收起按钮；中文sidebarElectron.showMore为“展开显示”。main SHA d33ed281dc58766cbbccb8e92a7149268a528901de8858c2d69750d12c6c205b的3123285为全局thread_catalog adapter，使用updated_at/desc、archived:false、useStateDbOnly:true与不透明cursor，不直接按cwd过滤。shared2629500的旧recent读取链成功返回后才推进cursor，并防止重复cursor循环；不声称这是现代catalog的全部实现。

当前协议ThreadListParams/Response明确支持cursor/nextCursor。当前App只取首批50/100条，导致旧会话不可达；Sidebar将当前已加载项目会话全量渲染，不符合初始5条规则。

## 实现选择与范围

1. App当前多个页面共用threads目录。本轮沿用这一路径，分页读取完整目录后再提交快照，避免用截断目录计算“空项目/无更多”；不直接复制官方catalog内部体系，不新增项目级cwd请求。代价是大型历史目录初次刷新需读取多页，性能与渐进加载呈现仍须后续量化。
2. 只在首次DB读取失败/完整结果为空时沿用现有修复扫描兼容分支；中间页失败不提交部分列表，也不把另一模式的cursor拼接进来。重复cursor报错保留旧目录，晚到刷新不覆盖较新结果。
3. 项目内已完整读取的列表按5→15→25显示，额外保留选中项；最后只剩1条时显示全部。更多只改变可见上限，不创建会话，不提供猜测的“收起”按钮。

允许产品文件：App.tsx、CodexSidebar.tsx、styles.css。新增实际refresh回调分页回归，扩展实际Sidebar组件回归；不增加依赖或修改真实用户数据。

验证顺序：分页/增量失败用例→最小实现→失败/重复cursor/乱序刷新/选中项回归→完整标准检查（显式隔离CODEX_HOME）→真实CLI隔离分页探针→对应源码原生构建。功能、原生、像素分别记录，不将构建成功称为整页通过。

## 本轮结果与证据边界

- 实际App refreshThreads回调原先只返回首批，失败日志before-pagination.log；现在覆盖所有cursor、按ID去重、只提交完整目录、中间失败保留旧目录、重复cursor中止、旧刷新晚到不覆盖新刷新，以及首次读取失败/空目录的既有兼容分支。回调回归通过。其服务边界由受控样本提供，属于L2。
- 实际Sidebar组件原先28条全渲染，before-sidebar.log复现；现在5→15→25，末页显示全部；保留限额外选中项、最后单条自动显示，按钮不触发选择/新建。6条、选中项追加后只剩1条等边界由L2覆盖。
- 完整verify-all退出0，包含新增分页回调、既有项目折叠与窗口状态、TS、前端构建、cargo check、17项automations（13项过滤）及原有隔离协议探针。本轮为整个标准命令显式设置独立CODEX_HOME并清空API key；部分旧探针本身会继承环境，不能只依赖脚本注释推定隔离。
- 真实探针先两次失败：thread/start、inject_items和命名不会将空会话标记为可列出的用户会话；即使在已有目录追加回放事件，现存DB条目也未据此修复。失败报告保留，不宣称它们通过。
- 最终采用明确的离线rollout回放语料：只在探针拥有的临时home中追加固定用户事件，停止服务后将sessions复制到另一干净临时home，不复制SQLite/认证，让真实CLI扫描建索引。28条经真实thread/list、limit3分10页完整遍历，未触发turn/started。**这证明CLI对回放目录的索引和分页，不证明真实模型对话生成或完整会话生命周期。** 初次失败阶段有无认证预连接401与PowerShell快照警告，已保留在失败报告；未将其当作生成成功。
- 对应release原生窗口真实加载这28条回放数据，实际点击验证5→15→25→28，最后无“展开显示”。25条后滚动在侧栏内完成。native-phases.json记录稳定态UIA节点计数和截图；截图为JPEG，不作无损像素验收。一次取证助手闭包读到旧快照而断言失败，之后改为显式传入当前快照，25条使用带explicit-state文件，不修改产品来迁就采证错误。
- 原生App本轮limit100，28条在其目录读取中仅占1页；App跨页由实际回调L2覆盖，真实服务游标由limit3的10页探针覆盖，不把两者混写为“原生已超过100条实测”。

## asar提取修正

取中文资源时发现extract-asar-file.mjs使用16+jsonSize作数据起点，未包含ASAR header pickle对齐；本包因此少1字节。改为8+headerSizeBuf.readUInt32LE(4)。本轮新增verify-asar-extraction.mjs执行提取器实际起点表达式，读取真实官方文件并对比entry.integrity.hash，修复前退出1、之后退出0。未通过import运行脚本的其他提取任务，未覆盖旧参考。

中文语言包正确SHA为`c6ac10a9fb407a393ea002d9aa818a4c7ed0e215e9c8bf0cfe2b798a98e3756f`，与官方内置integrity相同；showMore偏移1666532。先前代理以错误起点提取得到的efc321...不作为官方原始文件哈希。initial原始hash577a50...同时经真实archive integrity复验匹配。官方asar整体SHA仍17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb。

## 交付索引

根目录：`.ref/parity/01/runs/20261030-codex-01b-pagination/`。

| 产物 | 用途 |
|---|---|
| reference/static-evidence.json、语言包文件 | 固定官方chunk、中文资源与检索锚点 |
| cases/before-pagination.log、before-sidebar.log | 本轮两个实际失败 |
| cases/verify-all.log、release.log | 标准检查与release结果 |
| cases/real-pagination-first-failure.json、second-failure.json | 保留未成功列出会话的尝试 |
| cases/real-pagination-cold-replay.json及同名.log | 真实CLI读取回放语料的分页证明 |
| cases/before-asar-offset.log、after-asar-offset.log | 提取器偏移失败/修正 |
| actual/native-phases.json及对应jpg/txt | 原生5/15/25/28稳定态 |
| build-inputs.json、source/、frontend-dist/、build.json | 114份构建输入、前端资产实存归档及EXE身份 |

可运行构建：`dist-artifacts/01B-pagination-20261030/CodexNative.exe`。

状态：本轮分页与项目增量显示自验通过，待用户验收；01B仍有多项目/assignment归属、排序、菜单及同条件视觉对照待核查。大型目录全量刷新时延、刷新期间新事件合并和更细粒度的官方catalog加载时序尚未验证。持续目标“逐页推进开发”保持进行中，不将当前局部通过改写为首页/全部页面完成。
