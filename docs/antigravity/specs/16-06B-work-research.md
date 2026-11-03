# 16.06B：Work 偏好独立合同与本地智能体边界

日期：2026-11-03。只读调查；本文件没有执行远程请求、修改真实配置或放行 Work 页面开发。16.06B 产品主范围是本地 `ConfigurationPanel`，本文件用于避免再把 Work 页面误作本地智能体页。

## 来源与路由纠正

固定来源：`OpenAI.Codex_26.1027.3384.0_x64__2p2nqsd0c76g0`，`app.asar` SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。本次文件大小/hash 清单：`.ref/parity/16.06/actual/16-06B-research/work-research-manifest.json`。下列偏移均为 **0-based UTF-16 字符偏移**，不是物理行号。

`settings-lazy-routes-1c307af3cdd3.js` @6092 一带明确区分：

- `agent` → `configuration-panel-cb7ffcf1a381.js` → `ConfigurationPanel`，属于本地配置。
- `work-settings` → `panel-93241afe1ff1.js` → `WorkSettingsPanel`。该 123 字节包装 chunk 只重新导出 `panel-e921be19ab4d.js` 的 `r`，已只读提取并核对包内 integrity，SHA-256 `1672819d2606caedd8453a90c7cd3307f62703839a9a3879e104b57da08ff215`。
- `panel-e921be19ab4d.js` 内部标题复用了 `slug:agent`，**这个标题参数不能证明实际路由是 agent**。旧 `16-06-agent-settings.md` 的首段、旧 16.05 报告中“agent panel 就是 Work”的判断不能继续作为路由依据。

原始 initial/shared/panel 实现在 `.ref/parity/16.05/actual/16-05B-research/raw/`，本轮追加的 routes、包装与 initial-values 在 `.ref/parity/16.06/actual/16-06B-research/raw/`。两处是同一固定新包来源；不能混用旧补丁包的短变量名。

## 远程读写与初始化

来源：`app-initial-4267e52fe5b0.js` @4308896—4311200 的 `aI/oI/PSr`。

1. 资格必须同时满足 capability `work.cloud-orchestration.preferences` 为 capable、`ev.status === allowed`、`Cv.status === allowed`，且 accountId/userId 非空，才构造当前 Work identity。未知不等于允许。
2. GET `/wham/work/settings`，带 `expectedIdentity` 和当前账号头；query key 为 `work-preferences/accountId/userId`。一分钟 stale、每次窗口重新聚焦都 refetch、关闭默认 retry。
3. 原始响应至少使用 `{revision, settings}`。尚无真实服务响应样本证明 revision 的完整服务端类型/范围，不能只凭 JS 使用方式虚构 JSON schema。`settings == null` 是合法初始化分支。
4. 缺设置时动态读取 `initial-values-e72fb739088f.js`，等待模型与初始偏好 query，重新核对账号及 abort，再 PATCH **同一远程路径**：`{expected_revision:0, settings:initial}`。
5. 初始化 PATCH 只有 HTTP 409 被捕获后 GET 重读；其他异常向上传播。409 不生成本地成功，也不循环覆盖赢家。
6. 正常编辑先获取当前 query 数据、取消其 pending query、再次核对 identity，再 PATCH `{expected_revision:current.revision, settings:partialChange}`。同账号 mutation scope 串行，默认不重试。
7. 响应替换 query 数据并解析 `settings`，随后 invalidate 同账号偏好。正常更新的 409 **没有自动重放用户改动**；UI 显示保存错误，reload 用于重读。不能为“体验顺滑”静默新版本重试。

`initial-values-e72fb739088f.js` 的初始化对象共 9 个键：当前真实 Work `model`、`reasoningEffort`、归一化 `serviceTier`（缺省 `standard`），以及 `approvalPolicy/cloudBrowserUse/localBrowserUse/sandboxMode/networkAccess/webSearch` 六个 null。它没有将本地 `config.toml` 全表上传。

正常 PATCH 是小型变更对象，不是整表覆盖：换模型发送 `{model:newSlug,reasoningEffort:null}`，换其他项只发送相应键。保留未知服务字段的可实施方式是**只发送证实的变化键**，不要把 UI 解析对象重新编码为完整远程文档。官方 `J({...})` 未显式 `.passthrough()`；本次没有执行其 schema runtime，因此不宣称未知字段在 parse 后被保留。响应 envelope 中还存在什么字段也待真实样本确认。

## 设置 schema 与八项可见控件

来源：`app-shared-b9a49a97ca55.js` `Agt/Mgt/jgt` @1876270 附近；`panel-e921be19ab4d.js` `B` 函数。

schema 实际有 11 个 nullish/optional 键；“八项”指此 panel 可见的八行，不能将二者等同。

| 可见控件 | 远程键 | 官方候选/行为 |
|---|---|---|
| 模型 | `model` | 字符串长 1–256；真实 TPP 目录的 options、versionOptions.options、internalOptions 合并按 slug 去重；修改同时清空 reasoningEffort |
| 默认推理强度 | `reasoningEffort` | 字符串长 1–32；当前模型 `modelConfigBySlug[slug].thinkingEfforts`，目录未到/空时禁用 |
| 本地审批策略 | `approvalPolicy` | `on-request / untrusted / never`；文案说明 native Work 支持这些值，Classic Work 目前仅转发 on-request |
| 本地浏览器使用 | `localBrowserUse` | boolean，Off / On；On 文案仍受既有约束 |
| 速度 | `serviceTier` | `standard / fast / ultrafast`；经当前模型目录 tier helper 过滤，已保存但不可用时显示“新任务使用 Standard”说明，不默默改写保存值 |
| 本地文件访问 | `sandboxMode` | `read-only / workspace-write`；没有 danger-full-access 选项 |
| 本地网络访问 | `networkAccess` | boolean，Off / On |
| 本地 Web 搜索 | `webSearch` | `disabled / cached / live`；没有 indexed |

另外三个 schema 键：`cloudBrowserUse:boolean`、`enabledReasoningEfforts`（共用 GX 的集合 schema）、`showUltraInModelPickerSlider:boolean`。八行没有暴露这三项。完整列表为 `model,reasoningEffort,serviceTier,approvalPolicy,sandboxMode,networkAccess,webSearch,enabledReasoningEfforts,showUltraInModelPickerSlider,cloudBrowserUse,localBrowserUse`。

panel 保存期间全部行 disabled；模型加载与保存是不同状态。读取/保存错误使用共用 error banner，reload 重新读取。null/default 呈现由 `preference-row-876b4bb74b22.js` 共用行承担，不可把空字符串写进服务。

## TPP 目录不能替换成 model/list

来源：initial @4750824 的 `XR`；shared @2059975 的 `UDt`。

- GET `/tpp/models/`，query `iim=false&include_icons=false`；有账号/用户身份时附当前账号头和 expectedIdentity。接受 409 为预期错误状态，未见在此处吞错返回成功。
- query key 按账号和用户隔离；挂载总刷新、窗口聚焦刷新、五分钟 stale/定时/后台刷新。
- 本地 placeholder key `chatgpt-work-models-v1/<encoded user>/<encoded account>`，只使用 24 小时内、解析后 options 非空的缓存；网络返回才更新它。缓存不是资格证明。
- `UDt` 解析 models/internal_groups/categories/versions/slider_settings/workspace_model_policy 等；隐藏 internal model 不进入内部选项，管理员 disabled categories 和 disabled versions 分开处理。版本 intelligence presets 的非 standard tier 形成服务目录，内部模型 tier 还要与该集合相交。
- 输出含 `modelConfigBySlug/defaultModelSlug/defaultThinkingEffortByModelSlug/serviceTiersByModelSlug/options/versionOptions/internalOptions/sliderSettings/workspaceModelPolicy` 等。不能仅取 models 数组，或用 app-server `model/list` 重命名字段冒充 TPP 目录。
- 选择消费者 `GSr/qSr`（initial @4313549/@4315526）会结合远程偏好、账号最近配置、model upgrades、workspace model policy precedence 与 ultra gate `536305374`；并非偏好读到什么就原样执行什么。

## 真实消费者边界

- 模型默认：initial @4319770 `cCr` 将 `oI.data.settings` 送入 Work 模型/推理选择器，不进入 Codex 本地模型 React 状态。
- 速度：initial @7318635 `Cro/wro/Oro` 区分 thread 临时值、Work revision 绑定 optimistic 值、远程默认与旧 local fallback；非 standard tier 不在目录时新任务回落 standard。服务设置保存成功不能证明服务推理实际使用该 tier。
- Classic Work 本地执行：initial @7234263 `_5a` 仅当审批值为 on-request 才转发 `approval_policy`；传 `sandbox_mode`、按 `networkAccess` 构造 `sandbox_workspace_write.network_access`、传 `web_search`。这解释了 panel 的 Classic Work 限制文案。
- 本次未完整追完 cloudBrowserUse/localBrowserUse 的 native Work 启动消费者，不能宣称八项均已验证影响真实执行。后续开发需补 native Work 路由与请求证据。

## 现有桥可复用与真实缺口

当前 `src/chatgptService.ts` / `src-tauri/src/chatgpt_service.rs` 已具备宿主令牌不跨 IPC、账号 identity+generation、取消、账号切换作废、固定路由、账号 routing override、完整 HTTP 响应状态、401 一次刷新、完整 Statsig bootstrap payload 获取。可复用这些，不另建 generic URL/method/body 代理。

但目前**没有**以下固定操作：Work preferences GET/PATCH、TPP models、账号 workspace settings。`HttpMethod` 只有 Get/Post/Put，不能把 PATCH 当 share POST。`readShareAccess/decodeShareAccess` 只验证分享 gate，不能因为已取得分享资格就放行 Work。

资格来源可真实扩展取得：

1. 现有 `share_thread_access` 内部向 `/backend-api/wham/statsig/bootstrap` 发送宿主真实上下文并返回 `statsigPayload`。可复用底层认证传输建立专用 Work bootstrap；完整 V1/V2 snapshot 须绑定 user/account，拒绝 delta、不完整或未知编码。不要硬编码每个 gate 为 true。
2. `/wham/accounts/check` 的现有固定 `share_accounts` 操作可提供当前 membership/account plan/structure；不是全部 Work gate。
3. 官方 workspace policy fallback 来源 initial @1861195 `j_t`：GET `/accounts/{account_id}/settings`，消费 `admin_work_mode_enabled/admin_work_local_enabled/permissions/beta_settings.wham_local_access`。当前桥尚无此固定路由，但可以明确限定当前账号、安全编码，不需要新增依赖。
4. capability 父级 `work.cloud-orchestration` 还有 requiresFirstPartyInference、supportedClients electron、Statsig `1315865107`（initial @2163836），子 capability 继承；`Cv` 是 workCloud/workLocal allowed 的合并（@1869026），并非两个都必须 allowed。WorkCloud/Local 还涉及 rollout `1463309241`、个人 cloud rollout `1625797156`、组织 policy 与授权方式。`ev` 另有当前选择账号与已认证账号一致、plan/surface 检查（@1766302/@1855803）。需要完整映射这些 inputs，不能拿个人套餐单分支代替全账号条件。

以上证明桥具备扩展可行性，不证明已取得某用户的官方资格。无账号实测不阻止实现固定传输、schema、revision 回归；可以先完成这部分并让未确认资格的 UI 明确不可用，不伪造 allowed 或写本地成功。

建议后续最小专用接口：`readWorkAccess(signal)` 返回 identity 与逐项 evidence；`readWorkPreferences(identity,signal)` 返回原始 envelope/revision/已核设置；`updateWorkPreferences(identity,expectedRevision,partial,signal)` 仅接受证实字段；`readWorkModels(identity,signal)` 解析 TPP 目录。初始化单独串行事务，不在普通 GET helper 中无条件触发写入。测试覆盖 GET null→init PATCH→409→GET、正常 PATCH 409 不重放、未知字段不回写、换账号/取消丢弃晚响应、重复保存串行、不可用 tier 和 ultra gate。

## 与本轮本地开发的隔离

当前 `AgentSettings.tsx` 已使用 `config/read(includeLayers:true)` 的非 profile user layer、`config/batchWrite` 的 filePath+expectedVersion、读回核验，失败没有原生文件 fallback；旧文档所称“当前失败 fallback”不再是现状。本轮应沿真正 ConfigurationPanel 的本地合同扩充，而非用 Work schema 覆盖这层逻辑。

Work GET/PATCH 与 Codex config 层不能互为 fallback。两者 model、approval、sandbox 字段同名不表示枚举/作用域相同，例如 Work 此 panel 没有 danger-full-access、indexed、guardian reviewer。当前本地七字段用户配置表单的 UX/字段范围与官方 ConfigurationPanel 是否一致，由本轮主合同逐项取证；本文件不替代该调研。

## 验证状态

已验证：当前磁盘源码只读检查、固定新包路由/静态请求/消费者片段、包装 chunk 包内 integrity、记录文件大小与 SHA-256。未运行真实远程请求、未获取当前账号 Work gate 证据、未验证官方 Windows 页面像素、未修改产品或运行 Cargo。本合同状态为静态调查，不能标为功能通过或用户验收。
