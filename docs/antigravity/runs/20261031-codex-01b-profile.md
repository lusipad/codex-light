# 01B：资料菜单身份与键盘操作

日期：2026-10-31。本轮为 A08 的局部增量，现已完成下述自验，待用户验收；01B 仍开发中，不放行 01C。以下合同在产品修改前写入。

## 官方取证

固定包版本 `26.928.21956`，asar SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。本轮提取文件及哈希见 `.ref/parity/01/runs/20261031-codex-01b-profile/reference-manifest.json`。以下数字均为 0-based UTF-16 字符偏移。

- initial chunk `577a50e29502f573e2fbccf4940b9bd875339db420d6d5a9798a0d201ee0aff1`：
  - Xoo `6734782`：rail 资料菜单 side=right、align=end、sideOffset=4、alignOffset=-4，非 rail footer 有其他定位。
  - rso `6740000` 附近：身份名字优先 profile/name，email 是已证实的回退；没有身份时使用“设置”。认证状态与服务进程连接状态不是一回事。
  - U6o `8157493`：菜单只有 Work 和 Codex 两项；Work 标签由 capability 决定 ChatGPT 或 ChatGPT Work；codexOnly/其他 gate 下可直接显示静态标题。鼠标模式选择在关闭后执行，键盘有独立路径。
  - xds `8609679` 附近：chatgpt capability 与 gate 决定 workModeAccess，不能从登录方式或 app-server 连接推断。
- shared chunk `1ffb0654bdfcba23be50c06c8698e665bdb17330d923758001d01262aa81cb5b`：
  - f7 `6400932`：Oa 默认非 modal；DropdownMenuTrigger 约 `825700` 支持 Enter/Space/ArrowDown；Content 约 `826000` 记录 outside interaction，关闭时不抢回外部焦点。
- profile chunk `a3ac27a5d7888cf304ee707df95a38f7e47a6683412aa8d044cc3630fb1e4abd`：
  - Pi `15364` 按身份、usage、Mini、settings/help 等分支组合；Fi 按 callback 和可见状态显示 Mini；Ri 按 authMethod、账号与 gate 决定菜单，不能固定套用所有项目。
- 中文包：真实键值 `codex.profileDropdown.apiKeyAuth` 为“已通过 API 密钥登录”，`amazonBedrockAuth` 为“已使用 Amazon Bedrock 登录”，usage 为“使用情况”，settingsFallback 为“设置”。

静态证据不能证明官方运行时所有账号菜单、动画或焦点；包内有 offline patch/gate，不泛化为所有官方版本。当前没有同条件官方菜单无损截图，本轮视觉与官方运行时仍未验证。

## 范围与假设

仅修正资料入口的真实身份与可操作性，复用已有 account/read、AccountReadResult、HTML popover 和样式。没有官方 profile/name 接口时仅使用 account/read 的 email 回退，不伪造姓名或头像。无身份时保留真实可用的设置入口。API Key/Bedrock 不显示 ChatGPT 用量入口；ChatGPT 的“使用情况”仍进入本项目现有账号设置页，不能称官方 usage 展开已复刻。

模式菜单三项错配、帮助子菜单、登录/退出、账号切换、完整 usage gate 与内容列为后续缺口。本轮不启用未接入的 Work，不用网页跳转冒充原生模式切换。

## 修改前动作合同

| ID | 操作 | 本轮预期与验证 |
|---|---|---|
| PR01 | account/read 返回 ChatGPT / API Key / Bedrock / null | 显示真实 email 或对应认证说明；未知身份用“设置”；不再显示固定 Codex Native 或服务连接作为身份 |
| PR02 | 切换账号通知及请求失败/晚到 | 清除旧身份并重新读取；旧请求不覆盖新请求；失败回退未知，不保留错误身份 |
| PR03 | profile trigger Enter/Space 或 ArrowDown | 浏览器原生点击或显式方向键打开；方向键按实际边界定位菜单；仅 keyboard 打开时聚焦第一项 |
| PR04 | 菜单 ArrowUp/Down/Home/End | 在可用项间移动；当前焦点不在列表时 Up 选末项，Down 选首项，跳过 disabled |
| PR05 | 菜单 Escape / Tab / 外点 | Escape 关闭并返回 trigger；Tab 关闭让默认焦点移动；外点关闭不额外抢回 trigger |
| PR06 | 选择设置/使用情况/Mini/帮助 | 各执行已有真实 callback 一次并关闭；动作之后不异步抢回新页面焦点 |
| PR07 | 原生隔离窗口菜单操作 | 当前构建验证打开、方向键、Escape、Tab、外点及设置入口；不触发登录、退出或模型任务 |

先执行实际组件回归复现失败，再最小修改；类型检查、完整标准检查、Tauri release 后保存构建输入与 EXE 身份。修改前后无配对官方截图，visual-verdict 不生成评分。最终只交付局部自验，不写整页通过。

## 实现与简化

- `NavigationRail.tsx` 接入已有 `AccountReadResult`：ChatGPT email 回退、API Key/Bedrock 对应中文说明；未知或断连不展示旧身份。去除固定 C、Codex Native 身份与连接圆点；头像仍是本地回退，未声称官方头像资源一致。
- 复用现有 popover 及键盘处理，加入 trigger ArrowDown、Enter/Space 打开后的聚焦、上下/Home/End、Escape 返回及 Tab 退出。关闭不再统一抢焦点；延迟打开回调确认菜单仍开且焦点未离开后才聚焦。探索菜单共用此处理，路由与条目未变。
- 实际原生发现“鼠标打开后 ArrowDown 不进第一项”：已开 popover 不产生新 toggle。补失败用例后，在已开分支直接聚焦第一项，重新完整检查并重建。
- `App.tsx` 使用现有 account/read，account/updated 只含 authMode/planType（本地协议 `v2/AccountUpdatedNotification.json`），不能合并成账号身份；改为清旧身份后重新读。请求代次阻止晚到覆盖；断连作废在途请求，读失败清身份。
- 仅删本次去掉连接圆点后不再使用的 CSS；未增依赖、Rust 命令、模式切换或认证写入。

## 验证与失败记录

证据目录：`.ref/parity/01/runs/20261031-codex-01b-profile/`。

| 证据 | 结果及边界 |
|---|---|
| `before.log` | 修改前资料身份回归退出 1，固定身份不含 account/read email |
| `account-before.log` | 实际生产 refreshAccount 回调复现旧请求晚到覆盖新身份，退出 1 |
| `pointer-open-before.log` | 原生发现后先补实际组件用例，鼠标打开后 ArrowDown 不进入第一项，退出 1 |
| `actual/component-test.log` | 最终实际组件及 App 回调退出 0：账号变体、身份失效、请求乱序/失败/断连、菜单打开/导航/关闭、单次动作；属于 L2，未模拟完整浏览器默认行为 |
| `actual/mutation-checks.json` | 中间版本四项内存反证均退出 1：固定身份、错误 Up 索引、关闭抢焦点、无请求代次保护；没有改磁盘产品文件。初次反证命令因 Windows 参数过长失败，改用 stdin 后成功 |
| `verify-all-r2.log` | 最终源码完整标准退出 0，整个进程另设隔离 CODEX_HOME，含六个协议探针；Rust 只跑标准 automations 过滤，本轮无 Rust 改动，未重跑全量 Rust。没有独立 lint 配置 |
| `build-r2.log` / `build-identity.json` | 最终 release 退出 0，115 输入哈希核对；Vite 仍有既有 chunk 大小及静态/动态重复导入建议 |
| `actual/reference-hash-check.json` | asar、initial、shared、profile、中文、package 六个文件重新核验 |
| `actual/native-initial.json` | 中间 build 的原生操作及发现的鼠标已开菜单缺陷保留，不能作为最终构建证据；该版外点后输入未发送草稿成功 |
| `actual/native-verification.json` | 最终隔离 EXE：匿名菜单、鼠标开→Down→Tab关闭且可见后续控件焦点环、Enter打开→Escape关闭→Down重开、Down→Enter进入设置均观察到；无认证/模型任务 |

原生工具 UIA focused_element 始终偏向 RootWebArea/窗口，不能从它精确宣称 DOM 焦点；通过后续动作验证了上述有限序列。最终外点截图显示菜单关闭和 Composer 插入符，但立即返回的 UIA 仍残留菜单；随后补测遇到工具检测人工输入，停止所有 UI 输入。最终外点后打字及精确 Tab 顺序保留为未完成补测。测试窗口保持隔离，不自动终止可能已被人工操作的窗口。无登录、退出、沙箱安装、外链发送、模型生成。

## 交付与下一项

- 产物：`dist-artifacts/01B-profile-20261031/CodexNative.exe`，13,255,168 字节。
- SHA-256：`CF24AEA89D176A44919A5524A4BC634DF268AB43A8866ABD3E92282E0AAE5442`。
- 用户可核验：打开左下资料菜单；匿名不显示伪身份/ChatGPT 用量；按方向键进入，Tab 离开；重新键盘打开后 Escape 关闭，Down 可重开；选择“设置”进入真实设置页。已认证身份仅有 L2 样本证明，本轮不使用真实用户登录测试。
- A08 后续先完成官方帮助菜单及模式 capability 的可获取性调查，核实 Codex-only 分支是否应为静态标题；不得把 ChatGPT/Work 三项占位直接称为通过。完整 usage、账号菜单和像素仍未对齐。
- 更新剩余清单与实施日志；未提交、未推送，用户未验收，01C 未放行。
