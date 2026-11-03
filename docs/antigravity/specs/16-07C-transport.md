# 16.07C 账号指令传输与记忆清理边界

2026-11-03。本次只读取证，不代表账号运行时资格或网络调用通过。固定 Store26.1027.3384.0，asar SHA256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。

逐文件SHA256/integrity及片段保存在本机ignored `.ref/parity/16.07/actual/16-07C-research/{manifest.json,transport-anchors.json}`；共用16.07B/16.05B同包已核资源。以下数字均是 **0-based UTF-16**，不是行号或字节。没有账号网络请求、配置写、memory/reset或模型turn。

## 1. 账号指令实际HTTP目标

默认生产逻辑路径 `/wham/settings/user` 的物理请求为：

```text
GET   https://chatgpt.com/backend-api/wham/settings/user
PATCH https://chatgpt.com/backend-api/wham/settings/user
Content-Type: application/json   # PATCH
{"custom_instructions":"原始文本，清空时为空串"}
```

workspace routing 可以将 origin 改为实际返回的受支持 workspace backendOrigin，保留 pathname/search，并按真实 accountRoutingOverride 设置路由header。不能绕过真实routing强行固定chatgpt.com，也不能误用ASB的codex-cloud-backend。

| 链路 | 原文件与偏移 | 已证事实 |
|---|---|---|
| 逻辑GET/PATCH | cloud-preferences-80117a3a1dcd.js:647 / 1073 | GET/PATCH `/wham/settings/user`；PATCH含expectedIdentity和requestBody |
| 共享client | app-initial-4267e52fe5b0.js:1839306 / 1832645 | M_=new aht；路径不丢，body对象JSON.stringify，PATCH交给sendRequest |
| Renderer传输 | app-initial:1757575 / 1752026 | Zg.fetch→udt→宿主httpFetch.fetch，传method/body/headers/expectedIdentity |
| 宿主解析 | early-bootstrap-491-e75c34fa1b2c0832.js:1471031 | ensureAbsoluteUrl→sV.YK(options,relativePath) |
| Base URL | early-bootstrap-339-096ec1020e8592e0.js:100831 / 83684 | module88807.c优先显式环境override，否则prodApiBaseUrl；生产常量为https://chatgpt.com/backend-api |
| join | early-bootstrap.js:185744 | nZ去base尾slash和path首slash后相接；此路径保留/backend-api |
| Workspace routing | early-bootstrap-339:102234 | 真实backendOrigin替换origin；保留路径；无约束不加override header |

本项目无需支持环境任意URL来复刻正常产品；专用固定操作应拒绝前端任意URL、header和method输入，认证凭据继续只留宿主。

## 2. Body、response和失败

personalization-settings-bfea882ec410.js:35183 的 wi 把编辑器string原样传入 `{custom_instructions:e}`；读取使用 `r.custom_instructions ?? ""`。清空是空字符串，不存在UI发送null删除语义，宿主write应收string，不凭推断扩充null。

cloud-preferences:1073 的PATCH成功后将整个response对象更新到cloud-user-preferences缓存，对custom_instructions/communication相关修改通知跨客户端cache失效。该chunk没有完整response schema；可证明最小消费字段是可缺省/可null的custom_instructions，正常值为string；未知其它偏好不能删除或改写。不能编造PATCH response一定是`{ok:true}`或仅返回指令字符串。实现可保留原response并GET读回验证选定字段，缺失/null按官方读法显示空串，非string/非null明确报格式异常。

app-initial:1761957 fetchJson对204返回null，其它非空正文JSON.parse；无效JSON抛`invalid_json_response`。1757575在非成功response进入odt抛错；取消和身份变化传播异常。UI保存失败保留草稿、显示“说明保存失败”，不能因发送完成就变成功。

### 重试事实纠正

early-bootstrap-491:1468103 的默认401刷新重发条件不排除PATCH，只排除某特定POST并受retry==never/workspaceIP错误约束。cloud-preferences PATCH未显式传retry，故官方静态路径可能在401后重发一次。

本项目若采用“写请求仅发送一次，随后GET核对”需作为明确的保守适配登记，不能描述成官方同样单发。GET和PATCH重试策略必须分别验证，不能无意从现有GET循环继承多次写；超时/取消后状态未知须读回，不能自动报告未写或成功。

## 3. Headers、身份和gate来源

app-initial:1831273 A_提供originator、`x-openai-web-frontend=codex_webview`、`x-openai-codex-window-type=electron`、语言、auth标记等上下文。宿主early-bootstrap-491:1470765对JSON string body补Content-Type。1462753 performDesktopFetch删除不可信routing/integrity header，按真实token附Bearer、ChatGPT-Account-Id/Fedramp和workspace路由；token来自宿主app-server连接。

expectedIdentity是内部请求上下文，不写入JSON body或当普通HTTP header。cloud-preferences保存时捕获accountId/userId；宿主发送前比对token principal与缓存principal并关联身份signal；不一致AbortError/409，不能把旧账号响应写进新账号缓存。参见early-bootstrap-491:1462753起完整performDesktopFetch片段、early-bootstrap-339:102234附近token/routing帮助函数。

账号入口并非“能登录即开启”：personalization Aa:92366的Statsig gate2826489636切旧本地指令/统一账号指令；同时使用真实账号ID、userID和local/work访问状态。initial:1870519 uvt为rvt.allowed，1869169 avt为wv.allowed，其组合来源本地/Work访问策略，不能用CLI memories catalog代替。gate查询Mb:2132057使用Statsig store Tg；bootstrap逻辑initial:5985256 B8i POST `/wham/statsig/bootstrap`，不是config.toml键。

当前静态证据不证明当前账号gate=true。可先实现专用GET/PATCH桥与身份/失败/读回测试，再通过真实只读账号/准入取证决定展示；403/未知资格不能自动改成本地AGENTS.md保存，也不能强开远程入口。

## 4. Memory与Chronicle的真实前置

personalization Xr内 reset（11529）实际顺序：

```text
if selectedHost.kind==local && chronicleAvailability.available && runtime.chronicle!=null:
    await clearHistory(scope="all", interval=null, showSuccessToast=false)
await selectedHost.appServer.memory/reset(params omitted)
```

前一步真实清理失败会阻止memory/reset；没有native能力时跳过该步，但没有任何“已清理Chronicle”的证据。chronicle-service-queries-2ed0a2717495.js:5874 的clearHistory mutation调用真实runtime.chronicle.clearHistory，不是写features.chronicle=false。

关闭Memory主开关（personalization:13632）与删除完全不同：并行feature/config写入，另执行chronicleDisable。如果local、availability.available且native存在则runtime.chronicle.setEnabled(false)；否则走chronicle-service-queries:629的he，config/batchWrite设置 **features.chronicle=false**，reloadUserConfig=true、user configWriteTarget。禁用采集不等于清理旧数据。

### Windows确切能力边界

- use-skysight-chronicle-availability-d6508552413a.js:248 / 991：macOS+Statsig3488289778+非loading+requirements.featureRequirements.chronicle!==false才available；Windows得到unsupported-platform（即便CLI有chronicle feature条目）。
- early-bootstrap-491:4206282：native chronicle服务仅process.platform===darwin且getSkysightRecorderController存在时注册。Windows没有该native服务。
- 本次双CLI隔离只读catalog均返回chronicle stage=underDevelopment、enabled=false；这不证明用户真实配置为false，更不证明其历史数据已删。

因此Windows本机实现可与官方一致执行memory/reset并报告Codex记忆结果；Chronicle清理必须标未执行/unsupported-platform。关闭Memory时可真实持久关闭features.chronicle，但不得显示“历史已清理”。无需为了没有macOS清理服务让Windows的Codex记忆reset永远不可用，也不能用假clear作为成功前置。

## 5. 最小可实施合同

1. 账号桥固定GET/PATCH上述物理路径、白名单仅custom_instructions:string；复用宿主token、routing、取消、identity generation，失败草稿保留，写后GET核对，不泄露令牌。
2. 账号与本机指令分别缓存/读写，未知gate不冒充可用；补真实只读资格证据后才放行账号UI。
3. Memory开关写feature+generate/use并真实读回；工具辅助开关写disable_on_external_context并删除旧别名；用户层/managed限制与CAS不能绕过。
4. Windows关闭Memory时features.chronicle=false是真实禁用动作；reset只执行支持的Codex记忆删除，不将跳过的Chronicle清理算成功。未来macOS native可用时必须先真正clear再reset，clear失败中止后续。
5. 部分写成功、401重试、取消/超时状态未知、身份切换和服务重启均独立测试；无真实账号写和真实生成记忆证据时，不宣称在线或模型消费已验。
