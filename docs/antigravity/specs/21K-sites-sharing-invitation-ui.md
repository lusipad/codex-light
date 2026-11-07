# 21K 共享邀请：邮箱解析与输入/候选弹层合同

2026-11-07。本文为开发前完成的邀请 UI 独立补证，不替代 21K 主规格。后续已实现的有限范围与实际验证见[21K阶段记录](../acceptance/21K-sites-sharing-invitations.md)；本取证结果本身不表示服务权限、正常共享原生、像素或用户验收已通过。

## 1. 固定来源与核验

官方 Windows Store `26.1027.3384.0`，既有整包 SHA-256 为 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`，本轮未重算整包。八份既有 raw（七份 JS、一份 CSS）重新核对内容 SHA、manifest 与 asar entry integrity；另从同一只读 asar 在内存读取 `rolldown-runtime-428824ca0286.js`，1301 字节，SHA `f85e715d54a11fa37b7774ad77b536896ed01bfdfc98f485b678c81859fc8e2e`，与该 entry integrity 相符。asar header SHA 与已有基准一致。

完整证据：[email-ui-contract.json](../../../.ref/parity/21/actual/21K-sites-sharing-invitations/reference/email-ui-contract.json)。文件保留八份 raw 的路径/hash、runtime 全文、54 个完整函数/赋值与 12 条完整 CSS 规则、28 个 export、9 个 import、49 项直接中文及 52 个 descriptor。定位数字是 **0-based UTF-16、右端不含**，不是物理行号。所有片段往返及 hash 检查为 0 错误。

首次锚点扫描把 `Vt` 和 `Hfe` 当成本文件函数声明，留下两项“未找到”。后续分别恢复为赋值与跨文件 import/export，最终核验为 0；初次错误和修正原因在 JSON 的 `researchAttempts` 保留，没有修改产品或官方资源。

## 2. 邮箱 schema 的真实调用链

不能使用 share chunk 附近同名变量，或 shared 中另一条“看起来更完整”的邮箱正则替代。

1. share chunk import `app-shared.hVt as P`；初始化函数 `zn` 执行 **`In=P()`**，没有传 options。
2. shared 最终 export 是 **`jp as hVt`**；完整 `jp(e)` 返回 `cd(lh,e)`。
3. `cd` 构造 `{type:'string',format:'email',check:'string_format',abort:false,...G(undefined)}`。
4. `lh=K('ZodEmail',...)` 调用 `$ZodEmail` 的 `ra.init`；`ra` 仅在未提供 pattern 时设置 **`Pn`**。
5. `ea` 组合 `$ZodCheckStringFormat` (`Kr`) 和 `$ZodString` (`$i`)。`$i` 在无 coerce 时要求原值为 string；`Kr` 每次重置正则 `lastIndex=0`，失败产生 `invalid_format/email`。
6. `th.safeParse` 调用 `yp`；`yp=Vt(hp)`。真实 `Vt` 调用 `_zod.run`，issues 非空返回失败，否则返回原解析值。相关完整构造、检查、parse/run 与 safeParse 赋值均在 JSON，不只保留一条脱离上下文的正则。

该 schema 的默认正则原文为：

```js
/^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/
```

嵌入版本对象为 `{major:4,minor:6,patch:7}`。这是官方 bundle 中的实际对象，不是本项目安装依赖的版本声明。

schema 没有 trim、转小写、IDN 转换、字符串 coerce、显式 local-part 64/域名 255/label 63 长度检查；仅声明这些未出现的约束，不能据此推断服务端会接受相同输入。附近 `Fn`、`In`、`Ln` 等正则并非本入口选用的规则。

Y 只消费 `.success`，不消费 Zod 的错误格式和语言化错误对象。后续可在这条限定输入路径移植已证的默认布尔规则并回归真实 schema 向量；不必为了该布尔检查新增整套依赖，也不能因此宣称恢复了整个 Zod 或服务端邮箱合法性规则。本轮只交付证据，没有实施该移植。

## 3. 已执行的真实规则向量与边界

本轮使用原 runtime 的实际导出，在隔离 VM 中执行 shared 原始非 import 顶层语句，直到 `Dg` 声明结束（UTF-16 偏移 `351698`），再执行 `Dg(); jp().safeParse(value)`。只把 import 绑定到原 runtime 导出，没有改写 schema、正则或解析代码，也没有用本地近似 parser 产生 expected。VM 没有运行完整 App、GUI、账号或 HTTP。

JSON 保存 **50 个直接 safeParse 向量**与 **5 个 Y 归一化向量**，包括输出 data 和错误类型。代表性结果：

|输入|实际默认 schema|
|---|---|
|`user@example.com`、`USER@EXAMPLE.COM`、`a.b@example.com`、`a+b@example.com`、`a_b@example.com`|通过；大小写不在 schema 内改变|
|`o'connor@example.com`、`'a@example.com`|通过|
|`a'@example.com`、`a..b@example.com`、`.a@example.com`、`a.@example.com`|拒绝|
|`a!@example.com`、`a%@example.com`、`a/@example.com`|拒绝，不能换用另一个允许这些字符的通用邮箱 parser|
|`a@example-.com`|通过；不能自行补“域名 label 不能以连字符结尾”后声称与此 schema 相同|
|`a@localhost`、单字母/全数字 TLD、Unicode 本地部分/直接 Unicode 域名、quoted local、IP literal|拒绝|
|65 字符 local、64/260 字符单个域名 label 的已测输入|通过；这里没有常见长度上限|
|首尾普通空格、末尾 LF/CRLF、number、null、undefined、object、array|拒绝；实际执行结果见向量，不能靠记忆解释正则锚点|

**Y 的候选路径另外执行**：raw `Re` 保留，`U=Re.trim()`，`Nt=U.toLowerCase()`，再读 `In.safeParse(Nt).success`。因此 ` User@Example.COM ` 和 BOM/NBSP 包围的实际已测输入，候选值为 `user@example.com`；这不是 schema 本身在 trim。只通过 parser 还不等于允许邀请。

## 4. 邀请入口与候选资格

权限公式沿用 [21J 第 2 节](21J-sites-sharing-members.md)：`R/b/C/oe/Ut/Wt/qt` 分支不能合成一个宽泛 owner 开关。Y 仅在非整体 loading/硬错误、policy 非空且 `qt` 时渲染邀请输入；`disabled=!Qe`，`Qe=!H`，共享或 profile mutation 保存中禁用输入。

- 个人：placeholder/aria-label 为“输入电子邮箱地址”。
- workspace 且真实团队建议分支 `W` 启用：为“添加成员或团队”。
- 其他 workspace 分支：为“添加用户或群组”。

外部邮箱候选还要求：`oe`、schema 成功、不是当前邮箱、不是已有访问 users/editors 邮箱、不是当前成员候选邮箱。邮箱比较使用 trim/lower；实际外部候选值就是 `Nt`，不是保留 raw 的新邮箱字符串。候选仅在非保存中加入。

成员候选先按当前成员 ID、已有非 editor/editor ID、已选成员排除；Y 再过滤缺少 email 的成员。组/团队按 id 排除已共享/彼此重复；这些是独立身份维度，不能因为有相同字符串就把 email 当 member ID。

## 5. 输入、候选项与真实动作

Y 使用 primary import `Oy as st`；primary 最终 export 是 **`T0n as Oy`**。完整 `T0n`、选项 `V0n`、分组 `z0n`、状态 `v0n` 及键盘 hook `initial.SGs as __` 已保留。

本入口不传 selectedOptions；默认 `[]`。选中候选后即时邀请，不是先生成本地 chips 再等底部保存：

1. `T0n` 忽略带 `disabledReason` 的选项，调用 `onSelectOption`，默认清 query 并显式 focus 输入。
2. Y 的 `En` 先 `ze('')`，再发真实 `role:'viewer'` mutation。user/group 使用 recipient/type，external 使用已规范化 email；失败调用错误提示，不生成成功行。
3. 候选顺序固定 **teams → groups → people**；空 section 不渲染标题。外部邮箱候选位于 people section 的成员候选之后，`id='external:'+Nt`、label 就是邮箱。

默认输入为 field/medium、`autoFocus=false`，没有证据支持打开共享框必自动聚焦邀请输入。保持高亮默认启用，排除不可选项后才参与键盘导航。

## 6. 键盘、ARIA 与关闭

- input 使用 `role=combobox`、`aria-autocomplete=list`、动态 expanded/controls/activedescendant；候选弹层 `role=listbox`，项为 `button type=button role=option`，不把列表项当共享表单 submit。
- option ID 为 `${listboxId}-option-${encodeURIComponent(option.id)}`；`aria-selected` 反映高亮或 selected，禁用项没有可选 handler。
- 非 IME 的 ArrowUp/Down 循环高亮；Enter 在 active 列表选择当前/默认首项。列表打开时，即使没有可选项，T0n 仍阻止 Enter 的表单默认提交。
- `SGs` 在 `isComposing` 或 `keyCode===229` 时不导航/选择；不能靠一个 input Enter handler冒充整个物理 IME 验收。
- Escape 清 query、关闭 suggestions；hook 的 `CGs` 阻止默认与冒泡。popover 自身 Escape 也停止传播并恢复输入焦点，避免把整个共享框一并关掉。
- Ctrl+N/P 仅在 `initial Hfe ← shared aF ← k3()` 判定 `navigator.platform` 以 `Mac` 开头时启用；不是通用 Windows 快捷键。本入口不传 selectOnTab，不能把 Tab 默认做成邀请。
- 点击输入/该 select 容器的 outside 事件被豁免；其他 outside 关闭 popup。open/close 自动聚焦被 `E0n/D0n` preventDefault，显式 handler 管理输入焦点；实际 Tab/原生事件顺序仍待测。

## 7. 弹层、布局和加载/错误

这不是共享链接模式的 420px menu，也不是 inline 角色菜单。`T0n` 通过 shared `gRn as WD` (`kc`) 呈现非 modal Popover：

- `align=start`、默认 `side=bottom`、`size=anchor`；宽度来自 `--radix-popover-trigger-width`，不指定任意固定宽。
- `portalContainer=Y.He`，He 来自共享 modal 的 `onPortalContainerChange`。不能把 portal 任意放在 native dialog 外而导致 inert。
- `variant=menu`、opaque=true、collisionPadding=6；默认 sideOffset 为 `5 + rbn` 实测的 anchor-overlay 补偿，不能把所有分支写死为 5。
- 最大高为 `min(16rem, available-height, calc(100vh - 16px))`；无 options 且无独立状态时，默认 loading 最小高也受相同 16rem/边界约束。
- field/medium 的原始类为 `min-h-9 rounded-md px-3 py-1`；外层 `max-h-64 gap-1 overflow-y-auto border border-primary-outline bg-primary-soft focus-within:border-ring`。候选行 field 分支 `items-start px-2 py-1.5`、gap2、rounded-sm；组标题 `px-2 pt-2 pb-1 text-xs font-medium`。
- 保留 rem/token/class 公式；不能在当前 root 13px 的 clone 中直接换算并宣称物理像素相同。源 shadow/color/radius 依赖共享 `j3('opaque')`，完整函数已留证，尚无官方配对图。

另从同包 `5257da4ba4ae.css` 核对并留存 min-h-9、max-h-64、rounded-md/sm/2xl、px-3、py-1、p-2、text-sm/base、gap-1/2 十二条完整 utility 规则，全部 token 定位成功；它们仍受原 CSS 变量和字号环境约束。

独立状态直接中文：用户加载失败、用户加载中…、无法加载群组、无法加载团队、正在加载你的团队…。相关 key 在 JSON 的 translations/descriptors 中对应原文和 offset。

Y 在候选全部为空且相关搜索仍 loading 时传 `optionSections=undefined`，显示 spinner，不先显示“没有匹配的用户或群组”。只有 trimmed query 非空且没有相关人员/组/团队错误时才给出该空态。组搜索错误有“重试”；人员/组/团队状态可与已有结果并存，不合并成一个空列表。聚焦空 query 是否显示团队建议由真实 `W` 控制，不返回假团队。

## 8. 后续开发验收输入与未证项

实现时应从本 JSON 的真实算法/固定向量建立数据回归，另对 149/150ms、取消/15 秒、乱序结果、重复项、disabled/IME/Enter/Escape、选择即时 PATCH 与失败保留建立有意义回归。不得以模拟计时器造成功、自动向真实邮箱发送邀请或安装新依赖。

本取证步骤没有修改产品、运行 Cargo/build、官方 GUI 或真实 HTTP；后续实现验证另记阶段记录。仍未证：服务完整搜索 schema/真实账号 gate 和权限矩阵、发送邮件/限流及 ACK 时序、团队目录全部运行时分支、授权头像资源桥、远端语言包覆盖、原生焦点/物理 IME、窗口缩放和同环境像素。已有 static/VM 结果不代表以上项目完成。
