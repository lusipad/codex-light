# 01B：项目归属通知与列表刷新一致性

2026-10-31，修改前合同。上一轮归属协议调研已有反证和重启证据，本轮继续开发01B，不放行01C。

## 新增来源与实施取舍

固定官方main-DkWgQSQe.js：initializeProjects2590833从`app-server-project-id-by-legacy-project-id-by-host`按`hostId:codexHome`读取显式映射；storeProject2593823反向映射server UUID，默认使用真实server id，不能按相同root推断同一项目。getThreadStartProjectId2588527经threadAssignments取得映射后的server id。均为0-based UTF-16。迁移只在受支持版本执行，且保留legacy cache；本轮不自动导入或改写官方/真实项目配置。

当前`App.tsx`的thread/project/updated直接修改threads，但不使在途thread/list过期；旧列表晚到会覆盖通知后的projectId。原处理还将缺失字段无条件回退null，误当清除。上一轮schema和真实CLI已证明通知携带threadId/projectId（可null），canonical归属必须保留最新状态。

## 本轮合同与计划

1. 使用TypeScript AST提取当前实际refreshThreads与handleNotification，在受控RPC/React状态边界复现旧响应覆盖新归属，不从测试反推产品预期。
2. 有效归属通知立即合并目标线程，再调用现有refreshThreads，使其generation令先前请求过期并重新读取真实数据；未知线程也重新发现。不引入第二套overlay、固定延时或伪项目实体。
3. projectId缺失或类型不符不视为清除，显式null才是清除通知；兼容现有snake_case，但camelCase显式null优先。只处理有效非空threadId。
4. 验证多页旧响应、连续分配/清除、通知不受当前选中线程限制、未知线程、读取失败保留通知结果及project/changed旧行为。再用隔离真实CLI的通知驱动当前生产回调，验证实际协议到状态的链路；完整标准与release留下身份。

产品范围限App.tsx通知分支，测试和标准入口按需增加；不改UI/CSS/归属规则、不新增依赖。canonical项目实体及legacy映射仍需后续完整接入，本轮不能宣称侧栏已正确展示所有canonical项目。原生时序不能通过受控RPC测试冒充GUI已覆盖。

## 实施与结果

产品仅`src/App.tsx`的THREAD_PROJECT_UPDATED分支：显式nullable字段判断后立即合并并复用refreshThreads。删除“缺失→null”的隐式默认，不增加overlay、定时器或额外存储；原有generation自然使通知前的分页请求过期。保留既有snake_case兼容，camelCase明确null优先。

证据根目录`.ref/parity/01/runs/20261031-codex-01b-membership-refresh/`。`reference/main-migration-evidence.json`记录main SHA d33ed281dc58766cbbccb8e92a7149268a528901de8858c2d69750d12c6c205b及准确片段；仅静态来源，不表示对应gate已实测。

| 层级 | 证据及边界 |
|---|---|
| 实际生产回调L2 | `scripts/verify-project-membership-refresh.mjs`用AST提取refreshThreads、handleNotification和实际NOTIFICATION常量执行；`cases/before.log`退出1，旧A覆盖通知B；`after.log`退出0。覆盖旧分页、连续赋值/清除、字段缺失/类型错误、camel null优先、未知/非当前线程、失败保留及project/changed既有行为 |
| 实际服务到生产回调 | `integration.mjs`只在旧实际响应投递处设置可控边界，其余读取和通知均来自真实0.159.2 CLI。分配和空字符串清除各产生一次真实thread/project/updated，直接驱动生产handleNotification，晚到旧响应被丢弃，实际thread/read再确认。`cases/integration.log`退出0、`integration.json`passed=true，两个通知、零turn/started，服务退出[0,null]。React状态为受控替身，不冒充原生GUI时序 |
| 完整标准 | `cases/verify-all.log`退出0，新回归接入标准入口；含TS、前端构建、cargo check、automations过滤及已有真实协议探针。不是全量Rust；没有独立lint配置不报通过。独立CODEX_HOME、清空API keys |
| release与身份 | `cases/release.log`退出0，115构建输入、5dist及3检查脚本归档后重核匹配；见`source/`、`frontend-dist/`、`checks/`、`build-inputs.json`、`build.json` |
| 当前原生冒烟 | 运行本轮EXE，以本轮integration-home和本应用专用WebView profile连接真实CLI。定向Raise后核对截图与UIA目标一致，33个可访问聊天行（项目5+Recent28，非一屏物理行数），正常退出。`actual/native-start.jpg/.txt`。未从GUI注入/验证归属通知竞争，也未声称canonical分组已实现 |

当前构建`dist-artifacts/01B-membership-refresh-20261031/CodexNative.exe`，SHA-256 `576fa0ad5850b276e898fdf46897021808f5d0c51bf33ba4daec3ee0861a1411`，13,280,256字节。基于HEAD380c32c7及归档未提交工作树，不能仅用HEAD代表全部源码。本轮回放只复制既有明确测试sessions，未复制认证/真实配置或SQLite，服务重新索引；没有turn/*请求，没有模型生成。本轮测试原生进程正常关闭，未提交推送。

## 未完成与下一步

01B整体仍开发中、未验收。本轮修复数据事件一致性，不等于完成canonical项目UI接入。继续按显式legacy→server迁移表与local-projects缓存身份取证并接入，包含加载失败/乱序、项目被删除、不同主机及同roots不同ID；不以路径相等合并实体。当前侧栏first-find路径归属、完整客户端workspace-state优先级、新建项目归属和多root交互仍未完成。

本轮没有UI/CSS变化，不新增像素评分；官方同条件环境仍未知。原生层仅冒烟，竞态层以L2和真实通知/受控旧响应投递证明，不能扩张为官方运行时、原生乱序或整页通过。用户可以运行本轮构建确认既有目录/菜单可用；归属竞争复测应使用脚本及其明确隔离目录，不要求操作真实聊天来制造失败。
