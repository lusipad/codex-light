# 13F 技能试用草稿作用域：开发前合同

日期：2026-11-06。状态：**只读取证完成，未开发、未自验、未用户验收**。接续13E，不新增一个猜测的侧边聊天页。

## 官方来源与已证边界

[原包清单、36个UTF-16锚点及13条纯逻辑记录](../../../.ref/parity/13/actual/13F-skill-trial-sidebar/reference-contract.json)直接来自当前26.1027.3384.0的5个指定条目，SHA与header integrity匹配；整包hash沿用同会话15I核验。没有官方运行时截图、真实账号请求或模型执行。

- 卡片传入`startInSidebar:true`，普通主窗口链`Zpo→$po`虽解构该参数，但函数正文未使用它；实际准备`/`首页导航和prefillPrompt/project/focusComposerNonce。true/false的依赖替身执行记录一致，不能据参数名映射本项目SideChatPanel。
- `prepareNavigation`先经过guard；已追分支检查设置脏配置。拒绝导航返回null时，常规分支不注入prompt。不能把该分支扩称所有官方guard都已实测。
- 首页`UOc`按位置key单次消费prefill，未传`prefillPromptOnlyIfEmpty`时执行`setPromptText(prefillPrompt)`替换目标文本。技能调用未传only-if-empty。
- nonce可形成独立Composer作用域；同key不重复消费，新nonce可消费。录音origin满足特定条件才复用nonce。**目标文本替换不等于删除所有旧home草稿**。
- 旧scope如何返回、重启持久化、专用窗口分支、精确焦点及当前账号实际行为仍待证。

## 当前差异与实施约束

13E已复用真实主Composer并只准备草稿；已有home文本通过追加保留。引用构造正确不代表草稿作用域一致。当前`promptDrafts`只有home/thread键，不能简单将追加改成覆盖便称复刻。

开发前追清Composer draft、附件、工作区和执行配置的作用域关系，复用现有草稿机制。新scope不能污染主会话、丢旧输入或附件；禁止接入现有SideChatPanel的定时模拟结果，禁止自动发送turn。未证返回/持久化路径先保留未知，不自行设计多草稿管理界面。

## 后续验收

| ID | 操作 | 需证明 |
|---|---|---|
| ST01 | 空首页→技能试用 | 目标scope收到完整prompt，焦点在Composer；无thread/start或turn/start副作用冒充准备 |
| ST02 | 有文字/附件的旧草稿→试用→返回旧scope | 新目标使用替换语义；旧scope与附件保留，官方返回入口先取证 |
| ST03 | 同技能重复、同key重渲染、新nonce | 同key只消费一次；新scope可再次预填，不重复追加 |
| ST04 | 脏配置阻止导航、取消确认 | 不注入、不清旧稿；确认后的续执行有同身份保护 |
| ST05 | 试用期间切项目/账号/连接、旧异步返回 | 不向新scope写旧prompt，不改变权限配置或触发模型 |
| ST06 | 退出、重启、原生键盘/中文IME | 与官方同条件对照，未取得官方持久化合同前不得宣称通过 |

本合同不表示这些用例已执行。配对像素、原生路径与用户验收继续独立记录。
