# 16.03 快捷键设置：开发前证据与范围

日期：2026-11-01。修改前先建立三资源合同，随后补齐默认表、中文、后端和序列证据并开发16.03A；功能自动自验进行中，整个分区未验收。

固定原包：`C:/Users/lus/Codex/_internal/app/resources/app.asar`。从原始归档直接读取三项资源，逐项 SHA-256 与归档 integrity 相等，见[参考清单](../../../.ref/parity/16.03/runs/20261101-codex-shortcuts-research/reference/trace.json)。以下数字均为原始条目的 0-based UTF-16 偏移。静态分支存在不证明账号已启用。

## 已确认的静态合同

| 编号 | 来源 | 官方预期 | 验收方法 |
|---|---|---|---|
| KS01 | keyboard-shortcuts-settings-8b35561e41b2.js `pn`，20744 | 从真实命令能力、平台、feature gate 与 keymap 生成列表；不是固定数目的通用命令列表 | 等价能力场景下逐条比较 ID、顺序、标题、当前绑定；未实现能力不得伪造可用 |
| KS02 | 同上 `pn` | 文本搜索 trim 后匹配命令 ID、标题和说明；没有匹配时显示空态 | 中文标题、命令 ID、说明、空白和无结果回归；核官方中文语言包后采用文案 |
| KS03 | 同上 `pn`、`Cn` 34430；keyboard-shortcuts-search-input-7d67952b4ded.js `c` 201 | 按键搜索切换会清空查询；录入忽略 repeat，阻止事件传播；无修饰 Escape 清空并退出；组合序列按完整或空格前缀匹配 | 同一录入序列比较查询、列表和退出状态；IME 与全局快捷键作用域另实测 |
| KS04 | keyboard-shortcuts-settings-8b35561e41b2.js `Bt` 1735 | 单项更新调用 set-codex-command-keybinding，更新失败在行内可见，更新结果刷新真实 keymap | 改绑→实际按键执行→离开返回→重启，核单项与快捷键帮助一致；失败不得显示保存成功 |
| KS05 | 同上 `pn` | Codex 分支恢复全部默认先确认；调用 reset-codex-command-keybindings；忙时防重入；失败保留错误 | 取消不改数据；确认后读回并实测默认键；失败可见且不关闭为成功 |
| KS06 | keyboard-shortcut-command-order-6f9ce4190ce7.js | 平台、可用能力与功能开关约束命令，不能把包内全部命令无条件展示 | 核对 Windows 条件与当前实际功能；禁用和不存在分别登记 |

## 当前实现差距

`SettingsView.tsx` 当前仅渲染 `SHORTCUTS` 静态卡片，没有搜索、按键录入、单项修改、冲突反馈或确认恢复。说明直接暴露源码路径，且“与实际注册一一对应”尚未覆盖最近聊天等独立处理器。

后续先追踪 keymap schema、默认命令表、主进程持久化和冲突处理，核对中文语言包；再定义可实现的 Windows 命令集合和动作回归后开发。不能只增加输入框就声称完整快捷键页通过。现有全局快捷键、终端/编辑器作用域、IME、帮助窗口、原生菜单须回归。

## 尚待取证与验收

绑定结构、修饰键规范化、连续组合、保留键、冲突覆盖/拒绝、空绑定与 reset 的区别、重启存储、全局系统热键注册、原生菜单 accelerator 同步均未在本次三资源记录中完整证实。界面布局、焦点恢复、真实官方运行时、宽窄窗口和像素对照均未验证。该合同不得作为开始完整改绑功能的全部依据。

## 开发前追加证据与本批合同

[backend-trace](../../../.ref/parity/16.03/runs/20261101-codex-shortcuts-research/reference/backend-trace.json)核三项原始资源，[defaults-trace](../../../.ref/parity/16.03/runs/20261101-codex-shortcuts-research/reference/defaults-trace.json)核五项原始资源，均与原包integrity匹配。上节“三资源未证实”是最初缺口；下列已经追加静态证据，运行时仍待实测。

- 独立 `${CODEX_HOME}/keybindings.json`，根数组`{command:string,key:string|null}`。缺省命令使用平台默认；命令有自定义记录则覆盖全部默认，任一null表示无绑定。clear写null，reset删该命令记录；全量reset写`[]`，不删除文件。
- set替换第一键并保留其余，replace按原键替换，append追加去重，remove删除指定键且删空写null。UI先提示冲突，后端还有移除占用绑定/抑制默认与部分恢复规则；不能概括成所有冲突后端一律拒绝。
- 本地命令菜单两入口合并为官方`openCommandMenu`；Ctrl+J是`toggleBottomPanel`，终端`toggleTerminal`仅Control+反引号。侧栏默认顺序为Ctrl+Shift+S、Ctrl+B；forkThread无默认。本地旧审查Ctrl+Alt+C、派生Ctrl+Alt+F无本次官方依据，取消这些假默认。
- recentThread1–6独立可改绑，第4/5槽另有Ctrl+Shift+9/8。默认键脱离产品定义保存为`scripts/fixtures/keyboard-defaults.json`，防止测试从我们的实现反推预期。
- 录入忽略repeat/IME，Escape/失焦取消；允许序列时首个裸键等1000ms，第二键组成两段；含`+`首键立即提交。执行中间键不派发动作，1000ms后失效、错键重新作为首键；输入/终端作用域不能直接复用所有全局动作。
- 本批复用已有实际动作及真实文件读写；菜单改绑在持久化前同步，写失败恢复，部分成功不回滚成假失败。录键前暂停托管菜单accelerator、结束/离开恢复；异步启动期间离开也必须释放。

| 回归组 | 预期 |
|---|---|
| KB01–KB04 | 独立默认fixture、更新语义、null/reset/未知记录保留、冲突、原生映射、组合序列及输入/终端作用域 |
| KB05–KB07 | 初始读取禁止写、真实写读回、失败恢复原生菜单、部分成功、延迟录入启动后离开释放 |
| KB08–KB10 | 生产组件搜索/按键搜索、IME、冲突不写、两段录入、取消与确认全量恢复 |

完整命令目录、系统全局热键、特殊共享命令对/别名迁移/外部文件监听、运行时kind对应的序列许可及官方原生/像素仍须继续核验；本批覆盖不表示这些已经完整实现。
