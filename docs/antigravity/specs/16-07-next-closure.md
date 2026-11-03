# 16.07B 个性化下一阶段：修改前调查与合同

2026-11-03。仅完成只读静态调查，未开始本阶段开发/验收。固定Store26.1027.3384.0，asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。原始报告/逐文件integrity及0-based UTF-16锚点见本机ignored `.ref/parity/16.07/actual/16-07B-research/{research.md,manifest.json,anchors.json}`，不把这些路径当Git随附资源。

## 先明确三个独立能力链

- settings-lazy-routes-1c307af3cdd3.js:8325 → personalization-settings-bfea882ec410.js（122455 bytes，SHA-256 `01c232b7facc26b9487e2e9a9ebfa18990b817aa312b7601fcf34a20c9670892`）:92216 ka→Aa。Aa:92366由gate2826489636切换呈现，静态gate不等于当前账号已激活。
- 旧本地Codex指令、本机AGENTS.md统一分支均按执行host真实home读取/写入文件。统一分支与账号“自定义指令”并存，后者走独立cloud-preferences GET/PATCH `/wham/settings/user` 的custom_instructions及expectedIdentity，不能写AGENTS.md冒充同步。
- Memory是独立feature/catalog及memories.generate_memories/use_memories、memory/reset/chronicle链，另设合同，不因指令文件已保存宣布记忆完成。

## 下一阶段有界范围

先完成本机指令闭环，复用既有PersonalizationSettings、personal_instructions.rs和Markdown组件，不新增依赖、不强开统一gate或假远端host。按真实执行host/home能力读取本地路径，入口row/标题/描述/返回取消保存、初次失败重试、后台刷新保稿、override告警、安全原样写读、身份/host/跨窗与外部修改冲突保护分别落实。

精确官方来源：early-bootstrap-339-096ec1020e8592e0.js中W:700401派生host/WSL codexHome+AGENTS.md并缺文件创建，z:700757读内容和非空override，Q:701053写文件；personalization-queries:178/215/442按hostId读写隔离。personalization主chunk Ti:35696/Ei:36630、36930、37874、vi:31575定义加载、dirty全局导航与CmdOrCtrl+S；未找到默认Ctrl+Enter合同，需纠正旧预期，不继续凭旧测试保留推断。agents-md模式的源/预览需先证资格，且官方是Markdown编辑模式切换，不可把只读渲染称编辑器等价。

现有本地单一textarea、标题/成功提示/文件描述与新包不一致，无host参数/跨窗通知；现有expectedContents可复用，但比较后fs::write仍有外部竞态且无reparse/路径身份防护。安全适配须明确其与官方静态写法的差别，不借此宣称已验原生等价。

## 修改前成功条件

1. PI-B01：入口/中文/加载/错误/重试/空/正常/override与实际资格有来源；账号指令不可写本地替身。
2. PI-B02：隔离真实文件创建/清空/原样换行/未知外部编辑、并发CAS、路径替换/写失败和读回，不碰用户真实文件。
3. PI-B03：编辑/取消/返回和全局离开dirty导航、保存单飞/失败保稿、CmdOrCtrl+S/IME、晚到读写和host/身份切换有生产回归。
4. PI-B04：跨窗读回、真实新聊天文件消费/override优先级分开取证；未发模型turn不声称模型已执行。
5. PI-B05：已证实统一AGENTS.md资格才实施源/预览编辑；账号/Memory无资格则明确未实现，完整页面不记完成。
6. PI-B06：最终标准、相关及全量Rust、同源码原生构建/输入指纹、官方同条件视觉/原生与用户验收分别报告；大阶段通过自验后Lore提交，远程无分叉可推送。未测不冒充通过。

官方GUI、gate实际账号状态、DPI/App缩放及配对图仍未知，开发范围按已证实本地能力推进；必要运行时信息缺失不作为伪开启远程服务的理由。
