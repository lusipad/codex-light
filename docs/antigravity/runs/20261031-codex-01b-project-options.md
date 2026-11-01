# 01B续：项目标题组织选项

2026-10-31，修改前合同；01B仍开发中。

固定官方候选26.928.21956/build12404。initial文件SHA-256为577a50e29502f573e2fbccf4940b9bd875339db420d6d5a9798a0d201ee0aff1，中文包c6ac10a9fb407a393ea002d9aa818a4c7ed0e215e9c8bf0cfe2b798a98e3756f。定位均0-based UTF-16。

- initial8087346调用n4o，sectionKind为projects且organizeOnly=true；标题工具按F（选项）、N（创建）的顺序呈现。
- n4o8060830：organizeOnly时直接使用H2o的组织radio列表，不包二级“整理侧边栏”，不加入排序、Recent显示checkbox或新建分区。中文标签为“项目侧边栏选项”，选择使用同一CZn组织偏好。
- H2o8057452：组织项checked由当前mode派生。本应用本轮只覆盖已支持的本地project/list，远程connection受官方能力门控，不能无后端支持地增加。
- 当前项目标题工具为添加文件夹及“管理所有项目”跳转，与上述入口合同不同。项目标题本身与项目行操作仍提供项目中心入口，不因替换工具而移除。

计划：实际Sidebar先失败证明缺少入口→复用组织项数组、共享ThreadActionsMenu与同一偏好写入→验证双入口选中同步、模式往返/重建、无排序等额外项、不触发导航/创建、创建按钮保留→完整标准和release。无新依赖，不修改项目assignment，不修改CSS。官方同环境截图仍缺失，入口布局和像素不能仅凭静态源码宣称通过；原生工具异常需重核，不能沿用旧构建证据。

## 实施与结果

本轮仅产品文件`src/components/CodexSidebar.tsx`：抽出两个入口共用的组织项和偏好写入，使用共享ThreadActionsMenu替换项目标题的管理跳转按钮，顺序为选项、创建；标题和项目行的既有项目中心入口保留。删除被替换按钮，无新增依赖、CSS或协议字段。

证据根目录`.ref/parity/01/runs/20261031-codex-01b-project-options/`，官方静态文件实际哈希及定位片段见`reference/static-evidence.json`。

| 检查 | 结果与证据 |
|---|---|
| 实际Sidebar组件 | `cases/before.log`退出1证明缺少入口；`after.log`退出0。新用例覆盖organizeOnly直接radio、双入口同步、偏好写入/重建、创建保留、无额外项和无导航；既有项目/分页/排序/取消/拖动呈现回归均通过 |
| 完整标准 | `cases/verify-all.log`退出0，含TS、前端构建、cargo check、automations过滤单测和真实协议探针；非全量Rust，未配置独立lint不报通过。显式隔离CODEX_HOME，清空API keys，不生成模型任务 |
| 实际浏览器 | `actual/browser-verification.json`和PNG：展开直接两个radio、选择合并关闭并返回触发器、聊天子菜单同步选中、键盘Return切回、项目入口Escape关闭返回焦点。数据为明确样本；本轮未用合成拖动控制。入口页面复用前轮fixture，源码另存`browser-fixture.html`；fixture重载会重设偏好，不用它宣称重载持久化 |
| release | `cases/release.log`退出0。115输入/5dist构建前归档，构建后与当前磁盘重核匹配；`build-inputs.json`、`source/`、`frontend-dist/`、`build.json`记录身份 |
| 原生项目菜单 | `actual/native-project-menu.jpg/.txt`，当前release真实CLI读取既有隔离回放历史；菜单直接两项，选择合并后关闭，28条聊天。`native-merged`与完整退出后`native-restart-merged`均28行，经保存UIA断言。原生UIA焦点仅报告pane，不用它声称精确控件焦点通过；浏览器焦点另有直接证据 |
| 原生拖动补验 | 当前release含前轮拖动呈现源码；项目手动顺序05→01→02→03→04，真实拖动04到05之前后为04→05→01→02→03，松手无残留预览且仍首页；完整退出同EXE重启保留该顺序。`native-drag-before/after/restart`及`native-verification.json`。不将原子drag后的截图冒充中间态，不回写旧EXE为已验证 |

当前构建`dist-artifacts/01B-project-options-20261031/CodexNative.exe`，SHA-256 `a84f9894944f00e7a35b61a3365e54911ca3ad0a2e77eb526d44c5373b73d42b`，13,280,256字节。基于HEAD380c32c7及归档工作树，不把全部未提交改动算作本轮贡献。未提交推送。

原生工具恢复方法：先按实际窗口清单绑定本轮EXE，使用其UIA明确提供的Raise动作定向激活，再核对截图/控件树一致才操作。先前截图异常不能直接忽略。UIA在菜单提交后可能晚一轮，用稳定截图与第二次树核对。整个验证使用本应用专用native-home和WebView profile，不写官方配置、不发送任务；三个测试进程均已正常退出，测试浏览器页和Vite已关闭。

## 用户复测与剩余门槛

打开当前EXE，在“项目”标题右侧选项菜单选择合并，再从聊天组织菜单切回分项目，检查两处勾选一致、菜单选择后关闭且创建按钮仍在。完整退出重启应保存模式。手动排序同项目拖动，松手后无残留且重启保序。

限定功能与上述原生路径自验通过；01B整体仍开发中、未用户验收。官方Windows/App缩放、语言和主题仍未知，无同条件官方无损参考，像素未评分；本轮沿用既有菜单尺寸和图标实现，不能据静态合同宣称几何/图标完全一致。远程组织选项、项目assignment、跨组/置顶拖动、多选、自动滚动和原生在途取消/中间态仍未完成，下一步继续从真实协议能力与官方catalog/assignment合同调研，禁止改成猜测的最长路径匹配。
