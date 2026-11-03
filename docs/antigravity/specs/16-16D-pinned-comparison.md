# 16.16D 固定提交比较与私人审查前置

状态：只读调研合同，尚未实施；接续[16.16C真实阅读工作面](16-16C-remote-review-surface.md)，不将当前PR diff当作固定提交比较。

## 证据与边界

沿用Store 26.1027.3384.0。0-based UTF-16、end exclusive：

| 固定资源 | SHA-256 | 锚点 |
|---|---|---|
| app-initial-4267e52fe5b0.js | ba06de8c5418586b49ca7d639ea5ad2af531c1037454ec69b10b9ea11e00992e | snapshot [3561258,3561539)；revision diff [3561539,3561875)；revision file [3561875,3562211) |
| app-primary-998934e837fc.js | 084d7102a8eca9a49fc37e25d7b95c2c8052d3b5b2709e28867e266748d761a0 | GitHub/GitLab jZn [2496271,2497077)；GitLab kZn [2495834,2496220)；RZn [2498613,2501428) |
| .vite/build/worker.js | 1c0b48134ba6564b7da680600b8d068b29d0d700cf21fc119012ce296dff2e51 | SHA/path [772536,773043)；snapshot [773043,773703)；diff [773703,774047)；file [774047,774870)；读取边界 [774870,775266) |
| pull-request-revision-queries-21e464ddd969.js | 5776da86e22a15c4c21d02d2c63b3a293f1a4e103cecf74a74cbcb90bf1a3a49 | y从oldPath/newPath生成basePath/headPath，/dev/null→null；消费baseContent/headContent |
| pull-request-revision-tab-810f6a759f99.js | 5e50b3cbbdc5d8809dc2418eeef1e81e2652da0cb2add403af9eed41a82e1630 | all比较merge-base→head；单commit parent→sha；刷新成功才替换 |

revision两个chunk由固定asar只读提取并核内容SHA/integrity；worker是CLI实现、query部分有CLI能力guard，不能称其完整结果已由HTTP服务实测。HTTP请求路径与primary实际消费另有直接证据。

原始取证归档：`.ref/parity/16.16/actual/16-16D-research/manifest.json` 与 `anchors.json`，包含5项资源哈希及18个0-based UTF-16原文锚点；两个revision chunk存于其 `raw/`，其余引用已有raw。安装包SHA与asar integrity均已复验；不包含真实账号HTTP或原生运行时证明。

## GitHub宿主请求与呈现

复用16.16C真实account/PR、gate、连接成员、expected身份headers、网络策略和取消；渲染层不提供可信account或任意URL。

1. POST `/wham/github/operations/gh-pr-review-snapshot`，body `{account,pullRequest}`，60秒，无自动retry/refetchInterval。与fresh metadata并行读，两个status均success且metadata.headRevision等于snapshot.snapshot.headRevision，否则拒绝本次比较。
2. 必要snapshot消费字段是baseRevision/headRevision/mergeBaseRevision。worker同名完整返回还含commits `[{sha,parentSha:null|string,title}]`，失败为 `{status:"error",error}`。不要因缺commits就伪造空列表；读取HTTP完整schema仍待实测。
3. POST `gh-pr-revision-diff`，body `{account,pullRequest,comparison:{baseRevision,headRevision}}`，60秒，额外预期422/503；成功 `{status:"success",headRevision,unifiedDiff}`，head必须等于请求。全PR比较必须把snapshot.mergeBaseRevision作为comparison.baseRevision，不能用snapshot.baseRevision代替。
4. POST `gh-pr-revision-file`，上述请求加basePath/headPath（repo相对path或null），30秒，额外预期422/503；成功 `{status:"success",baseContent,headContent}`，unavailable与error分别呈现，不把缺文件当空。/dev/null侧是null，对应空内容。
5. worker校验SHA为40位hex，path非空、POSIX非绝对、normalize后不变且不穿越；超过1MiB、非base64、NUL或非UTF8不可用。上述属于同包worker边界，HTTP实现需独立校验实际消费字段，不能伪称已实测全部限制。
6. 若完整commits可用，选择单commit时parentSha→sha；parentSha=null回退snapshot.mergeBaseRevision。刷新成功才替换快照并清commit选择，失败保旧快照并显示失败，不换成混合head。

## GitLab单独处理

POST `/wham/gitlab/operations/read-snapshot`，body `{account:{provider:"gitlab-connector",hostId,hostname,connectorId,accountLinkId},pullRequest}`，retry=false。primary将响应**顶层**baseRevision/headRevision/mergeBaseRevision/可选计数作为comparison，不是GitHub的status/snapshot包装。实例列表没有accountLinkId；必须再核真实当前授权link。完整错误schema及GitLab revision diff/file路径未证，不编接口、不套用GitHub解包器。

## 私人审查与真实工具前置

只有绑定真实账号/PR/三SHA的比较被核验后才可启动私人审查。RZn要求远程源码工具核login/完整分页/改名删除二进制及遗漏patch，无法核验必须报告未完成。get_user_login等只是提示中的工具名字，不能写成假的宿主路由。

fixed initial Mun约2958000处存在readDynamicTools→动态namespace/function或desktop MCP工具注入；可证的是create_worktree/read_thread等桌面能力，不能据此断言远程源码工具已注入。当前生成ThreadStartParams未列dynamicTools，官方内部实现却使用它，这是实验/稳定schema范围差异。先用当前binary的隔离只读探针确认，再决定是否使用；不擅自加未知参数或强开features/apps。

复用当前thread的mcpServerStatus/list与真实app/installed/app/read核可调用性，保留disabledPluginIds。工具目录或OAuth状态仍不证明指定GitHub login已核验。私人thread创建/复用须绑定账号和PR，归档不绕过、网络失败不解除旧关联，真实turn/失败/取消由既有结果控制器承载；完整执行另留证。

## 修改前验收合同

- 账号/实例/PR切换、旧响应、取消及双击不能混用比较或启动旧thread。
- metadata/snapshot head不一致、无merge-base、不完整snapshot、revision返回不同head均失败，不制造成功空diff。
- all使用merge-base；commit root/null parent与刷新失败保旧快照分别回归。
- 远程删除/改名/相对path不得打开本机同名文件；binary/大文件/不可读不伪造成空内容。
- 真工具缺失、指定账号无法核验或分页/patch不全时只报告未完成，不输出假“无问题”。
- Node/Rust契约、跨层真实测试返回、现有读取回归、完整标准与原生构建；官方运行时、账号HTTP、原生/像素仍独立待验。
