# 17B Quick Chat 原生线程窗口

2026-11-03，修改前合同。原包main-DkWgQSQe.js已直接提取核integrity。ensureThreadWindow默认threadSize 470×640、最小400×400；hotkeyWindowThread使用无框/可调尺寸/skipTaskbar、禁止最小化/最大化/全屏；applyHotkeyWindowWindowPolicy仅moveTop而非alwaysOnTop。hideAll隐藏窗口，保留会话和渲染器。详见17/reference原包与锚点。

| ID | 修改前预期 |
|---|---|
| QN01 | 独立开发入口唤起Tauri singleton quick-chat窗口（不得占用newProjectlessTask）；重复唤起切换显示/隐藏，并发创建不得重复；首次独立新会话不清主窗口草稿或线程 |
| QN02 | 线程窗口默认470×640/min400×400，关闭/Escape隐藏而非销毁；保留草稿、真实订阅及运行轮次；无定时假完成 |
| QN03 | utility复用真实App状态/协议、Composer/审批，启动只渲染Quick Chat，不显示主外壳；草稿存储隔离主窗口，主窗口独占托盘/应用菜单/系统通知及收件箱写入，防止双响应/覆盖 |
| QN04 | 主窗口接续携真实threadId，经事件选择该线程；相同ID不重复resume；显示/聚焦主窗口后隐藏小窗，失败可见；无threadId仅聚焦主窗口 |
| QN05 | 独立窗口拖拽/缩放/关闭/重开/继续需原生验证；先自动回归与隔离构建，再尝试隔离CODEX_HOME/profile原生CDP烟测，不影响已有应用/用户配置 |

本轮先实现原生线程窗口，官方home/thread双窗口转场、鼠标穿透/贴边、多显示器位置持久化、系统级全局热键和完整像素仍缺。未发送的草稿/附件保留在小窗，不自动覆盖主窗口已有草稿；跨窗口未发草稿合并合同另待实测。官方Windows运行时和同条件像素未测项不标通过。

原生烟测：初次环境变量CDP未开放；显式代码flags测试配置构建成功，但启动被自动审批审查拒绝（blocked by policy）。不再执行该被拒操作，原生检查仍未通过。测试构建不交付。

## 2026-11-03 复核纠偏合同（修改前）

原QN01将newProjectlessTask错配hotkeyWindow，撤回该映射。官方initial chunk UTF-16偏移3533455/3533860/3528057分别注册无项目任务、quickChat与os-global hotkeyWindow；3670375/3670678分发不同动作，9502727的O1s以activeProject:null创建。协议ThreadStartParams允许projectId:null。

- QN06：Ctrl+Alt+O和/chat新建主窗口无项目草稿；首条发送及goal创建显式projectId:null，不继承当前项目/目录，不创建worktree。正常新建仍保留选中项目行为。
- QN07：原生hotkey窗口保留独立“快捷聊天窗口（开发入口）”菜单，无虚构默认全局热键；此入口不是官方菜单外观通过证据。
- QN08：收到桥接server-request-resolved按id类型及generation精确清理审批和响应，阻止旧刷新回填；不同generation请求保留。
- QN09：main和quick-chat的workspace watchId分区，一侧注销不得影响另一侧。
- QN10：utility只消费实际可见的新聊天、模型选择、缩放快捷键；隐藏路由/面板快捷键及其chord前缀不被拦截。不可见slash操作明确不可用。

本次修复前的17B/18A构建包含上述已知缺陷；原自动回归未覆盖这些合同，不作为已修复证据。原生与像素仍未验证。
