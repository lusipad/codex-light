# 01B / A11：本地项目移动合同与执行依赖

日期：2026-11-01。修改前规格。01B 仍开发中，不放行 01C。

本次增量先完成真实移动的后端依赖：目标构造、源文件夹覆盖检查、确认计划校验、workspace stage、真实 membership 写入与失败恢复。菜单和确认弹窗须在这些依赖验证后接入，不能仅改变侧栏分组冒充移动完成。

## 固定参照与证据边界

沿用候选 Windows 官方版本 26.928.21956 / build 12404；本次使用既有只读提取，不修改官方文件。数字均为 0-based UTF-16 字符偏移。

| 文件 | SHA-256 | 检索锚点 |
|---|---|---|
| `.ref/scratch/files/app-initial-fd3c4b862660.js` | `577A50E29502F573E2FBCCF4940B9BD875339DB420D6D5A9798A0D201EE0AFF1` | RA@2267520、uSo@7134714、fSo@7135084、mSo@7136033、_So@7137032、vSo@7142140、xSo@7142792、s0@7143662、DSo@7144625、jSo@7147345 |
| `.ref/scratch/files/app-shared.js` | `89601A70E2C369695B147F7EB24A8AE054CA01AB62425E7B1ED5D8BF22844D17` | EM@1860834、Ezt@2137490、Ean@2930470、Dan@2930639、kan@2930847、Aan@2931096、VRn@3656635、WRn@3657125 |
| `.ref/scratch/files/main-DkWgQSQe.js` | `D33ED281DC58766CBBCCB8E92A7149268A528901DE8858C2D69750D12C6C205B` | project assignment writer@2570875 |
| `.ref/scratch/files/worker.js` | `F8B0CA645B63726993750E08E8FC23A04D815ECA5DE19674F89F8A29ADDEA473` | BEe@1811308、resolve-worktree-for-thread |
| `.ref/parity/01/runs/20261030-codex-01b-pagination/reference/zh-CN-3ed9eb1db28a.js` | `C6AC10A9FB407A393EA002D9AA818A4C7ED0E215E9C8BF0CFE2B798A98E3756F` | 1648571–1649017 |

这些是静态合同。官方运行时、确认弹窗焦点/Escape、物理 IME 和像素对照仍未验证。用户报告 Windows/App 缩放未知；视觉分数保持 null。

## 修改前动作合同

1. 本轮只处理当前本机、真实 server identity 已映射的本地项目实体。远程项目、未知身份、未映射 legacy 组、空 sources 不猜测转换；返回明确不可执行结果，菜单不得提前开放这些分支。
2. 读取真实 `thread/read`、源/目标 `project/read`。若会话为 `notLoaded`，先用 `thread/resume` 恢复可读的 idle 执行上下文；该动作不得启动 model turn，也不得写项目根或 membership。目标身份取自当前 CODEX_HOME 的显式映射，不能按 cwd 猜 projectId。必须拒绝运行中的会话或非 local 环境，避免改变正在执行的轮次。
3. 检查源项目完整 sources 是否被目标 sources 覆盖：等于或目标为祖先才覆盖，`D:/foo` 不覆盖 `D:/foobar`。保留原路径字符串；比较归一化不等于 filesystem realpath。
4. 有 missing sources 时仅 prepare，不写 sources、membership、workspace。确认文案为“将文件夹添加到 {projectName}？”、“{projectName} 中的所有聊天都将获得这些文件夹的访问权限：”，按钮“取消”/“继续”。取消不得写入。
5. commit 必须重读计划相关状态，旧确认不能授权后来新增的路径。确认后先 `project/update` 保存目标原 sources + missing（按归一化去重），写后读回；失败不 stage workspace。
6. 普通目标 cwd 为目标首 source，runtime roots 为全部 sources。可识别的同仓库 owned/managed worktree 可复用并映射目标子路径；仅替换 runtime roots 中最深匹配 source 的槽位，不创建 worktree；canonical projectSources 不替换。
7. stage 新 revision、project 和 pending；applied 保留旧 applied 或运行时 fallback。移到“聊天”则 project=null、pending=null，保留最后 applied/fallback，不能重新生成目录。
8. stage 保存成功后，真实调用 `thread/metadata/update {threadId,projectId}`；移出使用空字符串。写后 `thread/read` 验证。成功才提交本地 membership；不提前宣称侧栏移动成功。
9. 失败 rollback 仅匹配 stage revision；有后来的 revision 则保留。previous 存在且 applied 已变时保留新 applied，按官方规则恢复/清除旧 pending；previous 为 null 时回到 null。已经成功追加的项目 sources 不因后续 membership 失败撤回。
10. RPC 错误可能表示响应丢失，不能据 Err 盲目回滚。用 readback 确认：目标已生效则完成；原值未变则 rollback；读回失败或第三种归属则保留持久化恢复记录并阻断发送。下次可读时再恢复，不自动重复写请求。
11. 本机进程内，移动与该会话的发送互斥；不同会话不互相阻塞。原子替换本地状态文件，失败不发布未保存的内存结果。服务与本地 JSON 不是跨系统原子事务，不作这种声明；跨进程修改仍须单独验证。

## 修改前回归与验收预期

| ID | 操作 | 预期证据 |
|---|---|---|
| PM01 | Windows 大小写/分隔符、祖先/同级前缀、多 sources | 完整 missing 列表，保留输入字符串，取消零写入 |
| PM02 | 普通多根目标/嵌套 root 的 worktree | 首 source cwd；只替换最深匹配槽；不创建 worktree |
| PM03 | 移到“聊天”，applied/pending 同时存在 | 清 project/pending，保留 applied；冷恢复仍使用其 cwd |
| PM04 | 失败 stage rollback、新 revision、并发 applied | 条件回滚不覆盖新 revision，applied/pending 符合官方规则 |
| PM05 | prepare 后源/目标/映射/workspace 改变 | 旧确认拒绝，不触发 project/update 或 membership 写 |
| PM06 | sources 更新失败/读回不一致 | 不 stage、不写 membership |
| PM07 | membership 成功/明确拒绝/响应丢失但写入成功 | 真实请求形状；读回决定提交/回滚，不自动重发 |
| PM08 | membership 响应及读回均失败，随后恢复 | 留下磁盘恢复记录，发送被阻断；恢复后再决定提交/回滚 |
| PM09 | 本地 stage/最终保存失败 | 不发布未保存内存；已成功的服务写不报告为未发生 |
| PM10 | 相同 thread 移动与 turn 并发，不同 thread | 同会话互斥，不跨会话污染，不增加 model turn |
| PM11 | 隔离 app-server 真实多根更新、归属读回、重启 | 无凭证/零模型 turn；真实 CLI 日志及退出码 |
| PM12 | 检查/构建 | 相关 Rust 回归、完整标准检查、当前源码 Release 指纹 |

允许修改：`src-tauri/src/{state,thread_workspace,git,lib}.rs`，必要时新增同职责移动模块及协议探针；`scripts/verify-all.ps1`；本轮规格/证据与实施日志。前端菜单本轮不提前接线，避免把尚未验证的事务暴露为完成动作。

## 当前状态

G1 静态调研完成，G2 修改前规格已记录。PM01–PM04 四组工作区合同测试通过，`thread_workspace::tests` 17/17；修正后的隔离 Git worktree 测试 7/7。真实 app-server 0.159.2 隔离探针证明：预检查/取消不写入；project/update 后 roots 写入可读回；membership 拒绝不回滚先前 roots；membership 变化不改变现有 cwd；重启后 roots/assignment 持久，清除 assignment 保留 cwd。全程零模型 turn。

新增真实 RPC 只读 `thread_project_move_prepare(threadId,targetProjectId?)`：检查 live thread id、idle/local 环境、当前 CODEX_HOME 的显式 local project 映射和 source/target `project/read` roots；返回缺失 sources、fallback、目标 workspace、可复用 worktree 与 `writesPerformed:false`、`commitAvailable:false`。五项 prepare 测试覆盖只读、未知/未映射目标、Chats applied 保留、membership override、运行/remote/陈旧 roots 和读取中状态变化。完整 `pwsh -NoProfile -File scripts/verify-all.ps1` 退出码 0，含 TypeScript、Vite、Rust 检查、相关 Rust 过滤测试与所有隔离协议探针；输出见 `actual/verify-all.log`。`git diff --check` 通过。

本轮后端事务现已实现 `project/update` roots 扩展、workspace stage、membership 写入及写后读回；读回不确定时保存恢复记录并阻止发送，reconcile 根据真实归属提交或回滚。新加入旧版不完整 `applied` 快照回归：项目移动时仅复用可反序列化的完整快照，否则使用 live thread fallback。另覆盖移动到 Chats 清除 membership/pending 并保留 applied，以及同会话移动锁阻止并发 turn。`cargo test --manifest-path src-tauri/Cargo.toml --lib project_move` 15/15 通过；隔离 app-server 根路径协议探针通过，零模型 turn；完整 `pwsh -NoProfile -File scripts/verify-all.ps1` 退出码 0，Rust workspace/project-move 分组及 TypeScript/Vite/所有既有隔离协议探针通过。

当前会话操作菜单已接入已映射本地项目/Chats 目标；缺失 sources 时展示确认框，取消不调用 commit，确认通过事务命令执行并更新 sidebar membership。`npm run tauri build` 成功，产物 `C:\Users\lus\.cargo-target\codex-desktop-native\release\codex-tauri.exe` 为 14,028,800 bytes，SHA-256 `15D69A82AAD47C9AA849020ECBE39AEDDA8B909052B679F3BC1C52A6F0D73505`。此 UI 路径尚无真实 Tauri UI 自动化或最终 Release 原生交互回归，也未验证官方运行时入口是否与当前 header 菜单一致。App 缩放及同条件像素仍未验证，视觉分数为 null。保持 01B 开发中，不放行 01C。下一步为菜单/确认/取消建立真实原生操作与恢复验收，再对照官方运行时入口和同条件视觉基准。

## 2026-11-01 原生观察与入口修正范围

以本轮 Release 窗口观察隔离项目移动 fixture：侧栏行的“更多操作”菜单显示重命名、置顶、移至分区、归档和永久删除；没有“移至项目”。正文选择该 fixture 后停在“正在加载会话…”，故不能由此验证 header 菜单或移动事务。本次将 A11 已有静态动作合同落实到可访问的侧栏行入口：对可映射的本地项目会话提供“移至项目”子菜单，目标为已映射本地项目及“聊天”；复用既有移动事务，保留 sources 扩展确认、取消零写入、写后读回和侧栏刷新。非本地/未映射会话不显示该入口。完成代码后需在修订版 Release 原生验收子菜单、目标切换、取消与确认；当前截图仅作为修改前缺口证据。

本轮缺陷证据：恢复未知 membership 后，下一次发送曾因历史 `applied` 只有 `cwd` 而返回“会话的待迁移工作区无效”。根因是项目迁移暂存逻辑保留了无法反序列化为完整 `WorkspaceSnapshot` 的旧值；修复后 15 项移动合同回归通过。

本轮原生复测缺陷：release 侧栏菜单能够显示项目目标，但对冷的 `notLoaded` 会话调用 prepare 时被 app-server 正确拒绝。已据已有 `thread-workspace-resume` 真实协议证据修正：prepare 先以无 turn 的 `thread/resume` 恢复 idle 工作区，再校验 local 环境和实际 roots；回归断言 prepare 没有 project/membership/state 写入。以修订 Release 完成取消/确认和持久化读回复测后，才更新验收结论。

操作偏差记录：执行 `cargo fmt --manifest-path src-tauri/Cargo.toml -- src/git.rs` 时 Cargo 将参数解释为 crate 格式化，错误地对多个既有 Rust 源文件格式化。最初未跟踪的 clean modules 已通过逐文件与 HEAD `rustfmt --emit stdout` 比对确认仅格式差异后恢复，并将被格式化版本留在 `actual/formatting-recovery/`。此前已有未提交修改的 `state.rs`、`lib.rs` 无本轮前源码副本，保留全部内容及本轮变更；故其 diff 含有额外格式变化，无法安全还原原排版。后续禁止再对整个 crate 执行格式化；当前验证通过但 review diff 会比语义改动更大。

## 2026-11-01 原生确认与读回续验

原生菜单首次点击暴露前后端 ID 合同错误：前端发送映射后的 app-server project ID，后端只按本地路径 ID 解析。后端现按当前 CODEX_HOME 的显式映射先解析 server ID，同时保留已有 legacy ID 兼容；新增回归覆盖两种合法 ID 与未映射 ID。项目根的原生预检也发现测试 fixture 的本地 roots 与 `project/read` 不一致，按既有本地映射修正隔离 fixture 后再测，没有放宽产品校验。

修订 Release 原生实际操作 A11：

1. 对冷会话执行“移至项目”后出现“将文件夹添加到目标项目？”确认框，列表仅含缺失的源文件夹。
2. 选择“取消”后只读检查：会话 membership 仍为源 project ID、目标 roots 不变、本地 workspace 移动状态为空。
3. 重复操作并选择“继续”后：侧栏会话进入目标项目；SQLite `threads.project_id` 读回目标 ID；目标 `project_roots` 同时包含原目标 root 与新加 source root；本地 workspace 状态写入对应 applied/pending 快照。
4. 全流程使用无凭证隔离 CODEX_HOME，未发送模型 turn。构建为 14,032,384 bytes，SHA-256 `A780F053A8E8E39BECBB6437A59CF12130AF0E977CB36E4B663F090FE6947285`。

Rust `project_move_prepare` 测试 13/13 通过；完整 `pwsh -NoProfile -File scripts/verify-all.ps1` 退出码 0，包含项目移动 Rust 合同 27/27 及隔离协议探针。结构化记录与准确的读回值见 [native-confirmation-verification.json](../../../.ref/parity/01/runs/20261101-codex-01b-project-move/actual/native-confirmation-verification.json)。

仍未完成：同版本官方 App 对该入口的运行时对照、确认框 Escape/焦点返回、App 缩放及配对像素比较、01B 其他未结项与用户验收。01B 保持开发中，不放行 01C。
