# 06A Git 异步身份与提交合同

日期：2026-11-01，修改前建立。固定原包提取资源及 integrity 见 `.ref/parity/06/runs/20261101-codex-git-lifecycle/reference/manifest.json`。

`local-conversation-git-actions` 以 cwd/hostConfig 区分操作范围，使用 mutation isPending 阻止重复操作和在途关闭；git-action-review-state 区分当前/会话分支。最初检索 commit chunk 实为图标，不作为提交逻辑依据。官方准确提交界面、生成说明和错误恢复仍待运行时对照。

| ID | 场景 | 预期 |
|---|---|---|
| GL01 | 切文件、diff模式、仓库后旧结果返回 | 旧 success/error/finally 不写新视图 |
| GL02 | 提交/提交并推送/推送快速重复 | 共享同步在途锁，只派发一次写链 |
| GL03 | 提交期间编辑新说明 | 成功仅清提交时的原文；新输入保留 |
| GL04 | stage 后仓库切换 | 不继续向已离开的仓库提交或推送；旧结果不清新输入 |
| GL05 | 提交成功但推送失败 | 不重做提交；错误反馈可见，允许独立推送重试 |
| GL06 | 提交快捷键遇到中文组合输入 | 不提交；普通 Ctrl/Cmd+Enter 仍有效 |

这些为当前已知 Git 流程的数据不变量及静态 busy 合同，不代表完整官方提交策略。真实隔离 Git、原生与像素另验。
