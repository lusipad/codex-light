# 10C 计划任务页面结构纠偏：修改前合同

2026-11-04。依据用户“以当前官方版本取证为准”，不沿旧自建管理卡片反推预期。固定Store26.1027.3384.0，asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`，原文/hash/UTF-16定位保存于`.ref/parity/10/actual/10C-ui-correction/reference/`。

## 来源必须分开

- `/automations`与`/scheduled`并不唯一对应一套UI。runtime Aj经gate3085093835及认证条件选择新ScheduledTasksPage或AutomationsLayoutPage；显式view=manage等条件另有管理入口。当前账号gate未实测，不强开、不假装已知。
- 新ScheduledTasksPage的He读取`/automations?cursor&filter&limit=25`，query key为cloud-automations/scheduled-page；它的自然语言composer需要真实ChatGPT能力。不能把Rust `automations_list`的本地任务冒充该云端列表，也不能做一个假提交框。
- 管理页configuration分支Oo/Ft接收独立localTasks及cloud来源；gate4283773748等决定其与旧建议列表形态的切换。本轮修复当前已有本地功能的**表格管理区域**，不宣布默认云端Scheduled/所有管理分支已完成。

## 区域与动作

| 区域 | 官方静态合同 | 本轮实现边界 |
|---|---|---|
| 标题/添加 | “定时任务”，右侧“添加” | 移除路径、automation.toml和长期目标管理说明；添加进入配置区域，保留真实保存 |
| 控制栏 | 筛选、排序、搜索；默认active | 状态all/active/paused/finished，搜索作用于已读本地任务，排序只排已读结果 |
| 任务表 | 4列，任务占2列，其后“下次运行”“已安排”；桌面4列、窄窗单列 | 本地任务真实name/status/nextRunAt；最后一列是RRULE人类摘要，不是createdAt |
| 行 | 整行button打开source=local的详情，不常驻堆run/pause/delete按钮 | 详情保留立即运行、编辑、暂停/恢复、删除及实际运行会话；不删除真实任务数据 |
| 创建/编辑 | configuration模式显示配置区，不一律称modal | 复用原保存字段及锁/读回/失败保稿；完整官方配置控件另列缺口 |
| 运行记录 | 官方有对应详情和结果流程 | 当前只显示真实已收到的当前窗口记录，不冒充完整持久automation_runs或云端记录 |
| 诊断 | 调度健康、秒时钟大卡不是此表格的首屏结构 | 撤下常态大卡；必要的错误/不可用状态仍可见、可重试，不以移除卡片隐藏错误 |
| 模板 | 新Scheduled推荐grid、旧manage建议行、configuration表格是不同分支 | 移除当前硬编码三张代码巡检/goal卡，不移植别的分支模板凑数 |

## 保留不变量

已有`handleCreate/handleToggleStatus/handleDelete/handleRunNow`共享锁、listRequestRef、运行started/finished合并、真实会话跳转、scheduler同步和订阅释放继续有效。运行命令接受只表示启动，completed仅来自真实匹配终态。调度不可用时不派发执行，不显示“回退本地执行”的错误承诺。修改前生产JSX回归已捕获该文字矛盾（退出1）；文字修复后退出0。

不为了换布局重写Rust调度器、存储或协议；不触发模型、真实任务或用户数据变更。现有goal/heartbeat兼容数据和字段保留，但不称它们是云端Scheduled的官方分类。

## 修改前验收

1. 当前本地列表正常/空/失败分别验证；默认已开启，切已暂停/已完成/全部、搜索/排序均不增删数据。
2. 首屏没有实现路径、调度器大卡、代码预设三卡、长期目标分类和全部任务action堆叠；有官方来源的标题、控制栏、列及row入口。
3. 行→详情→编辑/取消/保存/失败保稿，暂停恢复、删除确认取消、运行不可用与重试保持真实行为；原回归不因布局变化弱化。
4. 新增生产TSX回归覆盖实际DOM事件，不能只检查字符串存在；宽窄生产构建检查无横向溢出及可达控件。
5. 配对官方截图、原生GUI/IME、当前gate、云端任务/自然语言composer未实测即明确未验，不给像素分或整页完成结论。
