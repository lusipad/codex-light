# 09B Activity 入口、注意状态与 Inbox 数据源

日期：2026-11-03。修改前只读调研。承接 `09-inbox-lifecycle.md`，不表示09整页验收通过。

## 证据与适用性

包：`C:/Users/lus/Codex/_internal/app/resources/app.asar`，
SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。
这是**含codex-offline补丁的候选，不是干净发行基准**。以下仅为静态调用链，未证明运行时/账号gate/截图一致。

五份原始文件、SHA-256、包内integrity及定位片段保存于
`.ref/parity/09/actual/09B-research/manifest.json` 与 `*.anchors.json`。
五项包内integrity均核验匹配；定位采用0-based UTF-16字符偏移，不是物理行号。

## 三个不能混同的界面/数据集合

### 1. 侧栏 Activity 是上下文会话视图

`app-initial-fd3c4b862660.js`：

- `8600259`：`builtin:activity` destination，点击 `Tun(scope),Uxr(scope,sidebarMode)`。
- `8095607`：`g3o` 注册 `togglePriorityFilter`，活动按钮的状态来自 `MSr`，
  注意提示来自 `HSr`，不是从本地通知数组计数。
- `3303569` `Uxr` → `Gxr`。`Gxr` 在browser处于其他area时可导航 `/`，
  随后建立 `IR` 活动快照（activatedAt/items/pinnedItems/recency/visibleItemCount/sidebarMode），
  启动 `eSr` 监听。这里不是跳转到一个独立的本地 `/inbox` 通知全页。
- `3306956`：Done/关闭活动 `Jxr` 停止watch，清空IR及临时状态。
- `8602427`、`8603990`：导航landmark和上下文标题都是Activity。
- `8095607`之后的coachmark描述明确：“See chats that are unread, active, or awaiting a response”。
- `3316322`：活动候选过滤 `lSr` 先应用可见性和排期等条件，再接受非idle注意状态；
  还支持临时保留idle项。不是只看未读通知。
- `3324186`：`HSr` 的提示为候选中 `needsAttention` 或当前快照中 waiting/unread；
  **运行中但已读，不因此必有“需要注意”提示**。运行状态可进Activity和亮点规则不同。
- `3319205`附近OSr将本地thread注意状态转为
  `isUnread:state==="unread"` 与 `needsAttention:state==="waiting"||state==="unread"`。
- `3307124`：Activity“全部已读”取当前 `LR` 活动集合，对其调用真实会话读状态；
  scheduled本地线程还同步Inbox条目。不是清空所有本地通知。

Activity还含Pinned/Scheduled/Work/Chat等可用性筛选、最近分组和快照保留。
具体enabled gate与所有排序需要运行时对照。本轮不应凭候选补丁强开这些分支。

### 2. 本地自动化 Inbox 使用原生持久数据

initial `1939257`：`inbox-items`，limit200，1分钟stale/refetch；
`1940110`单项markRead/markUnread，经 `inbox-item-set-read-state` 主进程消息；
`1940561`全部已读只处理PENDING_REVIEW/ACCEPTED/ARCHIVED，并清空unreadRunCounts。

主进程 `main-DkWgQSQe.js:1414863` 的查询实际返回
`bootstrap.Yt(limit)` 与 `bootstrap.Jt()`：

- bootstrap `1710251` `QK`：从 `automation_runs JOIN automations` 读取条目，
  使用身份条件，按IN_PROGRESS、PENDING_REVIEW、created_at排序，LIMIT。
  字段包括automationId/name、threadId、title/description、
  archivedAssistantMessage/UserMessage/reason、sourceCwd、readAt、createdAt、status。
- `1711575` `$K`：未读计数来自 read_at IS NULL 且状态为PENDING_REVIEW/ACCEPTED的run，
  返回total、automationIds、unreadRuns，不是任意approval/turn toast计数。
- `1712041` `eq`：按thread与当前automation身份范围更新read_at。
- `1712845` `tq`：批量已读还要求 `updated_at<=readAt`，避免动作后到的新run被读掉。
- main `2072435`：set-read-state转发InboxManager markRead/markUnread；
  `2072581`：批量操作转发markAllAutomationRunsRead。
- main `2072684`的 `inbox-items-create` 来自指令，可有普通title/description，
  但不能据此推定上述查询一定返回所有旧legacy inbox_items。
  必须区分写入能力和实际读取SQL。

本项目当前自动化事件写入 `desktop_state` 的 `inboxItems`，
不是以上automation_runs数据合同。实现新原生持久run库、身份迁移和自动化历史联动
涉及更大范围，不能仅改InboxView过滤按钮就宣称来源一致。

### 3. Pages mentions 是独立Activity

`inbox-adea90c576b4.js` 包含 `/pages/mentions/inbox`、notification_id、
账户/用户身份与取消信号，提供PageActivityMenu。
initial `7889626` 动态导入的实际符号明确为PageActivityMenu。
因此不能把这个chunk的“Activity”label、错误重试、标记API用于证明侧栏会话Activity
或本地自动化Inbox的同一性。

## 当前产品已观察到的错误与下一开发范围

源码观察，尚未改产品：

1. `App.tsx` 的 `unreadInboxCount` 完全取 `inboxItems.filter(!read)`；
   `CodexSidebar`铃铛点直接使用该值。于是**真实thread未读/待审批但没有本地通知时不亮点**，
   **所有thread已读且无需响应、仅旧本地通知未读时仍亮点**。
   与上面HSr的来源不同。此项不需要先接Pages或重建原生automation库。
2. `CodexSidebar` Activity会话过滤已经包含未读/运行/等待状态，
   但状态判断与铃铛提示各走一套来源。可建立最小共享状态判定，保证“可进Activity”和
   “需要注意提示”使用同一真实thread数据、各有明确判定。
3. 目前Activity按钮右键与活动横幅额外打开本地Inbox全页。
   没有找到以上真正Activity入口提供这条右键路由的证据；
   历史A01/A02正则通过不能证明官方存在此交互。不建议继续扩充这个自建全页来追求官方相似。

**建议09B完整动作闭环**：
从真实thread列表/通知读状态及等待flags得到Activity注意提示 →
打开Activity并找到未读/active/waiting会话 →
打开会话或执行已有真实“全部已读” →
回读thread/readState变化并更新提示 →
关闭再打开重新计算候选。
复用已有readState协议与侧栏过滤，不新增数据源依赖。

这一闭环需要同时修提示源与验证真实读状态回读；不应仅换图标/增加入口。
完整快照保留、最近分组、scheduled身份数据及导航轨像素必须继续登记差异，
不能把本轮shared attention predicate命名为整个官方Activity状态机。

## 修改前可测合同

| ID | 场景/动作 | 预期 |
|---|---|---|
| AS01 | 未读thread，没有任何本地Inbox条目 | Activity提示亮；打开后能找到该thread |
| AS02 | 只有运行中、已读且无waiting的thread | Activity可显示它；不因running单独产生needsAttention提示 |
| AS03 | waitingOnApproval / waitingOnUserInput，分别覆盖status与activeFlags | Activity显示并亮提示；普通active不误归waiting |
| AS04 | 所有thread已读且无waiting，本地Inbox仍有旧未读记录 | Activity提示不因这些本地条目亮；Inbox自身计数可独立保留 |
| AS05 | Activity执行全部已读，协议失败/成功分别回读 | 成功以真实回读刷新；失败可见且不伪造成功；waiting仍保持需要注意 |
| AS06 | 快速连续全部已读、同时收到新readState revision | 不重复写同thread；不覆盖新未读状态；expectedRevision失败不能当成功 |
| AS07 | 关闭Activity再开、会话状态从waiting变idle | 按当前真实状态重新计算，不沿用旧通知计数；官方快照内保留规则另需明确实现与对照 |

测试应执行生产判定/handler/effect，不只搜索按钮字符串。
真实协议写验证继续用隔离CODEX_HOME；不改用户真实已读状态来制造证据。
原生与官方配对视觉仍未执行，不给分、不标已验收。

## 开发前复核纠正

实际开始09B时再次核对当前源码：23D已把**侧栏**提示改为真实未读会话数；
上述第1条“侧栏仍直接使用本地通知数”已不符合当前源码。NavigationRail的独立
Inbox计数仍使用本地通知，不与侧栏Activity混同。本轮实际修复的是：
waiting会话能进入Activity，却不计入侧栏注意提示；运行会话应可显示但不能单独亮点。
共享会话判定用于列表候选和提示。已有全部已读协议、revision互斥和失败回读保留并扩展回归，
不把这些既有能力冒充本轮新增实现。完整快照、原生自动化库和多host仍在范围外。
