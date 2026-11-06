# 21I Sites 共享设置开发前合同

2026-11-07，以下保留开发前合同；后续实现与限定本地自验见[21I验收记录](../acceptance/21I-sites-sharing.md)，整页及用户验收尚未完成。接21H；固定官方Windows Store26.1027.3384.0。只读核对21E已提取的八份raw资源，SHA均匹配其manifest；未重算整包、未操作官方GUI、账号HTTP或权限数据。以下数字为0-based UTF-16字符偏移，范围为左闭右开，不是行号。

## 官方来源和入口

来源根：`.ref/parity/21/actual/21E-sites/reference/`，同包settings、initial及中文亦在21G reference/raw保留。使用前按manifest复核，不能把这些固定版本结论当未来版本通用行为。

- `appgen-settings-page-8747d411b550.js`：`dr [52861,73196)`约68440呈现`vr`；`vr [73472,75306)`显示共享摘要和管理按钮，调用`Rt(scope,projectId,{initialProjectTitle,source:CODEX_SITES_SHARING_SOURCE_SETTINGS})`。该按钮没有owner、476199071或设置capability禁用条件，不复用slug门槛。
- `app-primary-998934e837fc.js`实际export `f5n as dv`，`f5n [2777348,2777734)`动态导入`appgen-share-dialog-778a71d62104.js`，可选shouldOpen检查后打开弹窗。
- share-dialog的`Y [8465,23995)`为主体，标题“分享 {siteTitle}”；独立权限、preferred live URL、加载骨架、错误、刷新、参与者、链接访问及底部动作。
- `sites-share-query-3bfcb272daf5.js`：`m [257,622)`读取，`h [622,2483)`写入，`g [2483,3148)`重新读取，`y [3156,3337)`query配置。
- `modal-footer-3b62d5f25710.js`的`l [167,2480)`为暂存保存/取消与完成分支；`use-workspace-users-73d44209e399.js`的h/v/g为成员/组搜索。

## 权限与数据

- owner依据GET权限中的users确认：role为owner且account_user_id匹配当前账号成员ID，或email忽略大小写匹配。initialIsOwner只影响部分加载呈现，不授予写权限。
- owner且未保存中才可修改链接访问；非owner显示“只有所有者才能更改链接访问权限”。编辑者管理要求workspace、gate476199071及owner；邀请还要求policy不是admins_only，公开模式另需该gate。
- 外部邮箱受gate2196156952、计划类别及`chatgpt.workspace.feature.sites.invite_external.access`控制。workspace account-owner分支也要求permissions已加载，不合并成单一bool。
- initial的`j_t [1862457,1862726)`，export Bsr，是账户订阅或GET `/accounts/{account_id}/settings`来源；不能仅凭客户端缓存角色授权写入。
- initial `Zji [5476069,5476283)`优先available_access_modes；缺省workspace为workspace_all/custom，个人为空数组。当前mode不在可选项时追加禁用项，不硬编码四种始终可切换。

## 真实请求与收敛

1. GET `/websites/{project_id}/share_access`；null可返回null。原wrapper没有完整Zod schema，不能把initial另一KMi allowed_users policy当此接口完整结构。消费者使用users、groups、access_mode、available_access_modes、show_private_tunnels_warning；allowed_editors缺省空数组，合并为role editor/editable true并去重。
2. query key为appgen/share-access/projectId，retry=false、staleTime一分钟。403/404即使有旧缓存也进入错误；其他刷新错误不能一概清空已有数据。
3. PATCH相同share_access路径，retry never，按sites-share-access/projectId串行。缓存失效/错误先GET，policy或有效mode缺失、admins_only拒绝写。body仅以下已证形状：
   - `{access_mode}`。
   - `{recipient,recipient_type:"user"|"group",role:"viewer"|"editor"|null}`。
   - `{email,role:"viewer"|null}`；外部email不能直接升editor，必须具有account_user_id。
4. PATCH返回明确null或status pending/accepted才接受，undefined及其他status失败。role-site-editor对应editor，其他非空role_id对应viewer。workspace_all且pending在缓存仍保持custom，不提前宣布全工作区已开放。
5. 写失败先取消旧query、失效并GET收敛，再抛原错误；重新读取10秒取消边界，失败仍失效。不能吞错、自动重发PATCH或伪造成功。宿主身份/取消/请求绑定须保留。
6. preferred URL独立GET `/websites/{project_id}/preferred_live_url`，initial `lMi [5477878,5478198)`定义cMi，retry=false、stale一分钟；使用真实live_url，不猜域名。

## 动作与呈现

- 链接访问先暂存，保存才PATCH；参与者角色改变即时对应PATCH，移除role null有独立确认。
- 有暂存修改时底部取消/保存，保存中禁用；无修改是完成关闭。成功保存不是直接close，不能擅自实现保存即关。
- workspace成员/组搜索150ms、trim且非空、15秒取消；GET `/accounts/{id}/users`或groups，limit10/offset0，不用Sites MCP接口替代。
- 中文在同包zh-CN中已定位：管理91768、管理共享91805、谁可以查看你的网站91853、共享设置91902、无法加载共享设置93014、只有所有者才能更改链接访问权限93184、分享94198、刷新权限94432、无法保存共享设置94809。仍需逐控件完整中文及CSS/共享组件补证。

## 实施与验收队列

下一有限闭环：管理入口→真实权限/URL读取→加载、错误与刷新→owner链接访问暂存→固定PATCH→pending/accepted区分→GET收敛。先写实际宿主/客户端/JSX回归，再实现；不解除尚未完成的邀请或角色操作按钮来伪装完整。

参与者邀请、角色/移除、团队建议及profile showcase保留后续独立动作合同。完整服务schema、账号权限矩阵、团队建议底层请求、pending真实服务时序、原生焦点/关闭、官方配对像素均待证。本调研不放行整页完成、不代表实际账号或任何写权限已验证。

## 开发前补证与明确适配

补证保存在`.ref/parity/21/actual/21I-sites-sharing/reference/`：8份既有核心同包JS，另补px转换工具JS及共享框CSS，共10项资源再次核hash/integrity，64完整片段、9真实export、86项直接中文往返0失败。首次提取脚本的CommonJS exports命名冲突已留失败，未修改官方来源。仍未运行官方GUI或真实账号HTTP。

- 共享框实际是initial kls→Als/jls/Els，不是21H的ISn。Als传maxWidth512；CSS `_901vo_2`在<48rem为底部全宽sheet、max-height92%、仅顶部圆角，>=48rem父容器居中、最大宽512、内部滚动上限calc(95vh - 40px)。按CSS根字号语义处理断点，不能直接把rem当物理像素；clone若限定768 CSS px需明确为根字号差异适配。
- header ps6/pe4/pt4，sectioned body px6/pb6、pt4或pt6，footer可换行；打开前记录trigger，仅焦点仍处弹层/body且trigger仍连接时关闭后回焦。Y未传isDismissalDisabled，不能照域名保存中隐藏X/阻止所有关闭；未实测的原生关闭时序仍待验。
- Cn的底部取消只清暂存，保持弹窗；完成才关闭。成功保存清draft，不自动关闭。Gn提交仅owner、存在暂存且!disabled时执行，Enter不得绕过。
- owner成员来自h_t规范化后按authenticatedAccountId重排的账户。clone继续用selectedServiceAccount按绑定ServiceIdentity.accountId读取raw map，不取原始ordering首项。邮箱源为AuthContext.email；已证Codex account/read refreshToken:false适配，不额外把GET /me写成官方来源。缺邮箱可仅匹配真实member ID；缺少身份不能因undefined相等授予owner。
- user消费account_user_id/email/name/role/avatar_url/editable/pending；un将缺身份/姓名字段归一null，其余保留；group为id/name/size/editable/pending。源不对allowed_editors自身额外去重，owner不被editor覆盖；不假称已恢复完整OpenAPI schema。
- preferred live URL是独立query，undefined不呈现链接动作，null为暂无发布URL。链接读取失败不清空已取回权限，也不拼接站点URL替代。复制与访问需按真实URL和动作结果处理。
- 只有show_private_tunnels_warning===true、draft public且原mode非public才显示“如果此网站使用私有隧道，任何拥有链接的人都可能使用可访问已连接的私有服务的功能。”
- 模式实际文案为“仅限我自己”“仅限受邀者”“此工作区内收到链接的任何人”“互联网上的任何人”。个人custom且无外部访问者可显示owner-only文案，仍写custom。具体控件顺序/描述见补证，不换成自行简化标签。
- 本项目对成功写另做GET读回、未知结果显式GET恢复，是适配验证；不得将其称官方已实测请求次数。原pending workspace_all保custom必须保留，不能宣称全员已开放。权限/真实URL状态和错误独立，403/404撤销旧权限。

纯数据回归使用执行原始m/Zji生成的固定向量，来源hash/UTF16定位随fixture保留，CI不依赖ignored `.ref`目录；不能从本项目输出更新这些基准消除失败。正常HTTP、原生/像素、邀请/编辑者/团队/profile和首次发布仍留后续完整范围。
