# 09C 活动会话生命周期与归档边界：阶段记录

日期：2026-11-06。状态：本地功能自验完成，待用户验收。固定官方Store26.1027.3384.0；[开发合同](../specs/09C-activity-session.md)与原函数/字段映射在`.ref/parity/09/actual/09C-activity-session/reference/`。本轮另用当前CLI0.165.0生成隔离schema，确认Thread时间为Unix秒、systemError及readState响应位置，不将CLI版本混称官方ASAR版本。

## 实施

- 复用真实thread summary与readState，按官方初始优先级建立有序session，行join最新数据。已读/结束保留，符合时间条件的新本地idle会话加入；关闭、重开、换身份、目录移除和旧请求分别处理。注意点仍实时计算，不等于session人数。
- 默认pin不单独分组，活动只出现一次priority列表；复用行组件，普通侧栏项目/分区/manual/captured revision行为保持。显示初始10、每次+10，搜索与分页不改变批量集合；这只是本地已加载全目录的显示分页。
- 批量只捕获当前session完整集合，逐项先thread/read，再以最新有效未读revision更新；共享每会话写锁，无自动冲突重试或本地伪成功。关闭/换身份/移除后未发出的写停止；归档/删除同步剔除ref成员，覆盖React提交前的晚回窗口。
- 修正三处无event归档入口、可见失败与重复写保护；晚成功按当前activeThreadId判断，不跳离新会话。后端服务失败不写本地归档，成功后在单一state锁中合并与持久化；删除记录的归档清理复用此路径。归档/删除确认及通知使在途旧目录代次失效。

## 已有证据

- 原bulk写集合外、无event归档TypeError、服务失败伪成功、RPC等待期丢更新、分锁并发合并、通知先于React提交时晚写，分别留失败依据；对应修复后生产函数/组件回归通过。没有削弱严格revision或原服务返回校验。
- 新session/App/Sidebar三脚本，以及既有菜单/排序/归档服务检查通过。后端3项专项通过后，全量Rust 515项通过、零失败/忽略/过滤，包含真实OS线程并发与私有磁盘一致性。
- 宽窗1280×800，Sidebar340；640×800 iframe中Sidebar300，两者无横溢出。12项初始显示10、分页显示12、读完结束保留、搜索一行仍捕获完整集合、读回后无未读点、关闭重开为空、失败不变、新建/移除均由真实React/Sidebar/model驱动。父回执是明确内存边界，App回调另由生产抽取回归覆盖，不混称完整App或真实服务。
- 完整非Fast标准313段/32协议探针、最终52组前端发布回归、全量Rust 515项与当前Tauri debug构建均退出0。初始冻结后仅两项验证脚本变化（旧归档夹具及发布入口登记），最终625项构建/测试输入稳定；345项产品输入与3产物绑定当前EXE。
- 私有Tauri通过12项初始10/展开12、Ctrl+Shift+A真实归档1项、重开显示10项时全部已读覆盖11项、已读成员保留、退出重启后Activity为空。只读SQLite确认12条记录、1条归档、唯一剩余未读正是归档项、tokens_used=0。初轮继承CLI0.159.2缺回执的空列表证据保留；支持路径仅在测试子进程指定npm CLI0.165.0，不修改全局环境。
- 可运行构建：`dist-artifacts/activity-09C-20261106/CodexNative.exe`，SHA-256 `6f2323ca10f80b4ed29e71cc9b30efd178fcd9cfae475f10fc6648cb126c98fc`。构建基线93c3b38加本阶段源码差异，详细输入/结果在native-inputs.json及verification/final-result.json；三次私有应用已正常退出。

证据根：`.ref/parity/09/actual/09C-activity-session/verification/`。浏览器`browser-wide-retained.jpg`、`browser-narrow.jpg`为JPEG，非无损像素对照。625项输入冻结；冻结后两项验证脚本差异及原依赖缺失失败保留，最终快照单独记录。

## 未完成边界

完整官方入口gate、root/子会话UN传播、silent heartbeat、Scheduled历史身份、远端/ChatGPT/多host、服务catalog分页所有权与自动resume仍未接入；不以通知数组或猜测关系替代。当前固定本地priority分支，官方完整分组/筛选/标题与可访问性布局仍待后续对照。

官方同环境配对像素、物理中文IME、多窗GUI及用户验收未完成；视觉score=null。现有state磁盘落盘错误为best effort，本轮没有扩成全局持久化事务。阶段提交不代表整页或整个App达到1:1。
