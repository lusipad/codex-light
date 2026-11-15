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

继续R2，不因本节点转页：远端home专用typed数据/资格与账号隔离→分类及目录来源tabs/分页→完整详情/路由/提示词/资产→管理面联合纠偏→统一标准/原生/官方配对与用户验收。本地降级分支须明确选用对应来源，不能把当前默认plugin/list直接当官方HTTP目录。

尚未完成：真实账号远端HTTP、官方配对像素、物理IME、完整独立详情/深链、分类首6与更多、图标条溢出组合、官方logo/安装轮廓、完整设置管理流程。现有候选不用于发布；CI账单历史阻塞未在本轮重新触发或处理。
