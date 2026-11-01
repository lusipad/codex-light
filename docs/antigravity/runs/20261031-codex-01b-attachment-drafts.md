# 01B A09：按 Composer 身份隔离待发送附件

日期：2026-10-31。01B 开发增量，待用户验收；不放行 01C。

## 官方调研

固定 Codex App `26.928.21956`，asar SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。入口及初始 chunk SHA-256 在[草稿取证 manifest](../../../.ref/parity/01/runs/20261031-codex-01b-drafts/reference-manifest.json)核验。

在 `.ref/scratch/files/app-initial-fd3c4b862660.js` 中沿 Composer 状态调用链核对：

- `Wx`（offset `1297409`）：首页与 local 会话有不同 draft scope；local 以 clientThreadId 为键。
- `Vlr`（offset `3079432`）：把来源 Composer 的 draft 和完整 viewState 交给 clientThreadId / conversationId 目标身份；目标已有 draft 或 viewState 时避免覆盖。
- `AL`（offset `3080244`）：更新 Composer viewState 后，对 home scope 另将 `imageAttachments` 与 `attachmentOrder` 写入按 `Wx(scope)` 索引的 `Uur`。
- `Yur`（offset `3089490`）与 `BL`（offset `3090190`）：Composer viewState 含 `imageAttachments`、`fileAttachments`、`pastedTextAttachments`、`uploadedFileAttachments`、`addedFiles`、`selectedTextAttachments` 等不同类别；home 的图片附件从按 scope 索引的状态恢复。`Vlr` 的完整 viewState 移交表明其他类别有独立状态承载路径，不能仅因 home 图片有 `Uur` 就推断其他附件类别的持久化行为。
- `Ilr` / `Llr`（offset `3078321`）：`composer-retained-documents-v1` 按 Composer scope 保存富文本 document、plainTextMode 和 prompt；这是富文本文档状态，不代表所有附件路径都写入该 key。
- `Ulr` / `Wlr`（offset `3081032` / `3081823`）：清空 Composer 时分别清理多种附件类别和草稿；keepMcpAppAttachments 是有条件分支，不推断为普通导航行为。
- `thread/attachment/add` 是本项目额外采用的 app-server 数据协议。官方静态片段不能证明普通待发送附件在离开会话时会被写入会话附件记录。

以上为**静态实现证据**，本轮不能连接官方 App 进行相同操作序列实测。由静态 scope/viewState 可支持“Composer 状态不能用一份全局数组跨首页和会话共享”；精确哪些类别在离开/重开/跨窗口后保留，仍待官方运行时采证。

## 发现与范围

本项目的 `attachedFiles` 原为单一 React 数组。`startNewThread` / `selectThread` 在离开当前会话时把未发送附件保存到旧会话，并在进入目标视图时清空；这会把草稿写到错误会话且切换身份后丢失本地草稿。

本增量只修复普通文件/图片附件的**内存 scope 隔离**和首次首页发送身份移交，不新增富文本、持久化格式、协议字段、依赖或样式。会话已保存附件仍由既有 `thread/attachment/list` 读取；异步读回与该 scope 的本地未发送附件合并。新聊天按钮仅切换到首页 scope，不提前保存到旧会话。用户随后在首页首次发送时，才将首页附件草稿合并移交至新 thread scope。

本地草稿刷新/退出恢复、官方附件顺序和其他富文本/文本选择/MCP/appshot context 完整复刻、多窗口同步、官方运行时焦点与像素均不在本轮通过范围。保留跨窗口与重启状态为未验证，不用 `composer-retained-documents-v1` 推断本地普通文件附件必定持久化。

## 修改前动作合同

| ID | 操作 | 预期与证据 |
|---|---|---|
| AD01 | 首页加附件H；切A加A；切B加B；返回A/Home | 各 scope 只显示自身附件，不串入、不丢失；生产状态 setter 回归 |
| AD02 | 切离含未发送附件的会话 | 不写 `thread/attachment/add` 到旧会话；草稿仍留在原 scope |
| AD03 | thread/read 与附件列表异步返回 | 只合并已持久化附件和当前 scope 附件，不覆盖新加入草稿 |
| AD04 | 首页加附件后普通新聊天/项目内新聊天 | 首页草稿保持；不会转存旧会话 |
| AD05 | 首页附件首次发送创建 thread | 按 path identity 合并并只移交一次；turn/start 失败时附件仍留在新 thread scope |
| AD06 | 文件选择器、Appshot、删除与消息发送 | 各操作针对捕获/当前 Composer scope；不影响其他会话草稿 |

## 实施

- `src/App.tsx` 将单数组替换为 `home` / `thread:<id>` scope map；复用既有 `mergeAttachmentItems` identity 规则。
- 文件选择器和 Appshot 回调捕获触发时 scope，避免异步返回写入后来切换到的视图。
- 离开会话不再提前将未发送附件写进旧 thread；选择会话后读取已保存附件，并合并该会话在内存中的草稿。
- 首次 `thread/start` 确认当前导航仍有效后，才把首页附件及文字草稿一并移交到新 thread。
- 复核异步删除路径后修复跨会话竞态：删除开始时捕获 Composer scope 与 thread ID；app-server 删除成功后仅清理原 scope。等待期间切换到含同路径本地草稿的另一会话，不会误删新会话草稿。
- 添加 `scripts/verify-composer-attachment-drafts.mjs`，从实际生产 state setter、身份移交回调和 `mergeAttachmentItems` 验证独立 scope、删除、保留及单次移交；既有项目导航/普通文本草稿回归同步调整了过期的“离开时必须保存附件”预期。

## 验证状态

- `node scripts/verify-composer-attachment-drafts.mjs`：通过（L2 生产函数/回调）。
- `node scripts/verify-composer-drafts.mjs`：通过（现有文本隔离、发送和导航回归）。
- `node scripts/verify-sidebar-project-selection.mjs`：通过（生产项目新聊天回调；新行为不再因未发送附件而阻止离开）。
- 新增竞态回归：持久附件在 A 删除等待期间切换到 B，且 A/B 有同路径附件时，删除完成只清理 A；B 草稿保持。删除完成、失败分支与切换时 thread ID 均由生产回调测试覆盖。
- `npx tsc --noEmit`：退出码 0。
- `pwsh -NoProfile -File scripts/verify-all.ps1`：退出码 0；专项回归、TypeScript、Vite、Rust check、17 项 `automations` 筛选 Rust 测试和 6 组真实隔离协议探针通过。脚本不代表像素和原生交互通过；前端存在 SettingsView 动静态双重导入及 bundle 大小既有警告。
- 修复后再次执行 `npm run tauri build`：退出码 0，Release EXE 及 MSI/NSIS bundle 均生成。独立归档 EXE 为 `dist-artifacts/01B-attachment-drafts-racefix-20261031/CodexNative.exe`，13,306,880 字节，SHA-256 `059933C06129E82FB6E46DB1D68885994C0ECFFBC5ED18A4C23C0F61317ED2F3`。此前的原生截图对应旧哈希 `997774...`，不得当作本次竞态修复版的原生验证。
- 修复后重跑 `node scripts/verify-composer-attachment-drafts.mjs`、`node scripts/verify-composer-drafts.mjs`、`node scripts/verify-sidebar-project-selection.mjs`：全部退出码 0；`git diff --check` 退出码 0。
- 原生 GUI：首轮 app-server `thread/list` 返回空数据；核对既有分页离线回放样本后发现，需在独立 rollout 中追加声明用途的 `user_message` 投影事件，CLI 才会把离线 fixture 纳入列表。已将该事件纳入 fixture 准备脚本；补齐后 `thread/list` 返回两个 fixture，重启归档 Release 后它们出现在 Sidebar 的项目与 Recent 列表。协议读回见[thread-list probe](../../../.ref/parity/01/runs/20261031-codex-01b-attachment-drafts/actual/thread-list-probe.json)。
- 当前 Release 1442×914 深色中文窗口下，分别通过系统文件选择器给 Home、A、B 加入不同现存文本文件。依次执行 A→B→Home→A→B→Home；每个 scope 只显示并恢复自己的附件，其他 scope 不显示其附件。最终分别移除 chip，并将附带/清空状态截图与操作记录保存于[原生证据目录](../../../.ref/parity/01/runs/20261031-codex-01b-attachment-drafts/actual/)。Windows/App 缩放未知，故不作官方像素结论。
- 该原生序列确认普通文件附件在当前进程内按 Home/会话 scope 隔离与恢复。未登录、未调用 `turn/start`、未发送消息、未请求模型。首页首次发送时的附件移交、退出重启、多窗口及特殊附件类别仍未验证。
- 官方运行时/同条件像素、重启持久化、多窗口、富附件类别：未验证；不得标为通过。
- 本次修复版 Release 尚未重新进行原生 GUI 操作；现有附件 scope 原生序列只对应修复前构建。

## 修复版原生续验（2026-10-31）

以 `059933C06129E82FB6E46DB1D68885994C0ECFFBC5ED18A4C23C0F61317ED2F3` 启动隔离离线会话，未认证、未调用 `turn/start`，未发送消息或请求模型。首页通过系统文件选择器加入临时 `a09-home-draft.txt` 后，UI Automation 同时观察到附件名称和“移除附件”按钮；随后切换到第二条离线会话行，该 Composer 不再呈现该首页附件。记录见[修复版部分原生续验](../../../.ref/parity/01/runs/20261031-codex-01b-attachment-racefix-recheck/actual/native-verification.json)。

该续验只证明修复版的一次首页加附件及离开首页后隐藏，不证明会话 A/B 附件隔离、切回首页恢复或删除。原生文件选择器自动化在后续会话 fixture 操作中未能得到附件 chip 证据；没有保留截图，也未记录所选行对应的 thread ID。修复版 Home/A/B 完整往返仍待续验；先前完整往返证据仍只对应旧构建。不得据此扩大 A09 通过范围。

后续排查发现，`SendKeys.SendWait` 输入绝对路径时屏幕显示结果丢失反斜杠；改用 Win32 `WM_SETTEXT` 后虽能从文件名 Edit 控件读回完整路径，但发送编辑变更、Enter 与 IDOK 通知仍未关闭对话框或产生附件 chip。诊断结果保存在同目录的[picker 自动化诊断](../../../.ref/parity/01/runs/20261031-codex-01b-attachment-racefix-recheck/actual/picker-automation-diagnostic.json)，所以本轮不把这些操作记为选择成功。

状态：开发中 / 自验中；01B 未验收，01C 未放行。
