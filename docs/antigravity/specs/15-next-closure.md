# 15B：全部删除本地归档聊天与归档身份重查

2026-11-03。以下保留修改前调研合同；当前实施与验证见[15B待验表](../acceptance/15B.md)，整页未验收。调研阶段未开发产品、未执行删除或模型操作。承接 [15A](15-archive-actions.md)，优先完成一个仍缺失的主要动作闭环：归档页“全部删除”从确认、真实删除到列表重读，同时修正归档删除边界。

## 基准与来源

本轮从当前候选 `C:/Users/lus/Codex/_internal/app/resources/app.asar` 重新只读提取 8 个原始文件，每项 SHA-256 与 asar entry integrity 核对一致。候选包 SHA-256 为 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。该包含已知 `codex-offline` 补丁，不能称干净官方发行基准。

[manifest.json](../../../.ref/parity/15/actual/15B-research/manifest.json) 保存包与文件哈希；[anchors.json](../../../.ref/parity/15/actual/15B-research/anchors.json) 保存 33 个官方定位及当前产品片段。所有数字都是解码后原始 JS 的 **0-based UTF-16 字符偏移**。本轮证据为静态链路，运行时、账号能力、DPI、主题、窗口与像素仍待配对验证。

## 已核对的官方动作链

| 原始来源 | 静态事实 |
| --- | --- |
| data-controls `thread/list` @8961 | 可见本地归档列表每页100、全分页、updated_at、useStateDbOnly:true；保留取消与重复cursor检测。附近离线吞错/缓存回退明确带补丁标记，不能作为正常合同 |
| 同文件 `fn` @12403、全部按钮 @20872、确认 @21134、`mn` @21919 | 全部删除仅当前 local host 且存在 local/local 条目时可用；加载/错误时不展示；恢复或删除 pending 时禁用；确认的本地ID来自完整entries，不是搜索后的可见组 |
| 同文件 mutation @15383 | all 调用 deleteAllArchivedConversations；project 对目标会话分别 deleteArchivedConversation；single调用单删。不是新增CLI批量协议 |
| shared runtime @3673869、A7t @2766898 | 页面→threadArchive主进程服务；有threadId走单删，无threadId走全部；成功取得deletedThreadIds后才清理会话缓存 |
| main @3091986/@3092191 | 主进程由实际host app-server连接执行单删/全部；返回真实deletedThreadIds，并通知automation runs变更 |
| bootstrap `Ic` @169685 | 单个归档删除先重新枚举archived集合，仅目标仍在集合才删除，否则返回空ID集合 |
| bootstrap `Lc` @169786、`Rc` @169860 | 全部删除重新枚举服务端完整归档集，页面cursor每页200、archived:true、useStateDbOnly:true；随后顺序删除该集合 |
| bootstrap `zc` @170048、`Dte` @170281 | 每个目标thread/delete成功后才做该ID缓存清理；普通错误向上抛。仅明确匹配“缺失rollout”的目标错误使用官方extension missingRolloutRecovery重试，不能将任意失败改成成功 |
| delete dialog @272 | 单个/项目/全部独立确认，取消不写；busy时不重复提交。全部文案明确“所有本地已归档聊天”，不是当前搜索匹配项 |
| 中文包 @1490316/@1490451/@1490371 | 按钮“全部删除”；标题“删除所有已归档本地聊天？”；正文“这将永久删除所有本地已归档聊天记录” |

全量删除在执行时重取列表，因此它针对当时服务端归档集合，并非打开确认时页面快照中的少数ID。这一点必须在实现与验证中保留；不能误写成“仅删除当前筛选结果”。顺序删除存在部分成功后后续失败的可能，官方源码没有原子事务保证，不可承诺全成全败。

### 恢复、搜索与其他缺口的边界

- `Sn` @32611 仍使用标题span与明确取消归档按钮，恢复成功后“查看”动作独立导航；shared `M7t` @2767776 在真实unarchive后加载会话，加载失败抛专门错误。当前 App 回调只执行unarchive再refreshThreads，完整load/open错误分类仍待后续对齐，不在本轮暗称通过。
- initial `PZo` @7927157 构造标题、项目、cwd/path basename等searchValues；`FZo` @7928810 使用包内搜索库，ignoreLocation:true、threshold:0.4；`IZo` @7928978 联合类型/项目/搜索过滤和分组；`VZo` @7930623 提供更新时间、创建时间、字母顺序。当前仅标题/preview子串过滤，**15A全分页搜索通过不等于官方模糊搜索一致**。
- 项目归属 `RZo` @7929978 优先显式assignment、fallback目录仅接受唯一项目；不能自行用最深cwd前缀猜项目。项目less、automation特殊组、durable与云端入口有另外分支。
- 本轮不新增模糊搜索依赖，不把云端删/恢复或项目批量混入“本地全部删除”。上述能力均继续作为整15页未验项登记。

## 当前源码实际差距

1. `ArchiveView.tsx` 已具备15A全分页列表、取消确认、同步mutation锁与过期请求保护；仅单个删除，没有“全部删除”按钮/确认/结果。
2. `App.handleDeleteArchivedThread` 调 `thread_delete`；Rust `thread_delete` 直接发thread/delete，成功后清本地记录。它没有官方Ic的“执行前确认仍在archived集合”步骤。若列表过期且同一聊天在其他窗口被恢复，旧归档行仍可能触发该ID的删除；这是本轮应一并修正的真实边界，而非重做15A错误传播。
3. 当前返回Result<()>不包含实际deletedThreadIds。批量部分成功、目标已不在归档集、最后重读失败不可统一显示“全部成功”。归档操作需要最小扩展返回真实结果，并复用现有缓存清理逻辑。注意thread_delete还有其他入口（App内普通聊天删除）；不能直接给所有删除无条件套archived限制，应建立归档专用边界或显式作用域，保留普通删除语义。
4. 既有 `verify-archive-actions.mjs` 覆盖15A列表/单条回调；`verify-archived-settings.mjs`验证设置/独立页共享入口；真实 `protocol-verify/verify-archive-actions.mjs`在隔离home内执行单条归档生命周期。这些均不证明批量或过期归档身份保护。

## 修改前验收合同

| ID | 操作、预期与验证 |
| --- | --- |
| AB01 | 存在本地归档且列表成功加载时提供“全部删除”；正在加载、列表错误、没有归档或存在恢复/删除操作时不可执行。中文确认采用原包语言，明确永久删除所有本地已归档聊天，不声称仅当前搜索结果 |
| AB02 | 点击取消或Escape关闭确认，零写请求；快速重复确认、与单个删除/恢复冲突只允许一个执行链；锁在失败后释放。设置入口与独立归档页必须复用同一行为 |
| AB03 | 执行前真实thread/list archived:true全分页获取当前集合，官方删除枚举limit200/useStateDbOnly:true。枚举失败/异常cursor不以部分结果开始删除；不增加未经协议支持的deleteAll方法 |
| AB04 | 单删重查后目标已取消归档/已删除时不发送thread/delete，不清其本地record；返回无实际删除并重读页面。不得将“没有删任何项”反馈为“已永久删除一条” |
| AB05 | 全部删除使用执行时完整归档集合，搜索文字不改变删除范围；多页及含刚新增归档项的fixture证明完整覆盖；未归档线程永不作为枚举目标 |
| AB06 | 每项真实thread/delete成功后才清该ID本地记录；按实际成功ID计数。某项失败停止后续，保留已完成结果并明确部分失败，重读列表；不回滚已真实删除项、不误报全部成功 |
| AB07 | thread/delete不支持/权限/断连等错误明确保留，不用thread/archive或本地清记录代替。官方missingRolloutRecovery扩展的当前两版CLI支持需先独立核实；不支持时报告真实失败，不能虚构恢复接口 |
| AB08 | 旧列表响应不能复活已删除行；成功/部分失败后的真实重读用于确定剩余集合。若重读失败明确呈现“删除已执行，刷新失败”，不恢复伪数据或再执行删除 |
| AB09 | 后台/窗口切换和卸载期间，响应不污染其他归档上下文、不导航；原生Tab、确认焦点、取消后焦点返回、Escape逐项验。成功后回到列表/合理焦点，不能声称window.confirm就是官方dialog像素 |
| AB10 | 回归15A全分页、重复cursor、查询保留、单项删除错误、恢复成功后查看导航、旧读请求与同步锁；真实删除测试只在私有隔离home和测试目录，零模型turn、不接触真实聊天 |

## 最小实现与验证边界

优先复用已有ArchiveView mutation与真实thread_delete后端，将归档身份重查和真实成功ID输出放在归档专用删除服务边界，避免两套前端删除引擎。批量顺序策略与官方Lc/zc一致；不做事务、定时成功、固定条数、吞错或本地伪成功。归档调用者必须处理目标不在归档集和部分成功；现有普通聊天删除调用者的语义需独立保留，不能只给归档页换按钮或全局禁止普通删除。

函数/受控回放覆盖AB01–AB10；真实两版协议探针验证archived身份、分页、逐项删除及实际剩余数据；原生构建后验证确认、错误、焦点与入口复用。没有官方同环境截图时，不声明界面1:1；全部删除、原生/视觉与用户验收分开记。完成15B限定闭环后进入下一主要页面，项目批量、完整项目/类型筛选、官方模糊搜索、云端与像素差异保留，不以本单元替代整15验收。
