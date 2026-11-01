# 01B A09：首页首次发送附件失败保留

日期：2026-11-01。01B 开发增量，待用户验收；不放行 01C。

## 调研依据与边界

沿用固定官方 Codex App `26.928.21956` 的 asar 调研，入口与 chunk 哈希见[附件草稿取证 manifest](../../../.ref/parity/01/runs/20261031-codex-01b-drafts/reference-manifest.json)。静态实现中的 Composer scope 与 `viewState` 移交表明首页和会话草稿按身份隔离；附件类别有各自状态路径。它没有证明普通附件跨重启持久化，也没有证明本项目额外采用的 `thread/attachment/add` 协议属于官方行为。因此本增量不添加新的持久化或协议行为。

本次补充沿调用点静态追踪两个先前未拆清的分支：

- 初始 chunk `app-initial-fd3c4b862660.js`（manifest 已登记 SHA-256）中的 `xU` 位于 0-based UTF-16 offset `4148565`。`freshDraft` 分支生成新的 `clientNewThreadId` / `draftThreadLocationId` 并走 Composer 草稿状态初始化；这是导航/草稿身份的静态合同，不能据此推断它跳过真实 `thread/start` 或确认具体附件类别的保存范围。
- 共用 chunk `app-shared-a906948d8868.js`（同一 manifest 已登记 SHA-256）中，队列 callback 位于 offset `3681396` 起：提交/编辑经 `thread/queue/add` / `thread/queue/update`，发送前重新核对队列项身份；发送“现在”若会话正在运行，则交给 steer callback，成功后删除队列项；空闲则请求 `thread/queue/start`，成功后再移除本地投影。以上是静态分支与请求顺序，不证明当前账号 gate、通知时序或 UI 更新时机；这些仍需官方运行时对照。

## 修改前验收合同

| ID | 操作/时序 | 预期 |
|---|---|---|
| HF01 | 首页存在附件；首次发送创建新 thread；`turn/start` 失败 | 首页 scope 被消费；附件保留在新 thread scope；不启动迟到的保存请求 |
| HF02 | 同一发送 | `turn/start` 输入仍包含捕获的附件路径 |

本轮以可控拒绝结果验证生产 `handleSendMessage`、`moveHomeAttachmentsToThread` 和 scope setter。它不替代真实模型发送、原生 UI 操作或官方运行时对照。

## 实施与验证

- 扩展既有 `scripts/verify-composer-attachment-drafts.mjs`，直接调用生产发送回调。测试首次首页发送已成功创建目标 thread，然后让 `turn/start` 拒绝。
- HF01/HF02 通过：Home 无残留草稿；创建的 thread 保留原附件对象；发送输入包含附件路径；`pendingAttachmentSaveRef` 已清空。
- 未修改产品代码、附件持久化、UI、协议或依赖。此前已有的生产实现满足合同，本轮只补缺失的回归证据。
- `node scripts/verify-composer-attachment-drafts.mjs`：通过，含 HF01/HF02。

### 原生时序探针（未形成通过结论）

- 以当前 Release `A780F053A8E8E39BECBB6437A59CF12130AF0E977CB36E4B663F090FE6947285` 和本地协议 shim 启动隔离窗口。shim 能收到真实 `thread/start`、`thread/read` 和 `turn/start`；发送输入只含文本，`turn/start` 被故意挂起。
- 在挂起期间打开真实 Windows 文件选择器并填写 fixture 路径。路径在文件名控件中可见，但本轮自动化没有产生 Composer 附件 chip；请求随后达到 60 秒 RPC 超时。日志中没有 `thread/attachment/add`。
- 窗口已关闭，未登录、未调用模型。该结果只证明时序夹具和文件选择自动化尚未闭环，**不证明或否定附件竞态行为**。结构化记录见 [native-verification.json](../../../.ref/parity/01/runs/20261101-codex-01b-attachment-native-race/actual/native-verification.json)。

### 文件选择器诊断续验（2026-11-01）

- 上次未提交文件时，对话框默认焦点在搜索框；这与输入目标偏差一致，但不足以确认唯一原因。后续通过 UIA 设置独立“文件名”控件并确认后，对话框关闭，Composer 树出现附件路径、文件名和“移除附件”按钮。另一次点击后刷新报句柄不可用，可能对应对话框已关闭，不能据此判定文件选择失败。此项仅证明本机 Release 的文件选择路径可用。
- 随后两次尝试在挂起的 `turn/start` 期间添加附件，但都没有形成有效的时序结论。一次 shim 等待 59 秒后自行返回 `inProgress`，而文件选择在回包之后才完成；另一次 Computer Use 窗口恢复报错，没有发送请求。具体排除原因和隔离环境记录见 [native-picker-followup.json](../../../.ref/parity/01/runs/20261101-codex-01b-attachment-native-race/actual/native-picker-followup.json)。
- 另有一次隔离启动变量名与 PowerShell 内置 `$HOME` 冲突，该轮已停止并排除；该轮没有发起模型请求。产品源码未修改，原生竞态仍为未验证。

### 鼠标发送接线缺陷（2026-11-01）

后续自动化续测仍未获得有效的“chip 出现在回包前”时序，排除记录见 [native-send-button-discovery.json](../../../.ref/parity/01/runs/20261101-codex-01b-attachment-native-race/actual/native-send-button-discovery.json)。分析回包后原文字未清时，发现按钮透传 React 点击事件到 `overrideText` 的独立产品缺陷。生产 JSX 回调回归先复现再修复，详见[鼠标发送增量](20261101-codex-01b-send-button.md)。本段之前的“产品源码未修改”仅描述当时测试，不代表后续未修复产品。

## 状态

本轮证明的是 L2 生产回调合同；原生探针未形成通过结论，不声称真实服务端发送、官方运行时或像素一致。AS/TS 原生异步保存/发送竞态、官方特殊 freshDraft/queued 分支、重启/多窗口预期、富附件类别、焦点、像素和用户验收仍待验证；普通附件重启持久化没有官方依据前不实现。
