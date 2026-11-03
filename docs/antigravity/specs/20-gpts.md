# 20 GPTs：目录、身份与会话绑定合同

2026-11-03，修改前调研。整页未完成，未验收。未修改产品代码、未读真实令牌、未请求云端或执行付费turn。

## 基准与证据

固定 `C:/Users/lus/Codex/_internal/app/resources/app.asar`，SHA256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。包含已知offline补丁，不能当作未修改发行包。新增chunk均按asar header.integrity核SHA256，来源路径/大小/hash见 `../../../.ref/parity/20/reference/manifest.json`。

共享大chunk只保存有界片段；位置数字均为 **0-based UTF-16字符偏移**，文件名和锚点必须同时引用。界面中文、DPI/缩放、真实账号能力、同条件官方运行时和像素均未实测，visual=not_executed/score:null。

本机CLI 0.165.0的现场experimental schema取自19批次隔离CODEX_HOME生成产物，记录来源hash与字段在 `app-server-gpt-contract.json`。该schema没有GPT/Gizmo目录或绑定专用RPC；`thread/start`/`turn/start`无gizmoId字段，projectId是另一个对象，不能拿来绑定GPT。

## 路由与数据模型

- 共享路由 `/gpts`、`/gpts/mine`、`/g/:gizmoId`；创建 `/gpts/create`。
- 官方发现页：`gpt-discovery-page-4510329cc78f.js::GptDiscoveryPage`。
- 我的GPT：`my-gpts-page-e718db067430.js::MyGptsPage`。
- 详情弹框：`gpt-about-dialog-b2bdfa2c0142.js`。
- GPT聊天路由：`gpt-chat-page-c966e2f7522e.js::GptChatPage`，先真实加载资源，404和其他加载错误不同；失败可重试，short_url/id规范化后进入真实ChatGPT工作面。
- Builder：`page-d6eedb95ef2b.js::GptBuilderPage`，不是跳到本地技能创建按钮。

`gizmo`是服务资源，消费gizmo.id、short_url、gizmo_type、display.name/description/profile_picture_url/prompt_starters、author、tools、files、sharing/audience、migrated_plugin_id及服务权限等。目录列表项常为 `{resource:{gizmo:...}}`，workspace搜索又返回gizmos/query_continuation；不能用一套手写四张卡假充。

证据：`route-resolution.json`、`resource-retirement-identity.json`、原始page chunks。

## 访问、目录与搜索

| 场景 | 官方静态合同 | 状态/约束 |
|---|---|---|
| sidebar入口 | ChatGPT能力、账户allowed及plan存在，并排除FREE/FREE_WORKSPACE分支；visibleByDefault:false | 路由存在不证明当前账号应显示入口，不能强开 |
| 公共目录 | GET `/public-api/gizmos/discovery` | 响应cuts/info/list，依据display_group构建分类；排除gizmo_type:snorlax项目对象 |
| 分类分页 | GET `/public-api/gizmos/discovery/{category_or_cut_id}` | cursor/limit/locale；空页带cursor时继续一页；list.items/list.cursor |
| 文本搜索 | GET `/gizmos/search` | q/limit/cursor/workspace_only；搜索防抖，加载/无结果/请求失败/追加失败分别处理 |
| 我的/共享列表 | 同分类接口，cutId=当前mine等tab，limit:20 | query key含账号/tab，逐resource.gizmo.id去重；不能把未连接写成“你尚未创建” |
| 工作区目录 | 真实workspace目录/过滤分支 | 数据驻留、allow_third_party_gpts、quorum/角色限制决定可见项；不能本地拼“全部” |
| 工作区创建者筛选 | GET `/accounts/{account_id}/users` | limit:30/offset/query，依赖账号；不是静态author列表 |
| GPT详情 | GET `/gizmos/{gizmo_id_or_short_url}` | 返回resource；预期401/403/404与详情不可用；不能回退到手写提示词 |
| 详情about块 | GET `/gizmos/{gizmo_id}/about` | about_blocks，独立加载 |
| 同作者更多 | GET `/gizmo_creators/{uid}/gizmos` | 来自真实resource.gizmo.author.user_id |
| bootstrap/pins | GET `/gizmos/bootstrap?limit=20`，GET `/pins?item_type=gizmo` | 筛非项目GPT；服务记录决定置顶/最近使用，不以本地点击代替 |

公共接口名带public-api仍经官方共享请求/身份路径，不能据名字推断无需认证即可调用。当前仓库没有18/19所需的ChatGPT认证与完整性HTTP桥，单有account/read不够。

原始合同见 `gpt-discovery-page-4510329cc78f.js`、`directory-banner-750a4b00a524.js`、`gpt-about-dialog-b2bdfa2c0142.js`；有界片段见 `catalog-permissions-actions.json`。

## 选择、启动会话与持久化

目录点击先打开真实GPT详情；Start chat根据返回resource.gizmo.short_url或id导航 `/g/...`，不能只套用名字和promptStarter。`GptChatPage`加载详情、处理权限/404、规范化路径，最终进入ChatGPT聊天容器。

官方ChatGPT请求构建包含：

```text
conversation_mode: {kind:"gizmo_interaction", gizmo_id:<真实资源ID>}
gizmo_id: <真实资源ID>
conversation_id: <已有会话ID，续聊时>
```

原始有界片段保存在 `gizmo-id-dataflow.json`，其中也含文件/项目等同名字段，实施必须用conversation请求构建锚点而不是任意`gizmo_id`命中。这证明“真实GPT身份参与请求”，不证明目前本项目具备这条服务链。

会话恢复需要后端conversation绑定与真实gizmo资源，不能把仅前端选择或localStorage保存的ID当作已生效。账号切换、权限变化、详情删除、short_url变化须正确失效；不把上次GPT上下文误用到普通app-server线程。

**当前差距**：`App.tsx`的onStartGptChat仅 `startNewThread()` + `setThreadPrompt(null,gpt.promptStarter)` + toast，未传任何真实GPT ID，也未加载配置/知识/工具/权限。它是普通文本草稿，不能称与GPT对话。不要为填补缺口向app-server添加schema不支持的gizmoId，也不要把projectId或模型名冒充GPT身份。

## 创建、管理与迁移

- `gpt-management-access-78237017e41c.js`检查当前账号、`/accounts/check/v4-2023-04-27`、有效订阅/允许plan以及工作区RBAC `chatgpt.workspace.gpt.crud`；context账号不匹配或权限加载失败不能写入。
- 创建按钮依赖dynamic config `2513446768.disable_gpt_creation`、gate `2160578039` / `1663164947`及插件使用权限。可能进入旧GPT Builder或迁移创建选项，不能一律跳插件页。
- Builder保存 `POST /gizmos` query gizmo_id，真实draft字段/instructions/tools/files/分享等；发布 `/gizmos/{gizmo_id}/promote`，检查error/resource；请求失败保留草稿，禁止仅toast“创建成功”。
- My GPT的分享/删除是独立确认对话框和真实服务动作；本节未完整追完其写请求，**待补证，不据组件名声称实现**。
- 详情migrated_plugin_id决定迁移后的插件展示和入口；“迁移”是独立的受权限控制真实动作，不等于打开插件目录或skill-creator。

### 纠正“12月11日停用”硬编码

`retirement-2863bfa3ced4.js`的无效/缺失日期默认值确实为UTC **2026-12-11**，但这不能证明应给所有账号无条件显示固定停用横幅。

`notices-f4b9bf214fa8.js`：

- config `2562735250.enabled`控制迁移notice；
- `2513446768.retirement_date`提供实际日期，以UTC本地化月/日；
- 账号、工作区与插件权限决定可迁移状态，disabled按钮解释权限；
- 文案表达未迁移GPT在截止后不可用，迁移后可作为插件继续使用；不是“所有GPT无条件停用”；
- 可dismiss当前session，不会因关闭notice而发生迁移。

`gpt-about-dialog`也区分Migrate to plugin与Start chat，原GPT仍有独立聊天动作。旧GptsView的固定日期、无条件迁移、空列表断言均超出了证据。当前没有官方运行时gate值，不能对外宣称此日期已作为当前全量政策生效。

## 当前可立即开发的最小真实增量

1. 撤销四张SAMPLE_GPTS、虚构OpenAI/作者背书和固定分类，撤销未连接时“我创建的GPT为空”的断言。
2. 撤销无条件停用横幅、无证据迁移承诺和“GPT→普通prompt”的假绑定回调。
3. 页面保留准确服务未连接状态；如保留插件导航，使用普通“打开插件”语义，不把导航提示为已迁移。
4. 实际GPT目录/详情/创建/聊天绑定依赖认证HTTP桥与账号能力，当前不能用已有app-server完成。可以继续开发桥及协议合同，但未接服务时不展示可执行假卡片。

该增量只修正误导行为，不能替代真实GPT页面。为推进整体，限定增量交付后继续其他单元，整页服务缺口保留。

## 动作与验收合同

| ID | 操作/前置 | 必须结果 |
|---|---|---|
| GP01 | 未接ChatGPT服务进入GPTs | 准确未连接；无示例卡/假空库/全员固定停用断言；不产生普通线程假GPT |
| GP02 | 连接后进入公共/工作区目录、搜索、分页 | 同官方分类/返回形状/身份过滤；loading/error/empty/追加失败可区分 |
| GP03 | 打开GPT详情、404/403/重试 | 真实资源、about与权限；不可用不回退假内容 |
| GP04 | Start chat后发消息/恢复 | 请求带真实gizmo_interaction/gizmo_id，后端会话恢复身份正确；普通prompt草稿不通过 |
| GP05 | 我的GPT/共享、编辑、创建、发布 | 真正服务读写与回读；权限/订阅/退休控制正确；失败保稿 |
| GP06 | 迁移notice与迁移动作 | 使用实际config日期与gate/RBAC；Start chat独立；确认服务迁移后才成功 |
| GP07 | 切账号/权限撤销/离页/晚到响应 | 清旧账号缓存/草稿引用，不跨账号写入；取消与失败可见 |
| GP08 | 原生和像素 | 同环境官方截图、菜单/焦点/快捷键/宽窄窗口；本轮未执行 |

当前只有GP01具备不依赖外部服务的实施条件。GP02–GP07缺认证服务和可用账号条件，GP08缺同条件官方实测；不得把限定纠偏或静态chunk发现记为整页通过。

## 20B 修改前真实只读切片（2026-11-03）

共享桥BR01已在隔离未登录环境验证0.159.2与0.165.0均支持legacy getAuthStatus，无token/模型turn。20B接入真实gpts_discovery/category/detail读取：前端先取得宿主脱敏identity，再按固定operation、真实浏览器profile和expectedIdentity读取。只展示服务返回cuts/list/resource.gizmo；snorlax项目资源过滤。分类cursor追加去重；失败保留现有列表，空态仅在成功合法响应后显示。账号/连接变更与离页取消旧读取，晚到结果不写回。详情读取真实ID，GPT会话写入仍未实现，不提供普通prompt假Start chat。

暂不放行GP02全量搜索/所有workspace gate/完整mine列表、GP04–06写入或官方像素；真实账号HTTP成功尚未验证。curl为系统运行依赖，串行请求为已知内部差异。此切片替换20A永久“未连接”状态，需保留未登录/路由/权限/网络/协议错误与重试。
