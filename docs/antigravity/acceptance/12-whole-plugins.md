# 12 插件整页执行记录

2026-11-16。**整页开发中，未验收**。[修改前合同](../specs/12-whole-plugins.md)及[总计划](../../FULL-REPLICA-PLAN.md)R0/R1→R2。当前只是可回退开发节点，不是完整插件页交付或1:1通过。

## 已执行取证

主线程读取当前Store版本并重算app.asar SHA-256，仍为26.1103.4239.0 / `fb47d6491dc3006b708cb1e14de479b882bf50f88b7daa81818f154c253266aa`。同版143资源、19区域/动作锚点及补充10个schema锚点在`.ref/parity/12/whole-page/reference/r0-20261116/`。远端home扁平listing与完整库存/详情对象不同，不能送现有mapRemotePlugins；库存未就绪与已读无匹配的安装状态也不同。

三桌面能力研究另见[宿主矩阵](../../research/desktop-host-feasibility-20261116.md)，只证明静态依赖和资源存在，未执行官方helper、修改真实配置或强开gate。没有因此把三个说明页改标可用。

## 当前产品改动

- 目录保留已安装卡片，增加真实库存图标区；目录按已有category字段组织，不将市场名或混合默认响应命名为公开目录。
- 卡片改为logo占位、名称/单行描述与独立状态/图标动作；已装不再显示重复安装。真实logo与安装图形最终轮廓尚未校准，当前Boxes/Download沿用现有图标作为开发占位。
- 列表点击进入独立详情工作面，返回保留搜索；不在原卡内展开ID/认证/路径表。详情当前是已有能力的初步组织，完整markdown/提示词/信息/法律链接/深链尚未完成。
- 目录搜索自动聚焦；刷新读真实目录而非只读库存；从技能切入目录亦可加载。外部管理变更/窗口聚焦刷新目录及已打开详情，修正卸载后卡片仍“管理”的问题。
- 安装图标阻止卡片导航并复用同步单飞、策略、准备/不确定结果核验；未重写安装/启禁/卸载、账号或MCP链路，未新增依赖。设置管理面的完整纠偏仍在R2队列。

## 回归与构建

证据根`.ref/parity/12/whole-page/actual/r0-20261116/`：

- 私有真实`verify-plugin-management-b.mjs`、`verify-plugin-preparation.mjs`均退出0，安装/详情与库存独立读回、启禁CAS、冲突、卸载及市场移除成功，0模型turn，未动真实HOME或账号。
- `verify-plugin-directory.mjs`在旧实现真实失败，新增目录/图标动作/独立详情/返回、技能切入、连点安装和focus/事件卸载传播后通过。最后事件缺陷由独立只读复审发现并先红后绿。
- 首次前端总入口因旧`verify-plugin-settings`片段VM缺新ref退出1，保留`frontend.log/.exit`；补夹具后140项总入口退出0，见`frontend-recheck.log/.exit`。最后事件刷新补丁之后另跑生产目录/管理专项、TypeScript及plugins/actions/catalog检查均0；没有把总入口说成以该最后补丁完整复跑。
- 候选`npm run tauri build -- --ci`退出0，EXE/MSI/NSIS完成，`build-candidate.log/.exit`。本轮没有运行完整非Fast标准或全量Rust，没有改Rust产品代码；尚非页面最终交付。
- 候选EXE SHA-256 `6a30b66db309aa974d59108429df373cb12946bd689e7946aa119d158f0ab710`。437个产品输入记录于`product-inputs-candidate.json`，构建/原生后重算无变化。`native-fixture.json`及私有`verification/launch.json`记录CLI0.159.2、环境与运行hash，不把旧EXE当当前源码。

## 候选原生观察

测试使用私有CODEX_HOME/AppData/WebView和本地文字插件，两个可发现插件中一个已由真实app-server安装，另一个未装。没有通过GUI安装外部插件、登录、发送模型或改变用户配置。该私有app-server默认目录还返回可读取的curated条目，不称其为已登录远端home。

| 操作 | 实际结果 |
|---|---|
| 打开目录后直接输入private- | 搜索得到两个私有条目，已安装项为管理，未装项为图标安装；`candidate-private-search` |
| 打开未安装卡片 | 原生显示独立详情、真实description/版本及安装入口；`candidate-private-detail`，未在GUI执行安装 |
| 返回插件 | 搜索private-与两项状态保留；`candidate-private-detail-back` |
| 缩至窄窗 | 单列，两项与操作可见，页头换行；`candidate-narrow-directory` |

图片为JPEG，窗口捕获1435×900、957×679，不是已标定CSS客户区。UIA焦点字段只暴露文档层，自动搜索/返回后的输入以实际文本和可见界面作有限证据；物理IME与完整原生焦点序列未验。官方配对图缺失，score=null。

## 下一步与未完成

### R2在途集成更新（晚于上述候选构建）

以下是晚于首批候选的集成改动，已使用下节新构建验证本地链路，不能沿用上述首批候选hash作为这些改动的证据：

- 增加typed flat首页/分类解析、资格与身份隔离、只读home/detail/category传输；主目录使用真实CLI搜索及200ms debounce，仅缺方法允许完整本地目录回退。私有CLI搜索探针已取得真实响应，HTTP传输仅注入测试，未实测账号。
- 接入分类分页、来源读回后的安装引用、独立详情URL与真实前后退。显式非空hostId拒绝，不默认为本机；未知库存状态不提前开放安装。
- 官方ACK补证区分安装、库存刷新和连接授权。安装ACK后库存失败/缺目标/部分市场加载失败保留待确认，禁止重复写；显式完整刷新可恢复。作用域journal覆盖组件存续中的账号/项目A→B→A，尚非跨组件卸载的持久记录，也未声称完整复制官方异常恢复。
- 独立复审复现两个P2后补回归修复：完整来源深链拒绝异实体详情；显式刷新重搜当前关键词。搜索循环游标保留已有结果并提示不完整，而非静默当末页；重试重新搜索。
- 新增搜索/URL/App历史/复审用例接入两个标准入口。初次前端集成在旧技能动作VM缺`unsupportedDirectoryHost`处退出1，补夹具后该专项及148项完整前端重跑退出0（`frontend-recheck.log/.exit`），TypeScript退出0。后端全量745项通过，0失败/忽略/过滤（`rust-full.log/.exit`）；HTTP使用注入transport，不能称745项真实服务验证。证据根`.ref/parity/12/whole-page/actual/remote-home-20261116/`。非Fast标准及32项真实协议探针退出0（`standard.log/.exit`），新EXE/MSI/NSIS构建退出0（`native-build.log/.exit`）；构建/原生后441个产品输入均无变化，`candidate-result.json`记录三产物hash及范围。
- 最后独立复审重跑目录与深链专项均退出0，另实测安装pending时显式完整空库存刷新再重复触发、ACK后仍缺目标均只发一次install；未发现新的确定重复写/跨身份污染。组件卸载后journal不持久的限制保留。

### 当前源码的新原生观察

产物[CodexNative.exe](../../../dist-artifacts/plugins-r2-directory-20261116/CodexNative.exe)，SHA-256 `7d8e88cda1272b5a6ef2e856350fc8607d7faf3dee3e973b6a35077653029afe`；同目录有MSI/NSIS。私有home沿用两个本地文字插件，AppData/WebView另建`r2-run`，未登录、未发送模型、未在GUI安装或卸载插件，测试后窗口已关闭。

| 操作 | 新构建实际观察/证据 |
|---|---|
| 未登录打开目录 | remote gate为真时明确要求ChatGPT登录；真实已安装private-first仍可见，未伪造远端首页 |
| 搜索private- | 真实CLI搜索返回private-first和private-second，已装/未装动作不同；`native-private-search.jpg/.txt` |
| 打开private-second | 独立详情读取真实description/version，URL含准确pluginId、pluginName、marketplacePath和search；`native-private-detail` |
| 标题栏返回/前进 | 返回保留private-和两个结果，前进重新读取正确详情；`native-history-back/forward` |
| 窄窗及刷新 | 957×679窗口下目录单列、页头换行；刷新保留query和两条结果，详情安装入口可见；`native-search-narrow`、`native-refresh-narrow`、`native-detail-narrow` |

宽窗捕获1435×900，尺寸是窗口而非标定CSS客户区。图片为JPEG。输入由UIA set_value执行，不能算物理键盘或中文IME验收；官方同条件配对图仍缺，视觉score=null。当前只是R2-A/B集成节点，完整详情、管理及整页验收继续进行。

继续R2，不因本节点转页：先完成当前目录/搜索/分类/深链的统一标准与新原生验证，再按已补`detail-contract.md`完成详情/提示词/资产、目录来源tabs和管理面联合纠偏，最后整页官方配对与用户验收。本地降级分支须明确标明来源，不能把默认plugin/list直接当官方HTTP目录。

尚未完成：真实账号远端HTTP、官方配对像素、物理IME、完整独立详情内容、来源tabs、图标条溢出组合、官方logo/安装轮廓、完整设置管理流程。分类首6/更多有生产回归，真实远端分类原生未测；本地搜索与详情历史有上述新原生证据。现有候选不用于发布；本轮重新读取最新远端run42644930892及job129255526818，仍为原来的未启动失败，注解为付款/支出上限；未重跑或更改账单，不能当当前源码CI通过。
