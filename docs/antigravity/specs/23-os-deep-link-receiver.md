# 23 OS 深链接接收：最小合同与验收方案

日期：2026-11-03。状态：只读静态调研，尚未实施。范围为操作系统交付 `codex://threads/<id>` 后打开已有本地会话。本资料不表示 OS 协议已注册、第二实例已转发、原生或官方对照通过；本轮不修改产品、脚本、系统注册表，不运行 Cargo。

后续状态：23G已按[开发计划](../runs/20261103-codex-deep-link-receiver.md)实现Windows argv/命名管道、最新队列、main握手及真实会话选择接线，见[23G记录](../acceptance/23G.md)。以下“未实施/缺口”为调研时点；仍未注册系统协议、未验证Tauri实际窗口/官方对照。query等完整语法仍待后续实现。

## 基准与证据边界

候选包为 `C:/Users/lus/Codex/_internal/app/resources/app.asar`，SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。该包含 offline 修改，不能当作干净官方发行版或据此证明账号能力。本次直接内存读取，内容起点为 `8 + readUInt32LE(4)`。下文偏移是 **0-based UTF-16 字符偏移**；检索函数名及片段优先于偏移。

| `.vite/build/` 文件 | SHA-256 |
|---|---|
| `bootstrap-DvSEn4qy.js` | `5a901ee1d59062eed03495e017158f6c44b9414cf27e876d4124e0361e91ddd6` |
| `main-DkWgQSQe.js` | `d33ed281dc58766cbbccb8e92a7149268a528901de8858c2d69750d12c6c205b` |
| `src-ghAWefM3.js` | `8cf86523941dd8b31900c57935decb45f5bba8dba08fa8a2de574b1d2df3ff22` |
| `desktop-open-path-queue-BHXvnlW9.js` | `1027c4a75a7e1cf8729e35a3096e78fd7d30de86bc10879628bd9353adef617e` |

尚未进行干净官方 App 的冷启动、热启动、最小化恢复、失败提示或焦点实测；错误文案、窗口呈现时序不作像素承诺。

## 官方静态合同

| 环节 | 检索锚点 | 可以证明的行为 |
|---|---|---|
| URL 外壳 | bootstrap `ie(e)`，文件前部约 1900 | 解析 URL；接受的初步 scheme 为 `codex:`、`codex-dev:`；用户名、密码或端口非空则目标为 unsupported。 |
| 会话路由 | bootstrap `n9(e)` @2162517、`case "threads"` @2165127 | `threads/new` 有独立分支；普通会话走 `r.za(t,{allowExtraPathSegments:true})`，合并 `s9` 参数及可选 `hostId`。 |
| 会话 ID | src `Nt`、`Ft`、`Gt` @约16485–17280，导出别名 `za` | `Gt` 要求 `protocol==="codex:"`、`host==="threads"`；首个非空路径段必须匹配 `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`。这是 UUID 形状检查，没有额外 UUID version 限制。 |
| 可选行为 | src `Gt`、bootstrap `s9` @2169237 | 存在 review、diffFilter、reviewPath、额外路径，以及 prompt/browser 等分支；存在不等于本单元必须一次实现。初步 parser 支持 codex-dev 也不证明普通 threads 子解析器接受它。 |
| 原生交付 | bootstrap `Cwe`，检索 `queueProcessArgs`、`initialArgv`、`startHandlingNativeUrls` | 初次 argv 与第二实例 argv 可进入统一队列；mac 另有 open-url。 |
| Windows 注册 | bootstrap `Cwe` 内 `registerProtocolClient` | Windows 分支直接返回，不调用 Electron `setAsDefaultProtocolClient`；本段不能证明安装器的具体注册内容。不得为了验证而抢占用户的官方 codex 协议。 |
| 就绪与竞态 | bootstrap `Cwe` 内 `p.at(-1)`、`flushPendingDeepLinks` | 未 ready 时保留待处理项；取队列最新项；等待窗口后复查仍是最新项；确认后清队列并导航，避免旧的慢操作覆盖新链接。 |
| 第二实例 | bootstrap @2205055 `app.on("second-instance"`；main @3693641 `deepLinks.queueProcessArgs` | 第二实例参数交给同一入口；成功消费后不落入普通启动处理。未据此完整恢复主单实例锁初始化。 |
| 启动后消费 | main @3708391 `flushPendingDeepLinks` | 主窗口准备完成后再次消费启动期间积压项。 |
| 实际打开 | main `PJe` @3317374 `case "localConversation"` | 先 `readThread(id,{includeTurns:false})`；读取不可用或失败则返回，不伪造会话、不创建新会话或执行 turn。 |
| 宿主与窗口 | main @3322496 附近 `Cwe` 调用、`UJe` | 通过 navigation window 导航，并解析 origin host/连接；不能将未知远端宿主静默作为本地处理。 |

## 本项目缺口及复用点

- `src/App.tsx` 已通过 `copy_deeplink` 输出 `codex://threads/${activeThreadId}`，但没有 OS 输入闭环。独立会话窗口初始选择已有门槛：`appServerStatus.connected && threadEventsReady` 后调用 `selectThread`。深链接应复用真实会话选择路径及相同准备条件，不能另造演示路由。
- `src/nativeShell.ts` 只有菜单、托盘接线。菜单通过当前 webview 的窗口作用域监听；托盘广播不适合作为深链接分发模型。
- `src-tauri/src/main.rs` 目前只设置 panic 处理并调用库入口，没有 argv 接收。`src-tauri/src/lib.rs` 没有深链待处理状态、renderer ready 握手、第二实例接收及分发命令。
- `src-tauri/src/menu.rs` 的公开 `show_main_window` 已执行 `show → unminimize → set_focus`，可以复用。普通深链接目标应明确为 main；不广播至 quick chat 或所有会话窗口。
- `src-tauri/Cargo.toml` 没有 deep-link/single-instance 插件；`tauri.conf.json` 没有协议 schemes 注册。现有依赖可用 `tauri::Url` 解析，无需为纯解析引入新 URL 库。

**平台缺口必须独立验收：** 参数解析、队列和前端接线即使全部通过，也不能证明 Windows Shell 的协议交付及已运行实例转发。后续实施先核实 Tauri 当前版本提供的现成入口；如需新增插件，须按仓库规则另行确认依赖选择。不得用启动第二个互不通信的进程替代第二实例转发。

## 第一阶段最小实施合同

以下是建议实施边界，尚未写入产品代码。只处理 bare local thread URL；官方更宽的语法保留为明确差异，不称为全量深链接一致。

1. 接收一个 URL，要求 `codex:`、host `threads`、无 userinfo/port、一个符合上述正则的会话路径段；允许 URL 解析器的 scheme/host 规范化。query、fragment、额外路径、`new`、codex-dev、远端 hostId 和 review/prompt/browser 暂不支持，明确拒绝且不触发任何执行。尾随斜杠的策略须写入 parser 用例，不能由实现偶然决定。
2. native 持有 pending 最新请求及单调递增 generation；冷启动先保存，main renderer 完成监听与 app-server/订阅就绪后才消费。事件仅发给 main，并通过确认机制避免监听尚未安装导致丢失；不记录会话内容或凭据。
3. 打开时复用主窗口恢复/聚焦。真实读取确认已有会话，进入 `selectThread` 的真实加载路径；不得 `thread/start`、fork 或 `turn/start`。查不到、连接失败分别保留失败结果，不制造成功 toast。
4. 异步查找完成时重新核对 generation、当前连接身份和窗口生命周期；B 后到时 A 的迟到结果不得覆盖 B。pending 与手动导航的优先顺序须在实现前固定，避免自动打开覆盖用户后续选择。
5. 重复投递同一链接允许幂等定位，不重复创建窗口或会话。renderer 重载时恢复握手，卸载时解除监听。quick chat、其他会话窗口不得抢占消费。
6. 不注册或改写用户系统 `codex:` 协议。本阶段通过显式命令行参数或隔离测试入口验证内部链路；测试入口不得暴露任意命令执行或绕过 URL 校验。

## 可验证用例与放行标准

| ID | 操作或前置 | 必须观察到的结果 |
|---|---|---|
| DL01 | 标准、大写十六进制 UUID；错误长度/非十六进制 | 合法解析稳定；非法拒绝；UUID version 不被额外收窄。 |
| DL02 | userinfo、端口、未知 host/scheme、编码分隔符、new、query、fragment、额外段及尾斜杠 | 按已声明边界判定；无命令执行、建会话或隐式远端降级。 |
| DL03 | URL 先到，renderer/app-server/订阅依次就绪 | 就绪前不丢失、不提前选择；就绪后只 main 消费一次。 |
| DL04 | A 读取很慢，随后 B 到达且先完成 | 最终打开 B；A 晚到不改变当前会话或覆盖错误/加载状态。 |
| DL05 | 读取失败、不存在、断连及身份变更 | 不伪造会话；错误可观察；旧身份异步结果失效。失败 UI 文案尚需官方实测。 |
| DL06 | 相同 URL 重复、监听卸载/重载、独立会话窗口和 quick chat 同时存在 | 不重复执行，不泄漏监听；明确 main 定向与恢复机制。 |
| DL07 | 现有会话中的手动导航与 pending 交错 | 按预先定义优先顺序处理；不因迟到 lookup 覆盖更晚用户动作。 |
| DL08 | 隔离环境命令行启动，目标会话实际存在 | 请求和读取结果可追踪；选中真实 ID；无 start/fork/turn 请求。只能证明内部接收链路。 |
| DL09 | 干净官方与本项目，OS 冷启动/热启动/最小化/关闭后重新打开 | 留 argv/单实例转发、窗口目标、焦点及状态证据；没有协议注册与原生实测则保持未验证。 |

纯 parser 和队列测试、renderer 回放、native 实际交付分别记录，不互相替代。完成内部开发后补类型检查、标准检查及原生构建标识；OS 全链路验收必须在不抢占官方协议的隔离环境执行。记录实际与参考的窗口恢复、会话选中和失败状态，用户确认前仅标“待用户验收”。

## 下一步与未决项

下一步先确认平台接收机制与零新增依赖可行性，再实现 parser/队列/定向握手/真实选择这一条闭环；第二实例机制无法落实时明确报告平台阻塞，不把 cold-only 当完整接收器。本轮没有更改系统配置或运行外部发布。

仍待取证：干净官方 build 与包哈希、Windows 安装器协议注册方式、主单实例锁完整初始化、失败状态的官方呈现、手动导航优先级、窗口恢复焦点、尾斜杠兼容策略，以及真实 OS cold/warm 交付。所有这些均未标为通过。
