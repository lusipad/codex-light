# 01B A09：按会话隔离未发送草稿

日期：2026-10-31。修改前合同；01B开发中，不放行01C。

## 官方依据与边界

固定官方26.928.21956，asar SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`已重核。相关initial/shared哈希及有界片段保存于`.ref/parity/01/runs/20261031-codex-01b-drafts/`。定位数字均为0-based UTF-16字符偏移。

- initial `Wx` `1297409`：普通首页以`dl({entrypoint:home})`为草稿键，local以clientThreadId为键；focusComposerNonce属于scope身份，不属于持久化prompt键。
- `xyn` `2071571`：从持久化map读取，setDraft对指定键写入/删除；不是整个App共用一份prompt。
- `cur` `3084440`附近和`zL` `3088107`：prompt按`Wx(scope)`写回和恢复；空内容移除相应键，local可映射server别名。
- `FL` `3087176`：`composer-prompt-drafts-v2`及legacy-v1。内部存储格式无需相同，本项目使用独立命名空间，禁止写官方数据。
- `xU` `4148418`：普通新聊天跳首页并提供focusComposerNonce；只有freshDraft、已有queued/特殊draft条件才重建草稿身份。不能把所有新聊天推断为清空输入。
- `O1s` `95012xx`：newTask调用bU/xU，host new-chat也进入同一导航；Sidebar和快捷键引用同一命令。现有本项目按钮/Ctrl+N均接startNewThread，保留共用入口。

当前差异：App只有一份promptInput，startNewThread/selectThread没有按身份保存恢复，导致A输入带入B。旧A09表的“清空当前输入”未经证实，应撤回为草案。官方运行时、丢弃提示、切回已有会话的精确焦点及附件全部视图状态仍未实测。

## 实施范围与假设

本轮修复普通首页/local会话的文本草稿隔离和持久化，沿用现有附件保存、项目选择及发送协议；不新增协议字段/依赖/CSS，不改变未知focus或丢弃提示。普通新聊天恢复同一首页草稿；重复新聊天保留首页文本。创建真实会话后将当前首页草稿移交该ID，成功发送只清除仍等于已提交内容的输入，失败保留。草稿使用本应用localStorage，不改官方状态。

允许文件：App.tsx、针对实际回调的回归脚本/标准入口、已有测试fixture必要接线及本轮资料。当前默认本地单窗口，跨窗口冲突和账号scope尚未证明，继续登记。

## 修改前动作合同

| ID | 操作 | 预期与验证 |
|---|---|---|
| DR01 | 首页输入H→切A→输入A→切B→输入B→切A | 分别恢复A/B，首页H不串入会话；实际生产回调回归 |
| DR02 | A→普通新聊天→重复新聊天 | 恢复H并保留，按钮/Ctrl+N共用入口；原生输入不发送 |
| DR03 | 刷新/退出重开→回首页/A | 文本按各自键恢复；空文本删除对应记录，保留其他草稿 |
| DR04 | 附件/项目选择失败或晚到导航 | 不提前切草稿身份，不清旧输入，不覆盖较新导航 |
| DR05 | 首页真实thread/start后turn/start失败 | 草稿归新会话保留，下一次普通新聊天不重复携带已移交内容；受控协议边界回归 |
| DR06 | 正常发送成功、失败、发送中继续编辑、离开后晚到 | 成功只清未修改输入，失败及新输入保留，晚到不清别的会话 |
| DR07 | 原生当前构建输入→新聊天/重开、现有会话切换 | 独立CODEX_HOME、不请求模型，原生可达路径留证；官方焦点/像素不由此推断通过 |

先补失败回归再改产品。完整标准、release、输入身份和原生路径按适用范围验证；无官方配对图不造visual-verdict评分。若未完成全部合同，逐项明确状态。

## 实施结果

App的单一prompt状态改为按`home`/`thread:<id>`索引的文本map，沿用现有setPromptInput调用形态。每个setter捕获会话身份，旧异步回调只能修改其所属草稿；写入本应用独立localStorage键，空内容删除对应记录，损坏/非文本记录不套用。持久化失败显示错误并保留内存输入。

首次创建会话时移交首页文本；turn/start失败保留，成功仅清除仍等于已提交内容的输入，发送中继续编辑不丢失。附件延迟保存改为发送时的附件/文本快照，避免读取B附件后写入A，也不清除B的当前附件。原有预填新聊天入口显式写首页，避免新的身份setter改变其含义；没有开发其他页面的新功能。

新聊天聚焦由固定50ms计时器改为React提交后的focus request effect，重复新聊天也触发一次聚焦；未擅改切回已有会话时的焦点规则。没有新增依赖、CSS、Rust或协议字段。

## 验证与证据

证据根目录：`.ref/parity/01/runs/20261031-codex-01b-drafts/`。

| 合同/检查 | 结论与适用范围 | 证据 |
|---|---|---|
| 修改前 | 专项失败，缺少按身份保存的草稿状态 | `before.log` |
| DR01/DR02 | 实际状态/setter及真实new-chat回调通过；原生H→A→B→A→Ctrl+N/按钮序列恢复各自输入 | `focused-final.log`、`actual/native-observations.json` |
| DR03 | 实际持久化effect读写回归通过；第一版正常退出、确认进程结束、重开恢复H/A/B；最终版再恢复三份并验证新聊天 | `actual/native-restart-observations.json`、`actual/native-final-observations.json` |
| DR04 | 附件失败/选择失败/晚到导航由现有生产回调用例及新草稿接线验证；不冒称原生故障注入 | `focused-final.log`、`scripts/verify-sidebar-project-selection.mjs` |
| DR05/DR06 | 实际send/附件回调与生产草稿状态组合，覆盖创建移交、发送失败、成功、编辑、离开及附件串写；无真实模型调用 | `focused-final.log`、`scripts/verify-composer-drafts.mjs` |
| 反证 | 共享草稿键、无条件清除、读取当前附件三个内存变异均触发断言；未修改磁盘产品源码 | `actual/mutation-checks.json` |
| 最终完整标准 | 退出0，包含六个隔离真实协议探针、类型检查、构建、Rust check和automations过滤测试 | `verify-all-final.log`、`standard-final-result.json` |
| 最终release | 退出0；补修附件后重新构建，再按记录输入确认构建 | `build-final.log`、`build-confirm-final.log`、`build-identity.json` |
| 原生样本 | 真实CLI创建两条明确离线上下文样本并冷读；没有请求turn/start或模型生成，不把样本历史当真实对话生成 | `actual/native-fixture.json` |

本轮无Rust改动，没有额外全量Rust新结论；上轮41项不是本轮重新运行结果。标准脚本无独立lint，不编造通过。

最终产物：`dist-artifacts/01B-drafts-20261031/CodexNative.exe`，13,304,832字节，SHA-256 `8e08d640ee06fe4b265ad804c8afe26369e2fc83af47e6591f6f88daa8d8f788`。118个构建输入及专项脚本身份见manifest。最终版原生恢复H/A/B、Ctrl+N/按钮和直接输入聚焦重新验证，早期版本证据未冒充最终版全序列。

额外确认构建同样退出0、118输入重核一致，但EXE SHA为`edc86041ffd5d2cb66fdf5277b1c6043003a287389c2859f772435c297c945e9`，与已原生测试产物不同；首次要求二进制相同的核验失败已保留于终端，不宣称构建确定性或推测差异根因。交付目录仍保留上段已实测文件，确认构建没有覆盖它，也没有沿用原生结论；两次身份分别登记在build-identity中。

原生工具即时读取可能滞后React提交，保留另一次稳定观察；focused_element只报RootWebArea，焦点用不再点击即可输入佐证。重开测试一次click报告geometry unavailable，刷新窗口/截图后重试成功。关闭时曾点到编辑菜单，重新观察后使用真实关闭按钮，进程退出有命令核验。工具截图仅现场观察，未保存payload。

## 尚未完成

- 官方运行时精确焦点、特殊freshDraft/queued分支、丢弃提示、附件/富文本/其他完整视图草稿尚未对照。本轮只交付已取证的普通文本身份修复。
- 账号作用域、账号切换、跨窗口同时编辑/同步、storage满额的原生错误场景仍未验证；当前本地存储不是官方格式等同证明。
- 系统/应用缩放、官方宽窄窗配对图仍未知；无新CSS，visual-verdict不具备输入，score=null。没有像素1:1结论。
- 首次模型发送和附件协议竞态仅受控生产回调证据；原生仅隔离输入/切换/退出重开，不登录、退出账号或提交模型任务。

01B整体仍开发中，增量待用户验收，不放行01C，不提交推送。下一项A11/A12的当前会话行交互、长名称和滚动边界先取证；A08模式capability及本节未测项继续保留。
