# 21I Sites 共享设置开发前合同

2026-11-07，调研草案，尚未开发或验收。接21H；固定官方Windows Store26.1027.3384.0。只读核对21E已提取的八份raw资源，SHA均匹配其manifest；未重算整包、未操作官方GUI、账号HTTP或权限数据。以下数字为0-based UTF-16字符偏移，范围为左闭右开，不是行号。

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
