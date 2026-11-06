# 13F 技能试用草稿作用域：开发前合同

日期：2026-11-06。状态：**本轮实施与隔离自验完成，未用户验收**。执行结果见[13F验收记录](../acceptance/13F-skill-trial-drafts.md)。接续13E，不新增一个猜测的侧边聊天页。

## 官方来源与已证边界

[原包清单、36个UTF-16锚点及13条纯逻辑记录](../../../.ref/parity/13/actual/13F-skill-trial-sidebar/reference-contract.json)直接来自当前26.1027.3384.0的5个指定条目，SHA与header integrity匹配；整包hash沿用同会话15I核验。没有官方运行时截图、真实账号请求或模型执行。

- 卡片传入`startInSidebar:true`，普通主窗口链`Zpo→$po`虽解构该参数，但函数正文未使用它；实际准备`/`首页导航和prefillPrompt/project/focusComposerNonce。true/false的依赖替身执行记录一致，不能据参数名映射本项目SideChatPanel。
- `prepareNavigation`先经过guard；已追分支检查设置脏配置。拒绝导航返回null时，常规分支不注入prompt。不能把该分支扩称所有官方guard都已实测。
- 首页`UOc`按位置key单次消费prefill，未传`prefillPromptOnlyIfEmpty`时执行`setPromptText(prefillPrompt)`替换目标文本。技能调用未传only-if-empty。
- nonce可形成独立Composer实例；同key不重复消费，新nonce可消费。录音origin满足特定条件才复用nonce。补证中的`_S`表明普通默认home持久key固定为`new-conversation`，不含cwd、host、project、clientId或nonce；prompt和retained document均按base写入。撤回“nonce自动保留多份home草稿”的推断。
- 锁定Work项目的homeDraftKey、GPT与draft-location是独立例外，不能泛化为每个本地cwd一槽。旧内存editor/撤销栈经Back如何恢复、专用窗口分支、精确焦点及当前账号实际行为仍待证。补充3条来源、31锚点和6组base选择执行记录在同一合同`supplementScopeLifecycle`。

## 当前差异与实施约束

13E已复用真实主Composer并只准备草稿；已有home文本通过追加保留，与已证普通home目标替换不同。当前保留home/thread持久键；不新增多nonce草稿架构。替换还须满足导航实际成功、原账号/项目/工作区/连接及请求仍有效，避免guard确认后重新捕获新身份重放旧技能。

实施顺序：先执行当前生产回调的替换/连续试用红回归；再固定请求身份和单次continuation，复用既有新聊天提交段并明确返回成功导航token；最后验证目标替换、焦点、持久读回、普通新聊天/项目选择及首次发送迁移。目标home原文本按官方预填替换；其他thread稿不能改变。等待期间用户新编辑、导航失败或身份变动必须保留新输入。附件、权限、录音各有独立合同，不从prompt共享键推断应清空或复制，也不顺手变更它们。禁止接入定时模拟结果或自动发送turn。

## 后续验收

| ID | 操作 | 需证明 |
|---|---|---|
| ST01 | 空首页→技能试用 | 目标scope收到完整prompt，焦点在Composer；无thread/start或turn/start副作用冒充准备 |
| ST02 | 有文字的默认home→试用，其他thread另有草稿 | home替换为完整技能prompt，其他thread不变；不承诺普通home自动保留多份旧稿。附件行为独立取证 |
| ST03 | 同技能重复、同key重渲染、新nonce | 同key只消费一次；新scope可再次预填，不重复追加 |
| ST04 | 脏配置阻止导航、取消确认 | 不注入、不清旧稿；确认后的续执行有同身份保护 |
| ST05 | 试用期间切项目/账号/连接、旧异步返回 | 不向新scope写旧prompt，不改变权限配置或触发模型 |
| ST06 | 退出、重启、原生键盘/中文IME | 与官方同条件对照，未取得官方持久化合同前不得宣称通过 |
| ST07 | A慢B快、等待期间编辑home、重复continuation | 晚到A不覆盖B/新编辑；同请求最多提交一次，新点击可再次替换；导航失败即使原本home也不得注入 |

本表是开发前预期，不代表每项均已完整执行；实际回调、隔离原生与重启读回范围见验收记录。官方同key重渲染/nonce实例与Back恢复、配对像素、物理IME及用户验收仍待验证。
