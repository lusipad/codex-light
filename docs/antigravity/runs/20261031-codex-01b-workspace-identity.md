# 01B：既有工作区行的显式 server 项目身份

2026-10-31，修改前合同。01B仍开发中，本轮接入身份读取及现有行归属，不声称完成local-projects实体视图。

## 官方依据与范围

main SHA d33ed281dc58766cbbccb8e92a7149268a528901de8858c2d69750d12c6c205b。initializeProjects2590833按`hostId:codexHome`读取`app-server-project-id-by-legacy-project-id-by-host`，storeProject2593823维护显式双向身份，禁止按roots猜测UUID。ci63317和fi638xx显示local-projects实体与其目录投影独立：目录去重不能用于合并项目身份。initial Kkn2284700有明确assignment时优先，项目less与客户端workspace state另有来源。以下定位均0-based UTF-16。

现有Rust工作区行id为规范化路径。本轮只接受迁移表中与该id完全相等的key；不是从相同roots反推legacy实体id。当前`getThreadWorkspace`对所有线程均按cwd first-find，无视已存在的canonical projectId，会把明确归属B的线程错放A。

## 实施合同

1. workspace_list为现有行增加可空serverProjectId，来自当前`local:<CODEX_HOME>`下该行legacy id的显式映射；远程/其他home映射不得串用；读取不写任何迁移表、不自动导入项目。
2. 非null thread.projectId只匹配显式serverProjectId，不再退回cwd/hint。未知项目的聊天不伪造项目，保留在Recent；null/省略仍按既有legacy路径回退，不能自动等同显式projectless。
3. 成功新建/派生通知携带服务实际返回projectId，手动排序的显式新项只前置到正确组，不能因响应cwd相同而污染另一个组。
4. project/changed重新读取工作区身份；重复异步刷新按generation拒绝旧结果。已有成员归属通知仍用上一轮回归保护。
5. 实际组件、Rust只读身份查找先失败后通过；验证不同home/主机、无映射/损坏数据、明确归属与cwd冲突、未知项目、null legacy、手动新项、binding切换及乱序。完整标准、相关Rust测试、release与隔离原生数据对照。

本轮不把路径行改装成多root实体，不强行合并同roots项目，不写官方配置、不加依赖或CSS。local-projects完整实体/客户端workspace-state/projectless、新建时项目选择及真实canonical项目列表仍是后续必需项，01B不因此完成。

## 实施结果

- `src-tauri/src/state.rs`：既有WorkspaceRootItem增加serverProjectId，lookup仅精确读取当前local:home和legacy id；纯读取不导入/改写映射。两个Rust测试覆盖home/主机/ID隔离、缺失、错误类型和空值。
- `src/types.ts`、`CodexSidebar.tsx`：显式canonical projectId只匹配serverProjectId；未知成员保留Recent，null/缺失保留既有legacy回退。没有新增占位项目或CSS。
- `src/App.tsx`：成功创建/派生的5处sidebar通知携带服务响应thread.projectId，避免手动前置写错组；project/changed重读工作区身份。workspace/meta读取用generation隔离晚到快照，失败保留已有数据。创建/派生的实际服务调用未在原生本轮执行，不能由字段透传宣称其完整生命周期通过。
- 回归复用实际Sidebar组件与AST提取的App回调；新刷新回归接入标准入口。无新依赖、无新配置写入或路由。

证据根目录`.ref/parity/01/runs/20261031-codex-01b-workspace-identity/`，官方main定位和SHA见`reference/static-evidence.json`。

| 检查 | 结果与证据 |
|---|---|
| Sidebar反证/修复 | `cases/sidebar-before.log`退出1，明确server-B与unknown被放进cwd的A；after退出0。覆盖冲突cwd、未知成员可发现、binding切换、无映射/null回退、manual新项 |
| Rust前置/全量 | `rust-before.log`退出101是新helper尚未实现的编译错误，不冒充业务断言反证。实现后`rust-after.log`全量cargo test退出0，32 passed、0 filtered，另binary/doctests均0；不同于标准脚本的automations过滤 |
| 读取乱序 | `refresh-before.log`执行上轮归档的实际App回调，退出1，stale-server覆盖new-server；未回滚真实产品源码。`refresh.log`退出0。最初测试桩靠microtask次数进入metadata阶段导致未完成await，记录在refresh-harness-before.log；改为显式请求进入信号后验证，不用计时或吞错 |
| 通知回归 | `notification.log`退出0，包括project/changed确实重读workspace身份，并保留上轮归属通知/旧列表保护 |
| 完整标准 | `verify-all.log`退出0（非Fast），含TS、前端构建、cargo check、过滤Rust和真实协议探针。无独立lint配置不报通过；隔离CODEX_HOME和API keys |
| release身份 | `release.log`退出0；115输入、5dist、4检查脚本归档并在构建后重核，见build-inputs/source/frontend-dist/checks/build.json |

## 当前原生旧/新对照

专用native-home仅复制既有明确离线回放sessions，由真实CLI索引。创建三个真实测试项目，把同cwd的三条历史分别分配A/B/C，命名IDENTITY-A/B/UNMAPPED；项目A/B的roots在独立测试目录，与cwd不同。专用全局状态只在本轮隔离home中记录A/B当前local:home显式映射，另有其他home将A误指C的干扰项。没有turn/*调用、没有模型生成、未复制认证或真实配置。native-setup.json记录真实请求/响应，exit[0,null]。

- 旧EXE（前轮membership-refresh，SHA576fa0ad…）在相同数据上把A/B/UNMAPPED都放进Legacy；取消Recent项目包含后，Recent空。`actual/old-default`和`old-projects-off`。
- 当前EXE复用完全相同home/profile，A组只显示IDENTITY-A、B组只显示IDENTITY-B；Legacy保留5条初始未分配历史；Recent只保留IDENTITY-UNMAPPED。其他home干扰未串入。`actual/new-projects-off.jpg/.txt`。
- 对保存的UIA以项目行/Recent边界作独立断言，结果在`actual/native-verification.json`，并核对迁移表值保持原样。截图为JPEG功能证据，不是官方同条件无损像素通过。先定向Raise核对目标再操作，两个测试进程均正常退出。

当前构建`dist-artifacts/01B-workspace-identity-20261031/CodexNative.exe`，SHA-256 `bbbf6119fce542e733828dd729bc2082b462a22a3c94802c1e23fdd861c34674`，13,277,184字节；基于HEAD380c32c7及归档未提交工作树，不把整份dirty diff归为本轮。未提交推送。

## 剩余门槛

限定的既有工作区身份读取、归属优先级和上述路径自验通过，01B整体仍开发中、未用户验收。当前只认目录行ID的显式迁移key，不把local-projects UUID实体按roots联接成目录行；缓存实体完整渲染、多root与同roots不同实体、客户端workspace-state/projectless优先级、canonical项目加载/删除/跨主机及新建归属选择仍必须接入。未分配legacy仍有既有first-find前缀行为，不宣称该回退已与官方catalog一致。

当前全局状态是DesktopStateManager加载的快照；本轮不新增外部配置文件监听，不宣称另一官方进程写磁盘后会自动刷新。精确home/legacy key匹配不做大小写或路径别名猜测，拼写不同可能保持未映射，不能因此改用cwd反推身份。选择聊天后的工作区导航仍按现有cwd逻辑，尚未做完整assignment对齐。官方显示参数未知，像素、原生在途竞态以及5处新建/派生的真实归属生命周期未测，不能列为已验收。
