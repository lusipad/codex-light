# 16.01 通用设置：取证与下一批范围

日期：2026-11-01。首批 Enter 行为开发中，当前分区未验收。

固定原包SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。
[trace.json](../../../.ref/parity/16.01/runs/20261101-codex-general-settings/reference/trace.json)记录四项原包integrity及18个原始UTF-16片段。

## 首批可执行范围

1. `general-settings-cbce7da152c5.js:148129`：composerEnterBehavior即时应用偏好，值enter（默认）、cmdIfMultiline、cmdAlways。Windows使用Ctrl修饰键。必须由真实Composer消费，不能只存下拉值。
2. 同文件`149206`：preventSleepWhileRunning默认false，Windows不展示。当前preventSleep默认true且只保存、无执行消费者；先按官方平台条件隐藏，不能虚构Windows防休眠已生效。

修改前合同：

| 用例 | 预期 |
|---|---|
| GS01 | 未保存偏好默认enter；合法三值加载，非法值回退默认；不得将应用偏好写入config.toml |
| GS02 | enter模式Enter发送、Shift+Enter换行；cmdAlways普通Enter换行、Ctrl+Enter发送；cmdIfMultiline单行Enter发送、多行Enter换行、Ctrl+Enter发送 |
| GS03 | IME组合及候选选择不发送；补全菜单优先处理确认，不能同时发送；既有禁用/运行状态约束保持 |
| GS04 | 设置即时写入、失败可见且回滚；保存成功读回，重新挂载仍生效；旧加载不能覆盖新修改 |
| GS05 | Windows不展示防休眠行；其他平台未实现真实执行时不可标通过 |

已追踪[实际键盘合同和中文原文](../../../.ref/parity/16.01/runs/20261101-codex-general-settings/reference/composer-keyboard-trace.json)：initial 2920332 的多行判定为段落数或 hard_break，textarea 对应用实际换行，不包含视觉折行。Shift/Alt+Enter 不发送；IME guard 先于补全和发送；补全确认不能同时提交。运行中 enter 模式 Ctrl+Enter 触发相反 follow-up 动作，其他两种模式为 Ctrl+Shift+Enter；空闲时 Ctrl+Shift+Enter 不发送。官方 code block 的 Ctrl+Enter 跳出块行为依赖富文本结构，当前 textarea 未覆盖。

三项中文为“按 Enter 键”“Ctrl + Enter 用于多行提示”“总是使用 Ctrl + Enter”，行标题“发送快捷键”，描述“选择按 Enter 时是发送提示还是插入新行”。应用偏好独立存储，不写 config.toml。

## 后续同分区缺口

- 默认外部编辑器：官方`117860`按真实available targets选择；当前固定选项只保存，open_path_external并未消费。需实际安装检测、可用性和真实打开链。
- Windows终端：官方`119876`的integratedTerminalShell支持powershell/commandPrompt/gitBash/wsl，后两者按可用性；仅影响新tab，不重启已有PTY。
- 语言、WSL agent environment、popout、其他条件项独立取证和实现。原包含codex-offline gate patch，不将其强制分支当账号可用性证明。

当前设置页的连接调试、全局保存及恢复出厂布局并未证明对应官方通用页；完整官方控件、原生和像素仍待验。
