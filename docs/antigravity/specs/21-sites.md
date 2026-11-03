# 21 Sites：功能调研与修改前动作合同

状态：静态调研完成；可开发只读服务列表，尚未进行运行时、原生或像素验收。2026-11-03。

## 1. 基准、范围和结论

基准安装包 `C:/Users/lus/Codex/_internal/app/resources/app.asar`，SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。这是已知带 offline 补丁的包，不能称为未经修改的官方发行基准。对包内活跃 gate、账户、身份读取等结论必须另行核对未修改运行时。

本单元研究 Sites 首页、owned/shared/all 列表、搜索分页、详情、编辑和创建入口、预览，以及设置中的域名/环境变量。数据库、分析、自动化是详情子页，只记录入口与已查到的合同，不把它们当已完成。**未发现支持旧实现“本地创建即部署”“固定发布流水线”的官方依据。**

资料位于 `.ref/parity/21/reference/`：

- `manifest.json` 登记原始路径、字节大小、SHA-256；原始文件已逐项与 ASAR header integrity 核对。
- 小 chunk 原样保留；shared / initial / 大页面只保存 bounded 片段。
- JSON 片段的 `offsetUTF16` 是从文件头开始的 **0-based UTF-16 字符偏移**，不是物理行号。
- `websites-http-anchors.json`、`sites-core-contract.json`、`routes-gates-versions-anchors.json`、`preview-deployment-anchors.json` 为主要索引。

本轮没有读真实账号/令牌、发服务请求、调用付费 turn 或执行部署/发布。静态 HTTP 合同可用于开发，但不等于本账号请求已通过。

## 2. 页面、路由和能力边界

| 入口/页面 | 证据 | 合同 |
|---|---|---|
| `/sites` | initial UTF-16 `8742766` 附近 | 经 `lDa` 能力门、`pDa` Space 迁移门后呈现 Sites。 |
| `/space/sites` | `sites-view-af840692499a.js`、`space-sites-page-ffe753c72291.js` | Space 变体；`/sites/library` 迁移为 `/space/sites`。不能只做一个不依赖模式的抽屉。 |
| `/sites/:projectId/*` | `appgen-site-detail-route-b13f47dc60b5.js` | 子页 settings / analytics / database / automations；预取对应 chunk。 |
| `/space/sites/:projectId/*` | `site-details-4c5f42b676c7.js` | 独立导航封装；analytics gate `262557526`，events 还受 `663642302`。 |
| `/sites/:projectId/edit` | `site-edit-route-0c7175da5a80.js` | 账户一致性、来源上下文、ChatGPT/Codex 既有线程恢复和站点 mention。 |
| Sites 启用 | initial `wY/lDa`，UTF-16 `5776699` 附近 | gate `637432221` 与服务 access.enabled 共同决定 loading / unavailable / available。无法读取 gate 不等于允许伪造启用状态。 |
| 列表能力 | `appgen-sites-query-2129868bd187.js` | `/websites/access` 返回 `{enabled,supports_workspace_listing:false默认,supports_editable_listing:false默认}`。 |

原包新建站点不是模板/域名前缀表单立即创建资源。`start-appgen-conversation-669d07745c6f.js` 的 create 动作切 Work 模式，预填带真实 `@Sites` 插件 mention 的新站点请求，让模型先询问主题；不立即发送，不声称已上线。

## 3. 可复用共享认证桥的只读 HTTP

以下路径为**逻辑路由**，生产经共享宿主桥的 base/workspaceRouting 合同解析，见 `chatgpt-service-bridge.md`。禁止 renderer 接收 token，禁止传入任意 URL、origin 或 Authorization。

| 功能 | 方法/路径与参数 | 返回/语义 |
|---|---|---|
| 能力 | GET `/websites/access` | enabled、supports_workspace_listing、supports_editable_listing；失败呈现错误或 unavailable，不伪造空列表。 |
| owned 列表 | GET `/websites?limit=20&include_editable=false` | `{items,cursor}`；首 after 为 null 不拼，后续 after=cursor。 |
| editable/shared 后备 | GET `/websites?limit=20&include_editable=true&after=sites-shared-projects:` | 首游标确为固定 `sites-shared-projects:`；HTTP 400 是明确兼容性分支，不可吞掉所有失败。 |
| 工作区 shared 搜索 | GET `/websites/shared?limit=20&query=…&after=…` | query 空时省略；首请求非空搜索延迟 300ms，可取消；后页使用服务 cursor。 |
| owner 摘要 | GET `/websites/{project_id}` | `current_user_role` 缺失时该 owner-summary 客户端补 owner；不能把这个特例扩展到所有 shared 响应。 |
| 环境 | GET `/websites/{project_id}/environment` | `{project_id,revision,updated_at,entries:[{key,type:"envvar",is_secret,value:null或string}]}`。 |
| 自定义域名 | GET `/websites/{project_id}/custom_domains` | `{items:[CustomDomain]}`，状态来自服务。 |
| 分享权限 | GET `/websites/{project_id}/share_access` | 服务角色与访问模式；仅查看也要隔离账户。 |
| preferred live URL | GET `/websites/{project_id}/preferred_live_url` | 静态存在；shared 中关联 gate 原包返回 false，活跃性未验证。不要据此强开。 |

`appgen-page-4190b6663a1a.js` 的新列表确实 import 并使用上述 HTTP query；不能只因为 shared 里还存在 MCP `sites.list_sites` 就忽略这条直接 HTTP 路径。

新桥若目前只有 18–20 operation，需要添加**固定 Sites 只读操作**，复用认证、工作区、错误、取消和 generation 机制，不开放通用 URL 代理。域名/环境返回应按服务类型检查，不能拿本地 localStorage 作为降级数据。

### 列表形状

`appgen-sites-query` 的摘要 schema：

```text
id, title, slug, updated_at: string
description: string|null|缺失
status: active|archived|suspended|deleting
live_url: string|null
hosted_url: string|null|缺失
latest_edit_context: {chatgpt_conversation_id?,codex_thread_id?}|null
screenshot_url: string|null
disabled_by?: workspace_admin|openai|null
current_user_role?: owner|editor|null
owner?: {name:string|null,email:string|null}|null
sharing: {access_mode,user_count,group_count}
```

详情/MCP 原始 schema 使用 `current_live_url` / `current_preview_url`、`latest_version_number`、`created_at`、`auth_client_id`、`access_policy`；摘要转换才将 `current_live_url` 映射为 live_url。不能未经适配混用两种形状。

### 搜索、分页和缓存

- 首页视图存在 **owned/shared/all**，不是只有我创建/共享两按钮。shared/editable 可用性取决于 gate 与服务 supports_*。
- owned 在已加载数据上按 title / slug / description 小写匹配；支持 workspace listing 的 shared 使用服务搜索。all 合并后按 id 去重，按 updated_at 倒序。不能把 owned 的本地过滤声称为全库搜索。
- `/websites/shared` 首页搜索 delay 为 300ms；页面翻页不重新执行该 delay；取消后不能更新旧搜索结果。
- owned/editable staleTime 5 分钟；workspace shared 搜索 30 秒；access 30 秒；cursor 为 null 终止。
- shared 后备首请求 400 会禁用 editable 能力并导航 owned；后页失败不走该首屏兼容性处理。失败后页保留已有记录并单独显示“无法加载更多”与重试。
- 原页面 query key 常量本身没有直接拼 accountId；实际使用账户 scope/query client。我们的全局 cache 必须显式分区 account/user/generation，不能照抄短 key 造成跨账户污染。
- `sites-view-mode` 是官方存储键，默认 **list**，只接受 grid/list；这只允许持久化视图偏好，不能存假站点数据。

## 4. MCP 读取与 HTTP 的区别

shared UTF-16 `3805871`、`3807330` 附近的旧/详情功能走 POST `/ps/mcp`，并非 app-server 专用 RPC：

```json
{
  "id": 1,
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "sites.get_site",
    "arguments": {"project_id": "<server-id>"},
    "_meta": {
      "connector_name": "Sites",
      "_codex_apps": {
        "resource_uri": "/connector_20205bf7d4e99a89d7154bb849718324/implicit_link::connector_20205bf7d4e99a89d7154bb849718324/get_site"
      }
    }
  }
}
```

头包含内部认证/完整性开关及 `X-Codex-Surface:appgen`。返回读 `result.structuredContent`；`result.isError`、RPC error、缺内容都不是成功。错误数据可带 `error_data.{type,code,message}`。

已证实的读取工具：

- `sites.list_sites`：`{limit:20,cursor?,include_editable?:true}`，shared 起始 cursor 同上；`invalid_cursor` / `inactive_workspace_user` 仅在特定首游标分支处理。
- `sites.get_site`：`{project_id}`，project_not_found 是已知错误。
- `sites.get_database_overview`：`{project_id,binding_name?}`，返回 bindings/selected_binding_name/tables。
- `sites.get_database_table_rows`：`{project_id,binding_name,table_name,limit:25,offset}`，返回 columns/rows/limit/offset/has_more；数据也可能在 `result._meta["openai/sitesDatabaseTableRows"]`，不能只取 structuredContent。
- `sites.list_available_access_groups`：`{name_prefix}`。

这些语义只读工具虽然 HTTP 方法是 POST，不能开放通用 `tools/call` 而使写工具穿过只读 operation 白名单；需要单独枚举允许 tool 和参数。当前阶段优先直接 HTTP 列表，MCP 详情/数据库可后续补齐。

## 5. 创建、编辑、预览、发布与版本

### 创建与编辑

`start-appgen-conversation` 的 create 是预填新 Work 会话；edit 进入站点编辑路由，保留真实 projectId、accountId/userId、title、latestEditContext；publish 是带站点 mention 与 Sites 插件 mention 的**待提交**请求。

`site-edit-route`：

1. 链接 account_id 与当前账户不符时显示切换账户提示；不能默默去另一账户编辑。
2. 有 ChatGPT conversation 时 GET `/conversation/{id}`，仅非 archived / readonly 才恢复。
3. Codex/local 工作模式恢复真实 host/thread，保留原 server 配置。
4. 无可用历史上下文时回首页预填结构化站点 mention，保留用户 prompt；不能只传 title，不能自动执行。
5. 已知 inactive 站点返回 unavailable；恢复失败可重试/返回 Sites。

### 预览

真实地址来自服务 `live_url/current_live_url/current_preview_url`，缩略图来自 `screenshot_url`。shared 截图读取先将历史 `/api/codex` 前缀规范成 `/wham`，再经认证 fetch blob；不能构造 `${slug}.codex.app` 或以固定 hero 假装远程页面。

Space 附着站点另有 GET `/wham/sites/space/{page_id}` 返回 page_id/project_id/live_url，依赖 browser.in-app 能力；未发布显示“尚未发布”，不能显示绿色 ready。PUT 同路径是附着/恢复动作，需要真实站点所有权与 Page 编辑权限，不属于只读列表。

`request-site-preview` 的 cloud browser 许可用 PATCH `/flora/browser/config`，body `{origin_mutation:{pattern:"http://terminal.local:4173",decision:"allow"}}`。这是账户级写入权限；不能为预览自动代用户授权。

### 发布与版本：当前可证边界

原 Sites 首页并没有查到旧实现那种固定“Git #6166bb5、18s、24s”的部署时间线；也没有查到可据此实现的直接 `/websites/{id}/deployments` / versions 列表 HTTP。包内 `versions-dialog` 的 `/conversations/{id}/versions` 是 **ChatGPT 对话历史版本**，不能误当 Sites 部署版本。

站点原始详情有 latest_version_number、current_preview_url/current_live_url，工具事件有 project_id/version_id/deployment_id tags；这能用于关联真实结果，不能由字段存在反推完整版本发布 API。`sites-end-resource` 本轮无命中的工具版本/部署锚点不能证明后端不存在功能；后续需连接器正式合同与未经修改运行时补证。

另有 Library HTML preview 发布流程：`publish-4d2da44dfb8b.js` 校验个人账户及受支持套餐、Sites enabled、可用插件/模型，创建带真实 libraryFileId 的 Work 请求并要求 dispatch acceptance。它不是直接本地创建“已上线”记录，更不能把它的个人账户套餐限制泛化为整个 Sites 首页限制。

## 6. 写操作真实合同：后续独立实现

| 动作 | 方法/逻辑路径 | 关键返回/约束 |
|---|---|---|
| 修改 title/slug | POST `/websites/{id}/metadata` | title 请求体按服务合同；slug body `{slug}`。slug_change 必须实际返回 pending/complete；pending 不能立即宣布 URL 已切换。 |
| slug 检查 | POST `/websites/{id}/slug/availability` | `{slug}` → `{available,slug,status:available|invalid|taken}`。 |
| 更新环境 | POST `/websites/{id}/environment` | UI 构建 `{remove:[key],set_values:[{is_secret,key,type:"envvar",value}]}`；完整请求需按设置调用链核对 revision。 |
| 加域名 | POST `/websites/{id}/custom_domains` | `{hostname}` → 真 CustomDomain，不固定 CNAME。未发布错误是 `invalid_project/Publish the Site before adding a custom domain`。 |
| 验证域名 | POST `/websites/{id}/custom_domains/{domain_id}/refresh` | pending/active/failed、SSL、validation_records；active 后刷新项目数据。 |
| 移除域名 | DELETE 同域名路径 | 根据真实返回再删除缓存。 |
| 分享更新 | POST `/websites/{id}/share_access` | 必须明确 access_mode；不能以 admins_only 直接发送更新；并发编辑排队/合并，失败回滚。 |
| 删除站点 | DELETE `/websites/{id}` | 必须返回 `success:true`，否则失败；不能只删本地卡。 |

CustomDomain 包含 hostname/id/project_id/status、cname_target、apex_proxy_ipv4_targets、validation_records、provider_status、ssl_status、last_error、worker_name、时间戳。显示 DNS 指引应来自服务，禁止写死 `cname.codex.app`。

环境 secret 值以 null / `<REDACTED>` 处理。不能把遮罩当真实值写回；重复 key、空 key、已存 secret 转普通值但无新值等有明确校验。只读环境显示也不得泄露/日志化秘密。

## 7. 当前产品已观察到的假数据差异

读取本轮磁盘 `src/components/SitesView.tsx`：

- DEFAULT_SITES 三张“文档站、研发能效、智能体协作”卡全部本地构造；localStorage `codex_sites_data` 保存，没有账户分区。
- handleCreateSite 用 Date.now id、拼 `.codex.app`、直接 status ready，并 toast“创建并部署成功”；没有任何服务写入。
- 预览是固定 hero 和 Node/CDN/SSL badges；发布流水线固定 commit 与时长。
- 自定义域名 onBlur 只写 React/localStorage；说明写死 cname；删除只过滤数组。
- 编辑回调只传 site.name，丢失官方要求的站点 ID/账户/线程上下文。

以上必须移除或替换为真实状态，不能将这些缓存复用成“离线站点”。无服务返回时应呈现 loading/error/unavailable；成功空响应才是空列表。该观察是修改前状态，不保证父代理后续实现仍相同。

## 8. 修改前动作合同与验收用例

| ID | 动作/前置 | 预期及数据验证 |
|---|---|---|
| S01 | 打开 Sites，登录/能力未知 | 先能力/列表读取；loading 不显示演示卡；error 不伪装空态。 |
| S02 | owned 首屏/翻页 | limit20、cursor 往返；真实 items；只更新当前账户。 |
| S03 | 切 shared/all | 依 supports_* 选择 workspace HTTP/后备；不强开不可用分支；all 去重排序。 |
| S04 | 搜索后立即改字/切账户 | owned 已加载过滤与 shared 服务搜索符合各分支；取消旧请求，晚到结果不覆盖。 |
| S05 | 第二页失败/重试 | 保留已有页，单独错误与重试；不清空列表、不重复追加。 |
| S06 | list/grid、离开重开 | 默认 list，合法偏好持久化；站点数据来源始终服务。 |
| S07 | 点击真实站点 | 导航详情/真实地址；无 URL 的站点不打开拼接域名；loading、禁用状态有界。 |
| S08 | 新建 | 预填带 Sites mention 的 Work 请求，不部署、不自动发 turn、不插本地 ready 卡。 |
| S09 | 编辑 | 保留真实 project/account/线程上下文；账户错配明确阻止；恢复失败可重试。 |
| S10 | 环境/域名只读 | shape 校验；secret 不泄露；状态与 DNS 取服务；错误可见。 |
| S11 | 保存/删除/发布 | 仅实现对应真实合同后可启用；写后 reread，失败无成功提示；发布须真实执行链。 |
| S12 | 官方同窗对照 | 当前无图，所有几何/字体/中文/菜单/焦点标未验证；取得同 DPI/客户区后逐控件比对。 |

自动回归优先验证 URL/白名单、分页/去重、状态区别、取消与账户晚到隔离。随后使用受控只读账号请求和真实 Tauri 验证；不能用 mock 或浏览器构建通过代替原生、服务和视觉。

当前交付只到“调研完成”：功能实测未执行；视觉 `not_executed/score:null`；未用户验收。部署/版本深层合同缺口单独留存，不阻塞已经取证的 Sites 真实只读列表开发。

## 21A 修改前实施范围（2026-11-03）

在共享桥新增固定 sites_access/list/shared/detail/environment/domains/share_access GET 操作，前端首先读取真实身份和access。owned默认limit20；shared按supports_workspace_listing走真实搜索，否则仅supports_editable_listing时走固定首cursor后备。首屏后备HTTP400禁用后备并返回owned，后页失败保留数据。all真实数据去重并按更新时间倒序，owned仅过滤已加载数据。默认list，sites-view-mode只存视图偏好，不读写旧codex_sites_data。

真实详情以已取证GET /websites/{id} owner-summary形状解析（live_url，而非擅自将其当MCP原始current_live_url详情），只读环境/域名保留真实错误并遮蔽secret。仅使用服务给出的安全HTTP(S)链接，不拼codex.app。身份变化/离页/搜索切换和详情关闭取消旧请求，晚到结果不覆盖新状态。

撤旧假创建/部署/本地删除/本地域名保存、固定流水线与丢失站点身份的App提示词回调；新建/编辑/发布真实Work mention写链未实现，准确显示未接通状态，不提供假成功。搜索/分页/全局gate、原生与官方像素不能以fixture和构建通过代替。暂不实现analytics/database/automations/分享写操作。复用现有CSS类和共享认证机制，无新依赖。S01–07/S10为本地合同验证范围，S08–09/S11–12仍未完成。
