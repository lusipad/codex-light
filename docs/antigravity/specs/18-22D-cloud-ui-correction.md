# 18–22D 云端页面结构与读取纠偏

2026-11-04，开发前合同。基准Store26.1027.3384.0，asar SHA256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。本轮显式读取Store原包，不使用硬编码旧包的提取脚本。原文件/hash见 `.ref/parity/18-22/actual/18-22D/reference/manifest.json`。DPI、缩放、账号门控和官方运行态未知，不评分、不宣称1:1。

## 官方 → 当前 → 本轮动作

| 页面 | 当前Store静态合同 | 当前差距 | 本轮动作/验收 |
|---|---|---|---|
| 18 普通资料库 | library-page-9cacf8554ea4.js：默认与cleanup不同variant，目录、筛选、来源、面包屑、网格/列表、真实nodes | 永远状态卡，无目录读取 | 复用身份/门控绑定的libraryClient读取默认根目录，展示真实条目及分页，保留加载/错误/无权限；不把cleanup组件当普通页，不造目录跳转和上传成功 |
| 19 图像 | 独立图库/目录/生成工作面；现有19C隔离工作树保留 | 主根为未接状态页 | 本轮保留边界，不能把Library images冒充我的图像；补合同与可用性语义，不合并冻结19C |
| 20 GPTs | gpt-discovery-page-61b23db251d5.js + directory-banner-9504db8e489d.js：Search GPTs，查询300ms防抖，GET /gizmos/search q/limit/cursor，items为resource对象，排除snorlax，详情独立 | 仅发现目录，无搜索，author误用name而非display_name | 接既有gpts_search真实只读桥，搜索独立取消、分页去重、失败不冒充空结果、账号切换失效；校正author字段；测试生产JSX |
| 21 Sites | sites-view-3878021e2c94.js为路由容器，正常站点列表与设置/发布不同工作面；旧21合同只作地图 | 正常首屏常驻开发缺口文案，详情读取域名/环境变量混为一按钮 | 保留真实owned/shared/all与身份保护，去首屏实现说明，保留既有真实域名/环境读取入口，不新增假创建/发布 |
| 22 Cloud | cloud-environments-settings-page-c0c7bd1e0217.js：配置详情有Repository/Network access/Sharing/Configuration/Setup script/Secrets，编辑/删除另有权限保护 | 正常页常驻不可用说明，详情首先列版本与repo ID等协议字段 | 保留只读真实数据；详情优先仓库、网络、共享及脚本，把协议标识收进技术详情，写链仍不提供 |

## 实现与验证计划

1. 先锁GPT搜索响应、参数、乱序与取消行为，再接生产页；原目录/详情回归必须保留。
2. 普通Library先根读取、分页/重复cursor/账号失效，不以未知子目录协议推测导航；目录读取不代表预览/上传/管理完成。
3. Sites/Cloud定向生产组件回归，保留账号切换、失败与关闭焦点行为。
4. 主代理统一类型/构建/原生检查。本子任务不跑Cargo，不访问真实账号、不启动模型、不写云端、不提交。

未配对截图，不执行缺输入的visual-verdict数值打分；原生、像素、用户验收均未完成。任何剩余缺口不得计为通过。

## 实际结果与范围收敛

- 18：`LibraryView`新增默认根目录只读表与真实分页，复用`readLibraryAccess/readLibraryPage`的账号/门控/地区/来源资格检查；未修改`LibraryCleanupView`。请求失败不显示空目录，旧身份/离页结果不会落入新页面，重复游标可见错误且保留已加载数据。**只读表仅为根目录有限增量，不是完整官方浏览器或像素结构完成**。官方`library-browse-layout-3334d3a52834.js`为extraWide、compact sticky header，并有Grid/List；`library-list-skeleton-53f0aa521a58.js`显示来源、日期、共享人及大小列受上下文/gate控制，本轮尚未恢复这些完整分支。
- 19：保持主根未接状态和原有真实会话图像卡，不合入冻结19C。当前Store独立图像合同在`.ref/parity/19/actual/19C-research/notes.md`，其manifest与本轮同版本。**该页仍待恢复，未因本轮文档归档算开发完成**。
- 20：接公共发现分支已有`gpts_search`只读桥；真实查询300ms防抖、独立取消、分页去重、重复游标保护、错误重试及无结果；作者优先读取当前Store`author.display_name`。不新增GPT聊天/Builder按钮。workspace目录、公共/工作区切换、RBAC过滤、我的GPT与about完整块仍未实现；不据公共目录搜索宣称工作区限制完整一致。
- 21：去正常标题旁常驻的开发缺口说明，搜索使用search语义并限制输入长度；保留全部真实读取、共享列表、设置读取、秘密值掩码与失败状态。详情仍是dialog，官方`sites-view`的`SpaceSiteDetails`子路由表明完整页面导航仍待恢复；本轮没有声称详情路由完成。
- 22：去正常标题旁开发缺口说明；共享/状态使用属性行，仓库名称/ref优先，版本/repo ID/depth保留在可展开技术详情中；脚本长行可换行。真实数据、草稿优先、权限未确认提示与取消语义保留。官方完整配置布局、编辑/删除/重置缓存和子路由仍未实现，dialog只是既有承载。
- Sites/Cloud弹窗增加视窗内最大宽高和长文本折行，为当前窄屏溢出保护，640px不是官方测量值，不能写作像素通过。

### 已执行定向验证

2026-11-04：`verify-library-service/read/data/cleanup`、`verify-gpts-service`、`verify-sites-service`、`verify-cloud-environments`、`verify-images-service`八组Node回归均exit0；日志与exit在`.ref/parity/18-22/actual/18-22D/`。`npx tsc --noEmit`当时exit0，后续其他组仍在写源码，最终组合检查交主代理。

测试执行隔离VM与夹具，没有HTTP/模型/真实数据变更。未运行原生、配对像素或GUI；visual score=null，用户未验收。

### 独立复核修复（18D）

- 复现合法首个空页`items:[],cursor:"page-2"`被误报为整库为空：`library-empty-page-before.exit=1`。修复后只有无cursor终态才显示暂无内容；有cursor则说明可继续加载，下一页真实内容可见。`library-empty-page-after.exit=0`。
- 核对bridge原生`listen`可以reject。新增回归证明旧实现监听失败后仍读取资料，`library-listener-before.exit=1`。将监听注册和读取并入同一取消作用域，先注册成功再读取；失败显示可重试错误，不无保护读取。离页早于监听返回会立即释放监听。`library-listener-after.exit=0`。
