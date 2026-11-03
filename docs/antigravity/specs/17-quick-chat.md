# 17A Quick Chat 真实共享会话增量

2026-11-03，修改前合同。原包四chunk从固定asar直接只读提取并核integrity，见.ref/parity/17/reference/manifest.json及anchors.json。hotkey-window-thread-page渲染local-conversation-thread（allowMissingConversation检索锚点见anchors.json），mainWindowPath指向同conversationId；page-codex-quick-chat-composer复用会话controller、真实模型/服务档及session-current检查。静态证据证明共享组件/身份模式，不证明Windows窗口时序、尺寸或运行时功能可用。原包含offline补丁，非原始发行包闭环。

旧HotkeyWindow自建thread/start、固定1500ms读取、无ID返回假“已收到”和错误thread/list形状均不符合目标。当前先移除独立假链，复用App现有ComposerBox、turns及ApprovalCenter；这是应用内快捷面板增量，原生独立窗口另有缺口，不冒充已实现。

| ID | 修改前预期 |
|---|---|
| QC01 | 面板不再自建协议/超时/伪消息，渲染当前真实turns；content数组用户消息与agentMessage增量更新一致；错误/加载可见 |
| QC02 | 原样复用主会话ComposerBox与所有真实发送/停止/模型/权限/附件回调，面板打开时隐藏底层重复Composer；复用同一草稿，不另存局部发送副本 |
| QC03 | 复用同会话ApprovalCenter和真实响应状态/处理器，打开面板时隐藏底层重复审批；关闭面板不取消/重发/清空正在运行的线程；主窗口接续不重新resume当前线程 |
| QC04 | 新建调用App真实新建处理器；Escape尊重输入法、已处理事件，关闭后焦点返回；卸载移除焦点/滚动副作用；无旧/resume伪命令 |

回归使用生产JSX执行真实渲染和回调，主Composer/审批已有协议回归继续运行。原生独立窗口/全局热键/置顶/完整执行卡片/同条件像素未验。历史17–23的路由存在断言不能作为本页通过证据。

补充官方Escape监听：仅未处理且无Meta/Ctrl/Alt/Shift时dismiss；本轮照此限制，另保留中文输入法保护。完整检查启动后补正修饰键边界，最终专项及重建覆盖；不声称此前检查已经覆盖补正。
