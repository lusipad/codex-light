# CI 第二层问题：临时目录别名及终端编码

2026-11-04，承接[编译问题诊断](ci-notifications-msvc-20261104.md)。修复编译后实际跟进[run 41747410523](https://github.com/lusipad/codex-light/actions/runs/41747410523)，新通知SDK步骤成功；Rust完整测试452通过、11失败，0忽略。这是此前编译中断所遮挡的问题，不能说C++20修复后整轮CI已绿。

## 已观察到与修复合同

| 失败用例 | 直接证据 | 修复边界 |
|---|---|---|
| git cleanup_runs_after_snapshot / cleanup_ignored_source_fallback | 删除后记录的runneradmin长名和RUNNER~1短名不同 | 测试fixture根创建后canonicalize；删除前保存真实路径，删除后验证记录及目录已删除 |
| git cleanup_failure_preserves_directory / automatic_cleanup_requires_snapshot | 错误正确含canonical长路径，contains原短拼写断言失败 | 统一fixture身份；不删除快照保护或错误内容断言 |
| recommended_skills sr06 | 真实安装目标canonicalize，但测试对短路径starts_with | 统一fixture根，保留项目作用域和不覆盖断言 |
| inventory wb05_collects / primary_and_corrupt / symlink_or_junction | 记录及错误用canonical长名，期望是原短名 | 统一fixture根及清理边界；不canonicalize被拒绝的junction来掩盖其路径 |
| local_environment_missing_read | 缺失配置路径无法整体canonicalize，locate用短请求对比长候选，错误拒绝同一工作区 | 产品修正：固定末尾.codex/environments/file，解析已有definition根，再按原config_path检查；不创建缺失目录、不放宽根边界/文件名/symlink检查 |
| terminal real_action_cwd | PowerShell Get-Location长名与测试root短名直接比较 | 测试以canonical实际目录相等验证；保留一次写入及真实退出码 |
| terminal real_pty_consumes_worktree_setup | ENV=saved value ?? | 独立探针显示同一环境值经PowerShell OEM437输出会丢字；固定该测试命令为UTF8，保留原中文/UNSET断言，不改用户shell默认编码 |

所有11项属于两类环境差异，其中首次读取配置为实际产品缺陷，其他是测试未固定正确比较方式或输出编码。原始失败片段见.ref/ci/20261104-notifications/runner-test-failures.log，编码字节探针见terminal-probe/encoding.json（437为3f3f，UTF8为中文完整字节）。

## 回归方式

新增Windows真实GetShortPathNameW交叉回归：长/短cwd × 长/短请求，配置不存在仍不写目录；首次save及读回成功，外部根及父目录跳转拒绝。旧locate实际退出101，修复后退出0；不是仅比较模拟字符串。初版测试误用会canonicalize的normalized来确认“拼写不同”，已改为确认原始拼写不同且canonical身份相同；最终红日志明确在真实read_config处失败。

完整测试在独立子进程将TEMP/TMP指向同一真实8.3目录别名，模拟CI路径条件，不改用户或系统环境变量。长短路径、执行命令、日志和退出码在short-temp.json、verify-short-temp.ps1、cargo-short-temp.log/exit。新测试要求该Windows测试卷支持8.3别名，当前本机C卷及已观察的CI路径条件支持；不启用系统8.3设置来方便测试。

第一次全量探针额外套了一层57字符UUID目录，展开长名后技能Git克隆路径超过MAX_PATH：456通过、8项技能失败，错误明确为Filename too long，保留cargo-short-temp-long-root.log/exit/json。这个更深目录条件不是原CI的Temp深度；后续使用13字符的私有Temp目录，使长名总深度接近runneradmin的原CI，同时保留真实短别名和原464项全部断言。Git深目录长度限制是另一个已观察到的限制，未以全局core.longpaths设置掩盖，也未宣称本轮已修复任意超长路径。

源码修改只涉及local_environment.rs的locate及对应回归，和git/worktree_inventory/recommended_skills/terminal原测试夹具；不变更工作树删除、快照策略或用户终端编码。保留全部测试，不增加依赖。

## 执行结果

接近CI目录深度的真实8.3 TEMP/TMP完整测试已退出0：464通过、0失败、0忽略、0过滤；binary及doc-tests均0用例通过。该轮包括全部11个此前失败用例和新增真实短路径用例；输出与退出码已保留。git diff --check通过。新云端结果待提交后核验，不能沿用上一run的SDK通过代替这批测试通过。

2026-11-06补记：已核验修复提交 `0e6e7120b646ff089e323c10640d250a8dc50c83` 的[云端 run 41750917173](https://github.com/lusipad/codex-light/actions/runs/41750917173)最终 completed/success。该轮完整464 Rust用例、通知SDK和原生安装包均通过，普通分支push未发布Release；最终日志/资产清单留在 `.ref/ci/20261104-notifications/final-result.json`。本补记与本次E阶段新提交的CI结果分开，不能沿用为新版本通过证明。
