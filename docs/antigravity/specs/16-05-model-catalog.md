# 16.05 模型目录与旧提供商页纠偏

日期：2026-11-01。修改前范围：移除无对应官方注册入口的providers-models导航／编辑界面，将旧入口归到agent；模型目录读取与消费者留在真实Composer，agent完整偏好读写由16.06继续。

## 原始证据与假设

固定原包哈希沿用17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb。[trace.json](../../../.ref/parity/16.05/runs/20261101-codex-providers-research/reference/trace.json)记录原始资源哈希、archive integrity、0-based UTF-16片段。

- use-visible-settings-sections注册agent等条目，没有providers-models；settings-page/app-shared/app-initial也没有该slug。这是固定包静态注册证据，不是所有远程gate的运行时证明。旧26分区清单不能作为官方页面存在证据。
- panel-cef8ad89ba10.js使用slug:agent，其Work偏好分支模型改变提交model并清空reasoningEffort；实际为/wham/work/settings远程保存，受work.cloud-orchestration.preferences能力与账号gate控制，不能拿它证明Codex本地config.toml设置等价。选项来自真实catalog，不是Provider表单和示例模型生成器。
- app-initial的model/list请求includeHidden:true、limit:100；协议schema定义cursor和nextCursor。隐藏项默认不显示，codex-auto-review不是普通可选模型；远程额外可见性gate未还原，不伪造激活。
- 模型displayName是呈现名称，id与model可以不同；发送模型标识必须对应后端model，不能对显示名擅自字符串改写。
- 固定参考中存在codex-offline补丁标记（如K6r人为添加ultra），说明它是当前安装参考而非已证明未经修改的官方发行包。此类分支不得作为硬编码能力依据；运行时model/list能力优先。

## 用例与预期

| ID | 操作/预期 | 证据/拟实现 |
|---|---|---|
| MC01 | 多页模型目录按cursor读取，includeHidden:true；空目录清空旧结果，异常保留旧目录并可重试 | 真实协议形状与生产loader |
| MC02 | 快速刷新旧响应后到，不覆盖新响应；离开后晚响应不更新 | App加载版本/生命周期回放 |
| MC03 | 隐藏项和审核专用模型不成为普通选择或默认兜底；名称原样呈现 | q6r与生产modelCapabilities/JSX |
| MC04 | id与model不同时，UI可稳定选中，thread/turn等请求发送真实model slug | 实际App参数回调 |
| MC05 | 新provider配置保存后重新读取模型；目录不存在的选中项退回有效默认，空目录清除能力 | App设置回调与选择回归 |
| MC06 | providers-models不再出现在导航和模拟编辑UI；旧路由兼容到agent | 注册证据与SettingsView回调 |

不新增依赖，不触碰用户真实提供商配置，不删除backend的真实配置读写能力。原生窗口、远程gate、账号差异、实际发起模型推理、官方/本批配对截图待验；纯协议探针隔离CODEX_HOME、不认证、不生成模型轮次。
