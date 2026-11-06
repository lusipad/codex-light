# 15H 云端取消归档 UI 与读缓存生命周期

2026-11-06。前端产品增量冻结移交主线程；自验不代表真实账号写入、原生或像素验收。依据 [15H开发前合同](../specs/15H-cloud-unarchive.md)。本负责范围未执行真实HTTP、模型、Cargo、完整构建或Git。

## 实施边界

ArchiveView仅在settings已读ready行、当前reader的实时epoch/订阅/身份有效时启用云端取消归档；行保存渲染时reader，不能将旧行借新身份提交。前置accountRead/serviceIdentity和接受后的快照/identity校验保留，AbortController跟随页面和来源失效。同步锁以source:id划分，不增加全表锁；不同来源同ID、同来源不同ID可独立在途。

每次操作有独立token，async状态、finally清理、锁和unknown读回解锁均核对所属token。A换B或ABA后旧请求晚完成不能清新pending。普通同账号列表reload不等于监听/账号失效，已发送操作用实时isCurrentIdentity守卫继续收敛，起写仍要求canUnarchive ready与真实已读项。

2xx接受后仅对应reader忘记目标、取消旧读防回插，随后刷新该来源；任务失败也按onSettled读取。正常接受只用官方info“聊天已取消归档”，不新增常驻待确认大卡，不自动导航。云端删除继续disabled；内部查看仍未接入，不调用selectThread或系统浏览器。

unknown显示“取消归档结果尚未确认，请刷新查看。”，行内及顶栏刷新均只读，不直接重放。只有用户要求刷新后，新成功快照实际仍含目标且当前身份/订阅有效，才释放unknown锁供下一次明确点击；部分页没目标、失败或task HTTP-empty均不算恢复确认。readVersion只在真实成功首页替换时增长，局部forget与失败不增长。accepted后刷新/校验读取失败显示简洁刷新提示；后续成功读清已解决detail，保留accepted事实，不声称独立单项验证。

明确失败toast固定“无法取消归档聊天”，不拼transport原文。当前身份仍有效的auth_unavailable/auth_required前置错误可见且实际重读禁写恢复；真正换号/监听失效/卸载旧回包不产生新页toast/cache/重读。

pending保持“取消归档”原文字、aria-busy和前置LoaderCircle。复用现有lucide/旋转样式模式，未证图形栅格和时长像素一致；score=null。

## 实际验证

- 新 `verify-archive-unarchive-ui.mjs` 初始UU01真实红灯（缺可信行恢复动作），实现后UU01–UU10退出0。
- UU01–03：同步同source:id重复保护、同ID跨源独立、正常接受只清对应缓存/info、unknown不盲重放、不进本地mutation。
- UU04–05：行内及顶栏刷新解锁；失败/缺目标/HTTP-empty不解锁；成功新快照仍归档才允许用户再点且零自动写；accepted刷新失败保留事实；postcheck detail在读成功后消失。
- UU06–08：403/404保留行并释放明确失败重试锁；preflight失败零写；同源两个ID第一条刷新loading不取消第二条；换号/监听失效/卸载旧成功零toast/cache/重读；preflight取消零发送。
- UU09先真实红灯复现A晚结束清B pending，token修复后A→B与ABA均绿；UU10覆盖当前身份auth_unavailable/task及auth_required/conversation前置失败官方错误、实际reload与loading禁写。
- 真实task/conversation reader回放新增当前epoch、render gap断线、旧can/forget拒绝；普通reload仍有效；accepted取消旧读防回插；readVersion仅网络新快照增长。两个reader完整既有脚本退出0。
- 最终本负责范围重复执行UU、task reader、conversation reader、AC、CV、AS、AA、AB、archive-service、ARS（含ARS06/07）全部退出0；`npx tsc --noEmit`退出0。
- 旧AC/CV只读夹具保留“没有可信生命周期能力时disabled”的断言，并直接调用guard验证零写；删除依旧无handler且disabled，没有删掉安全断言制造通过。

## 文件与剩余事项

产品：ArchiveView.tsx/.css、archiveCloudTasks.ts、archiveConversations.ts。回归：新增verify-archive-unarchive-ui.mjs，补两个真实reader脚本，维护AC/CV旧安全夹具。未修改service客户端、SettingsView、Rust或标准入口；主线程分别负责。

分页并发缺项P2由主线程真实双reader浏览器复现，证据见15H browser/paged-accepted-false-error-before.jpg/.txt。最小修复已完成：forgetAccepted仅在当前identity/epoch有效时，目标不在当前缓存视为移除no-op成功；缺项不能用canUnarchive开始新写，此门槛未放宽。真实reader缺项用例先红false!=true；新增UU11生产controller模拟首页a与后页项同时在途，a成功后的首页刷新淘汰后页项，后页host accepted仍应正常info成功、不能伪造“列表刷新失败”；UU11先红成功toast少1条后转绿。两个reader全回归、UU01–UU11及tsc退出0。主线程继续浏览器重建复验。自动reload重置已读页数与官方infinite query的差异仍登记，未重写分页框架。

主线程随后补充两个真实reader红灯：缺项移除虽然成功，也必须取消在途旧读取，避免晚回包回插。删除各一行早返回，统一走identity守卫→abort→filter/publish；缺项起写仍被拒绝，readVersion不伪递增。两个reader及UU01–11复验通过，独立复核无新增可证缺口。最终重建的浏览器也再次通过后页并发成功与宽窄检查；其他错误/重试场景的具体源码边界见browser/results.json。

15H浏览器夹具和后续原生/成对视觉验证由主线程所有，完整终态见[整合记录](15H-cloud-unarchive.md)。内部查看、云端删除、真实服务幂等/取消竞态、用户验收仍未完成。
