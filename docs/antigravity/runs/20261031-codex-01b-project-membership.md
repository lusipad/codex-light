# 01B 项目归属调研与协议验证

2026-10-31。上一轮已交付项目标题菜单和当前release原生回归，属于实质进展。本轮继续01B，未进入01C。本文件先记录修改前研究合同，不能把资料中的功能视为已实施。

## 已确认的数据边界

- 固定官方initial SHA577a50e29502f573e2fbccf4940b9bd875339db420d6d5a9798a0d201ee0aff1；shared SHA1ffb0654bdfcba23be50c06c8698e665bdb17330d923758001d01262aa81cb5b。以下为0-based UTF-16偏移。
- initial Kkn2284700：有效assignment优先；projectless标记阻止cwd回退；旧Okn2278775只查规范化路径Map的精确key。Lkn2281639才在worktree/git-origin条件下推导工作区hint，不是任意子目录找最长前缀。
- G_n2056446构造现代catalog项目scope：cwd精确值与带分隔符前缀；匹配hint加入include；本项目assignment加入include且移出exclude；其他assignment移出include且加入exclude；separatelyLoaded最后排除。这里是每个scope，不是first-find的唯一归属函数。
- shared GRn3657285（initial导入Jht as ace）：客户端workspace state可覆盖assignment和projectless集合；Man2931479先取projectMembership，才回退project。持久key为thread-workspace-state-v1:<id>，与app-server thread.projectId字段不是同一数据结构。
- 当前`WorkspaceRootItem.id`由Rust工作区路径产生；Sidebar只拿workspace列表、workspaceHints，并对cwd做first-find前缀匹配。没有官方本地项目实体ID映射，没有客户端assignment/projectless数据接入。现有Project实体模块只供项目中心，不能直接把其UUID与工作区路径ID比较。

## 本轮验证计划（不发送模型任务）

1. 当前安装CLI生成experimental schema到本轮reference/schema，隔离CODEX_HOME；保存版本、二进制哈希。核对thread/list的projectId过滤、metadata/update的空/null/省略语义。
2. 仅复制既有明确离线回放sessions和session_index到本轮独立probe-home，不复制认证、真实配置或SQLite。真实app-server建立独立索引。
3. 两个声明测试项目、同cwd的两个已有回放线程；分配到不同project后重新read/list核对；null/省略不改变，空字符串清除。完整退出app-server重启后再read/list。只在隔离数据中写入，不使用turn/start。
4. 对从官方文件提取的scope构造纯函数做受控求值，验证include/exclude优先级；仅为静态合同推演，不冒充官方运行时。
5. 结果决定后续产品接入合同；本轮若仅拿到协议和静态证据，不修改产品猜测归属，也不宣称多项目或官方像素通过。

## 实测结果与反证

证据根目录`.ref/parity/01/runs/20261031-codex-01b-project-membership/`。当前CLI为0.159.2，SHA-256 `cbafb6422bca005b94c12d105b1a16a0474219e24ea4893f85846409c464f5a1`。官方asar哈希仍为17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb。版本/选定schema哈希在`reference/manifest.json`，官方定位在`reference/static-evidence.json`。

| 项目 | 当前证据 |
|---|---|
| 同cwd不同canonical归属 | 真实CLI允许创建两个roots完全相同的项目，两个同cwd线程分别分配给不同项目；重新thread/read及projectId过滤的thread/list均匹配。故不能通过相同root把canonical UUID唯一映射到workspace路径ID |
| null/省略补丁 | 首次探针按schema“保留”理解，提交只有projectId:null的补丁，真实服务拒绝-32600：thread metadata update must include at least one field。原始失败保留在`cases/protocol-first-observation.json`和`probe-first-observation.log`。不能把该错误当作清除成功，也不能吞掉 |
| 补丁有效性与归属变化 | 第二次使用全新probe-home-2；null单字段、完全省略字段均断言拒绝且重新读取归属不变；含有效gitInfo补丁时null/省略均保留canonical归属；projectId空字符串清除，重新读取为null |
| 查询null语义 | thread/list过滤projectId:null包含刚清除的线程、不含仍归属B的线程；这仅表示后端unassigned，不能据此创建官方前端显式projectless标记 |
| 重启持久化 | 完整停止真实app-server并以同隔离home重新启动，重新read确认A清除仍null、B仍其UUID，B过滤列表仍包含该线程；没有turn/started通知 |
| 官方scope静态合同 | `scope-contract.mjs`提取原始G_n/K_n/J_n求值，7项断言通过，结果在`reference/scope-evaluation.json`；输入均已规范化、ai用identity替身，不证明官方路径规范化/实际catalog过滤或UI运行时 |

`cases/probe.log`与`cases/scope.log`退出0。两轮探针从本应用既有明确离线回放语料仅复制sessions/index，不复制认证、配置或SQLite；写入只发生在本轮隔离home，真实服务重新索引。有效gitInfo补丁的branch是明确测试值。探针禁止所有turn/*调用，不生成模型回复；finally等待测试服务退出。首次失败未覆盖其数据，第二次使用独立目录。`probe.mjs`为单轮研究脚本，有非空sessions防覆盖保护，重跑需另设全新隔离home。

## 后续开发合同与验收顺序

1. **先分清身份来源**：复用`Project`及`listProjects`加载canonical实体，显式标记成功/不可用，不能以workspace路径伪造UUID。保留前端legacy workspace与客户端本地/远程assignment的独立来源。相同root的两个canonical项目必须可区分，多root项目不能拆成多个伪实体。官方local-projects与canonical实体的迁移/映射链仍待继续取证，本条是接入约束，不是迁移已核实。
2. **再接归属与刷新**：canonical成员由projectId及对应过滤结果核对，不能只看cwd；加载中的未知projectId不能临时塞回任意cwd项目并闪动。thread/project/updated及project/changed后更新，晚到项目列表/线程列表不得恢复旧归属。独立保留projectless显式标记，null不自动等同于它。客户端workspace state优先级按GRn/Man继续追链后实施。
3. **新建与迁移完整闭环**：schema已确认thread/start支持projectId（持久线程保存，ephemeral仅live），不能只传root cwd；thread/resume没有同名字段，不能凭空添加。归属变更用metadata/update有效补丁，清除用空字符串，并read/list往返。UI移动到项目的菜单和拖动目标还需官方动作取证；未取证前不新增自定义“移动成功”流程。
4. **回归再交付**：同root不同项目、不同root显式分配、multi-root、未知/已删除项目、无项目、legacy fallback、worktree hint、置顶/分区、Recent包含及手动排序；操作后离开/重开/重启读取。新增数据刷新需覆盖乱序和失败，不以静态样例代替真实协议。当前scope构造的7项静态推演仅作为合同输入。

本轮没有修改产品代码、没有重建EXE，不宣称canonical项目已接入侧栏。上一轮`01B-project-options-20261031`仍为最新产品构建；该版侧栏first-find前缀归属缺口仍存在。01B整体开发中，未用户验收。官方运行时/同条件像素、实际scope消费者和客户端assignment迁移仍待取证；不把本轮协议通过扩张为官方界面通过。
