# 17B 原生 Quick Chat 线程窗口

状态：开发及自动回归完成；原生交互与像素未完成，待用户验收。修改前合同见[17B规格](../specs/17-native-quick-chat.md)。

采用Tauri独立quick-chat窗口及真实App协议状态，默认470×640/min400×400、无框、可调大小、不显示任务栏、非置顶。singleton锁串行创建/切换/隐藏/主窗口继续。关闭请求和Escape隐藏保留WebView，继续携threadId向main发送事件，主窗口同ID不重复resume。前端只渲染Quick Chat/真实Composer/审批/目标编辑，未发送草稿和附件保留在小窗。主窗口草稿存储与小窗隔离，主窗口独占系统通知/音效、收件箱持久化、托盘与原生菜单，避免多窗口覆盖与双执行。

改动：src-tauri/src/quick_chat.rs、lib.rs最小注册、quick-chat capability；App.tsx、HotkeyWindow及布局CSS。复用App状态与现有Composer/审批/发送协议，无新增依赖。保留浏览器应用内面板作为明确的开发回退。QN01/QN03/QN04执行生产路由回调、事件订阅清理、同ID/异ID接续、失败提示和独立草稿；Rust三个adapter用例覆盖显隐/恢复及错误停止、空ID校验。旧草稿/收件箱测试补充窗口上下文并增加跨窗口不覆盖断言，未放宽既有断言。

常规Release/MSI/NSIS构建通过，产物在dist-artifacts/17b-native-quick-chat-20261103。完整Rust120通过。完整标准检查首轮因测试夹具未提供新窗口上下文失败，记录保留；修正夹具后的复跑结果见.ref/parity/17/native-actual/build-manifest.json。166项产品输入构建前后相同。

原生烟测限制：隔离CODEX_HOME/profile启动过常规EXE，但环境变量调试端口未开放，未执行窗口行为断言。微软[WebView2 flags文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags)说明提权进程会忽略本机环境变量flags。已生成仅用于测试的显式调试配置构建；启动此测试应用被自动审批审查拒绝，理由仅“blocked by policy”，未继续该被拒操作。调试配置EXE不在交付包中，release目标已恢复常规EXE。因此原生尺寸/焦点/拖拽/关闭与重开/真实线程流式接续、审批跨窗口竞态均未验证，不标原生通过。

验收：启动常规EXE→快捷键设置中“独立聊天”（默认Ctrl+Alt+O）→观察第二窗口；输入草稿、隐藏/重开、调整尺寸、关闭/重开；隔离工作区发送并中断/审批；回主窗口继续，核对thread/turnID和消息；主窗口草稿不得被小窗覆盖。当前为应用内快捷键，系统级全局热键仍未实现。

其他缺口：官方home/thread双窗口转场、屏幕贴边/位置持久化、多显示器、全局热键、完整执行/分页/队列管理、跨窗口未发草稿合并、官方运行时及同条件像素。Tauri当前版本无fullscreenable builder，未授予小窗全屏权限但所有原生全屏路径未实测。visual not_executed、score:null，不能作为整页严格1:1通过。
