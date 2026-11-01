# 01B：恢复后的新聊天项目上下文

日期：2026-10-31。状态：本增量自验完成，待用户验收；01B 整体仍开发中，不进入 01C。

## 官方依据与缺口

固定官方文件哈希沿用上一轮并需在本轮重核：

- `.ref/scratch/app-shared-a906948d8868.js`：`1ffb0654bdfcba23be50c06c8698e665bdb17330d923758001d01262aa81cb5b`。
  - `3441113` 起的 `_K`：`hK` 在没有临时覆盖时读取 SELECTED_PROJECT；`dK` 从 LOCAL_PROJECTS 的选中实体派生 rootPaths[0]；`twn` 派生完整 rootPaths。数字为 0-based UTF-16 偏移。
- `.ref/scratch/files/app-initial-fd3c4b862660.js`：`577a50e29502f573e2fbccf4940b9bd875339db420d6d5a9798a0d201ee0aff1`。
  - `4148418` 的 xU：未显式传 activeProject 时不覆盖项目选择；显式传入时经 TM 更新选择。

本项目当前只有点击实体＋才设置 pendingNewThreadProjectRef；重启/普通新聊天后 ref 为空，虽然 membership.selectedProjectId 已恢复，发送和首次目标创建仍可能只按 legacy 活动目录创建无项目会话。这是当前源码缺口，不是官方运行时实测结论。

## 修改前合同

1. 新会话：显式 pending 项目优先；否则从所选实体 ID 恢复项目，不按相同 root 猜测实体。
2. 本项目仍有 legacy 目录选择器：只有所选实体首 root 与当前活动目录一致时才恢复其上下文；切到其他目录不套用旧项目。该路径保护是本项目兼容适配，不宣称是官方相同内部机制。
3. 新会话首次发送和首次设定目标都传 canonical serverProjectId 与完整 runtimeWorkspaceRoots；多根顺序保持不变，缺少显式映射拒绝伪造项目身份。
4. 已有会话不读取首页 selected-project，也不把首页项目首 root 带入 turn；依赖既有会话上下文。
5. 显式目标首次创建后，不因 React 状态尚未提交再次创建第二条会话；测试实际目标→发送回调时检查此风险，必要时仅修正即时 thread ref 的使用。
6. 隔离真实 CLI 只创建/读取项目与会话，不执行 turn/start 或付费生成；生产发送回调在 turn/start 边界受控停止。为空会话补充明确离线测试历史以验证实际持久化，重启后 resume/read 检查根列表。不能把此验证称为模型发送成功或官方原生对照。

## 验收

| ID | 操作 | 预期 |
|---|---|---|
| PC01 | 无 pending，恢复选中多根实体后发送 | thread/start 带正确 server ID、首 root、完整 roots |
| PC02 | 同 root 两实体、selected 指向第二个 | 按 ID 选择，不取数组第一个 |
| PC03 | 显式＋上下文与 persisted 不同 | 显式上下文优先 |
| PC04 | legacy 活动目录不同、无选择或失效选择 | 沿用 legacy；不猜实体 |
| PC05 | 选中实体无 server 映射 | 保留输入、提示错误，不创建伪归属会话 |
| PC06 | 已有会话且首页另选项目 | 不创建新会话，不带入首页项目 roots |
| PC07 | 恢复项目后首次设定目标 | 同一正确项目会话创建一次，goal 与后续触发使用同一 ID |
| PC08 | 真实隔离 CLI 读回恢复产生的请求 | thread projectId/cwd 正确，runtime roots 有服务响应证据；无模型 turn 请求 |

## 未知与边界

官方 Windows/App 缩放、语言、主题未知，像素不能判定。本轮不修改界面样式，不实现项目创建/删除 UI。原生窗口无认证合成数据不能证明服务端身份；真实协议使用独立 CODEX_HOME，不读取/复制用户认证。

## 实现与简化

- `sidebarProjects.ts` 增加小型 `resolveNewThreadProject`，发送与首次目标创建共用。显式草稿优先，其次从 selectedProjectId 找实体；所选首 root 与 legacy 活动目录不一致时不套用旧项目。
- `App.tsx` 的新聊天发送/目标创建接入上述解析；已有会话以即时 ref 判定，防止首页项目污染。
- 首次目标创建立即设置 activeThreadIdRef，发送也以它决定是否创建新会话，避免 React 还没提交状态时第二次 thread/start。没有扩大修改其他会话导航或样式。
- 没有新增依赖、后端命令、归属补写或界面控件。

## 验证结果与证据边界

证据目录：`.ref/parity/01/runs/20261031-codex-01b-project-context/`。

- `before.log`：实际生产发送回调在改动前退出 1，冷启动 selected 实体的 projectId 丢失（undefined，而不是 server-multi）。
- `scripts/verify-new-thread-project-context.mjs`：退出 0，执行实际发送与目标回调，覆盖 PC01–PC07。`actual/mutation-checks.json` 将 persisted fallback 移除、或恢复使用旧 React thread ID 时分别失败，均为内存反证，没有改写产品文件。
- `verify-all.log`：完整标准退出 0，包含新增专项和 6 个协议探针；给整个标准检查也传独立 CODEX_HOME，覆盖早期探针没有自行隔离的情况。Rust 全量另跑，`cargo-test.log` 为 39 项通过、退出 0；没有独立 lint 配置。
- `actual/protocol-failure.json`：首轮真实请求返回正确项目和 roots，但空会话立即 read 的 projectId 为 null，原断言失败。未删除失败记录。
- `actual/readback-diagnosis.json`：未持久化空会话在服务退出后无法再读，metadata/update 也报无 rollout；这是空会话状态边界，不能据此增加伪历史或生产补写来绕过。
- `actual/callback-protocol.json`：新隔离 home 重跑；生产回调实际 thread/start 请求送入真实 CLI，服务响应返回正确 projectId、cwd、顶层 runtimeWorkspaceRoots 及 thread.environments；在 turn/start 边界停止。研究探针另以 thread/inject_items 加入一条明确标记的离线语料，随后 read 返回正确项目和完整两根。测试语料不进入产品行为。
- `actual/restart-readback.json`：持久化后重启，projectId 正确；未加载时 environments 为 null，因此此时不能断言 roots 丢失或完整。
- `actual/resume-readback.json`：同一隔离 home 再次启动后，thread/resume 与随后 read 均返回正确项目和两个原顺序 roots。没有实际 turn 请求或 turn/started。
- 原生 `actual/native-verification.json`：最新构建启动、app-server 已连接、恢复项目行可见，普通“新聊天”保留磁盘 selected ID 和两根。新建后的真实模型发送未从 GUI 执行，功能发送边界证据来自上述实际回调→真实 CLI 探针，不能合称原生全链路通过。原生测试的独立 home 只有项目元数据，不拥有协议探针 home 的项目。
- 原生工具第一次点击几何信息不可用，重新定位/激活并观察截图后成功；测试结束 UI 关闭被任务视图遮挡，核对本轮启动的 PID 与 EXE 路径后仅终止该隔离测试进程。原生业务验证已在结束前保存。
- `build.log`：Tauri release 退出 0，115 个输入哈希及产物身份见 build-identity.json。现有 chunk 大小建议警告仍存在。

## 交付

- 构建：`dist-artifacts/01B-project-context-20261031/CodexNative.exe`。
- 大小：13,254,656 字节。
- SHA-256：`8333092273E42CE77142ADDC4CA1E8BDC6D13E35FA7A497554BE610FA96D6230`。
- PC01–PC07 为 L2 自验，PC08 为真实 CLI 创建/持久化/重启恢复自验；原生 GUI 仅启动/入口冒烟。
- 官方视觉、物理输入法、GUI 首次模型发送及用户验收均未通过。01B 剩余验收按 [当前清单](../acceptance/01B-remaining.md) 推进。
- 未提交、未推送；没有将局部通过改写为整页完成。
