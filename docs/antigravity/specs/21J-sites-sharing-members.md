# 21J Sites 共享参与者与邀请：固定版本开发前规格

2026-11-07。状态：**已有参与者角色/移除有限本地自验完成；整页及完整邀请仍开发中，未用户验收**。承接21I链接共享闭环；本文件先完成只读取证，覆盖已有参与者的角色、移除确认，以及邀请、成员/组搜索和团队建议。实现、已登记界面差异与证据见[21J阶段记录](../acceptance/21J-sites-sharing-members.md)。preview.9不包含本单元。

## 1. 基准、证据及边界

固定官方Windows Store `26.1027.3384.0`，asar SHA256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。开发前取证复用21E完整提取，重新计算8份原始文件hash并逐一匹配manifest与asar entry integrity；**没有重新整包hash**，取证步骤没有真实账号HTTP、官方GUI、权限/gate激活、Cargo、产品构建或像素测试。后续实现的实际验证另记阶段记录，不覆盖取证时的边界。

本轮证据：`.ref/parity/21/actual/21J-sites-sharing-members/reference/` 的 `manifest.json`、`anchors.json`、`translations.json`、`self-check.json`、可重复 `extract.cjs`。8份资源、55个完整函数/赋值/局部handler、25个真实export、42项直接中文；hash和片段往返0错误。原文位置均为0-based UTF-16字符偏移、右端不含，不是行号。raw路径明确引用21E原文件，未伪装重新从安装包提取。

关键原始文件：

|文件|真实职责|
|---|---|
|`appgen-share-dialog-778a71d62104.js`|Y权限/搜索/写handler；gn参与者行；wn菜单；hn移除确认；Nn/Pn/nn目标映射|
|`sites-share-query-3bfcb272daf5.js`|m GET规范化；h串行PATCH及ACK后缓存合并；g失败后重新GET|
|`use-workspace-users-73d44209e399.js`|h成员搜索、g成员GET、v组搜索；m按邮箱精确查成员|
|`dialog-utils-47bc5da6d90a.js`|排除当前成员、已共享成员、已选成员；显示标签|
|`modal-permission-dropdown-b56c4d79264f.js`|h真实角色菜单、inline样式和移除项|
|`workspace-team-recipient-suggestions-c1e4675f8237.js`|仅把当前workspace团队建议暴露给弹窗|
|`app-initial-4267e52fe5b0.js`|Og计划类别、j_t工作区设置、zEt团队资格/真实目录，Olt表|
|`zh-CN-88ebb426d686.js`|已有直接中文；缺失项不能拿另一语义旧key冒充|

本轮没有恢复完整OpenAPI schema。静态query存在不证明当前账号可用，也不证明所有服务器角色矩阵。

## 2. 不可合并成单一开关的权限

沿用21I按绑定ServiceIdentity.accountId选raw账户成员、真实account/read邮箱、完整身份绑定gate快照与权限读取。不要用全局userId、原raw ordering首项、site摘要role或初始owner提示授予共享写权限。

为忠实复现Y/gn，定义：

- `R`：有效policy的users中真实owner与当前account_user_id或不区分大小写邮箱匹配；403/404时为false。
- `b`：当前账户structure为workspace；`C`：476199071；`H`：共享mutation或profile mutation保存中。
- `K`：当前链接访问draft优先，否则policy.access_mode；`Ut`：非editor访问users中存在account_user_id==null的外部访问者。
- `O`：真实Og(plan)，即Olt表成员；`P`：工作区settings.permissions，不能把未加载当空权限已确认。
- `oe = account存在 && gate2196156952 && (!O || (account_user_role==='account-owner' && P.permissions存在) || P.permissions包含'chatgpt.workspace.feature.sites.invite_external.access')`。
- settings query仅当2196156952 && workspace && O启用；j_t可走宿主accessInputs订阅，或GET `/accounts/{account_id}/settings`。clone需保留已有身份scope；不能假称所有原路径都发同一HTTP。
- `Ht = b && C && R`（canManageEditors）。
- `Wt = R && policy.access_mode!=='admins_only' && (K!=='public' || C) && (b || oe || Ut)`（canManageInvitees）。
- `qt = Wt && (b || oe)`（展示邀请输入）。个人oe=false但已有外部访问者时，可管理已有邀请者，不因此显示新邀请输入。

Olt完整19项：business、enterprise、enterprise_cbp_usage_based、enterprise_cbp_automation、enterprise_cbp_trial、enterprise_cbp_view_only、deprecated_enterprise、hc、hc_consumption、finserv、law、ent26、education、edu_plus、edu_pro、edu、deprecated_edu、k12、quorum。**team不在此表**；不要按产品名联想替换此表。

### gn真实行菜单条件

`j=R&&!H`、`M=Ht&&!H`、`N=Wt&&!H`。行顺序：owner→workspace的editor→其余访问users→groups；owner没有角色/移除菜单。

|行|菜单/动作条件|
|---|---|
|已有editor|workspace才进入独立editor数组；readOnly=`!j&&!M`。降级按钮仅workspace && j && account_user_id非null；移除仅workspace && (j||M)。**已有editor的owner降级/移除不能统一再要求C=true**。|
|viewer/其他非owner用户|readOnly=`!N || !entry.editable || (H && account_user_id==null)`；升editor回调仅M && account_user_id非null；移除仅N && editable && (!H || account_user_id非null)。须同时尊重readOnly及回调存在，不能仅检查一个bool。|
|group|readOnly=`!j || !entry.editable`；只提供当前viewer和移除，没有editor升级；移除回调仅N && editable group id集合含该id。|
|外部邮箱用户|account_user_id为null；不能升editor，原handler显式报错并Promise.reject；移除用email。不要因有email就构造成员ID。|

bn为**显示owner行**的选择器：先找owner；否则找当前邮箱trim/lower匹配；否则当前成员ID匹配。这个显示fallback不能取代R的授权判断。

## 3. 搜索、邀请与目标排除

Y中raw搜索Re保留；U=Re.trim()。工作区用户hook接Re，内部trim并150ms debounce；个人不发workspace用户搜索。非空、最新trim值等于debounced、authMethod为chatgpt或chatgptAuthTokens、accountId存在才查询。源stale一分钟、retry=false、networkMode always、reconnect可刷新。

|查询|真实参数与时序|
|---|---|
|GET `/accounts/{id}/users`|limit10、offset0、query=trim文本、include_profile_photos=false（本弹窗未启用照片）、include_total未提供则省略；组合query signal与15秒timeout；返回body.items。|
|GET `/accounts/{id}/groups`|limit10、offset0、query=trim、include_member_counts=true（Y显式）、include_total=false；150ms/15秒，返回items。仅workspace && Og(plan) && owner且非空才向hook传查询。|
|团队建议|不是groups query别名。zEt的$y要求853110088、账号allowed、workspace已加载、目标accountId一致、authenticatedAccountId一致；GET `/accounts/{id}/teams` limit100/offset分批，按has_more继续；建议wrapper再过滤workspace_id===当前account。不得无条件请求或返回假团队。|

成员候选排除当前account_user_id、已有非editor和editor成员ID、已选成员ID；share弹窗再要求email非null。users的真实标签name→email→id，不能伪造用户名。已存在emails和成员ID是不同排除维度。

外部邮箱：U.toLowerCase()经原In.safeParse成功；不能等于当前邮箱trim/lower、不能与已有users/editors邮箱trim/lower相同、不能与已有成员候选邮箱相同；需要oe且不在H。原email解析器内部通用合法性算法本轮未恢复，**不能用任意简化正则冒充同一parser**。

组/团队按id去重，组名toLocaleLowerCase包含查询；已共享组不可选，团队候选和组候选相互去重。团队空query可在focus显示建议，组非空查询loading/error分开；组失败有Retry，用户、组、团队错误不能合成一个假“无结果”。

邀请目标：

- user：`{recipient:account_user_id,recipient_type:'user',role:'viewer'}`，初始行来自真实user，role viewer、editable true。
- group/团队：`{recipient:groupId,recipient_type:'group',role:'viewer'}`；team在共享链仍是group类型recipient，不能改为team后端字段。
- external：`{email:normalizedEmail,role:'viewer'}`。

选中后源先清搜索输入再发PATCH；失败toast，不把菜单选中当成功，不凭本地行宣布获得访问。未来clone的失败草稿/明确重试若增加，需标适配，不写成原始UI行为。

## 4. 角色变更和移除的真实PATCH

所有操作共用PATCH `/websites/{project_id}/share_access`、retry never、scope=`sites-share-access:{projectId}`串行，与21I mode写互斥。请求不加revision、expectedMode、siteId到body；path的projectId由宿主编码并绑定身份。

|操作|body|
|---|---|
|成员升editor|`{recipient:memberId,recipient_type:'user',role:'editor'}`|
|成员降viewer|同上role viewer|
|移除成员|同上role null|
|移除group/团队|`{recipient:groupId,recipient_type:'group',role:null}`|
|外部邮箱移除|`{email:entry.email??'',role:null}`；正常数据应有真实邮箱，不能补假邮箱|

角色改变即时发PATCH，不等待底部保存；viewer→editor、editor→viewer没有hn确认。**只有移除**打开hn确认。

发写前：失效/error旧policy先g GET；policy和有效access_mode必须存在且不能admins_only。只有mode动作携带access_mode；recipient动作仍需当前policy允许，不能因body不含mode就跳过检查。

响应：明确JSON null或status pending/accepted对象可接受；undefined、空body、其他status失败。不额外要求project_id、recipient或完整policy响应；role_id按真实分支解释，不伪造accepted。

h的缓存合并原逻辑必须记录清楚：ACK非null时，把role_id恰为role-site-editor映射editor，其他值（包括缺省）映射viewer；ACK为null时保留请求role。用户合并保留owner，用相同account_user_id或精确email排除被改条目后再按role非null追加；group按id排除后按role非null追加。pending由ACK.status决定。**因此不能武断说所有非null移除ACK必定使本地行消失**：当role:null请求收到非nullACK且role_id非editor时，字面分支会重新追加viewer；服务实际移除ACK约定/role_id null样本尚未取得。实现应保留真实ACK并实际GET收敛，未从服务读回消失前不宣称删除成功，不静默伪造null。

写错误：源先g取消/失效旧读并GET收敛，10秒取消边界，再抛原错误，不自动重发PATCH。成功后原h协调已有读、写缓存并失效摘要；clone额外GET读回是已声明适配，不能假称官方同样多一次GET。

## 5. 菜单、确认框和中文

wn的默认permission=visit，映射“查看者”；edit映射“编辑者”。readOnly时只有文字，无下拉。可改角色才options visit/edit，否则只保留当前项；移除项为“移除访问权限”。modal-permission-dropdown h使用inline、size默认sm、gutter2xs、opticallyAlign=end；完整menu/焦点/边界与共享组件需要后续浏览器/原生验证，不能把这些静态class直接换算为物理像素通过。

hn为现有共享qe的compact变体，**不是21H域名ISn**：

- 标题“移除 {label}？”。
- editor说明：直接中文“{label} 将无法再编辑 {siteTitle}”。
- viewer/group当前说明key `appgenShareDialog.removeDialog.accessListDescription`：源英文明确“从本站访问列表移除，其他共享设置仍可能赋予访问”。**该key在固定中文包缺失**；旧removeDialog.description“{label} 将无法再访问 {siteTitle}”不是同一含义，不得冒充当前译文。按实际语言系统fallback或待实测，明确记为缺译。
- 取消secondary/xl，确认danger/xl、submit；无输入slug，不照永久删除站点。
- pending防重复、取消禁用、isDismissalDisabled=true；onConfirm resolve才关闭，reject恢复pending=false并保留确认框。Escape/外点与焦点返回须按共享容器再实测。

直接中文已证：输入电子邮箱地址、添加用户或群组、添加成员或团队、没有匹配的用户或群组、你的团队、查看者、编辑者、所有者、移除访问权限、待处理、移除/取消。角色说明完整保留“编辑站点并发布更新。访问、下载、更改或删除其数据。”和“查看和使用站点。”，不能弱化真实权限说明。

## 6. 第一可实施闭环及后续完整范围

首个可开发闭环：**已有viewer与group的移除**。复用21I真实policy/owner/context与序列化scope，先实现权限驱动行菜单→hn确认→role:null固定PATCH→保ACK→真实GET收敛→父摘要/截图失效；取消零写，失败/unknown保留行并只读恢复，403/404撤权并作废旧metadata请求。明确验证GET不存在后才移除呈现；无法确认时不能造成功。它不依赖尚未恢复的email解析器、搜索协议schema或团队目录。

下一闭环依次：

1. 已有成员editor/viewer升级降级，完整role_id/pending和gate矩阵；已有editor降级移除不能被泛化gate误禁。
2. workspace成员搜索→邀请viewer，复用真实account/users、150ms/15秒、排除已共享/自己，结果shape按实际消费并补探针；非owner不能提交。
3. workspace groups与真实teams建议，按Og/853110088/账号allowed分别准入；含完整目录分页、独立错误与重试。
4. 外部邮箱邀请及权限settings、真实email解析器和地域/计划限制；不绕gate2196156952，不向外发送真实邀请作自动测试。
5. 头像/profile showcase、首次发布、转让所有权与其它深层分享链仍保留整个Sites目标，不能因本阶段只处理成员而删除。

## 7. 逐动作验收合同

|ID|前置/动作|可证目标|
|---|---|---|
|J01|owner/editor/viewer、personal/workspace、C/oe/K/H组合|菜单显示、只读、升级/降级/移除与第2节一致；表单Enter不能绕owner/readOnly|
|J02|viewer/group点击移除→取消/确认|取消零PATCH；确认一次，raw recipient正确，pending禁关闭，成功GET确认后才呈现移除|
|J03|editor降级/移除且C=false|按已有editor真实owner分支允许；外部email永不能升editor|
|J04|null/pending/accepted/坏ACK/role_id分支|明确null不混204；不从请求role反推ACK角色；pending不冒充已接受；非null移除ACK实际GET收敛|
|J05|403/404、5xx、10秒GET失败、网络未知|撤权与旧metadata取消；错误可见、原行/确认保留、无自动重发；显式恢复后才重新操作|
|J06|中文输入、149/150ms、空查询、切query/切号|真实搜索参数与取消，旧结果不污染新query；无loading假空；用户/组/团队状态分开|
|J07|自己/已有成员/重复邮箱/组团队同id|按源去重，缺邮箱成员候选不渲染；不把email当memberId|
|J08|个人oe/已有外部访问者，workspace计划/settings加载|邀请输入与已有管理资格分离；未加载permissions不授予account-owner外部邀请|
|J09|角色change即时写、owner行、pending重复点|同site mode/recipient写串行、owner不可移除、重复点击单飞；profile写冲突不双执行|
|J10|关闭重开、离页、账号代次变化、晚ACK|绑定site/account/user/generation；旧写/旧GET/旧toast不污染，待写监听释放规则延续21I|
|J11|宽/窄菜单、嵌套确认、Tab/Escape/IME|同源共享容器和按钮、焦点规则；raw JPEG开发截图不代替配对无损像素证据|

## 8. 未证与交付门槛

待证：真实share_access完整schema、recipient/email写ACK和role_id实际样本、移除服务最终语义、邀请是否发邮件/限流、全部账号/角色矩阵、workspace设置订阅恢复分支、真实teams数据schema与用户搜索照片字段、In邮箱解析器完整算法、中文缺译运行时fallback、头像授权、原生焦点/关闭/IME及官方同环境像素。

开发前把本次范围的协议shape和动作写成实际红回归；只在隔离fixture验证写，不自动向真实用户/团队邀请。功能实现、离线回放、真实服务、原生、像素与用户验收分别记录。本文件及自检0错误仅表示资料锚点正确，不表示21J或整个Sites完成。

## 9. 移除确认框的组件、宽度、嵌套关闭与缺译补证

本补证仍只读，无GUI/HTTP。新增 `reference/ui-manifest.json`、`ui-anchors.json`、`ui-self-check.json`、`extract-ui.cjs`：**5份资源重新hash核对、28完整函数/赋值/CSS片段、8真实export、11 import定位，0错误**。5份是前轮8份中的share-dialog/initial，加shared JS和2份CSS；合并资料共有11份不重复资源，不能把重复hash核对次数当独立文件数。

### 9.1 compact改变内部布局，不把最大宽度改成420

真实链：`appgen-share-dialog:hn`→本chunk import `initial.iP as qe`→initial真实export **kls as iP**→kls→Als/jls→Els。

- hn给qe `variant:'compact'`、title/subtitle/footer、isDismissalDisabled=saving，没有width/size420属性。
- kls把onClose交Als，其余props交jls；**Als不看variant，始终给K3.Content maxWidth:512**。K3.Content=gls，将maxWidth经CSS变量helper写为modal-max-width；shared真实export Cx as NPt（initial import NPt as rae）、完整赋值证据可核数字到px规则。
- 实际CSS是`b74e19ff7ff4.css`的`_Modal_901vo_2`。>=48rem桌面max-width=var(--modal-max-width,450px)，此链显式512，因此是**512 CSS px最大宽**，不是CSS默认450，也不是21H ISn的420。<48rem为底部全宽sheet、max-height92%、仅顶部圆角；没有因variant compact改成固定居中小框。
- compact只让Els用两行grid，header/说明/children合入滚动区，`-mx-5 -mt-2`及内部`px-5 pt-2 pb-5`，subtitle在jls单独`pt-6 text-codex-description`渲染；footer使用Oo且expandSingleButton=false。它不是sectioned父共享框的同一内边距结构。
- 原始CSS还有enter600ms、modal exit300ms、宽窗inside max-height calc(95vh - 40px)；这些是静态动画配置，不是本机测得时序。根字号、应用缩放和48rem实际断点仍待同环境测量。

### 9.2 danger按钮与保存中关闭

hn取消为shared **Wx as fPt**，color secondary、size xl；确定为同按钮color danger、size xl、type submit、loading/disabled=saving。shared Wx把这些转成`data-color`/`data-size`/`data-loading`，variant默认solid；loading默认inert，并与disabled合并为原生button.disabled及aria-disabled。`5257da4ba4ae.css`的完整ojzy2按钮规则已经核hash和片段：xl使用control-size-lg等token，danger使用对应危险色token，不凭空宣称固定红色或物理尺寸。

hn提交只在!saving时执行，一次setSaving(true)后等onConfirm Promise：resolve调用onClose，reject只setSaving(false)。不能立即从列表删项/关闭确认，也不能吞reject误当成功。

jls看到isDismissalDisabled=true时：

1. 注册onRequestClose返回deny。
2. **X仍存在但disabled**，不是21H域名弹层的隐藏X。
3. form submit有!isDismissalDisabled&&!isLoading防护。
4. wls外点遍历checkAllowClose，遇deny即preventDefault；自定义Escape回调也检查同集合后才setOpen(false)。取消按钮同时disabled。

非pending时返回allow；X、取消及容器正常dismiss路径可关闭。具体鼠标按下/点击次序、Escape与输入法、辅助技术行为仍需真实Tauri/官方对照，静态合约不等于已测。

### 9.3 嵌套portal、焦点与Escape栈

每次Als自己createPortal到document.body，外包装fixed/inset0/z50/data-overlay-owner；其内部Pcs Provider给当前root设置radixPortalContainer，gls经shared `_je as Hjt`读取。故hn虽然在Y的React children中出现，实际是**独立body portal确认层**，不是直接嵌套父共享role=dialog的普通DOM块。不能用父框的overflow或任意全局z-index猜测等价。

共享K3内部jie明确modal:false，KC走Radix非modal的KCe分支，trapFocus:false/disableOutsidePointerEvents:false；其qCe FocusScope显式loop:true。除此之外，gls有挂载后若焦点不在容器就focus容器的useEffect、容器自身Shift+Tab时定位最后可聚焦控件、阻止focusOutside/blurOutside的自定义处理。**不能把这一组合直接写成已证明完整原生focus trap**；完整Tab循环、辅助技术树、父框焦点暂停仍待运行时验证。

Escape不是任意document listener同时关两层：shared `_A as Kjt`对应vA维护pA栈，新注册unshift，body keydown遇Escape只取首个callback；关闭/卸载按id注销。gls的RadixonEscapeKeyDown由Zve/MPt preventDefault，真正关闭走自定义栈和checkAllowClose。静态链说明“只给栈顶处理并遵守deny”的设计；同帧注册/动画/嵌套菜单的实际优先级仍待原生测试。

Als第一次root ref就记录activeElement（排除body/documentElement）；关闭自动聚焦时，仅当当前焦点仍为body或处于该portal内，才调用调用方onCloseAutoFocus，未preventDefault且旧元素仍isConnected才focus({preventScroll:true})；最后阻止Radix默认focus恢复。**不保证移除菜单item仍连接**，因此不能承诺关闭必回某个具体行按钮：菜单项卸载后的fallback位置、确认取消/成功后父层焦点必须实测。onAfterClose交给Als的onClose，需保留动画后清理语义，不能把所有焦点动作当同步。

### 9.4 缺中文的精确fallback边界

hn当前viewer/group descriptor的原始defaultMessage为：

> This removes {label} from this site’s access list. Other sharing settings may still give them access.

id=`appgenShareDialog.removeDialog.accessListDescription`，label由带font-medium的React span插值，完整hn锚点已留存。固定zh-CN源码全文未包含该id；旧removeDialog.description的直接中文虽然存在，却不等价于当前说明，不能替换成“将无法再访问”。

shared `Rj`完整函数中的Lj（FormatJS formatMessage）已补证：在messages中找不到当前id且defaultMessage存在时，尝试用defaultLocale/defaultFormats格式化defaultMessage；格式化异常则onError后返回defaultMessage原文或id。`Fj`默认配置defaultLocale=en、fallbackOnEmptyString=true。由此可证明**正常配置下存在英文defaultMessage回退代码路径**，不是编译器自动把缺译改成新中文，也不是必然展示旧中文。

尚未证明：本机官方当前locale provider是否叠加远端/另份messages、onError实际配置、缺译运行时日志、rich text插值输出、屏幕实际英文/空值。没有运行官方GUI，因此不能声称用户屏幕已看到这句英文。clone可忠实提供当前英文defaultMessage并记录缺译，不能自造中文并标“官方文案”。

以上是开发前对第5节输入的补强，该取证步骤本身没有开发或放行21J；后续有限实现见阶段记录，不改变真实HTTP、完整schema、正常共享原生与像素待验状态。
