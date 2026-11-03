# 16.04 通知：修改前调研草案

日期：2026-11-01。状态：本地偏好与分类派发增量自验中；完整分区未验收。

从固定原包直接读取notifications-settings两项资源，SHA-256与归档integrity匹配，见[参考清单](../../../.ref/parity/16.04/runs/20261101-codex-notifications-research/reference/trace.json)。偏移为原始UTF-16；最初仅有设置证据，后续消费者和中文取证见下文16.04A合同。

## 已确认与差距

| 项目 | 原始静态证据 | 当前产品差距/下一步 |
|---|---|---|
| 通知时机 | notifications-settings-a6a254747182.js `lt`，24017；turnMode默认unfocused，选项off/unfocused/always | 当前TurnCompletionPolicy使用never，须追真实持久化key和消费者，不能只改下拉显示 |
| 独立类别 | `lt`读取turnMode、permissionsEnabled、questionsEnabled、dotEnabled | 当前通知/审批粗粒度布尔值未覆盖完整类别；审批不能被完成时机错误抑制 |
| 音效 | 同文件`Ve`，8217；default/classic/none及Basso/Glass/Ping/Pop/Purr等选项，另有导入、试听错误 | 当前九项使用自行合成振荡器，不足以声称与官方音效一致；须查平台过滤、实际资源和许可 |
| 自定义声音 | 同文件`Be`，7538；错误说明MP3/WAV/FLAC/Ogg、少于30秒/10MB；操作可abort | 当前没有等价导入；须追主进程校验、存储和文件选择行为后实现 |
| 系统权限 | `lt`读取权限状态；被禁时禁用控件、提供系统设置动作；`ut`30692调用systemPermissions.openNotificationSettings | 静态文案主要针对macOS，不能直接给Windows加同样权限行为，先追平台适用性 |
| ChatGPT账户通知 | `Je`14054账号allowed/loading/denied/error；`Ye`15010、`Xe`18840 GET/PATCH /notifications/settings，带账户头和abort/乐观回滚 | 不是本地desktopPreferences；无账户支持时不能生成固定分类或冒充远程保存 |

## 修改前发现的差距与调研清单（历史草案）

1. 追通知schema与各独立key的默认、值域、持久化；核实际中文。
2. 追turn完成、权限、提问事件的真实发出条件、前后台/当前聊天/重复事件策略，以及Windows系统通知桥。
3. 定义并执行等价场景：前台/后台/失焦、off/unfocused/always、审批与提问、重复/取消/错误、声音关闭与试听失败、重启读回。
4. 找到可合法使用的资源或明确等价实现条件；没有证据不再称自行合成音为“官方9款预设”。
5. 最后进行Windows原生通知点击、权限/系统设置、音效与官方同环境界面验收。现有设置文本和构建成功不能代替这些。

## 16.04A 限定动作合同与证据边界

消费者证据见同目录consumer-trace.json（app-shared schema、app-initial服务、主进程声音链）；本轮重新核验原包SHA-256仍为17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb。中文见locale-trace.json。官方静态可证明条件与持久化合同；实际系统弹窗、账户gate及截图仍未实测。

| 用例 | 操作与官方预期 | 本轮实现/验证 |
|---|---|---|
| NT01 | 缺少独立key时turn=unfocused，permissions/questions/dot=true，sound=default；值域校验 | notificationPreferences标准化；不再消费旧desktopPreferences通知字段 |
| NT02 | off抑制完成；unfocused仅失焦；always允许前台 | shouldNotify矩阵；thread/turn稳定ID |
| NT03 | 权限/提问独立开关；应用聚焦且该聊天可见才抑制；请求取消不应迟发 | requestUserInput/ask_user/questions分类，派发前重查请求和焦点 |
| NT04 | 相同完成ID不重复；最近ID有界；none仅关声音 | 1000项集合，发送错误可见；dot仅数据模型与判定用例，无真实来源故未显示控件 |
| NT05 | 修改独立key，保存后读取；失败不假成功 | desktop_state_get/set，写失败回滚，写成功确认失败保留新值并报错，重新读取 |
| NT06 | Windows仅default/classic/none；按真实中文显示 | JSX回调，真实测试通知桥；仍为合成音，不宣称官方资源一致 |
| NT07 | 请求ID与generation不能串用，已解决请求不迟发 | 实际App监听回调执行；resolved同步更新ref |
| NT08 | Windows独立播放器不重叠；none静音；失败可见 | 复用合成播放器，关闭前一AudioContext并在完成后释放；无API时抛错 |

本地迁移决策：新五项key缺失时采用官方默认。旧desktopPreferences通知字段保留在磁盘但忽略；不把never或总开关映射成新独立类别，以免将旧错误耦合延续到新语义。设置页通用保存不再写入旧通知字段。

自动化调度已有run-finished桥保留，使用完成类别与id/finishedAt去重；官方静态h0s有automation quiet决策，但当前调度payload尚不携带完整decision，故静默自动化合同仍未完成。目标完成仍显示应用toast，移除其额外系统音以免与turn/completed重复。

当前限制：初始设置读取成功前不发系统提醒；账户变化/静态gate、dot来源、通知撤回/点击/快捷回复/审批按钮、操作系统权限、声音导入及官方音频资源、远程ChatGPT账户通知设置不在本增量中。现有Rust通知桥的show返回仅证明提交，依赖内部异步展示错误不能全部上报，不能以API返回证明实际可见。原生重启往返与像素仍待验。
