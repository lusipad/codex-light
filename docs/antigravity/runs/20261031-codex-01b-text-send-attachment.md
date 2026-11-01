# 01B A09：纯文字发送期间新增附件保护

## 决策与前提

当前单元仍为 01B / A09。延续 AD06、AS01–AS04 的 scope 与发送快照合同：本次请求未携带附件，其返回不得清理请求发出后新增的附件。信心高：请求输入在等待 `turn/start` 前已创建；该分支仅在捕获的 `attachedFiles.length === 0` 时执行。官方运行时若存在明确不同的可观察清理时序，需另行对照，不把本轮安全修复写成完整官方对齐。

本轮先复核固定版本的 `app-initial-fd3c4b862660.js`，SHA-256 为 `577a50e29502f573e2fbccf4940b9bd875339db420d6d5a9798a0d201ee0aff1`。0-based UTF-16 offsets：`Wx` 1297409、`Vlr` 3079432、`AL` 3080244、`Uur` 3087987、`Jur` 3088554、`BL` 3090190。它们证明 scope/viewState 和首页图片专门状态；不能证明普通文件必须跨进程重启保留。保留身份隔离；适配已有 React scope setter；不新增磁盘格式、依赖、协议字段或 UI。本轮不直接复制官方源码。

## 实施前计划与偏离规则

1. 在现有附件专项中执行生产 `handleSendMessage`，控制 `turn/start` 返回时点，复现新增附件被清理。
2. 纯文字成功分支不再清理空附件快照；只删除多余的清理语句，不调整发送状态机。
3. 运行附件/文字/项目发送专项、完整标准检查和原生 Release 构建，记录来源和限制。

仅允许 `src/App.tsx` 此分支、`scripts/verify-composer-attachment-drafts.mjs` 和本轮证据/日志。发现其他发送状态机问题时记录并分项处理；不扩大到其他页面。实施记录写在本文下方，不覆盖旧验收结论。

## 修改前验收合同

| ID | 输入/时序 | 预期 |
|---|---|---|
| TS01 | A 发纯文字，`turn/start` 待定时给 A 新增附件，然后成功 | 请求仍只有原文字；新增附件保留，原文字正常清理 |
| TS02 | A 发纯文字，A 新增附件后切 B，旧响应成功 | A 的新增附件和 B 草稿均保留；旧回调不写 B |
| TS03 | A 发纯文字，新增附件后请求失败 | 新附件和文字均保留 |
| TS04 | A 发纯文字，等待期间无编辑，成功 | 原文字清理，附件仍为空；无额外协议调用 |

上述为 L2 生产回调测试，不能替代真实模型发送、官方运行时或原生竞态与像素对照。普通文件附件重启行为继续为待官方采证，不凭本项目当前实现反推官方预期。

## 实施记录

- 修改前专项退出码 1：`text-only send completion must preserve attachments added after its empty snapshot`，actual `[]`，expected `[after-send.txt]`。测试执行实际生产发送回调和 scope setter，以待定 Promise 控制时序；没有调用真实模型。
- 修复仅删除纯文字发送成功分支的 `setAttachedFiles([])`：该次请求没有附件，无需清理附件。复用原文字保护，不新增 helper 或状态；其余附件发送仍沿用原快照清理逻辑。
- TS01–TS04 修复后通过；附件、普通文本、项目新聊天专项均退出码 0。TS01 先红后绿证明测试能抓住本次误清；其余用例执行同一生产回调、真实 scope setter 和待定 Promise，不通过字符串存在来判断行为。
- 完整 `pwsh -NoProfile -File scripts/verify-all.ps1` 退出码 0，包括专项、TypeScript、Vite、Cargo check、17 项 `automations` 筛选 Rust 测试和 6 组隔离协议探针。没有运行全量 Rust 单测；本轮未修改 Rust。仓库 package.json 没有 lint 脚本，不报告独立 lint 通过。Vite 的 SettingsView 动静态导入/大 chunk 警告与协议探针 Node DEP0190 警告仍存在。标准脚本中历史命名为 parity 的项目不等于像素验收。
- `npm run tauri build` 退出码 0，Release、MSI、NSIS 均生成。归档 [CodexNative.exe](../../../dist-artifacts/01B-text-send-attachment-20261031/CodexNative.exe) 为 13,307,392 bytes，SHA-256 `bf6d6d71b5f1f3679ea9cc1c86f18ac1b13af450f7c216b69f037652fd98472e`。185 项源码/配置/验证文件构建前后哈希一致；[构建清单](../../../.ref/parity/01/runs/20261031-codex-01b-text-send-attachment/actual/build-manifest.json)同时记录 HEAD、未提交工作树和 dist，不能只用 HEAD 证明源码身份。
- 使用该归档 EXE 在新建 `CODEX_HOME` 下观察原生首页、空 Composer 和禁用的发送按钮，随后关闭测试窗口并确认 PID `216832` 退出。只做启动检查，未登录或发起 UI 发送；WebView 用户配置未单独隔离，不称为完整用户数据隔离。截图/UIA/限制在[本轮证据](../../../.ref/parity/01/runs/20261031-codex-01b-text-send-attachment/verification.md)中。
- 没有改动 UI 样式，也没有官方同条件截图，不产生视觉评分。本轮原生检查**没有**复现 TS01–TS04 的成功发送竞态；也不复用上一 EXE 的 Home/A/B 附件往返截图当作新 EXE 的完整原生验收。

## 尚未完成

原生发送竞态、官方运行时对照、普通文件附件重启预期、跨窗口、富附件、精确焦点、同条件像素和用户验收仍未完成。01B 未验收，不放行 01C。若继续 A09 持久化工作，先取得官方运行时预期；在此之前不添加未经证实的附件磁盘存储。
