# 16.11 插件设置：调查与组合管理合同

2026-11-01 初始调查（下方有本轮开发合同）。当前SettingsView的pluginMarketplaceUrl/pluginAutoUpdate/pluginAllowUntrusted/pluginDevMode/pluginSandbox仅存desktopPreferences，未发现产品执行消费者。不能把这些开关称为真实插件策略。当前已安装列表复用listInstalledPlugins，但加载异常被catch成空列表，缺少请求代次与失败重试；市场入口skills需核实际默认tab。

下一步：先追固定包plugins-settings页面真正renderer和插件目录/安装/托管策略合同，复用12A已经实现的真实消费者，避免重复自创市场或权限层。当前16.09/16.10完成仅为限定增量，插件设置不沿用其缺证UI通过。修改前定义启停真实写读回、管理员约束、加载失败/重试/旧响应和入口导航用例，再改源码。

参考旧docs/antigravity/specs/12-plugin-actions.md与12A安装/卸载/政策证据，使用前核当前固定包hash，不直接继承旧通过。自动更新/开发模式/未签名许可若无真实执行器先撤下虚假生效入口；完整官方视觉和原生继续待验。

注册取证：plugins-settings与file-type-handlers使用同一component yt，plugins-settings可见性依赖p，不能认定与当前“市场源/自动更新/沙盒”表单对应。原始锚点见.ref/parity/16.11/reference/registration-trace.json，使用原始UTF-16偏移；下一步追yt由app-shared Zx导出所指向的真正renderer。

## 16.11A 开发前合同

真正页面由 plugins-settings-f7077a21c195.js 导出 PluginsSettings，主体 plugins-settings-cbe96e4a6efb.js 的 no 渲染标题、组合管理器 za(manageOnly:true, initialManageTab:plugins)、浏览目录及添加入口。原注册 component yt 实为图标，不是页面 renderer，前段追踪推断在此纠正。证据见 .ref/parity/16.11/reference/renderer-contract.json。固定补丁包及运行时缺口继续保留。

本次复用 SkillsMcpView 增加设置管理模式：插件/技能/MCP 三标签、默认已安装、保留真实读取/失败重试/策略约束/操作读回，浏览目录按当前技能标签或插件标签跳转。移除无消费者表单及公共保存；旧本地值保留以免破坏数据。暂不重写既有 MCP CRUD。

验收 PS01：设置直接挂载真实管理器，加载错误不能作空列表；PS02：设置只显示插件/技能/MCP，默认已安装，无假策略保存；PS03：浏览目录在技能标签进入技能目录，其余进入插件目录并选浏览模式；PS04：既有插件动作/目录/技能回归通过，离开设置卸载管理器保持旧响应隔离。视觉、原生及远程服务逐项待验，自动检查不代表整页完成。
