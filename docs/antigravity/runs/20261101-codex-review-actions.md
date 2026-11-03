# 14A 本地快捷审查启动与差异范围

日期：2026-11-01。增量自动自验通过，14整页未验收。

## 依据与修改

先完成[启动链路合同及补证](../specs/14-review-start.md)，固定原包与CLI schema证据在`.ref/parity/14/runs/20261101-codex-review-research/reference/`。官方caller默认inline，沿普通turn；分支先解析merge base，新会话带code_review来源。

- `App.tsx`：本地未提交/分支两类从review/start改普通turn/start；同cwd当前聊天默认复用，否则thread/start后首turn。沿现有权限/快速模式，明确collaborationMode null；关注点进入真实文本请求。
- 同步启动锁、项目/页面上下文及导航代次校验；过期结果不再抢占新视图。运行中聊天不被此入口追加成普通输入。进入目标聊天、完成现有历史读取后才提交turn，复用既有通知/审批/停止路径。
- `git.rs/lib.rs`：新增只读git_merge_base，先安全解析commit，再计算HEAD共同祖先；无共同祖先不执行模型。git_diff新增可选reviewBaseCommit以展示同一基准SHA到当前工作区的差异，保留手动分支对比旧语义。
- `CodeReviewView.tsx`：异步分支/提交默认值恢复，按cwd重挂载；分支数据未属于当前项目时禁启动。App Git状态读取按请求/cwd隔离，旧项目结果不回填。
- `DiffDrawer.tsx`：成功审查打开对应working/branch及split面板，清旧文件选择；跨项目清除审查导入的mode/base。后台分支差异包含基准后的提交与工作区改动，不再使用只比较提交的三点范围。

无新增依赖。复用现有协议、会话导航、权限和差异组件；提交/custom原有review/start暂保留，未凭此声称官方四类入口已证明。PR入口的head/base和远端执行仍须后续独立修正。

## 验证

`verify-review-actions.mjs`执行生产callback及effects，RA01先红复现两次thread/start；修改后RA01–09覆盖同步去重/失败重试、真实merge base先决条件、普通turn参数/权限/关注点、默认inline、过期创建/导航、旧commit/custom、异步列表归属与差异目标。selectThread在该脚本中为简化mock，不能证明真实订阅及加载失败路径。

Rust临时Git仓库测试覆盖分叉共同祖先、未知/选项式ref、orphan无共同祖先，以及相同基准SHA下已提交/工作区差异和文件过滤，不修改真实Git配置。所有完整检查及构建结论以[actual证据](../../../.ref/parity/14/runs/20261101-codex-review-actions/actual)为准。

最终完整`verify-all.ps1`退出0，全量Rust为95项通过、0失败，Release/MSI/NSIS构建退出0；八项绑定输入构建前后SHA-256一致。额外执行生产diff effect及React依赖比较，确认同项目同分支换merge base会重新请求新SHA，见`actual/same-branch-refresh.json`。

归档[CodexNative.exe](../../../dist-artifacts/14-review-actions-20261101/CodexNative.exe)，13,962,240 bytes，SHA-256 `8296B6162A3428F6812326EA9F38D78347E3E727CA281C2479F83DD3CA634093`。HEAD、未提交差异摘要、输入与退出码见[build-manifest](../../../.ref/parity/14/runs/20261101-codex-review-actions/actual/build-manifest.json)。以上没有执行真实模型审查，不代表下列未验项通过。

## 未验与限制

- 未运行真实模型审查、官方运行时、当前原生键盘/IME/审批/取消和同条件像素比较；视觉不打分。
- 完整官方guidelines/请求前缀、reviewDelivery持久化设置、named权限profile及新线程响应有效权限尚未完整复刻。
- PR工作台、commit/custom官方入口、分支差异文件列表（当前仍由工作区状态提供）、未跟踪文件完整聚合仍有缺口；Git原生diff SHA本身不包含未跟踪文件。
- 用户在启动途中离开会使后续步骤失效；已创建的空聊天可能保留，已发出的turn不会因此被撤销。启动失败后沿现有toast报告，不宣称自动取消或自动重试。
- 旧CLI字段能力兼容尚未实现；当前schema为0.165.0。无独立lint配置，Vite大chunk警告保留。

页面仍待官方/原生/像素和用户验收，未提交推送。
