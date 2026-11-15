# 12 插件整页合同与R0/R1执行

2026-11-16，开发前记录。整页状态为调研/开发中，未通过官方运行时、像素或用户验收。[总计划](../../FULL-REPLICA-PLAN.md)R0/R1→R2，旧12-13D的26.1027位置不沿用。

## 基准与证据

本轮读取Store版本26.1103.4239.0，重新计算app.asar SHA-256为`fb47d6491dc3006b708cb1e14de479b882bf50f88b7daa81818f154c253266aa`。当前固定版目录/管理证据位于`.ref/parity/12/whole-page/reference/r0-20261116/`：report、manifest（136条目integrity/大小/hash）、anchors（13关键UTF-16锚点）、zh-copy。数字不是物理行号。

当前官方文档：[技能与插件](https://learn.chatgpt.com/docs/skills-and-plugins)、[插件开发](https://developers.openai.com/plugins)支持插件可组合技能/MCP及共享目录；具体界面与门控以固定包为准。当前文档不替代旧版运行时证据。

## 来源结论与区域树

普通Codex目录：页面头/副标题及管理→插件/技能入口→目录来源tabs及搜索→已安装图标条→分类卡组→独立详情。紧凑壳另有sticky/search分支，不能与普通版混用。

- `514115.8fbb427cba.js`：普通页头inset/page/medium，搜索autoFocus、id=`plugins-store-page-search`，query保留；真实已安装图标条。公开/工作空间/团队/个人根据账号与内容门控，不强开。
- `772864.6475793667.js`：远端开关优先feature列表`remote_plugin`，缺项才读Statsig4218407052。真时ChatGPT资格下GET `/ps/plugins/home`的sections；假时`plugin/list {marketplaceKinds:["local"],cwds:resolvedRoots}`本地分类。undefined是加载/未知，不能当false。远端首页不混入本地市场分组。
- `704837.a97a7a5782.js`：目录卡包含已安装，36px logo、标题/单行描述、条件来源；未装icon安装按钮，已装状态/管理。点击进入独立详情，安装stopPropagation。普通卡无版本/认证/路径metadata表。
- `565116.d530028e70.js`：目录grid默认单列，容器581CSS px双列，横gap24/纵gap8。
- `548929.7a0b4cbb28.js`：管理候选plugins/apps/mcps/skills/marketplace；MCP常驻，其他按真实计数/宿主能力。不是固定删为三tab。保留已接通的管理链路。

## 动作及修改前验收预期

| ID | 动作 | 可观察预期/真实结果 |
|---|---|---|
| P01 | 打开插件目录 | 聚焦搜索、读真实目录与已安装；目录不是安装管理面板 |
| P02 | 搜索/清除 | 不过滤已安装；卡片与已安装状态一致；原始目录和作用域不变 |
| P03 | 打开已安装项 | 进入对应详情/管理，不触发安装；同名不同market身份不合并 |
| P04 | 点击目录卡/键盘Enter或Space | 独立详情工作面，列表不再内联metadata；返回保留搜索与可见列表 |
| P05 | 图标安装 | 可访问名称“安装 {name}”；只安装一次，不同时打开详情；既有权限/准备/读回继续生效 |
| P06 | 已安装状态 | 不显示再次安装；以真实installed/readback决定，不以点击或toast冒充 |
| P07 | 刷新目录 | 强制重读当前目录和库存；错误保留可见重试，不仅刷新库存而留下旧目录 |
| P08 | 账号/工作区变化/离页 | 旧目录、详情、错误与晚到安装结果不能污染新身份；关闭后释放监听 |
| P09 | 目录/设置管理互跳 | 管理只导航；既有启禁/卸载及动态tab保留；不多一层installed/browse目录开关 |
| P10 | 宽窄/长描述 | 源断点、logo、单行描述与层级正确；真正像素需配对图 |
| P11 | 远端资格/目录切换 | 仅真实gate和账号支持才读相应HTTP；未知不伪造公开/工作区目录 |
| P12 | 安装失败/授权等待/未知结果 | 真实结果读回；不把打开OAuth外链当已连接；取消不重复写 |

## 实施边界与依赖

已证实的本地目录/已安装呈现、卡片动作和列表→详情→返回可先开发，复用现有协议/锁/身份保护。远端home schema、分类分页、详情精确URL模板及官方焦点待继续取证，不能因这个局部可开发而放行完整R2。不得将默认混合plugin/list强命名为公开，也不删除已有远端能力来伪装完整。

R1三桌面能力同版资料在`.ref/parity/16/whole-page/reference/host-r1-20261116/`。Computer Use Windows使用实际allow-list配置；Appshots需要helper protocolVersion=1/windows_appshots_v2及目标/捕获/文本/热键消费者，双Alt和60秒路由均有源。浏览器需要原生session服务。仅静态可行性，不依赖复制官方binary、未运行helper或修改用户配置。

## 本轮真实探针

`verify-plugin-management-b.mjs`与`verify-plugin-preparation.mjs`在私有CODEX_HOME/目录分别退出0，安装/独立详情及installed读回、启禁CAS/冲突、卸载与市场移除读回均有结果，0模型turn。证据`.ref/parity/12/whole-page/actual/r0-20261116/`。本地夹具验证协议消费者，不等于远端账号或官方页面通过。

页面整体剩余：远端首页/分类/来源tabs、完整独立详情及深链、官方资产与精确呈现、原生正常链路、同条件图/物理IME和用户验收。后续结果在整页验收记录续写。
