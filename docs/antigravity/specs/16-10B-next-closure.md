# 16.10B MCP 设置完整 CRUD：修改前合同

2026-11-03。只读调研，**本合同尚未实施**，不表示官方运行时或像素验收通过。固定 Store `26.1027.3384.0`；本次重新实测 asar SHA-256 为 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`，未变化。新提取资源逐个核 archive header integrity；完整hash、原文与定位在 `.ref/parity/16.10/actual/16-10B-research/{manifest.json,anchors.json,raw/}`。偏移均为0-based UTF-16。

官方功能文档：[MCP](https://developers.openai.com/codex/mcp/)，本次HTTP200快照 `official-mcp.html/txt`。文档证明STDIO/Streamable HTTP、环境变量/Bearer/OAuth、用户config和受信项目config；在线文档可能比固定包新，**界面字段与动作以固定包为准**，不能把新文档额外字段自动加入旧版表单。

## 1. 页面结构与真实来源

`mcp-settings-d02d57a3b385.js` 为薄壳，title slug mcp-settings、subtitle连接外部工具和数据源，复用 `plugins-settings-13da7ceae7e2.js` 的 `manageOnly:true`。以下称 plugins；initial指同包 `app-initial-4267e52fe5b0.js`。

plugins ga约23900开始：加载当前host、cwd layered config、独立MCP运行时status。普通列表标题“服务器”，header添加按钮；空态“未连接 MCP 服务器”+添加；无搜索结果“未找到 MCP 服务器”。来自插件独立组，不能当用户config CRUD。按display name/key排序，搜索同时匹配二者。配置没有而status有的服务器补入“来自插件”，避免重复。

普通行：名称、设置按钮、启用switch；只有status notLoggedIn且非statusLoading显示身份验证。project origin传isReadOnly=true，禁用设置/启禁；插件行不传设置/启禁，只可按实际状态认证。enabled缺失视true，只有明确false为关闭；status错误不等于disabled。

详情是**嵌入页面，不是添加弹窗**。新增标题“连接至自定义 MCP”、返回、文档链接、名称、类型；已有标题“更新 {name} MCP”+卸载，名称和类型不允许直接修改，提示“如需切换 MCP 服务器类型，请先卸载当前配置。”。保存底部靠右；失败留在详情，pending遮罩，保存/卸载禁重入。

## 2. 输入字段和保存规则

plugins oa约21500将raw投影成draft；sa约22600序列化。

| STDIO可见字段 | raw key | HTTP可见字段 | raw key |
|---|---|---|---|
| 启动命令 | command | URL | url |
| 参数（数组逐项） | args | Bearer令牌环境变量 | bearer_token_env_var |
| 环境变量（key/value） | env | 标头（key/value） | http_headers |
| 环境变量传递（数组） | env_vars | 来自环境变量的标头（key/value） | env_http_headers |
| 工作目录 | cwd | | |

新增默认STDIO `{command:"",args:[],env_vars:[],enabled:true}`。保存disabled条件：trim(label)空、draft与initial深比较相同、pending、或所选STDIO command.trim空/HTTP url.trim空。没有证据此UI强制URL parse或网络连通预检，不自行用更强规则声称官方行为。新增label只用于生成config key，不额外发送虚构displayName字段；编辑实际key保持原key。

key生成 Ca:31852：trim→空白改`_`→非a-zA-Z0-9-_改`-`→连续`-`合并→小写；空则custom-server；冲突以-2、-3递增。不覆盖已有服务器。

序列化必须保留语义：command/url/cwd原串（cwd仅非空length写）；args非空数组原样，否则省略；env key/value均保原值、空key过滤、空value允许；env_vars各trim过滤空；Bearer env var trim非空才写。http_headers key.trim、value原样且允许空；env_http_headers key/value均trim，任一空过滤；同key后项覆盖。不要按空格split参数，不破坏JSON内空格、引号、Windows路径或密钥。

raw base保留enabled、required、startup_timeout_sec/startup_timeout_ms、tool_timeout_sec、enabled_tools、disabled_tools；HTTP还保auth/oauth/scopes/oauth_resource。它们是**已有值保留字段**，不代表当前详情有对应可编辑输入。未知配置、内建codex_app、插件元数据不能因表单投影丢失；按字段改动而非全表重建。

## 3. 读取、scope和真实写入主链

initial iNn:3452823→nct:1653234→ag：`config/read {includeLayers:true,cwd}`，local默认活动workspace root，显式cwd覆盖；host独立。aNn取config.mcp_servers（兼容mcpServers），输出serverOrigins和configWriteTarget。

TNn:3460690优先选择**最后一个user layer**（cMn:3443399）；无user才由origins回退。managed来源包括mdm/sessionFlags/legacyManagedConfigTomlFromFile/FromMdm，不得写；system尝试user回退；project来源路径为dotCodexFolder/config.toml，但UI该来源行只读。没有scope选择器，不能增加“随便选择用户/项目”假装官方默认。不能把merged effective config整体写回user，吞掉项目/managed优先级。

### 创建、编辑、卸载

plugins He/Ue约26700调用initial mNn:3455473：

```ts
// 创建：仅该server；卸载：value=null
config/batchWrite({
  edits:[{keyPath:`mcp_servers.${key}`,value:serverOrNull,mergeStrategy:"replace"}],
  filePath:configWriteTarget.filePath,
  expectedVersion:null
})
```

编辑传previousValue和changedFields。mNn仅逐字段replace，移除字段value=null；env/http_headers/env_http_headers在transport不变时逐map key diff。编辑路径对server/field/map key做TOML双引号转义，不能把`.`当层级或任意注入路径。原包新增/删除顶层key未quote，但新增slug安全；本项目任意既有key应经实际协议探针核对quoted path，不复制潜在路径缺陷。

原包expectedVersion明确null，不宣称有CAS。本项目复用真实user layer/version CAS可保护并发，冲突需重读/保留草稿，属于本地可靠性增量；不要静默覆盖，也不要写每次新读到的version掩盖用户编辑期间冲突。保存后重新config/read证明目标字段/未改字段与scope，不能仅toast证明落盘。卸载后可能暴露低层同名server，应按有效配置重新显示，不能永久本地过滤冒充完全删除。

### 启禁

initial gNn:3456804：`config/value/write {keyPath:"mcp_servers.<key>.enabled",value:boolean,mergeStrategy:"upsert",filePath:null,expectedVersion:null}`；乐观更新两个配置cache，失败回滚，settled重读。官方这一分支文件选择与CRUD的显式target不同，不能说完全同一写scope。项目/插件/managed只读边界仍需保护，本项目若锁定user target则明确实现选择与差异，不能全局override受管来源。

### 重读与生效

initial vNn写成功invalidate layered config、mcp config、status。plugins将当前host加入dirty/restart集合，header出现“重启”，点击派 `codex-app-server-restart {hostId,intent:"restart"}`；`codex-app-server-initialized`清对应host的dirty记录并invalidate status。**不是写后自动mcpServer/refresh**，不是页面刷新就已重启生效。配置已保存、运行时未生效分别呈现；重启失败保留按钮和错误。不得用定时器伪造重启成功。

## 4. 状态、OAuth与协议

initial gMn:3444117调用listMcpServers `{cursor:null,detail:"toolsAndAuthOnly",limit:100}`，递归消费nextCursor；full路径不同。真实协议为 `mcpServerStatus/list`。Store0.166 schema在16.07C schema-store/v2目录，参数还可含serverName/threadId；不把当前可选参数硬编码为旧版本必支持。

OAuth plugins Ge约27200：仅未登录/实际可认证服务器进入；调用 `mcpServer/oauth/login {name}`，支持版本>=0.148.0-alpha.9或0.0.0时可传非auto clientRegistration=cimd/dcr；UI选择仅本次登录，不保存到config。response.authorizationUrl不能为空，校验外部browser可打开才进入进行中；重复点可重开同URL，不重新启动多个login。completed通知按hostId/name/success处理，成功刷新status。失败不能造已登录，窗口/host切换不能污染另一host。

Store schema OauthLoginParams：name必需，scopes/string[]、timeoutSecs、threadId、clientRegistration(auto/cimd/dcr)可选/null；response authorizationUrl。本阶段若只交CRUD，OAuth保持真实状态但不加假认证动作，明确列后续；不能以openURL成功证明已登录。没有证据当前编辑器包含注销OAuth按钮。

## 5. 中文与布局锚点

固定zh-CN-88ebb426d686.js：settings.mcp.detail.titleNew=连接至自定义 MCP；titleExisting=更新 {name} MCP；back=返回；name=名称；transport.label=类型；stdio=STDIO；http=流式 HTTP；save=保存；uninstall=卸载；saveError=无法保存 MCP 服务器；uninstallError=无法卸载 MCP 服务器；myServers=服务器；fromPlugins=来自插件；empty=未连接 MCP 服务器；addServer=添加服务器；restartApp=重启；server.enable=启用；server.login=进行身份验证；server.authenticationStarting=启动中…。字段中文见上表，实际key/value数组编辑不能换成一行JSON文本。

列表外层`flex flex-col gap-[var(--padding-panel)]`，行窄窗`max-sm:flex-col max-sm:items-stretch`，control`max-sm:w-full max-sm:flex-wrap max-sm:justify-end`；详情复用SettingsContentLayout embedded/fullWidth，主体relative，SettingsGroup.Content多组卡；错误`rounded-md bg-background-danger-surface/20 px-3 py-2 text-sm text-danger`，保存`flex justify-end`。仅静态class证据，DPI/窗口/实际截图仍未验。

## 6. 本阶段有界范围与测试合同

优先完整CRUD+启禁：独立client/组件复用真实layer读取，保raw字段，单server/单field CAS，读回，host/版本/冲突，列表与嵌入编辑、数组map字段、空态/错误/只读、重启生效分离。OAuth与内建MCP app数据清除可后续，不因本阶段未做而伪造按钮或成功。

- AC10-B01：user/project/managed/plugin/内建混合，同名高低层、无target、无config、断线；不误写effective全表，不丢codex_app/未知字段。
- AC10-B02：创建STDIO/HTTP、空label/command/url、key清洗/冲突、引号点号map key、args含空格/空字符串、env空value、header空value及env header过滤，读回持久化。
- AC10-B03：编辑只改指定字段，保持其它值及未知字段；existing不改type/key；删除map项/null清理、取消零写、pending重复操作、服务失败留草稿。
- AC10-B04：卸载只删user目标，低层同名重新出现可解释；启禁bool只改enabled、失败回滚、并发/跨窗/stale version冲突不覆盖。
- AC10-B05：保存与运行时状态分开；真实restart完成事件才清dirty，hostA事件不清hostB；status分页与错误/未登录独立，非登录不显示认证成功。
- AC10-B06：隔离CODEX_HOME真实protocol probe只触测试server，不启动不可信命令/访问真实密钥；相关tsc/功能标准和同源码原生证据。没有官方配对图/原生条件的项标未验，阶段提交不代表整页严格1:1完成。

本次只读提取/在线官方文档读取，无产品或已有测试修改、无Cargo、无真实账号OAuth、无MCP连接/配置写入。

## 2026-11-03 实施状态补记

本合同的本地MCP配置CRUD/启禁与列表详情主链现已实施，生产专项、双CLI隔离协议、受控Chrome、完整标准及全Rust332通过；最终构建见[16.10B待验表](../acceptance/16-10B.md)。CAS与user目标适配已明确；OAuth/远程host/官方原生像素与用户验收仍未完成。
