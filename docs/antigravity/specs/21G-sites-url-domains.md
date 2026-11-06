# 21G Sites URL与自定义域名开发规格

2026-11-07。21F提交2aef033后的下一单元。先完成下述固定官方来源合同，当前仅开始设置能力独立读取的最小增量；URL可用性/改名pending收敛、自定义域名增删刷新与DNS呈现继续属于本单元范围，未开发项不得标完成。不修改已发布候选preview.8的精确标签。

执行顺序：1）设置能力读取与错误/关闭状态，验证sharing gate关闭仍读、false无域名请求、失败可重试；2）URL规范化、可用性检查及提交/收敛，验证400ms和1000ms/10min、取消/晚事件；3）域名真实写入、DNS及确认弹窗，验证完整返回与读回、未知结果恢复；4）宽窄/原生/全标准和阶段交付。每部分先相关回归，冻结最终产品后统一完整验证，不重复没有受影响的全库检查。

本仓库没有现成公共后缀解析依赖；官方allowPrivateDomains根域识别不能用点数量或少量后缀表代替。该细节保留为待解决约束，不新增依赖、不伪造DNS根域判断；继续其余无依赖动作。

以下为开发前来源合同；源码静态发现不表示真实账号HTTP或官方GUI已测。

# 21G Sites URL 与自定义域名：可开发动作合同

基准固定26.1027.3384.0。`manifest.json`复用21E同包fresh完整文件，复制时再次核每文件SHA256与原entry integrity。没有重新整包hash、HTTP、官方GUI、DPI或账号权限实测。`anchors.json`为31完整函数与34真实export定位（0-based UTF-16），`translations.json`57直接中文，`self-check.json`逐文件hash与片段往返0失败。

## 1. 设置能力必须独立读取

- initial SNi的fNi（真实export PUt，settings内alias Je）queryKey为`['appgen','settings-capabilities']`，GET `/websites/access`，retry=false，staleTime=ONE_MINUTE；没有siteId路径、没有sharing gate enabled条件。
- settings dr初始化无条件调用该query；因此476199071关闭仍要读设置能力。不要把已有readSitesAccess仅sharing=true才读的目录能力当作此query；不要要求capabilities.enabled===true才识别slug/customdomain布尔。
- `custom_domains_enabled===true`才enabled GET `/websites/{project_id}/custom_domains`。正常false隐藏域名整行；能力读取失败显示域名错误行+Retry，而不是拿失败当不可用或显示假空目录。失败Retry先refetch能力，若false返回unavailable；true才refetch域名。域名本身GET失败与能力GET失败分开。
- slug Change按钮条件严格为gate324493575、capabilities.slug_change_enabled===true、site.status==='active'、current_user_role为owner或nullish。完整CNi使用`current_user_role ?? 'owner'`，不覆盖显式editor或空字符串。不要据此推断domain同样owner-only；domain行原逻辑没有相同角色判断。

## 2. 更改URL dialog

来源 `appgen-change-slug-dialog:E/de/fe/A`，settings dr通过dynamic import打开，输入currentSlug、projectId、hostedDomainSuffix。归一化仅用于查询和提交：raw input保留，wire=trim().toLowerCase()；正则`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`，没有此input的maxLength原值证据。不自行限制为63或100。

1. 打开compact共享Dialog（ISn compact=w105，名义420px，max92vw、固定居中、默认90% elevatedsecondary背景），标题“更改 URL”，说明“为你的站点输入新的网址”。输入autofocus、autocomplete off、spellcheck false，h9/rounded-md。后缀只显示已有hostedDomainSuffix，不拼猜官方域。
2. raw归一化后与currentSlug相同→无状态提示、不查availability；空值→requirements；非法非空→invalid-format。合法不同值先400ms debounce；debounced值仍等当前归一化值才query。
3. POST `/websites/{project_id}/slug/availability` body `{slug}`。queryKey含site+debouncedSlug，retry=false/stale0。CMi无响应Zod parse，UI只接受当前slug匹配的响应，`available===true`启用submit；false不可用，网络失败明确error+Retry。不能把晚旧结果应用新input。
4. 提交POST `/websites/{project_id}/metadata` body仅`{slug}`。vNi取response.slug_change，null/undefined失败；不把metadata名称更新的title/updated_at响应要求强加此操作。源附近有`{requested_slug,status:'pending'|'complete'}`schema定义，但vNi实际没有调用此schema.parse。宿主选择严格schema是适配验证，不能声称原wrapper已强制完整shape。
5. Dialog isPending时input禁用、cancel禁用、外点忽略、隐藏X，防重复submit；成功关闭dialog，失败保留raw并toast“无法更改站点 URL”，没有toastRetry action。
6. pending响应：按site缓存`{requestedSlug,expiresAt:Date.now()+600000}`；complete/null非pending清缓存，并onSettled失效相关query。**pending不代表新URL已生效。** 不能插本地成功URL。
7. settings dr读取pending缓存，只有requestedSlug!=当前site.slug时立即GET网站摘要，然后按1000ms间隔轮询CNi，retry=false/stale0；匹配后更新owner详情缓存、失效目录/详情、删除pending。每次GET返回未匹配才判断10min超时，匹配优先于过期；超时toast“站点 URL 更改所需时间比预期更长”，轮询失败toast“无法确认站点 URL 更改”。缓存清理匹配expiresAt+requestedSlug，不能误删新请求。
8. 源pending query gcTime=660000、staleInfinity，回收从无人观察时开始；隐藏页面仍有observer，不是从创建起11分钟强删。不是localStorage持久任务。未证明应用退出后恢复pending或服务后台停止。

后缀补证见`reference/slug-supplement.json`：dr优先hosted_url（即使无效也不回退live_url），否则仅当iGs识别live_url的hostname以slug加点开头、且属于`.chatgpt-team.site`、`.chatgpt.site`或`.appgardenapps.dev`时使用live_url。iGs返回去掉slug的含点后缀，不能从access发明域名字段或缺省域名。完整固定函数与客户端96个组合对照留证；静态来源不等于真实服务实测。

## 3. 自定义域名请求与完整返回

- GET `/websites/{project_id}/custom_domains` -> `{items:CustomDomain[]}`，schema oNi；retry=false，stale1min。
- POST同路径 `{hostname}` -> CustomDomain，mutation mNi；更新同site domains缓存（同id替换/否则append）。add dialog仅`raw.trim()`，不lowercase，没有原UIhostname regex/长度/URL剥离。空trim禁提交；原服务决定合法性。
- POST `/websites/{project_id}/custom_domains/{custom_domain_id}/refresh`，没有body -> CustomDomain，hNi；返回active时先失效目录/详情等，再更新该域名缓存。非active不假成功。
- DELETE `/websites/{project_id}/custom_domains/{custom_domain_id}` -> **CustomDomain**，yNi；不是success布尔/204。源parse aNi再按返回id从缓存移除；被删除域名若原返回status active，则额外失效目录/详情。
- CustomDomain完整aNi：`apex_proxy_ipv4_targets:string[]; cname_target:string|null; created_at:string; hostname:string; id:string; last_error:string|null; project_id:string; provider_status:string|null; ssl_status:string|null; status:'pending'|'active'|'failed'; updated_at:string; validation_records:[{name?:string|null,record_type?:string|null,value?:string|null}]; worker_name:string`。所有未带optional字段原schema要求；没有凭空添加deployed、verified、dns_ready字段。
- 源mNi/hNi/yNi未显式retry:false；不能引用slugquery的retry:false假证域名写自动重试策略。最小宿主保守不自动重发并读回需明确为适配。

## 4. 域名列表、添加与设置

bn按能力/目录加载状态显示split row：标题“自定义域名”。无域名可Add；不是所有状态都显示Add。已有条目每个xn显示hostname、pending说明“DNS 更改待处理。可能需要 24 小时才会生效。”（严格文案见translations），failed说明及last_error；active无pending/failed说明。provider_status/ssl_status保留真实字段，不编成额外绿色verified badge。

- pending/failed有“查看DNS设置”与刷新按钮；active隐藏这两个按钮。所有域名有移除按钮。refresh/remove任一pending时锁冲突操作。refresh失败toast，已有条目保留。
- Add compact Dialog（420名义/92vw），标题“添加自定义域名”，说明用户需要拥有域名及DNS权限。input type text/code/autofocus/spellcheck false；raw保留。POST pending禁input/cancel，忽略外点，隐藏X；失败dialog保留输入、toast；如果Yg JSON匹配`detail.type='invalid_project'`且message精确`Publish the Site before adding a custom domain`，额外提示先发布。
- Add成功不直接关闭：Tn本地domain变为返回结果，切换到Sn DNS setup Dialog。不能在add后省掉设置步骤或标已上线。
- Sn为default Dialog（520名义/92vw），标题“完成 {hostname} 的设置”；DNS表type/hostname/value，可分别复制name和值。mobile隐藏表头，以行内type显示。
- “我已在提供商处添加记录”按钮**只关闭Dialog**，不POST refresh、不标域名active，也不代表DNS已验证。
- “请ChatGPT帮助”使用真实Sites插件序列化预填带原hostname和逐行DNS记录；不立即发送、不改DNS。当前clone无Work承载时仍是明确待实现，不将普通Codex线程伪作成功。

## 5. DNS派生与移除

Dn=基础On+完整非空validation_records：record_type/name/value分别trim，任一空跳过。基础On：若An识别hostname是注册根域且apex A targets非空，则每条A的name='@'；否则cname_target为空时A的name=完整hostname；有cname_target时用CNAME(name=hostname,value=cname_target)。An依赖原域名解析器allowPrivateDomains，不得以简单“点数量”假识别根域。返回DNS值是服务真实值，不写死。

移除compact Dialog：标题“移除 {hostname}？”，说明访问者不能再用此域名；cancel ghost，确认danger/submit，pending忽略外点/隐藏X/禁止cancel。成功按真实DELETE返回更新缓存并关闭；失败保留Dialog+toast，不提前从React列表删。无需输入slug，不能照搬永久删除站点的确认合同。

## 6. 身份、未知结果及未证项

- 上述源函数通常靠当前scope/query分区，而非每个mutation显式传expectedIdentity。clone必须继续已实现account/user/generation写scope与失效取消、离页保监听/完成释放，不能让旧账号回包改新账号。
- slug有明确服务pending轮询机制，但网络未知POST的实际完成状态没有源级完整恢复流程证明；domain add/remove网络未知也没有源中“先GET再重发”的完整机制。安全适配应先真实GET摘要/域名目录判断已应用，保留draft，不盲重试；这是一项适配设计，不能写成静态原流程实测事实。
- 不自动访问用户DNS服务商、不假DNS操作，不在账号限制/错误时生成演示域名或成功状态。
- 未证：真实服务角色矩阵（尤其editor/viewer domain writes）、400/403/409具体errorbody、metadata pending实时样本/后台边界、DNS传播时间、真实复制焦点/IME、同环境官方配对像素、许可允许的资源复用。

## 7. 开发验收最低映射

- 合法/非法/空/同slug与raw大小写：仅合法不同值400ms后查；399ms不查，晚响应不激活submit。
- availability error可重试，旧slug响应不用于新值；disabled/pending外点、Escape、焦点/取消不发写。
- metadata complete与pending区分；pending1000ms GET、10min超时、轮询错误、晚新请求不误清。
- 设置能力独立于sharing gate；customfalse无domains GET且隐藏；能力失败/目录失败各自真实retry。
- Add仅trim hostname；真实完整domain parse/项目ID绑定；失败保留raw；success→DNS setup；确认记录只关闭无refresh。
- refresh回active/failed缓存与目录读回；delete失败保留条目，unknown先GET不重复写；身份变化取消且旧toast禁止。
- DNS根域/A/CNAME/validation、空字段过滤、copy实际文本、窄窗表格；共享Dialog420/520/92vw居中且AX有title/description。

上述为验收要求，不代表已经执行或已完成21G。
