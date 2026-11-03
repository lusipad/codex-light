# 13B 推荐技能目录与真实安装闭环

日期：2026-11-03。状态：实现前合同。13A 已覆盖内容身份、写锁、编辑草稿和来源安全；本单元不重复这些内容，不扩大到整个技能页面改版。

## 当前缺口与本单元目标

当前 `list_local_and_recommended_skills` 只扫描用户 skills、环境变量来源、工作区的 `vendor_imports/skills` 与 `_internal/seed/skills`。官方推荐仓库实际在 CODEX_HOME 的 `vendor_imports/skills`，目录下包含 `skills/.curated` 和 `skills/.experimental`。现有单层扫描既不读取该位置，也不进入真实目录结构。没有自备种子目录时，推荐列表可能为空；这不表示官方没有推荐技能。

本单元交付“读取真实推荐目录 → 展示来源/错误 → 安装到用户或选定项目 → 读回已安装技能”闭环。保留现有本地编辑入口与 13A 异步保护；不同时展开推荐卡片像素重排、完整图标回退、编辑器重构、远程主机安装、Statsig markdown 覆盖、AI 自动技能建议。

## 官方静态合同与证据

清单：`.ref/parity/13/actual/13B-research/manifest.json`。引用原始文件均在既有单元完整性核对后保存，本次重新计算文件 SHA-256；沿用含 offline 补丁候选包 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`，不是干净官方或运行时基准。定位数字为 0-based UTF-16 字符偏移。

| 原始文件/锚点 | 已确认静态行为 |
|---|---|
| `main-DkWgQSQe.js` 1410674 `recommended-skills` | 主进程桥读取推荐目录，参数 `hostId,refresh`，返回有来源和错误的结果。 |
| 同文件 1410971 `install-recommended-skill` | 接收 `skillId,repoPath,installRoot` 等；成功返回 `{success:true,destination,error:null}`，失败 `{success:false,destination:null,error}`。不能把 Promise resolved 本身当安装成功。 |
| `bootstrap-DvSEn4qy.js` `Hq`（约1736500） | 固定源 `https://github.com/openai/skills.git`、分支 main，目录 `.curated` 优先于 `.experimental`，同 ID 去重，按 name 排序。 |
| 同上 `Hq/$q/eJ/tJ` | CODEX_HOME/vendor_imports/skills 是托管 Git；浅克隆/稀疏签出两类目录，刷新 fetch/reset 到 FETCH_HEAD。缓存 `skills-curated-cache.json`，10分钟过期，单 Git 命令30秒。已有非 Git 目录报错，不能删除冒充托管仓库。 |
| 同上 `Hq` catch | 读取失败可保留真实缓存 skills，并同时返回 error；没有缓存则空列表＋错误。离线缓存不是刷新成功。首次未有托管目录时可优先使用真实 bundled 源。 |
| 同上 `Wq` | 从真实 SKILL.md frontmatter 读取 name/description；返回 id、repoPath 等。不通过当前本地种子列表伪造官方目录。 |
| 同上 `uJ`（1743098附近） | 默认目标 CODEX_HOME/skills/id；显式 installRoot 则 installRoot/.codex/skills/id。按 repoPath 从托管或 bundled 源复制整个目录，包含脚本/资源；缺来源才刷新并再查，仍缺则失败。 |
| 同上 `pJ` | ID/来源路径解析后必须处于预期root，不能路径穿越。 |
| `use-skills-page-data` `H/ie/J` | 成功必须检查 response.success，再失效推荐查询、forceReload skills 并广播刷新；host/安装尝试代次绑定，过期回调不污染新上下文。 |

`uJ` 原实现存在“非 force 且目标已存在就返回 destination”的幂等分支；本项目应保留已有技能，不静默覆盖。本地安全实现可以进一步真实读取目标 SKILL.md，缺文件/无效目录应显示冲突，不能把一个空目录视作安装已确认。不得照抄不安全的 forceReinstall 递归删除，当前单元不暴露强制覆盖。

## 实现合同

1. 推荐目录作为独立真实数据源，不与用户/项目同名技能按显示名混淆。结果至少含 `skills,repoRoot,source,fetchedAt,error`，每项含 `id,name,description,repoPath`；空列表、读取失败、缓存回退分别呈现。来源标签不能把自备离线种子称为刚从官方刷新。
2. 复用已有 Git 进程、CODEX_HOME 和技能复制逻辑，不新增依赖。托管缓存只可位于当前明确 CODEX_HOME/vendor_imports；Git 更新前核对绝对目标、真实目录及 origin，不触碰用户工作仓库或任意已存在目录。相同目录刷新合并在途，失败保留上次已读数据。
3. 默认加载有新鲜缓存时不访问网络。无缓存/过期按官方链更新；显式刷新强制更新，网络失败同时显示缓存和错误。测试通过临时托管源/受控 Git 结果验证，禁止修改真实用户配置或运行对用户项目的 reset。
4. 推荐目录读取 `.curated` 与 `.experimental`，每项必须有真实 SKILL.md；两类同 ID 按优先级去重，repoPath保留精确来源。复用既有解析方式；不为此单元构建通用 YAML 框架。
5. 安装动作使用选中目录项身份，主进程重新验证 ID、repoPath、canonical source、目标root和链接边界。复制完整目录，不只写 SKILL.md，以免资源/脚本缺失。只读推荐缓存不被安装操作改写。
6. 默认安装用户范围，若当前项目可用，支持明确选择该项目根；UI显示实际目标作用域。只允许当前真实已知项目根，不接收前端任意 root 后无校验写入。项目在协议中的读取范围与现有 workspaceCwds 对齐。
7. 写入失败不显示成功、不标已安装；原有目标保留。目标已存在时不覆盖用户文件；只在真实完整目标可读时作为幂等结果，其他情况显示冲突。部分复制失败不能留下被误识别为成功的技能；实现可先在目标父目录写私有暂存目录，完整后再落位。
8. 成功后调用 `skills/list` forceReload，并核对预期 destination 所对应的技能真实出现；暂未被协议发现要显示“文件已安装，技能发现待确认”，不能假装服务可用了。现有本地列表也重读。当前项目/host/安装尝试切换后的晚结果不得污染其他上下文。

## 验收用例

| ID | 场景 | 必须证明 |
|---|---|---|
| SR01 | CODEX_HOME真实目录含两类技能、同 ID、缺文件 | 正确层级、优先级、真实名称/描述；缺SKILL.md不成推荐项，不漏同级技能。 |
| SR02 | 新鲜缓存、过期缓存、显式刷新 | 网络调用时机符合合同；成功来源/时间真实；重复刷新不并发改同仓库。 |
| SR03 | 网络/Git失败，有/无缓存 | 有缓存仍可浏览且错误可见；无缓存错误空态可重试；不显示刷新成功。 |
| SR04 | 托管位置被非Git目录/错误origin/链接占用 | 拒绝更新，原有文件完全保留，用户工作区Git不受影响。 |
| SR05 | 安装含脚本/assets/多级目录技能 | 目标每个文件字节一致，源未改，真实SKILL.md和协议发现都能确认。 |
| SR06 | 用户/项目目标安装、同名既有技能 | 指定作用域正确，另一目标不变；已有自定义文件不被覆盖；空目录冲突不假成功。 |
| SR07 | 坏ID、越界repoPath、源链接、缺文件、复制失败 | 失败可见，无目录外写入，无假安装标记，下一次合法操作可继续。 |
| SR08 | 双击安装、刷新中切项目、晚完成、A→B→A | 同目标一个写；读回与提示绑定原上下文，不替换编辑草稿。 |
| SR09 | 安装成功但skills/list未发现/读取失败 | 保留真实文件安装事实，明确发现状态待确认，不直接判完全成功。 |

验证分层：生产服务/回调受控Promise回归＋临时真实Git/文件字节与作用域测试＋隔离 CODEX_HOME 的真实 skills/list；之后标准检查、相关Rust测试及原生构建。网络源变化不通过固定技能数量判断。原生路径需验证目录刷新、目标选择、安装后发现及错误重试；视觉需固定官方版本和窗口的配对截图。无以上证据不称整13验收或1:1。
