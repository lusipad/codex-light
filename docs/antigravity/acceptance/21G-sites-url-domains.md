# 21G Sites URL与自定义域名

2026-11-07。开发中；设置能力读取与URL更改已完成限定功能/浏览器自验，完整标准检查与原生构建结果见末节。整单元未完成、未用户验收。不属于preview.8。

开发前来源：[规格](../specs/21G-sites-url-domains.md)，固定官方26.1027.3384.0；复用已核同包逐资源再次核hash，5文件、31完整函数、34export、57直接中文自检0失败。无官方GUI或同环境配对图。

## 当前增量

设置能力独立GET /websites/access，不受sharing gate或enabled字段阻断；仅custom_domains_enabled严格true才读取域名。初次未取回或正常false隐藏整行，cap错误与域名GET错误分别呈现，域名独立重试不重读环境变量。身份/换站/离页与旧finally不影响新请求；保留既有环境快照、草稿和21F写队列。

保留实际红绿：能力false仍请求域名，原始界面出现不可用域名行，以及首屏未fetched无错误却显示加载行。能力增量当时客户端19组、页面31组（旧26保留）、设置18组、原读取14/数据5通过，类型检查与累计81前端退出0；该次未重跑全Rust、完整标准或构建新原生EXE，后续URL结果另列。

浏览器载入真实组件/client/wrapper/CSS，只有bridge为明确离线host，CSP禁止外网。固定sharing gate false：正常customfalse实际capReads1、domainReads0、envReads1且无域名heading；cap失败可见独立Retry。恢复重试capReads2→3/domainReads0→1，envReads保持2、envWrites0，空键草稿仍在。域名失败分开可见；retry后capfalse只增加capReads4→5，domainReads保持2/envReads保持3并隐藏整行。1280×800与640×800无document横向溢出。计数来自可见DOM，不访问隐藏夹具状态。证据`.ref/parity/21/actual/21G-sites-url-domains/{reference,verification,browser}/`；680前一21F全量冻结结论不得套用本次工作树。

## 下一步与缺口

继续域名增删刷新、DNS配置和确认弹窗；不是将整单元缩成只读。根域识别的官方allowPrivateDomains依赖在仓库缺失，已询问是否允许精确引入tldts及必需core 7.4.9并随包保MIT许可，尚未获得答复、未安装；不能用点数量或手写后缀表伪造。源staleTime一分钟缓存及完整操作布局尚未完成，不宣称网络次数/视觉已全面一致。

官方配对像素、真实账号HTTP、物理IME、多窗口、URL弹窗原生及用户验收未做；visual-verdict score=null。不把本节浏览器测试称正式页面验收；生产EXE未登录路径结果另见末节。

## URL增量与实际复核

- 入口使用独立324493575 gate、slug_change_enabled、active及owner/nullish四项条件，64种组合经真实父组件回归。后缀复用完整官方iGs/hosted优先逻辑的96个向量，无猜测默认域；输入raw保留，仅请求trim/lowercase，400ms查询，不添加无依据maxlength。
- 复用现有私有typed桥、身份/取消和pending请求跟踪；availability与有副作用metadata严格分开。pending只记录请求，立即GET再1秒轮询、10分钟未匹配超时；无人观察后11分钟GC。complete同样读回真实metadata和截图授权；旧时间戳不能假收敛，晚POST能通知已返回的新页面。
- 未知结果先显式GET，仍旧URL则重新查availability；可用后仅允许用户明确再提交。实际浏览器发现恢复按钮被React复用为submit时，原click默认动作导致额外POST；保存red DOM，最小修复为恢复handler先preventDefault。修后实际开发模式写入次数保持1，查询次数2，可明确再提交；不以浅JSX模拟替代本条浏览器绿证据。
- 新客户端9组、状态/JSX22组、父页面32组、设置18组通过。保留旧数据收敛、跨页晚pending、StrictMode构造/挂载、complete回读错误及按钮默认动作回归。StrictMode最初red来自明确标记的历史实现回放，其他实际红绿分别留证，不混称所有用例均当前源码先红。
- Rust新增7项；聚焦sites21实际24通过/563过滤，全库587通过、0失败/忽略/过滤，Rust输入hash全程稳定。早期两项测试无界等待已限定5秒；保留中止日志和独立typed variant真实exit101，不把中止运行称完整7项红。
- 最终生产和development React夹具均载入真实产品组件/client，仅bridge为明确离线样本，CSP禁止外网。验证可用/占用、Escape返回、pending离页/返回及显式服务端样本完成后轮询更新、complete Enter读回、未知GET恢复、保存中禁止编辑/取消/Escape且隐藏X。1280/640宽度弹窗420 CSS px；440窗口测404.795约等92vw且居中，各document无横溢出。截图JPEG，缺少官方配对图，不作1物理像素结论。
- 证据：`.ref/parity/21/actual/21G-sites-url-domains/{reference/slug-supplement.json,verification/slug-ui/,verification/full-rust.log,browser/url-browser-result.json}`。准备私有原生组件宿主的命令遭自动审批拒绝，仅返回blocked by policy；确认原宿主index哈希未改变，该组件原生验证未执行。

## 最终本地阶段结果

最终83项前端检查退出0，684项输入在该检查和原生构建前后稳定。独立协议验证脚本不进入产品构建，修复后另记SHA及两版CLI结果。原生debug/no-bundle构建退出0，3个dist产物与5份既有许可随构建记录；未新增依赖或安装器。

完整非Fast标准实际337段/32探针执行完，首次退出1，唯一失败为模型偏好探针即时快照仍为旧模型。保留原失败；修复确认同步后在CLI0.159.2/0.165.0定向退出0，无模型轮次。另留一次临时配置落盘失败，原因未定，未加自动写重试。不称整套标准在同一最终冻结下重跑全绿。详见[独立诊断](../../research/model-preference-probe-sync-20261107.md)。标准开始后有两文件恢复click修复，但其22组专项执行于修后；之后冻结重跑83前端与构建，Rust输入未变。

当前EXE：`dist-artifacts/sites-21G-20261107/CodexNative.exe`，SHA256 `fb7a6dcd9ba36f28cddd16082c7876e3a9e553fa3534a7c5857b1bde6d827f6c`。源码基准b25cb71加本阶段未提交输入的完整hash清单保存在build-inputs.json，不拿preview.8产物验收新源码。

真实生产EXE使用私有CODEX_HOME/WebView与CLI0.165.0，已实测探索→Sites、实际`http://tauri.localhost/sites`、未登录错误、重试的加载→原错误、Alt+F4退出；PID消失、只读SQLite查0线程。该路径不证明正常账号URL写入或新弹窗原生键盘通过。当前URL阶段完成限定自验、待用户验收；域名写链及整页仍开发中。本阶段先本地提交，暂不推送或新发Release。
