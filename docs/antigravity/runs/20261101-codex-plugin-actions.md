# 12A 插件操作与可用目录

日期：2026-11-01。功能专项自验，12 整页未验收。

## 官方证据与范围

[修改前合同及调研补证](../specs/12-plugin-actions.md)。原包 SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`；本轮直接提取并核 integrity 的文件见 [manifest](../../../.ref/parity/12/runs/20261101-codex-plugin-actions/reference/manifest.json)。

官方详情动作明确禁止默认安装插件卸载；中文标签为“由管理员安装”。shared dHr/oHr 的目录请求支持省略 marketplaceKinds，由服务端按能力提供默认远程目录；特定账号/gate 才选 vertical。新版 category query 另走 HTTP `/ps` 分页，不是 plugin/list 的 cursor。旧实现“必须 local-only 才安全”不能作为官方一致结论。

## 改动

- SkillsMcpView：安装/卸载按插件 ID 同步锁，允许不同插件独立操作；UI 和回调均校验管理员策略，默认安装插件不再弹确认后卸载。
- 详情收起即失效旧请求、清理 context/loading，旧成功和失败不重填；项目切换/卸载使插件目录和详情读取失效。
- 已安装/浏览读取有请求代次；旧 finally 不清掉新加载态。安装/卸载成功后重新读取 installed 与当前浏览目录，删除本地 patchMarketplacePlugin，不以乐观布尔值代替状态读回。失败提示并释放锁。
- plugins.ts：浏览不再强制 local，保留服务端默认目录；forceRefetch 从显式刷新传入，不强开 vertical/gate。
- 目录完整搜索后按 50 项递增显示，避免一次挂载整个大目录；这是客户端渲染分页，不减少网络响应体。去除浏览工具栏的内部接口/响应大小说明，刷新入口同时支持浏览目录。
- 复用现有协议/错误模型，无新增依赖。共享组件的 skills/apps/MCP 功能保持原有实现，插件异步保护不表示这些子页已全覆盖。

## 验证

- `verify-plugin-actions.mjs` PA01–PA06：执行生产 handler/loaders，覆盖默认卸载先红、重复写/不同插件并发、策略拒绝、失败解锁、详情收起旧响应、强刷读乱序、A→B→A、旧写完成不刷新新项目、安装/卸载后接口重读。
- `verify-plugin-catalog.mjs` PC01–PC04：执行生产封装，断言默认/强刷参数且无虚构分页；执行生产分页表达式，覆盖跨市场边界、完整匹配计数、无重复。
- 旧 verify-plugins 不再固化 local-only 错误合同；batch3 隔离协议探针新增默认目录 forceRefetch false/true。
- 浏览器生产组件回放：默认安装卸载 disabled；121 项先显示 50、显示更多到 100；搜索第121项得到1项；模拟安装失败可见，重试后请求 installed/list(forceRefetch=true)/skills，安装卡从浏览消失、已安装计数变2。仅隔离数据，不是真实安装通过。
- 详情浏览器回放的初始 fixture 错误：返回缺少 PluginDetail.summary 导致组件报错，修正 fixture 后重载/CDP超时，没有最终详情或截图证据。该失败不隐藏，也不把 handler 通过当作浏览器通过。

完整标准检查（含默认目录 false/true 两项真实协议探针）与 Release/MSI/NSIS 打包均退出 0，七项输入前后哈希一致；日志与绑定结果见 [actual](../../../.ref/parity/12/runs/20261101-codex-plugin-actions/actual)。[本批 EXE](../../../dist-artifacts/12-plugin-actions-20261101/CodexNative.exe) SHA-256 `1F5EF2877E8E3E3C45982ECAA90D31334DC1BD7AA3F42F60E50F11DC43688409`，HEAD/dirty/输入见 build-manifest.json。未执行真实账号安装/卸载。独立 lint 未配置，不声称通过；原有 chunk 大小警告保留。

隔离 Vite PID 233056 已核验命令行后停止；临时浏览器标签12关闭请求也遇到 CDP 超时，未确认关闭，不反复重建浏览器。browser-results.json 保留已观察结果和失败说明。

## 保留缺口

官方完整 /plugins 布局与新版 HTTP 分类/搜索/分页、账号gate、OAuth/ON_INSTALL 中间页、启用/禁用、默认插件状态策略全貌、市场源变更单飞、MCP/apps/skills 的并发和跨项目状态仍待验。大目录网络成本仍存在，本轮只约束渲染。真实安装文件读回和权限、对应 EXE 原生操作、宽窄与官方同条件截图均未执行；不能报告像素通过。全局刷新原有其它子页异步路径不在本轮称已修复范围。12 未完成，未提交/推送。
