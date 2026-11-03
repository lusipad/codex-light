# 16.16C 账号绑定远程PR工作面

状态：修改前调研合同；GitLab企业实例增量之后的主要开发单元。先实现真实GitHub PR阅读工作面，再闭合固定比较/私人审查与侧面tab；不得用旧gh CLI列表/本地branch审查代替。

## 固定来源与可证范围

Store 26.1027.3384.0，asar SHA-256沿用[16.16B](16-16B-next-closure.md)。本轮复核raw：

| 文件 | SHA-256 | 0-based UTF-16锚点 |
|---|---|---|
| app-initial-4267e52fe5b0.js | ba06de8c5418586b49ca7d639ea5ad2af531c1037454ec69b10b9ea11e00992e | XO/$O 3528346/3528824；响应schema 3536598；ck/dk 3546126/3548177；account 3555041；metadata 3556502；diff 3560358 |
| app-primary-998934e837fc.js | 084d7102a8eca9a49fc37e25d7b95c2c8052d3b5b2709e28867e266748d761a0 | global route 1372518；jZn 2496271–2497077；RZn 2498613–2501428；hQn 2512533–2515037；yQn 2515193–2516366 |
| open-task-tab-a68554cc784b.js | 87903c07b100b69a2ac98886cbafb85847c5910adb7f3b00e9275aa7fb3367ca | ge/X，tabId为code-review:规范URL；普通链接与显式菜单分流 |

以上是静态合同，未取得真实账号HTTP、官方运行时或配对像素证据。

## 首个实现闭环

1. 独立全局 `/code-review#pullRequest=<URL>` 工作面，URL导入→真实账号→PR摘要/元数据/正文/当前diff→失败重试/返回。导航轨进入该工作面；原本地审查保留原路由和快捷键，不混用身份。
2. 新宿主命令接真实ChatGPT身份与固定官方服务。渲染层仅传URL及期望身份，不传可信account/connection/任意endpoint。GitHub默认github.com，企业host须匹配已保存且当前授权的连接。gate 223049465明确true后读取，失权/未知不强开。
3. `POST /wham/github/operations/account`，body `{hostname,connection?}`。只有`currentUser.status=success`的真实`currentUser.account`可作后续账号；核hostname、login与选定连接，补实际local hostId。不把本机gh登录或实例列表当授权账号。
4. 基础请求 `{account:{hostId,hostname,login,connection?},pullRequest:{hostname,owner,repository,number}}`，hostname/login/owner/repository按官方规范化。所有请求带真实X-Codex-Expected-User-Id/Account-Id，JSON Content-Type，固定账号服务路由、网络策略/取消/身份代次与有界限时。
5. 固定POST：`gh-pr-metadata-v2`、`gh-pr-body`、`gh-pr-diff`，以及`summaries`的 `{account,pullRequests:[pullRequest]}`。metadata仅405或404且非github_resource_not_found回退`gh-pr-metadata`；真实资源404/403不掩盖。
6. 最小响应：metadata成功且headRevision非空；body成功且body字符串；diff成功且headRevision/unifiedDiff字符串；summary按数组第一项读取，成功时title/url/baseBranch/headBranch可为null，state是open/closed/merged。metadata/diff head不一致不能展示为同一比较，要求重读；当前diff不宣称固定提交快照。
7. 账号、连接、设置、请求URL或页面生命周期变化立即取消/遮蔽旧响应。账号A/B同URL不共享加载结果；失败不制造空diff、合并成功或私人审查完成。远程文件不映射成本机同名路径。

首轮只读工作面不实现合并、发表评论、检出、编辑文件或伪造私人审查结果。GitLab MR阅读端点另补独立合同，不将GitHub请求体套用到GitLab。

## 后续固定比较与tab合同

- GitHub jZn并行强刷`gh-pr-review-snapshot`与metadata，必须成功且headRevision一致，形成baseRevision/headRevision/mergeBaseRevision及可选计数；revision-diff/file完整schema尚待补证。gh-pr-diff会在发送前移除headRevision，不能凭这个客户端字段宣称固定比较。
- GitLab `POST /wham/gitlab/operations/read-snapshot` 使用真实gitlab-connector账号，含hostname/connectorId/accountLinkId；实例列表没有accountLinkId，不能直接启动审查。
- thread/start支持threadSource=code_review，turn/start支持turnTrigger=code_review；没有自拟provider/account/comparison/dynamicTools顶层字段。真实远程源码工具及新reviewer能力必须核验，提示内工具名字不是HTTP接口。
- 私人审查绑定真实账号/PR/比较，仅在聊天返回普通Markdown，不改代码/发评论。无法核账号或完整比较须报告未完成，不写“零问题”。个人指令原文不能覆盖这些边界。
- 专用侧面tab按code-review:规范URL去重/激活/替换；全局路由与侧面tab不同。会话关联atom为pull-request-chat-associations-v2，key含ChatGPT账号/用户、真实源码账号和PR，最多300；归档不绕过、确不存在才解除映射，网络失败保留。
- configured链接优先；缺失才消费reviewTabDefault。普通链接尊重偏好，显式Code review菜单不受该偏好阻断；unavailable/external/pending分别处理。

## 修改前回归与成功条件

| ID | 必须证明 |
|---|---|
| RRC01 | HTTPS/无凭据/有效PR身份规范化；企业host不匹配选中连接、无gate时不得请求PR服务。 |
| RRC02 | 真实account响应核host/login/connection后才发四类读取；固定路由/body/headers/限时/网络策略，没有任意URL代理。 |
| RRC03 | metadata-v2 405/接口404可回退，github_resource_not_found/403不回退；读取错误/不完整schema明确失败。 |
| RRC04 | metadata与diff head一致；空diff仅真实成功空串，不把错误当空。外部PR内容不执行HTML/指令，远程path不打开本机文件。 |
| RRC05 | A/B账号、实例或URL切换晚到、重复打开、卸载取消、失败重试；旧结果不能覆盖新工作面。 |
| RRC06 | 旧PR详情的“深度审查”也不能绕过安全入口调用本地branch；所有PR入口统一接远程工作面或明确不可用。 |
| RRC07 | 真实生产组件浏览器阅读/失败/重试，相关Node/Rust/TS/构建；原生/官方配对像素另验，不以夹具替代。 |

未知schema先停在对应子能力，继续有证阅读路径，不凭名称补接口。整体16.16C、整页16.16与全App目标均保持未完成，后续验收不能缩减成只检查URL输入框。

## 错误与实际消费字段补证

固定shared SHA-256 `f4b8ddb204fe43881fe4a625c09938e96aca597585583af1d86fc611c79d2e47`，bct [1778013,1778124)、aX/Pct [1780435,1780878)；initial odt [1749385,1751083)在1749884将HTTP原文交给该提取器。JSON节点优先序为extra→root→error→detail→detail.error→error.error，各节点依次尝试非空string的error_code→file_parse_error_code→code，不trim；未知早期有效码也阻止后续覆盖。不能只读取root.error_code，否则嵌套资源404会错误回退。

metadata缓存schema [3537284,3537806)中createdAt:string、authorLogin:string|null及三个计数number|null均为必有，summary [3536597,3537237)的headRevision也必有。URn属于官方持久缓存safeParse，失败撤销缓存但仍返回原服务响应，不能宣称官方运行时全量拒绝不完整响应。本项目校验实际消费字段，并对计数强化为非负safe integer/null、createdAt强化为非空；这是本客户端边界，不冒充官方数字/日期schema限制。
