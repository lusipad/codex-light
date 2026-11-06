# 21F Sites 设置写入：名称与环境变量

2026-11-07，状态：静态调研草案完成，产品开发/运行时/像素/原生验收未完成。范围为21E同页设置中的名称与环境变量真实保存；不把本阶段缩成全部Sites设置完成，URL、共享、转让、域名、永久删除仍保留独立队列。

## 基准和证据

固定官方26.1027.3384.0，整包SHA256复用21E已核值 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`，本阶段不宣称重新整包测量。`.ref/parity/21/actual/21F-settings-write/reference/manifest.json`记录6份完整原文件与entry integrity对应SHA；来源是21E fresh提取，复制前再次核逐文件hash。`anchors.json`保存23个完整函数及0-based UTF-16起止位置，`translations.json`38项直接中文；`self-check.json`全部hash/片段往返通过。不是HTTP、官方GUI或角色权限实测。

## 请求、响应及保存身份

|项目|官方硬合同|不能自行补出的结论|
|---|---|---|
|名称请求|initial `SMi` POST `/websites/{project_id}/metadata`，body仅`{title}`。`site-delete-confirmation:l` trim用户draft，非空且异于saved（或上次失败）才保存。input `maxLength=100`。|100是UI属性，非已证明服务端schema；不要虚构revision/version/request_id字段。|
|名称响应|`SMi`无Zod响应parse，直接消费`title`、`updated_at`；既有详情updated_at更晚则不覆盖，否则更新title/updated_at，并失效目录。|没有从本函数证明response必有id/project_id；缺完整OpenAPI/runtime样本，宿主适配只能声明检查必要字段，不声称恢复全部响应schema。|
|环境GET/POST|同`/websites/{project_id}/environment`。GET query与POST返回均`tNi.parse`：`{entries:[{is_secret:boolean,key:string,type:'envvar',value:string|null}],project_id:string,revision:number,updated_at:string|null,requires_secrets?:boolean}`。|revision是number原schema未int限定；不能虚构全部GET都回requires_secrets。|
|环境POST body|`Fn`生成`{remove:string[],set_values:[{is_secret,key,type:'envvar',value:string}]}`；不传请求revision。返回完整环境成为新base。|不能把secret遮罩送回服务，不能假定save返回success布尔。|

认证复用真实固定服务桥。每次请求绑定当前account/user/site与取消/代际，renderer不给任意路径/头。官方状态管理`appgen-settings-autosave-state:p` key为JSON `[accountId,userId,site.id]`，保存pendingTitle/pendingEdit与refs，并有`isCurrentIdentity()`复核账号/用户。复制这些语义不要求搬入官方状态库。

## 两条独立队列及离页行为

`appgen-settings-page:dr`中名称队列为`Ne`（局部alias J），环境队列为`Pe`（alias Y），各自saving/requested/status/error；一条失败不得撤销另一条已成功。

- 名称onChange立即保存raw draft并清旧timer，**900ms**后请求J；compositionStart置composing并取消timer，compositionEnd重置900ms；blur直接J；Enter仅非nativeEvent.isComposing且keyCode不是229才preventDefault并J。J自己也检查composing、skipFlush、currentIdentity，防重复/IME误发。
- J设置requested=true；已saving时只记请求。单一async循环每轮取最新raw draft，用trim后的title与saved基线比较；相同则清draft。成功更新saved，只有请求时draft仍是当前draft才清空；编辑期间的新draft保留给后续轮。失败titleFailed=true、status=error、停止自动requested并保留draft；显式Retry会重新发送，即便与旧saved相同也可触发。
- **环境没有名称的900ms计时器。** Xn/Zn字段onChange更新draft；row焦点离开整个group时commit，Enter排除IME后commit；secret toggle立即commit，删除确认后commit，新增空行仅更新draft并暂停展示校验，后续blur/Enter才commit。不得给环境臆加统一900ms自动保存。
- Y先校验draft；无效仅显示缺key/重复key/stored-secret缺新值，不POST。设置requested后由独立单循环串行写；写期间新的draft会用`Ln`相对本轮draft和返回环境rebase，保留用户晚输入与新服务entries，不以成功响应覆盖后续编辑。
- 发送前把remove与set_values全部key放environmentUncertainKeysRef。**任何写失败后先保留该集合和草稿**；显式重试先GET staleTime0，然后`Ln(currentDraft,Pn(oldBase),freshEnvironment,uncertainKeys)`恢复base/合并本地意图，再计算差异写。不能盲重发同一未知结果，也不能失败后清空用户输入。
- cleanup是`useEffect(()=>()=>ze(),[])`，ze在!skipFlush且currentIdentity时调用J/Y。它启动保存，**不await阻塞路由，不丢弃已pending的keyed状态**。账号/用户变化后isCurrentIdentity=false，不再替旧账户开始新flush；已发请求仍需固定身份/取消保护，避免晚响应污染当前账户。
- 转让前调用J/Y后检查是否仍有pending/composing/saving/uncertain，未清空则阻止转让。永久删除开始置skipFlush；删除失败恢复并继续J/Y。21F未接入这些操作时保留后续整合点，不伪造已完成。

## 环境draft、秘密与编辑控件

- `Pn`：普通环境value=null显示空字符串；stored secret无论返回值均用`<REDACTED>`内部sentinel，保留previousKey/keyInputDisabledWhileValue。UI显示“替换机密值”按钮而非真实秘密。点击按钮打开空password输入；Escape恢复sentinel并返回按钮焦点，未输入离开则恢复sentinel。
- `Rn`：stored secret仍isSecret、有previousKey、禁用键标记且值为sentinel或空时视为未改。`Fn`排除它，且remove集合用previousKey保留原key。不能把`<REDACTED>`当新值写回，也不能对所有新建普通字符串值通用禁止该字面量。
- stored secret的key和secret toggle在整个替换阶段仍禁用：Zn依据isSecret、previousKey与keyInputDisabledWhileValue判断，不取决于值是否已替换。In仍对历史/外部draft中的stored secret改公开保留必须真实非空新值的校验，不能据此给UI造切换入口；sentinel或空触发stored-secret-needs-value。
- `requires_secrets===true`时新行默认为secret，secret toggle强制禁用并可聚焦解释地理限制。不是自动把已有普通变量悄悄改secret。
- `In`：空key判`key.trim().length===0`，重复判raw key集合精确相等（不trim归一、不小写），stored secret公开缺新值另判。**没有对全部环境键强加regex**；secret名称限制是服务错误提示，非所有公开key规则。
- `Fn`仅发送相对base变化的entries；删除用base keys缺失求差。输入value可为空字符串。新建/替换变化保留用户原key和值，不因简单清理改数据。
- 一个共享12列grid，items-center、gap-x-2/gap-y-2、p-4（原CSS token；名义8px gap与16px padding），单一表头，Zn每行display:contents；key占5、value占5、secret占1、删除占1。普通值text、secret值password，autocomplete分别off/new-password。组blur只有焦点真正离开组才commit；组内Tab不重复保存。Enter目标必须HTMLInputElement且排除IME。
- 新增添加空key/value行；requires_secrets决定默认secret。删除已有previousKey或未知保存key需确认dialog，警告只展示key不展示value；新建未写行直接移除。取消默认焦点，确认后删除draft并commit，保存中禁止remove/确认。
- 当前公开字段可在保存期间继续编辑，stored secret的固定旧值控件在保存期间禁用；删除在保存期间禁用。不要把整form锁死造成丢失队列编辑能力。

## 权限与错误边界

`cr→lr→ur→dr`的settings读取owner-project（`CNi`只在缺current_user_role时补owner，显式editor保留），原settings表单**没有title/env基于owner/editor的disabled分支，也未按site.status全局锁form**。layout `At`对403/404回Sites；plugins另有owner限制；URL slug与转让各有明确owner条件。不能用这些相邻权限反推title/env只有owner可写，也不能宣称viewer有权写。真实角色写矩阵、服务400/403/409仍需隔离授权账号或官方契约补证；服务拒绝必须保留草稿并呈现，不能以静态发现当写权限。

`xr`只对原服务Yg错误JSON读取`detail.type`：

- environment_requires_secrets：真实中文“由于地域限制，此网站不支持环境变量。请为每个值启用“密钥”选项，然后重试。”
- invalid_secret_name：提示机密名称1–100、首字符A–Z/a–z/_，后续A–Z/a–z/0–9/_，要求同步更改代码引用。
- regional_environment_unavailable：使用Sites智能体添加、更新或移除机密；不能伪称旧设置接口支持地区机密写入。
- 其他错误（包括未特殊识别的400/403/409）：title/environment各自持久inline错误+toast，保留草稿，Retry只重试error的字段。标题/环境/两者失败有独立中文key。未发现本页针对409的特殊覆盖规则，不得自行视为成功或“最后写入获胜”。

## 开发前验收清单

|ID|场景|必须证明|
|---|---|---|
|F01|名称空/同值/raw空白/100字符|空不写、同值不写、trim发送、UI长度限制；响应title/updated_at最低字段检查与较新缓存保护。|
|F02|900ms/blur/Enter/IME|899ms无写、900ms一次；blur及时commit，IME选字Enter不写；composition结束重计时。|
|F03|两条独立队列|名称A写中改B、环境写中改值，串行最后值真实读回；一条失败不撤销另一条成功。|
|F04|stored secret|未改/空恢复/Escape不泄露不写sentinel；替换与转公开验证新值；没有真实secret值进入日志。|
|F05|环境空/重复/添加/删除|raw key重复、trim空key阻止；新增行未提交不写；已有删除确认取消不变、确认才发remove。|
|F06|未知结果与失败|写断开后GET再rebase，仅差异重试；错误可见且草稿保留，返回/重开仍显示同身份pending。|
|F07|路由/账号|同身份离页启动flush且pending继续存在；切账号不开始旧flush、不晚写新账户、取消不伪成功。|
|F08|真实服务/原生|隔离账号工作区真实写→GET比对；键盘焦点/中文IME原生验证；不能拿离线mock当真实写。|

本稿只给来源合同，不表示上述用例已执行。宿主HTTPS/大小/身份严格检查等适配边界需逐项记录，不凭安全理由造出与原行为不同的产品成功状态。

## 删除确认弹窗的共享组件复核

21F原生组件实测发现删除弹窗落在左上角，追加追踪`Hn→Me/yP→LSn→HSn/ISn`，证据`21F-settings-write/reference/dialog-contract.json`含21个完整锚点及逐文件哈希。默认无size覆盖，固定left/top 50%并双向平移-50%，宽520 CSS px、最大92vw；未发现此默认分支统一max-height，不借用其他variant限制。共享body padding5名义20px、section顶部3名义12px、footer顶部5及gap3名义20/12px。

`O→SP/RSn→qC`生成h2标题id，`Ae→xP/zSn→JC`生成说明id，DialogContent按存在性关联aria-labelledby和aria-describedby。原生dialog等价实现须关联实际标题、说明。标题“确定要删除环境变量吗？”，取消默认焦点、确认“删除变量”；有key说明包含该key，无key使用不含名字的中文说明。定位、尺寸、语义须在当前构建宽窄与原生输入下复验，不以静态锚点代替像素通过。
