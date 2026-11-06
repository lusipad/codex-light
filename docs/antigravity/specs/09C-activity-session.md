# 09C Activity 打开快照、保留与批量已读：开发前合同

日期：2026-11-06。状态：**本地功能开发及自验完成，待用户验收**。本单元承接09B真实会话readState/status，不重做通知日志，也不把automation/approval通知数组替代官方Activity。

## 来源与当前差距

固定Store26.1027.3384.0。当前asar的3个条目直接重读并与header integrity匹配；57个UTF-16/source-hash锚点、完整raw及可重跑`helper-sequences.cjs`在`.ref/parity/09/actual/09C-activity-session/reference/`。11组原函数内存边界序列通过，仅证明这些输入下的静态函数行为；外部存储、host、导航及观察器均明确替身。

当前`CodexSidebar.tsx`的activityOnly实时过滤会话，已读或结束后可能立即移出；`App.tsx`批量已读遍历全部threads。这两点与同版Activity session及集合范围不同。09B已有真实候选、注意提示、revision读写和冲突处理须保留，不以旧全页面记录误判它们尚未开发。

## 确定的官方合同

- `aOt`（primary UTF-16 409306）先通过导航guard，再于没有同mode session时建立去重快照、activatedAt、pinnedItems、recency和visibleItemCount=10。重复打开同mode不重建；导航被拒绝不建快照。
- 首次资格不是简单“未读或运行”。相关_P、xOt、bOt、wOt等函数须逐字段映射；bOt的silent heartbeat不是泛归档条件，rm仅waiting/input/approval/error。缺失字段不能凭名称推断。
- `fOt`（417246）融合初始快照、当前候选和符合条件的新本地会话。仍在当前目录、且未触发明确排除条件的快照项，读完或由active结束为idle后仍保留；实际移除、隐藏及归档有各自规则，不能永久留住任意已删除项。
- 默认Pinned/Scheduled关闭、Priority/Work/Chat开启。Pinned是单独DP集合，Priority的EP会排除已分入DP的ID；priority关闭后的分组有独立分支。本单元不能把EP当作所有模式的可见行。
- `lOt`（413146）操作整个当前EP集合，既不截成visibleItemCount，也不混入独立DP或全部threads；`UN`再展开root/子会话的真实未读目标。
- 本地receipt先`thread/read`取得最新revision，再执行read-state更新；还受saved ready/sync、非durable及threadReadState版本能力约束。保留失败/冲突和晚回保护，不乐观伪造服务端已读成功。
- `pP`（412971）关闭时停止监听并清理session。重新打开按当时数据建立新快照；分页只扩展当前session的显示数，不扩张批量写作用域。
- 官方header入口要求gate4039078146且access.status不是denied；本轮未读取真实gate值，不强开，也不借修复会话生命周期发明入口资格。

## 开发顺序与验收

1. 把当前本地会话数据映射到已证资格字段，登记无法映射的字段和适用范围；先写确定性状态序列，不能从我们的输出反推预期。
2. 实现打开→合并更新→读完/结束保留→明确移除→分页→关闭释放→重开重算的session，保留现有真实readState消费者。
3. 批量仅取当前EP对应本地目标，root/子会话和revision规则分别回归；失败保留可见状态，旧请求不污染新session。
4. 验证鼠标/键盘、导航拒绝、重复打开、操作中关闭、晚分页与晚已读；当前源码原生构建和宽窄布局留证，官方配对像素及用户验收单独记录。

## 本轮字段映射与必要边界

- 当前本地普通会话以id去重，session只存成员/已见ID、打开时间和显示数，行始终join最新summary；新资格项补入，原成员已读/结束保留，真正从权威目录移除才退出。官方`fOt`中打开后新建local还可idle加入；当前服务createdAt为Unix秒，与官方归一化毫秒的比较须显式转换，不猜量级。
- 首次按attention（等待输入/审批/已证systemError）、未读、运行、idle分档，再按recency降序；当前字段没有root/子会话、silent heartbeat、Scheduled历史与host alias，不补造关系或伪装完整UN。更多仅为已读全目录的显示分页，初始10、每次+10；不能冒称官方catalog服务分页。
- 默认Pinned不独立分组，activity成员只呈现一次priority列表；搜索与显示分页不改变批量集合。普通侧栏项目/自定义分区、pin/manual和菜单captured revision保持既有合同。
- 批量在点击时捕获本次session完整集合，以真实readState资格为前提，逐项先thread/read(includeTurns:false)，再用最新有效未读revision更新；不自动重试冲突。关闭/换身份后未发出的写停止，已发出的服务写不能伪称撤销；旧完成不得复活旧session。
- 只读接入评估确认三处归档调用传`{} as any`，原callback在请求前TypeError；backend还会吞archive/unarchive错误，成功后的本地记录合并基于await前旧副本。先用故障和并发回归修复该边界，再以可靠归档结果清session。删除/归档使在途旧thread/list代次失效，避免旧目录重新插入已移除行；失败与取消不能移除。
- 接入评估、13条序列及原函数执行证据在`.ref/parity/09/actual/09C-activity-session/reference/current-integration-map.md`。主线程已用原bulk callback证实集合外写入，`current-bulk-red.log`保留；修复及后续自验证据见[阶段记录](../acceptance/09C-activity-session.md)。

## 尚未证明（继续保留）

真实运行时gate、完整root身份与Scheduled历史身份、ChatGPT/远端/多host行为、导航拒绝和晚分页的完整动态链、官方原生视觉及像素均未验。`lastThreadId`不能代表全部Scheduled资格，普通通知条目不能补造缺失身份。允许先完成有来源的本地会话生命周期，但不得宣称完整官方Activity或强开未证分组。
