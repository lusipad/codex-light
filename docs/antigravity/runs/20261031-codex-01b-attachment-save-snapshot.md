# 01B A09：附件保存完成后只清理发送快照

本轮范围：A09 / AD06 的异步附件草稿归属；01B 仍自验中，不放行 01C。

## 调研与修改前合同

固定官方基准及 asar 哈希沿用[附件草稿调研](20261031-codex-01b-attachment-drafts.md)。`Wx` 为 Composer 身份分配 scope，`AL` 更新该 scope 的 viewState，`Vlr` 移交源 viewState；它们支持按 Composer 身份保存状态，不能证明普通文件重启持久化或本项目 `thread/attachment/*` 保存路径与官方完全相同。本轮没有官方运行时比较，不新增持久化行为。

当前生产函数 `flushPendingAttachmentSave` 已捕获 thread ID、文字和附件发送快照，却在异步保存完成后清空当前附件数组。保存期间新增附件会被误删；切走后则不清理原 scope 的已发送快照。这违反现有 AD06“操作针对捕获/当前 Composer scope，不影响其他草稿”的合同，以及文字回调已有的“只清理本次发送内容”保护。

| 用例 | 操作 | 修改前定义的预期 |
|---|---|---|
| AS01 | A 发送附件 S；保存待定时加入 N、编辑文字；完成保存 | 只移除原 S，保留 N 和新文字 |
| AS02 | A 发送 S；保存待定时切 B 并加入 N；完成保存 | 原 A 的 S 清理；B 的 N 和文字保持 |
| AS03 | A 发送 S；保存待定时移除 S，再添加同路径新对象；完成保存 | 保留重新添加的草稿，不能只按路径清理 |
| AS04 | 保存期间新增 N，保存失败 | S、N 和文字均保留，错误可见 |

允许修改 `src/App.tsx` 的保存完成清理分支、专项测试与上述测试的现有调用上下文；不改样式、协议、依赖或其他页面。

## 失败复现

新增用例直接执行生产 `flushPendingAttachmentSave` 与 scope setter，控制保存 Promise 完成时点。修改前 `node scripts/verify-composer-attachment-drafts.mjs` 退出码 1：`late save must preserve attachments added while persistence was pending`，actual `[]`、expected `[added]`。这是执行回调的 L2 回归，不能替代原生 UI 或官方对照。

## 实施与验证

- `src/App.tsx`：保存成功后向捕获的 `thread:<id>` scope 应用清理；以发送快照中的对象身份匹配，只移除该次发送的原对象。重新添加同路径是新对象，应保留；不新增状态或 helper。
- `scripts/verify-composer-attachment-drafts.mjs`：执行 AS01–AS04 的生产回调/状态 setter，覆盖新增、切离、同路径重加和失败；退出码 0。
- `scripts/verify-composer-drafts.mjs`：将旧的全清 stub 改为检查原 thread scope 和发送快照，保留既有跨会话文字、附件回归；完整标准检查中通过。
- `pwsh -NoProfile -File scripts/verify-all.ps1`：退出码 0，包含专项、TypeScript、Vite、Cargo check、17 项 `automations` 筛选 Rust 测试及 6 组隔离真实协议探针。该脚本不是全量 Rust 单测或原生/像素验收。Vite 仍报告既有 SettingsView 动静态双重导入和大 chunk 警告；协议脚本仍报告 Node DEP0190 警告。
- `npm run tauri build`：退出码 0，Release、MSI、NSIS 均生成。独立归档 `dist-artifacts/01B-attachment-save-snapshot-20261031/CodexNative.exe`，13,307,392 bytes，SHA-256 `824aafed923cd0325058a1692752a97d5a290b00a87b481be8ee98e65dcabbd1`。
- [构建清单](../../../.ref/parity/01/runs/20261031-codex-01b-attachment-save-snapshot/actual/build-manifest.json)记录 HEAD、dist 及 185 个源码/配置/验证文件哈希；构建前后这些文件哈希一致。源码工作树含此前未提交改动，不把 HEAD 单独当作构建来源证明。
- 没有改动 UI 样式，不生成或沿用视觉评分。原生异步保存竞态仍未验证；后续在当前修复构建上完成附件草稿 Home/A/B 往返与逐项清理，证据见本 run 的 [原生续验记录](../../../.ref/parity/01/runs/20261031-codex-01b-attachment-save-snapshot/verification.md)。官方运行时、重启/多窗口和严格像素仍未验证。

## 当前构建原生续验（2026-10-31）

- 复核已归档 Release 的 SHA-256 与构建输入指纹后，在隔离 `CODEX_HOME` 启动当前构建；未登录、未发送或调用模型。固定首页、fixture A、fixture B 各自的文本附件，往返切换均只恢复对应 scope；随后分别移除三份附件，再返回首页确认首页仍为空。
- 操作截图及窗口 UIA 文本见本 run `actual/native-{home-clean,a-clean,b-clean,home-final-clean}.*`；本轮索引为 `actual/native-verification-events-20261031.json`。fixture 没有单独核对真实 thread ID，因此只称 A/B，不据此推断 thread ID。
- 这是当前构建的**原生 scope 往返与清理**证据；没有执行发送，也没有在保存 Promise 未完成期间操作界面，不能据此宣称 AS01–AS04 异步竞态已通过原生验证。官方运行时、重启/多窗口、富附件类别、焦点细节及严格像素仍未验证。
