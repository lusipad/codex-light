# 01B：项目内新聊天与 `selected-project` 持久化

2026-10-31。本轮只覆盖 01B 项目内新聊天的选择保存小单元，整页仍未验收。

## 范围与修改前合同

- 项目行普通点击及 Enter/Space **只展开/收起**。不得选择实体或切换工作区。
- 点击项目“＋”独立调用项目内新聊天：先保存旧会话附件，再保存有效项目选择，成功后进入新草稿。
- 保存失败显示错误并保留当前会话和附件；无效/未知实体不修改内存状态。
- canonical 项目以实体 ID 选择；同 root 不同 ID 不合并，多 root 保留完整新建上下文。
- legacy 目录没有 canonical 实体时沿用既有目录切换逻辑。

## 官方静态证据

以下数字均为 0-based UTF-16 字符偏移。静态证据不能证明 Windows 原生时序。

1. `.ref/scratch/files/app-initial-fd3c4b862660.js`
   - SHA-256：`577A50E29502F573E2FBCCF4940B9BD875339DB420D6D5A9798A0D201EE0AFF1`
   - `8476544`：Pos → qas 传 `projectRowBehavior:"expand"`。
   - `8434909` 的 cos、`8439083` 附近 Je → ODe：普通行点击切换展开；`open-project-page` 是另一分支。
   - `8459095` 的 xos：plus 使用独立 `onStartNewThread`。
   - `8397488` 的 Yis → `8070308` 的 j4o：本地项目以 activeProject 传入 xU。
   - `4148418` 的 xU：导航/新草稿适用 home 路径调用 TM。
   - `2406427` 的 TM：更新临时状态与 selected project query，调用 `Ni(scope,Mg.SELECTED_PROJECT,n)` 持久化。
   - `8598741` 的 pe 仅设置 `{projectId,root}` 临时 atom；`8603433` 的 workspace added listener 不能单独证明保存。
2. `.ref/scratch/app-shared-a906948d8868.js`
   - SHA-256：`1FFB0654BDFCBA23BE50C06C8698E665BDB17330D923758001D01262AA81CB5B`
   - `1810880`：key 表含 `selected-project`、`local-projects` 等。
   - `7660749` export `XCn as DTt`、`3441113` 的 XCn：只清/改临时 atom，不是持久化。
   - 后续 _K 从 LOCAL_PROJECTS 派生首 root 和完整 rootPaths。
3. `.ref/scratch/main-DkWgQSQe.js`
   - SHA-256：`D33ED281DC58766CBBCCB8E92A7149268A528901DE8858C2D69750D12C6C205B`
   - `64134` 的 mi：写 SELECTED_PROJECT。
   - `2608713` 的 createOrSelectLocalProjects：选择 `{type:"local",projectId:n.id}` 并广播。
   - `2012143`：文件夹入口创建/选择后发送带 projectId/selectedProjectId 的事件，再导航 `/`。

本轮曾提出“项目行选择并展开”的假设，重新追踪后发现与上述 expand 分支及 [既有合同](20261029-codex-01b-sidebar.md) 冲突，已在交付前撤回。当前合同以行仅展开、plus 选择为准。

## 实现边界

- 后端 `workspace_select_project` 校验实体，更新嵌套 `electron-persisted-atom-state["selected-project"]`，保存成功后发布内存并返回 workspaces/membership。
- 本项目为兼容既有目录 context，将首 root 放入 `active-workspace-roots` 和已保存目录列表。这是本项目适配，不能据此声称官方写入同样的 legacy 字段。
- App 统一等待选择成功后发布快照、清空旧会话并进入首页；Sidebar plus 不再另发工作区写请求。
- 导航 generation 防止晚到响应覆盖更新的视图；已经成功的磁盘选择不会因之后导航自动回滚。
- 不覆盖进程崩溃/断电时文件替换的原子性保证，不宣称实现了跨窗口事件广播。

## 验收用例

| ID | 操作 | 预期 |
|---|---|---|
| PS-00 | 点击项目行及 Enter/Space | 只展开/收起；selected project 和活动 root 不变 |
| PS-01 | 点击有效单根实体的＋ | 附件保存后保存选择；磁盘读回对应实体，进入新草稿 |
| PS-02 | 点击多根实体的＋ | 选择实体 ID、活动目录为首 root；完整 rootPaths 保留用于真实 thread/start |
| PS-03 | 同 root 不同实体依次点＋ | selected project 分别为对应 ID，不合并实体 |
| PS-04 | 空/未知/损坏实体调用选择 | 返回失败；原内存状态、assignment、projectless 不变 |
| PS-05 | 同隔离 CODEX_HOME 重启 | 重新读取后仍是所选实体，多 root 不丢失 |
| PS-06 | 附件保存失败或选择文件 IO 失败 | 不清空当前会话/附件，不进入新草稿；显示错误 |
| PS-07 | 等待保存期间导航或重复点击 | 晚到结果不清空新视图，不覆盖较新项目上下文 |

## 验证与未测项

- `node scripts/verify-sidebar-project-selection.mjs`：退出 0，实际生产回调 VM 覆盖等待保存、IO 失败、附件失败、导航过期、重复选择、多 root 上下文与 legacy 回退。Sidebar 组件、local-projects 和 workspace-identity 回归也退出 0。
- `npx tsc --noEmit`：退出 0；`cargo test --manifest-path src-tauri/Cargo.toml`：退出 0，39 项通过。新增 Rust 用例从临时磁盘重读完整 JSON，并用目录作为写入目标验证失败时不发布内存。
- `pwsh -NoProfile -File scripts/verify-all.ps1`：退出 0，含 6 个隔离协议探针。标准脚本的 Rust 部分仍为 automations 过滤；全量 Rust 结果来自上面的独立命令。没有配置独立 lint，未声称 lint 通过。
- `npm run tauri build`：退出 0。Vite 仍提示现有 chunk 体积超过建议值，未改变打包策略。
- 本轮新专项测试最初仍检查已撤回的 `onSelectProject` 行选择假设，随后重写为实际回调执行；测试异步等待不足曾导致“晚到拒绝”未被接住，已改成明确等到 RPC 被调用后再注入。未将这些测试问题当作产品缺陷复现证据。
- 隔离原生窗口 PS-00/02/03/05：点击 A 行后磁盘仍选中 B；A 的＋写入 multi；同 root 的 B 的＋写入 same；再次选 A、关闭重启后高亮与磁盘均为 multi，两个 root 保留，A 展开/B 收起也恢复。第一次 UI 点击报 `coordinate input geometry is unavailable`，重新定位唯一自建窗口、激活并重新观察后重试成功。
- 失败、无效 ID、乱序仅由 Rust/生产回调 L2 证明；原生没有注入这些故障。重启后首次真实发送的项目上下文没有在本轮验证。
- 官方 DPI、应用缩放、语言、主题未知，无同条件官方截图，像素和官方运行时对照均未通过。
- 隔离原生测试仅准备草稿，不发送模型任务；合成 metadata 的 server ID 不证明真实服务端项目有效。
- 未实现本轮以外的项目创建/重命名/删除及完整项目中心。
- 状态：本增量自验完成、待用户验收；01B 整体继续开发中，不放行 01C，不标记用户已验收。

## 构建与证据

- 产物：`dist-artifacts/01B-project-selection-20261031/CodexNative.exe`
- 大小：13,254,656 字节。
- SHA-256：`852A7BE9AFC8ED46CE0501F5BC52F749947475B6372E2F847DEC252365296078`。
- 证据目录：`.ref/parity/01/runs/20261031-codex-01b-project-selection/`
  - `reference-excerpts.json`：3 个官方资源哈希及定位片段。
  - `build-identity.json`：源码 HEAD、未提交清单、构建输入文件哈希及 EXE 身份。
  - `verify-all.log`、`cargo-test.log`、`build.log`：检查原始输出。
  - `actual/native-verification.json`：原生 UIA 观察、操作与结果。
  - `actual/after-disclosure.json`、`after-multi-plus.json`、`after-same-plus.json`、`before-restart.json`、`after-restart.json`：隔离合成状态的真实磁盘读回。
- 使用独立 CODEX_HOME/WebView profile；server 项目 ID 明确为合成 metadata，没有发送模型任务。完整协议探针的真实服务边界不等于上述合成项目已通过 thread/start。
- 未提交、未推送；没有新增依赖或修改 CSS。简化为 App 一个选择入口，删除 Sidebar 对工作区的重复调用及不再使用的 prop。
