# 17A Quick Chat 共享真实会话

状态：应用内面板限定增量自验完成、待用户验收，原生独立窗口未完成。

先核对[修改前合同](../specs/17-quick-chat.md)，六个原包chunk直接提取并核integrity，复核官方本地线程共享组件及Escape约束。修改HotkeyWindow、App与main入口，撤独立thread/start、错误resume形状、固定延时读取及伪成功消息。

面板复用主App的turns、ComposerBox、ApprovalCenter及模型/权限/附件/发送/停止/审批回调；不再维护第二份会话或发送草稿。打开时不重复挂载底层Composer和审批。关闭保留运行中的线程，主窗口继续不重新resume同一线程。旧hotkey URL也先初始化真实App协议/状态所有者，不再挂载孤立无订阅组件。新建复用App真实处理器，焦点返回/Tab边界、中文输入法与修饰键Escape有回归。

QC01–QC04通过生产JSX回调与共享Composer/审批回调执行测试：结构化用户消息、实时文本更新、真实运行/错误/加载、接续/新建/关闭、IME/焦点、无第二传输和定时伪完成。主发送/草稿/输入法回归与tsc通过。完整verify-all含隔离真实协议、最终专项及Tauri Release/MSI/NSIS、diff-check均退出0，164项产品输入前后相同。见.ref/parity/17/actual/build-manifest.json。完整检查启动后补正修饰键Escape边界，由最终生产JSX回归及重建覆盖。

验收操作：主会话打开快捷面板，确认历史与模型/权限/附件；修改草稿后关闭再打开；发送观察真实流式和停止；在隔离工作区触发审批并响应；运行中回主窗口接续，确认thread/turn ID一致且无重复发送；中文选字Enter和带修饰键Escape不得误触发；Tab留在面板。上述原生实测尚未执行，自动回调回归不能代替。

缺口：原生独立窗口/置顶/全局唤起和多窗口生命周期、完整执行卡片/历史分页/排队管理、官方运行时对照、同条件像素。详情与队列管理目前需回主窗口；当前应用内面板不等于官方独立窗口。无同条件截图，visual not_executed、score:null。完整1:1及用户验收均未完成。无新增依赖。
