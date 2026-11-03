# 01F 首页发送与错误恢复增量

状态：发送增量自验中；前序与本单元均未用户验收。继续开发的授权不代表整页通过。

## 关键决策

- 同一导航请求身份的 `thread/start` / `turn/start` 等待期间只接受一次发送；请求结束释放保护，实际运行中的 `turn/steer` 保留原有语义。信心高：React 状态提交前，同一回调能够被连续调用；用生产回调挂起请求验证。官方双击精确表现仍待运行时采证。
- Worktree 创建失败停止本次发送，不偷偷使用原项目目录。信心高：官方静态前置校验会抛错；若后续官方实测提供其他明确恢复流程，再单独修订。

## 假设与证据

- 固定候选官方版本沿用 26.928.21956 / build 12404，缩放未知；不据此宣称视觉一致。
- `.ref/scratch/files/app-initial-fd3c4b862660.js`，SHA-256 `577A50E29502F573E2FBCCF4940B9BD875339DB420D6D5A9798A0D201EE0AFF1`：0-based UTF-16 offset 9294756 先 `await TUs(...)` 再进入 Worktree 排队；`TUs` 对非 Git 项目、起始引用不存在、创建分支失败抛错。保留失败即停止的语义，适配为现有 Tauri 创建调用；不复制官方代码。
- HOME-SPEC A28/A30：错误不能伪装成功，草稿保留，单次操作的投递次数与身份需验证。
- 当前源码已有文本/附件移交、失败保留和独立 steer 在途保护；复用，不重写。
- 连接初始化当前依赖真实 `app_server_connect` 与 status 事件；连接恢复 UI、事件时序、官方首屏过渡动画仍需取证，本轮不推断动画参数。

## 偏离规则

只改发送入口的并发保护和 Worktree 错误传播；新增异常则保持草稿、显式失败，不自动重发、不改变执行目录。真实调用、原生键鼠、官方截图缺失时标未验证。不得新增依赖或改变权限映射。

## 实施与验证计划

1. 挂起真实生产回调内的请求，先复现重复发送与错误目录续发。
2. 复用导航身份和 ref，增加在途集合，finally 释放；Worktree 失败交给原有失败处理。
3. 回归初次创建/已建会话等待、失败重试、导航身份隔离、文本/附件与项目上下文；执行完整标准检查。

| 用例 | 操作 | 预期 |
|---|---|---|
| FT01 | 首页首次创建挂起，连续发送 | 1 个 thread/start，1 个乐观用户轮次，释放后仅 1 个 turn/start |
| FT02 | 新会话已创建但 turn/start 挂起，再次发送 | 不启动第二个 turn/start 或提前 steer |
| FT03 | thread/start 失败，再次手动发送 | 草稿保留，保护释放，可正常重试 |
| FT04 | Worktree 创建拒绝或缺少返回路径 | 不调用 thread/start/turn/start，错误可见，草稿保留 |
| FT05 | 旧请求等待时切换导航身份并发送 | 新身份不被旧锁阻塞，旧 finally 不释放新身份保护，旧失败不清理新身份附件记录 |
| FT06 | 已有会话空闲发送，turn/start 挂起并重复触发 | 仅一次 turn/start，结束后可继续发送 |

## 实施记录

- 修改前 FT01 失败：期望 1 个 `thread/start`，实际 2 个；补充 FT05 后再次复现旧失败将新会话的 `pendingAttachmentSaveRef` 清成 null。
- `src/App.tsx` 使用 `Set<number>` 按现有导航请求代次阻止 start 在途重入，并在 finally 释放；保护也覆盖已创建身份但 `turn/start` 尚未确认的阶段，保留原有 steer 分支。
- 删除 Worktree 创建失败后继续执行的内层 catch，缺少返回路径同样作为错误交给原有失败显示。未增加自动重试、协议字段、权限或目录降级。
- 旧请求 catch 先校验导航身份，再清理待保存附件；避免跨会话破坏正在发送的附件快照。
- FT01–FT06 执行实际生产回调，修复后退出 0；项目上下文、Composer 文本/附件草稿、发送按键专项与 TypeScript 检查退出 0。脚本已接入完整标准入口。
- 新回归的请求由受控 fixture 挂起/拒绝，不调用模型、不真实创建 Worktree；它证明客户端在途与失败处理，不是官方实测或真实服务集成结论。
- 原生发送、连接恢复 UI/首次加载时序、官方 Worktree 异步排队完整表现、物理 IME、动画、像素及用户验收仍未验证。后续进入 02 会话页；这些欠项保留，不以新页面开发替代本页验收。
- 补充 FT05 后完整 `pwsh -NoProfile -File scripts/verify-all.ps1` 重跑退出 0，包含 8 组隔离协议探针和脚本配置的过滤 Rust 测试，不是全量 Rust 单测或原生 UI 测试；独立 lint 未配置。既有 Vite chunk 大小和 DEP0190 提示仍在，没有吞掉失败。
- `npm run tauri build` 退出 0，Release/MSI/NSIS 均产出；归档 [CodexNative.exe](../../../dist-artifacts/01F-send-transition-20261101/CodexNative.exe)，14,033,920 bytes，SHA-256 `EAC0564230A6F25E012D565E5CA7276FFE16B3C5270BCC45F7CDA1848E3AA27F`。
- [构建清单](../../../.ref/parity/01/runs/20261101-codex-01f-send-transition/actual/build-manifest.json)、[专项输出](../../../.ref/parity/01/runs/20261101-codex-01f-send-transition/actual/send-transition.log)、[完整检查](../../../.ref/parity/01/runs/20261101-codex-01f-send-transition/actual/verify-all.log)、[构建输出](../../../.ref/parity/01/runs/20261101-codex-01f-send-transition/actual/tauri-build.log)已保存。清单记录父提交及 dirty 摘要，4 项本轮输入检查前后哈希一致。新 EXE 未执行原生交互，未提交/推送。
