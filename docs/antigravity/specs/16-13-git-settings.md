# 16.13 Git设置：调研与偏好消费合同

2026-11-02。固定原包git-settings-a9883d7b9cb4.js导出GitSettings，包含Branch prefix、Always force push（force-with-lease）、Create draft pull requests、PR merge/squash、Commit instructions、Pull request instructions及Disable Git-based diffs（仅Last Turn）。证据见.ref/parity/16.13/reference/initial-contract.json。这些字段通过共享F与o持久化，不可直接等同config.toml字段。

当前SettingsView自创默认主分支/忽略空白/Conventional/GPG开关主要存desktopPreferences，需核实际消费者。下一步追F共享atom存储键和git上下文消费者，复用现有git.rs真实提交/工作区行为；不会凭原包存在force-push开关自行发起真实推送。以上为初始只读调查，产品开发范围见下方16.13A。

开发前应锁定分支前缀作用域与创建消费者、Changes可见模式、提交/PR指令如何进入真实生成请求；无消费者不能以本地保存冒充生效。验收含重启读回、创建分支参数、last-turn-only隐藏并禁止额外Git读取、错误/重试/旧响应。官方截图与原生仍需单独采证。

共享ON（q$t）字段调用EN，已追函数定义确认hostStorage.kind=global-state（相邻DN才是persisted-atom），键git-branch-prefix/codex/、git-always-force-push/false、git-create-pull-request-as-draft/true、git-pull-request-merge-method/merge、git-review-mode/full|last-turn-only，并声明agentAccess:read-write。这些是主机偏好，不能写入无关CLI配置字段。证据storage-contract.json，下一步追ACn与原生存储桥、分支/审查/指令消费者。

进一步追ACn→NCn：优先i6.settings.write，回退IW(set-setting,{params:{key,value}})；读MCn对应get-setting或settings.read.effective，写后invalidate查询。EN字段是global-state，不能被相邻DN的persisted-atom定义误导。分支前缀的agentAccess:read-write与提交指令read-only是agent访问标注，不等于UI只读。

## 16.13A 修改前合同

本轮接入已有真实消费者：git-review-mode（full/last-turn-only）、git-always-force-push（false，实际force-with-lease）、git-create-pull-request-as-draft（true）。App共享偏好状态，独立键保存并读回核对后更新消费者，无新增依赖。撤下自创GPG/Conventional/默认主分支等未消费表单，保留旧数据。分支前缀/提交与PR指令/合并方式继续保留缺口，不能声称整个Git设置完成。

GT01保存/读回失败与重试/单飞/卸载；GT02仅本轮模式隐藏并阻止工作区/暂存/分支/历史Diff请求，既有晚响应不能覆盖本轮结果；本轮文本来自会话记录而不是Git状态文件清单。GT03推送/提交并推送与顶栏推送均消费force-with-lease，PR创建默认draft=true但用户可在创建前更改；设置变化不会自行执行推送/创建PR。GT04既有Git生命周期/审查/文件编辑回归。仍需原生/像素与用户验收。
