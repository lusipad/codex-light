# 16.03B：真实命令目录、执行作用域与键位文件闭环

2026-11-03。**只读调研合同，未开发、未构建、未放行整个快捷键页验收。**承接 [16.03 原合同](16-03-keyboard-shortcuts.md) 和 [16.03A 待验表](../acceptance/16-03A.md)。本次不改产品、测试、已有文档或用户配置，不启动官方 GUI，不执行 Cargo。

## 下一主要动作

下一阶段应把“本机实际支持的命令目录 → 录入/改绑 → 对应真实动作及作用域 → 原生菜单/另一窗口/重启读回”做成主要闭环。现有 A 阶段已具备搜索、录键、改绑和文件读回骨架；继续给固定列表加一个开关不能填补目录与执行差距。

先完成命令能力映射表，按当前真实实现接入导航/工作区、会话、Composer 与审批、Git/文件面板这几组。每条都必须有真实 handler、启用条件与焦点作用域；缺少功能实现的命令不能只展示一行“可配置”或绑定空处理器。系统全局、语音、浏览器/Artifact/Pages 的服务依赖另列，不能通过把它们全隐藏便宣称全部目录完成。

## 固定独立来源

- Store 包 `OpenAI.Codex_26.1021.3705.0_x64__2p2nqsd0c76g0`，原包 `C:/Program Files/WindowsApps/OpenAI.Codex_26.1021.3705.0_x64__2p2nqsd0c76g0/app/resources/app.asar`。
- 本次重新读取原包 SHA-256：`04862a659c6a90fc50514d8c0b8016709d97dece58839726c57495ed72f1d9f0`，640129388 bytes。13 个只读 entry 分别与原包 entry integrity 哈希匹配。
- [manifest](../../../.ref/parity/16.03/actual/16-03B-research/manifest.json)、[48个定位锚点](../../../.ref/parity/16.03/actual/16-03B-research/anchors.json)、[原始文件](../../../.ref/parity/16.03/actual/16-03B-research/raw/)、[产品输入快照](../../../.ref/parity/16.03/actual/16-03B-research/product-snapshot.json)。数字均为 **0-based UTF-16 字符偏移**。
- 旧 16.03A 基于 `C:/Users/lus/Codex/_internal/...` 候选的证据继续作为历史记录；该候选含已知 offline 补丁。本次 Store 的文件/偏移不可与旧来源混用。签名/BlockMap 另见 `docs/research/reference-store-20261103.md`。
- 环境中的实际账号能力、官方窗口主题/语言/DPI/缩放与原生焦点仍未知。本次静态读包不证明任何账号已启用 gate，也不证明像素一致。

## 存储：键位仍是独立文件，不是把外观方案套过来

| 来源 | 已证实合同 |
| --- | --- |
| `.vite/build/src-Dl21kCYQ.js` @561657、562064 | 路径仍是 `${CODEX_HOME}/keybindings.json`。根数组 schema 为 `{command:string,key:string|null,version?:1}`；不是 `desktop.keybindings` 配置，也没有本证据支持的 app-server 键位协议 |
| 同文件 @562494、565843 | 读取经过 parse、别名/迁移、过滤可配置已知命令等步骤；损坏内容记录警告并回空默认状态。包内过滤不证明产品应破坏未来版本未知记录，本项目保留未知原始记录是前向兼容策略，须单列与官方过滤边界 |
| 同文件 @563001、564391、564505、568791 | 单项更新/reset经共享队列串行；reset-all 写 `[]`；写入按 command 排序，nextTab/previousTab 记录额外 `version:1`。clear写null、reset删命令记录仍成立 |
| 同文件 @565973、566696、567430 | closeTabOrWindow 等别名迁移；globalDictationToggle/startDictation迁移；旧 nextRecentThread 等特定绑定迁到命令菜单；旧tab导航组合有version门槛迁移与冲突裁剪。不能只保留command/key后重新保存就认为无语义损失 |
| `.vite/build/src-CTNXdakG.js` @153115 | `primary-number-shortcut-target` 默认 **tabs**，值为sidebar/tabs；hostStorage为旧persisted-atom来源分类 |
| 同文件 @154507、152272 | `external-browser-link-shortcut` 默认primary，可为unassigned/primary/alt/primary-shift；属于modifier-click偏好，不是普通命令键位记录 |
| `.vite/build/startup-requirements-CuyNnLmn.js` @98831、100701 | 上述已登记偏好经统一settings store迁移、写`desktop.${key}`；hostStorage分类不是当前持久化位置。与keybindings.json两条链必须区分 |

实现要求：继续使用真实独立键位文件；补 version/迁移前保留脱敏固定样本和官方预期。修改单项不得静默覆盖其他窗口/外部程序刚改的键位；当前文件整表写入存在这项边界，需读版本/内容校验或在宿主按动作重新读后串行变更。并发只在前端按钮上置busy不足以保证跨窗口正确。

本次没有找到明确的官方 keybindings 文件 watcher/外部编辑主动通知链，不宣称官方支持任意外部编辑自动同步。必须区分“重开读取”和“另一窗口主动变更后实时同步”；运行时具体时序待测。

## 官方目录与当前实现的差距

[command-catalog.json](../../../.ref/parity/16.03/actual/16-03B-research/command-catalog.json) 用 TypeScript AST 只读解析静态对象，不执行官方代码；可复现提取脚本为同目录 `catalog.cjs`。目录共184个定义：**155 webview、21 electron-only、8 vscode-only**。Desktop相关176个定义不是176个当前可用控件，更不是本项目完成率。Canvas工具ID引用已通过同文件静态属性解析；focusTab1–9通过原始明确数字数组的map展开，保存来源偏移与展开序号，未执行官方代码或用推测字符串替代。

[src-Dl21kCYQ.js @507986、514122、554881] 包含真实kind、title/description消息ID、requiredAccess、availableIn、electron默认键及scope。完整中文用 [command-zh-labels.json](../../../.ref/parity/16.03/actual/16-03B-research/command-zh-labels.json) 的353项原始语言包键值定位，不凭英文自行翻译。

本地 `SHORTCUT_COMMAND_IDS` 目前有26个映射，官方desktop定义中150个未出现在该映射。此为**注册表差异**：不自动证明这些命令没有其他本地处理器，也不能把所有141项无条件列为当前账号缺陷；逐条能力/作用域映射仍须开发前确认。差异清单见 [local-command-gap.json](../../../.ref/parity/16.03/actual/16-03B-research/local-command-gap.json)。

| 主要组 | 官方目录样本 | 当前核对与下一步 |
| --- | --- | --- |
| 聊天与编号导航 | thread1–9、focusTab1–9语义、next/previousThread、next/previousTab、recentThread1–6、openThreadInNewWindow、markThreadUnread、deleteChat、copyConversationMarkdown | 当前只有recentThread六槽被SHORTCUTS注册，不等同于sidebar编号或tab编号。最近聊天槽数量6是官方定义，不能擅自扩为9；真正的thread1–9属于另一组。已有会话菜单动作应接回同一真实handler |
| Composer与审批 | submit、steer、queue、clear、addPhotos/addFiles、toggleFastMode、reasoningEffort、togglePlanMode、approval.approve/decline | 当前映射仅composer.openModelPicker。组件内可能已有独立Enter等处理，必须先查消费者，避免全局注册产生双发或跨会话审批 |
| 工作区/Git/文件 | git.commit/createPullRequest/createDraftPullRequest/createBranch、file.goToDefinition/findReferences/navigateBack/navigateForward、environmentAction1–9、toggleFileTreePanel、showWorkspaceTabView | 当前并非全部纳入可配置键位。已有Git真实操作不能只绑一个toast；能力缺失不展示假成功。file语言特性需gate支持，环境动作槽读取真实配置 |
| 宿主与系统全局 | closeTab、closeWindow、openCommandMenu、hotkeyWindow、globalDictationHold/SingleTap、realtimeVoice、spotlightSearch | 当前nativeAccelerators只管理10个菜单项，quick_chat.rs是窗口生命周期，未在该模块找到OS-global注册。普通webview快捷键不能冒充后台仍有效的全局热键 |
| 浏览器/Artifact/Pages/语音 | browser.toggleAnnotationMode、navigateBrowser*、artifact.sendAnnotations、page.format*、canvas工具、realtimeVoice.* | 包内存在不证明本地服务/账号可用；逐项登记实现/外部依赖，不虚构本地代用动作 |

`keyboard-shortcut-command-order-3aee56991df5.js` @137/993/1739/2071 明确按commandAccess、Windows/macOS、浏览器、自动化、语言特性、dictation/global-window、voice、sidebar、模式等能力过滤和排序。截图选择与copyConversationPath有macOS条件；toggleNotch/notchVoice不应当作Windows通用控件。`vscode-only`不应出现在桌面设置目录。

## 执行作用域与原生链不能省略

- `src-Dl21kCYQ.js` @556541、556629、557148：配置资格、browser annotation单键约束、composer.submit禁止序列、平台scope分别判断。
- `command-row-cc145d321cf5.js` @10065：只有 **kind=webview、非OS-global、非composer.submit、非browser.toggleAnnotationMode** 才允许组合序列；OS-global和dictation不能append。当前所有可配置行共用录入器，尚未按此资格限制。不能因为新聊天支持G H就推断命令面板/宿主命令也支持。
- 同row @2624：默认Ctrl+B在Composer中有特殊语义：未选中且光标在开头才折叠sidebar，否则让给富文本bold。当前App的宽泛global键监听不足以证明这项上下文一致。
- `src-Dl21kCYQ.js` @555470、557354、564837、565330：closeTab/closeWindow、goToLine/focusBrowserAddressBar、file.goToDefinition/navigateForward有允许共享组；Enter的submit/approve特例；占用默认抑制与释放恢复规则。现有固定reserved字典和通用冲突判断不是完整等价规则。
- `main-BPBEjAxi.js` @2227189、2230103：commandKeybindings宿主service负责get/update/reset；写后同步hotkey窗口、dictation、voice、avatar、spotlight、app shell、原生菜单与浏览器owner的accelerators。不只写JSON。
- 同main @2188513、2188744、2191053、2191912：系统热键有注册/取消、全局录入暂停、ownership、generation和平台单修饰键限制。Windows系统保留Alt/Windows裸键与普通Ctrl+组合不能混淆。
- 同main @4959978、4579803：窗口原生命令缓存更新，number-target变化触发菜单及browser-owner更新和keymap查询失效。实际窗口焦点/双重派发仍需真实原生验证；不能从静态call存在声称Windows成功。

## 与16.03A逐项承接

| 16.03A动作 | Store复核结论与B阶段要求 |
| --- | --- |
| 文本/按键搜索 | 保留现有。Store搜索覆盖title、ID、description；当前本地title+ID搜索缺description。必须从真实中文目录补，不自造说明 |
| 第一键替换、追加/删空/reset | 原语义继续成立；但append/序列资格取决于kind/scope/命令，不能统一放行 |
| 冲突不写 | UI预检保留；扩展官方共享组/前缀/隐式PlusShift/系统保留规则，后端仍需文件当前状态重查 |
| G H序列与输入/终端保护 | 保留已有回归，新增不可序列宿主命令、Composer bold、审批焦点和编辑器语言导航。1000ms已有来源不等于所有命令通用 |
| 录入离页释放 | 继续回归原生accelerator暂停/恢复；系统热键未来实现也要一起释放，不能只解除React监听 |
| reset-all确认写[] | 继续成立；额外external-browser-modifier偏好恢复与ChatGPT/Codex不同恢复范围是新包分支，不能直接覆盖全部平台偏好 |
| 损坏文件/未知记录/确认失败 | 继续保留边界；补version与别名样本、外部并发更新和跨窗刷新；不能把未知记录一律删掉当成“官方一致” |
| 原生与像素 | 仍未验证。旧EXE、旧测试数不构成本次产品输入的验证结果 |

## 修改前验收合同

| ID | 操作/官方预期 | 证明材料 |
| --- | --- | --- |
| KB-B01 | 使用同一固定Windows能力场景生成目录；ID、真实中文、顺序、默认键、可编辑/不可用状态逐项对应；vscode-only不混入 | 官方catalog+能力输入→本地命令/真实handler映射，不用本地列表反推预期 |
| KB-B02 | 给导航、会话、Composer/审批、Git/文件各组当前已实现动作改键；新键触发同一真实动作，旧键释放；重复事件不双发 | 生产事件回放和隔离真实数据操作，不只断言回调被调用 |
| KB-B03 | 导航编号目标tabs/sidebar切换后，Ctrl/Alt编号导航语义与原生菜单/帮助一致；recentThread六槽不混淆 | 隔离desktop偏好写读、实际列表/tab数据、同序列官方对照 |
| KB-B04 | 宿主命令/OS-global/submit/annotation不录入不支持的序列/append；允许webview序列可执行、取消/超时正确 | 官方资格表驱动正反例、IME/repeat/失焦与输入作用域 |
| KB-B05 | 共享组、Enter特例、占用默认抑制/释放、PlusShift规范与命令前缀冲突正确 | 固定官方样本；组合前后整个绑定表比较 |
| KB-B06 | keybindings.json版本1/别名/旧tab迁移正确；损坏可见；单项保存不丢无关或并发外部更新 | 私有home文件fixture、写前冲突/读回、重启，不写真实用户配置 |
| KB-B07 | A窗改键→B窗重新读取并执行一致，新窗/重启一致；录入A退出不会留下全局暂停；旧读响应不覆盖新值 | 两个受控hook/窗口，再补Tauri两窗；不设未测的官方延迟阈值 |
| KB-B08 | 系统全局命令在应用失焦后仍按官方能力触发；占用注册失败可见；释放/关闭/ownership不重复 | 仅在真正实现对应Windows原生注册后测；普通webview成功不得替代 |
| KB-B09 | 设置页搜索description、长中文标题、无结果、录入/冲突/恢复弹窗焦点；宽窄窗 | 当前同源码原生构建+官方等环境配对截图、AX/几何、overlay/diff |

建议B阶段一次交付“真实可支持目录四组+资格/冲突/持久化+执行接线”，另以清单保留OS-global及服务依赖，不把阶段完成写成整个快捷键页完成。若能力映射发现大模块缺失，允许先实现有真实handler的主要命令组，但必须保留未接入目录及明确下一阶段；不能用仅修description或number-target小偏好代替主要闭环。

## 本次验证与冻结边界

只读提取/AST统计与文档空白检查；未改产品、测试、旧文档，未构建、未执行Cargo、未请求模型、未写配置、未运行官方GUI。原包/entry哈希和原文锚点是静态证据；所有运行时/原生/视觉预期均待采证，不将其写为通过。
