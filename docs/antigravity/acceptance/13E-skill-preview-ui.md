# 13E 已安装技能详情：UI 实施与局部验证

日期：2026-11-06。状态：**本文记录UI实施与Node回归；主线程后续浏览器、原生结果见[阶段记录](13E-skill-preview.md)**。配对像素与用户验收仍未完成，本文不宣称页面已验收。

## 基准与范围

遵循 [13E 开发前合同](../specs/13E-skill-detail.md)、[原始清单](../../../.ref/parity/13/actual/13E-skill-detail/reference/manifest.json)、[anchors](../../../.ref/parity/13/actual/13E-skill-detail/reference/anchors.json) 和 [补充动作/CSS取证](../../../.ref/parity/13/actual/13E-skill-detail/reference/supplement-actions.json)。固定官方 Windows 版本 `26.1027.3384.0`；asar hash、13项 integrity 来源沿用上述同会话只读取证，本实施子任务没有重新计算安装包全量哈希。

本轮实现独立技能目录的已安装预览。设置 `manageOnly` 继续既有编辑路径；离线种子/本地模版及其草稿继续显式入口。没有把 settings contents 的 xwideTall 属性表或远端 Showcase 引入目录。

## 实施与复用

- `SkillsMcpView.tsx`：已安装卡片点击/Enter/Space进入独立预览，默认卡片使用状态 check，真实启禁开关在 header；管理卡片开关保留。预览 identity 包含工作区、连接生命周期、技能 key 与递增实例号，关闭/上下文变化销毁子组件。启禁后从刷新列表读取真实状态。
- `SkillPreviewDialog.tsx/.css`：原生 HTML dialog，header/菜单/独立滚动 Markdown/footer；关闭/Escape/遮罩、菜单 Escape/方向键、组合输入 Escape 防护。普通关闭恢复仍连接的原焦点；宿主文件/聊天动作成功转移焦点时不抢回卡片。header保留关闭能力，写入中开关/卸载/试用禁用。
- `skillPreview.ts`：仅清洗预览副本，复现 CRLF→LF、完整起始 frontmatter 移除、存在标题候选时无条件移除首 H1（不比较其文字）。复制仍用原文，成功读取的空串允许复制。
- 读取复用 `readFileText`，错误可见/可重试；关闭后晚到 promise 不写子组件状态。路径存在但失败不尝试远端。无路径且缺完整官方远端身份时明确不可读，不从 `pluginId.split("@")` 猜 RPC，不展示无效重试；仍允许按技能名准备试用草稿。
- 文件“打开”复用 App 提供的可异步 `onOpenSkillFile(path)`；“立即试用”通过 `onTrySkill({name,path,defaultPrompt})` 交宿主准备草稿。只有返回 `true` 才关闭；`false` 保留并在 dialog 顶层显示未保存修改提示；异步重复点击单飞。精确 prompt builder、真实 Composer 接线和文件保存 guard 由主线程负责验证。
- 启禁、`skill_delete` 确认与刷新使用原有链；启禁传递原始 name 与 path，让协议 helper按冒号名称选择。卸载仅暴露已绑定本地已安装项且非 admin 的既有 ID 删除能力。取消无写，失败在 dialog 内显示错误。A 的卸载晚到不能关闭 B 或同技能重新打开的实例。
- 文件管理器使用真实 reveal IPC，独立于“打开”，不关闭预览。当前 app-server 为本地进程，因此 `localHost=true` 是当前已知能力范围；没有把 connectionIdentity 的 JSON生命周期串当作 host 类型。

## CSS 证据与未证差异

逻辑尺寸 `600×720` 来自 editor；`Q7s→iCn` 证实图标上置、标题描述纵向、动作 top/right 20；`$7s` 的 h-10/w-10 为40。body padding20、footer margin20、section12+preview pt16合为正文上间距28、正文p16和radius12、外壳radius24来自静态类及补证。颜色复用现有主题 token，没有新调色板。

同一已校验原始 CSS `.ref/parity/05/actual/05D-ui-correction/reference/raw/5257da4ba4ae.css` 的 UTF-16 检索锚点：`.heading-dialog{` 129565，`--text-lg:16px` 138054，通用 `--text-heading-md:20px` 141909，`:is([data-codex-window-type=browser],[data-codex-window-type=chrome-extension],[data-codex-window-type=electron]) body` 下 `--text-heading-md:18px` 1352697，`[data-codex-window-type=electron]` 下 `--text-sm:13px` 1354583。故采用标题18/line28、描述16、正文13；不能只读通用token推断Electron尺寸。正文h1/h2类来自 `o9s/s9s`。

仍未证：固定官方运行时的实际分支/可用账号、同环境DOM和配对截图；完整图标资产/字体栅格、按钮/菜单几何、主题token与官方色值偏差、窄窗/极长描述溢出、缩放/DPI及精确关闭焦点。这里的 CSS 数字是静态逻辑值，**不是已测物理像素**，无评分。

## 回归：红→绿

实施前运行实际 `SkillsMcpView` 隔离 hook fixture，打开目录已安装卡片后断言 `textarea` 数为0；旧实现真实失败：`AssertionError SD01 ... 1 !== 0`（2026-11-06）。随后新增 `scripts/verify-skill-preview-ui.mjs`，执行生产预览组件与生产目录 handler，而不是静态源码字符串检查。

| 命令 | 结果与可证明范围 |
|---|---|
| `node scripts/verify-skill-preview-ui.mjs` | exit0；SD01/03/04/05/06/07/09/10/12相关隔离用例：状态、清洗、原文及空串复制、晚到读取、目录check与编辑草稿隔离、连接关闭、路径错误无猜测RPC、无路径试用、真实handler写锁/读回、晚到卸载不关B、取消/失败卸载、异步宿主拒绝保留与提示 |
| `node scripts/verify-extensions-ui-d.mjs` | exit0；维护旧“选择显示textarea”断言为preview，保留本地模版ID清空/草稿、插件详情、目录/管理边界、键盘事件源检查；其共享管理fixture完整执行PMB01–07 |
| `node scripts/verify-skill-actions.mjs` | exit0；原SA01–06身份、内容和变更回归保留（本轮没有改其旧管理兼容远端回退断言） |
| `npx tsc --noEmit` | exit0；冻结产品源码后检查通过 |
| `git diff --check` | exit0；有仓库已有LF→CRLF提示，无空白错误 |

以上均为内存/协议 mock 的 Node 执行，不涉及用户真实写删、模型调用或原生UI。没有新增依赖、Rust、全局配置或Git提交。标准脚本、build、原生与浏览器由主线程冻结输入后执行，结果须另行填写，不能由上述Node通过推导。

## 明确保留的缺口

1. 官方宿主 remove 是 path/host 合同且此追链无确认；当前保留已有确认与 ID-only 删除。repo/WSL/纯远端或无本地绑定的卸载尚未实现，不能报告为完整删除对齐。
2. 卡片传`startInSidebar:true`，但主线程后续追到同版本本地宿主未消费该参数、实际准备首页导航，撤回仅据参数推定侧栏的缺口。当前复用真实主Composer；官方nonce草稿分槽与目标文本替换尚未对齐，现保留旧草稿并追加。不接已有定时模拟成功的SideChatPanel，不调用turn。下游来源见13F只读合同。
3. 官方Retry键中文未找到，现“重试”为本项目可用本地文案，未宣称官方运行时已证。
4. `manageOnly` 的既有编辑与兼容远端读取语义保留；它不是本次目录preview正确性的证明，也未被标为新的settings contents对齐。
5. 无路径远端正文不读取；需要官方完整remoteMarketplaceName/remotePluginId/version及host能力身份后单独实施，不能以错误后回退补假身份。
6. 主线程已补浏览器尺寸/键盘及隔离Tauri真实读取/打开/dirty/试用与焦点实测，见阶段记录；物理IME、卸载原生路径、官方配对像素与用户验收继续保持未验证。

## 浏览器第一轮反馈修复（2026-11-06）

主线程浏览器真实复现并记录在 `browser/initial-wide.jpg` 及 `.omx/state/parity-13E/ralph-progress.json`（score=null / revise）：全局reset将dialog margin归0导致左上角定位；跨页面按钮class未覆盖导致页尾UA白底；末尾试用按钮Tab跳至body、`dialog.contains=false`。这些是首轮实际失败，不能由先前Node通过覆盖。

定点修复：`.pm-skill-preview`明确`margin:auto`；组件内独立定义已有medium按钮padding6×16/font14/line18/radius10及主题背景/文字/禁用态，同时覆盖重试兼容按钮；生产dialog handler显式圈定可见且enabled的button/链接/可tabindex内容，最后Tab回首个、首个Shift+Tab回末个，中间Tab保持浏览器行为。组合输入期间不触发Enter/Escape，Tab不拦截输入法候选处理。

先新增实际handler回归并运行，真实失败 `SD11: final Tab must wrap inside the dialog / false !== true`；修复后 `node scripts/verify-skill-preview-ui.mjs` exit0。新增断言还包括：隐藏控件不成为焦点、正常中间Tab、IME Escape、外部success→宿主false显示阻塞反馈→新的外部error可见。`node scripts/verify-extensions-ui-d.mjs`、`npx tsc --noEmit`、`git diff --check`均exit0。CSS定位/按钮的computed样式和真实浏览器Tab复测仍由主线程执行，Node不冒充浏览器已修复证据。产品输入此轮再次冻结。
