# 20E GPT 公共目录、搜索与只读详情：阶段记录

2026-11-06。状态：本阶段本地自验和最终构建已完成，待用户验收；未推送或发布。属于 preview.6 之后的新开发。[开发前合同](../specs/20E-gpts.md)保留整页目标，本阶段不等于 GPT 聊天、工作空间和管理全部完成。

## 官方来源与边界

基于固定 Store 26.1027.3384.0、asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。35 项 fresh entry integrity、56 个 UTF-16 锚点及实际中文已核对；直接准入补证完整原函数、Adt28/Olt19计划表及原函数隔离样本。另重新读取原生 early-bootstrap，证实 `X-OpenAI-Attach-Auth` 是在真实 HTTP 前删除的内部标记；宿主保留等价身份认证，不把标记原样发服务器。具体 hash/偏移/样本见 `.ref/parity/20/actual/20E-gpts/reference/`，不使用旧补丁包规格。

真实账号 gate、官方运行窗口/DPI/缩放、同环境截图未知；静态来源与离线回归不当作在线集成或像素一致。

## 当前实现

- `gptsData.ts` 保留原 resource、分类/locale/display group/type、排名、作者/用量、限制和工具/about真实字段；不再提前压扁成四个字段。snorlax、restriction优先级及明确owner例外按原函数处理，未知类型不编造。
- `gptsClient.ts` 使用原始 accounts map、当前身份、完整 Statsig 快照和真实完整实验功能列表。直接准入支持 FREE/GO，按精确企业计划表应用770071981条件permission，识别codex_only席位分支，不套用Images/Library/sidebar门槛。缺项实验flag与明确false分开。完整快照/has_updates是本项目支持范围；缺布局gate采用旧布局、缺详情刷新gate不强开，属于保守适配，不能宣称未知值已证。
- 复用真实服务桥，公共搜索250ms、limit12，分类追加limit6/locale；首游标省略。只在原始items真空且有cursor时再取一次，过滤snorlax不触发额外取页。错误、重复cursor及外来分类不覆盖原结果。
- 四metadata固定操作返回独立opaque头像引用，新增identity-derived工作空间设置固定GET及头像bytes读取。头像仅由真实metadata登记，不接受renderer URL/headers；隔离身份/代次/请求/用途，处理取消、策略、晚到、重定向去认证、撤销及容量恢复。8MiB、1024/4096授权限额和5次重定向是传输适配，非官方数值。
- `GptsView` 恢复官方中文标题/说明、分类导航、581px容器单/双列、24/8间距、36px头像、featured/排名、单行描述、作者用量及不可交互受限条目。公共分页保留手动查看更多。新旧Header分别处理，复用共享Header并仅新增可选description，不改资料库默认行为。
- 普通目录resource立即显示详情，2160578039开启时再刷；about独立状态，错误不遮有效metadata。80px头像、真实工具、滚动正文及固定底部，Escape/Tab/焦点返回均有回归；聊天明确禁用，未伪造普通Codex绑定。
- 修正App的图像/GPT路由容器：原通用壳额外24/32/60 padding、960宽限制与外层滚动，会破坏单独组件布局。现在使用各自限定route class，和已有资料库处理一致；未改其他页面壳。

## 跨页原始账号兼容修复

fresh官方 `h_t` 和实际宿主证明 `share_accounts` 返回 `{account_ordering,accounts:{[id]:{account,features,can_access_with_session}}}`。此前图像、资料库、分享和个人用量补证误按整理后的数组读取，旧隔离夹具亦用了数组；旧正常界面截图不能证明实际账号准入兼容。

新增小型 `serviceAccounts.ts`，三个前端消费者仅在各自边界选择真实membership，校验ordering/key/account_id、必要成员字段及外层session，不改变桥原始响应或GPT seat.features。当前账号可处于ordering非首位。Rust仅修个人空account_id用量的同类补证helper，保留个人/停用/session/身份约束。没有扩大为全局账号重构。

三个前端旧读层带入准确raw fixture分别实际红exit1，修后图像19组/资源29组、资料库读取、分享和相关预览/会话回归退出0；新用量真实raw个人允许用例先红exit101。证据 `verification/accounts-shape/`。这证明原始schema兼容修复，不证明真实账号HTTP已执行。

## 已执行与运行中验证

统一证据根 `.ref/parity/20/actual/20E-gpts/`：

- 数据11组、client→真实wrapper→真实config完整分页→明确离线bridge12组、新UI真实JSX12组通过。原功能的错误/取消/分页/身份断言保留，旧入口导入新组件回归，避免双跑。
- GPT宿主新增14回归先通过；完整共享服务先205过1失败（旧RPC夹具未提供新增网络策略），仅补真实policy响应，206过0失败。未吞掉原路由、origin或integrity断言。该历史失败原始日志保留。
- 全库Rust **562通过，0失败/忽略/过滤，exit0**，372.26秒，覆盖用量rawmap修复；最后头像同步修复只动两个TS/JSX文件，Rust输入未变。冻结保护正确拦截旧流水线，随后新664输入快照执行最终前端/完整非Fast/原生构建；结果待实际结束。
- 实际浏览器运行真实组件/client/decoder/CSS，仅bridge是明确离线宿主，CSP禁止联网。有效PNG解码；12项目录、追加失败保留/重试18项；搜索及URL其他参数/hash保留；about独立失败/重试；关闭焦点返回与撤销资格后12个旧pending请求不能回写均有证据。
- 宽1280/窄640无横向溢出；容器577px单列、581px两列；1800窗口内容1440上限；旧布局768宽。App旧容器实测960宽/1064高/额外padding，修后1280宽/705高/padding0。该对照仅改变已核旧/新App wrapper，不冒称完整官方运行时。
- 独立原生组件宿主验证有效头像、Unicode搜索、详情、Escape和可见条目焦点环；原始测试host文件已恢复、进程关闭。它是离线组件验证，非生产EXE或物理IME；最后头像同步修复之后的对应原生复核另行记录。
- 提交前独立审查实际复现“详情撤销头像后目录仍显示已交付旧bytes”：新增目录/搜索×撤销/替换四场景，先红exit1后绿exit0。稳定callback同步同ID最新resource/refs，无关头像不重新请求，详情/about不重复请求。真实浏览器复测撤销后所选卡0图、其他11图、dialog0/inert0。证据 `detail-avatar-withdrawal-*`、`browser-avatar-withdrawal-green.json`。

## 未完成及未验

工作空间目录/类别和创建者筛选、mine/create/迁移/管理、真实GPT会话gizmo绑定未恢复。seat及不可用提示是适配，未恢复官方seat完整流程和不可用replace首页；workspace_filtered提示的计划/地区notice细分未完整接入。详情评分/功能/菜单图标等尚有结构细节差异，pin/作者其他GPT/举报/会话开场白未全接。头像当前按已读取列表加载，未证明官方缓存/懒加载策略完全等价。

真实HTTP/账号、多窗、物理中文IME、非1x缩放、官方同环境配对图和用户验收未完成，visual score=null。不将预览版发布或自动检查当作整页1:1；后续继续整页队列。

## 2026-11-07 最终官方响应结构复核

完整非Fast标准328段（含32协议探针）、72组前端与原生debug构建均已退出0；当时全库562 Rust也已通过。该构建SHA256为a65b5d34f7795e93981a92145b9fe1ca52ee375aa0710c45eae638a0d343eb9c，因下述末次缺陷修复而作废为交付候选，保留其记录。

重新沿原始safeGet→makeRequest→JSON.parse调用链确认：详情HTTP body直接是含gizmo/tools的resource，列表条目才有resource包装。前端解析已支持两者，但宿主头像登记只读/resource/gizmo；旧宿主、客户端与浏览器夹具同样误包装。将主夹具改为实际bare资源后，metadata_shapes真实失败（exit101，0过1失败561过滤，授权引用0而期望1）。登记改为优先顶层gizmo、兼容既有wrapper；不改变其他页面或传输授权。

客户端12组已以bare详情通过；真实浏览器在明确离线bridge下验证刷新与撤销后所选卡0头像、其他11图保留、Escape后dialog0/inert0且焦点返回所选卡。本次独立复测viewport为1280×720；不混用先前1280×800像素。720高夹具控制条覆盖鼠标关闭位置，初次点击未关闭，保留premature记录；改用真实Escape，未修改产品来绕过。最终宿主回归、模块和原生重建结果随后补记，不将前述全库/完整标准冒称末次Rust差异之后重跑。

最终差异重验：72组前端、共享服务模块207项（0失败/忽略、355过滤）及原生debug构建均exit0；664输入哈希稳定。末次只变化客户端真实fixture和两Rust文件，不重跑修前完整328段/562全库，保留明确差异清单。最终EXE为 `dist-artifacts/gpts-20E-20261106/CodexNative.exe`，SHA256 `67e2a3f47b079ed655c20759e9d2547b7be2f044ecb2325896b7c3c52b008545`，五许可与构建收据同目录。

该生产EXE使用独立CODEX_HOME/WebView配置和CLI0.165.0，实际打开GPT/图像入口、重试均保持真实“请先登录ChatGPT账号”错误，无伪造卡片，Alt+F4退出后PID消失；只读隔离SQLite确认0会话。正常工作面仍仅为明确离线bridge的真实浏览器/独立原生组件验证，未冒称真实账号HTTP成功。原生截图为JPEG；物理IME、官方配对像素、多窗和用户验收仍未完成。状态为本地阶段自验完成、待用户验收；preview.7仅准备说明，未创建标签或发布。
