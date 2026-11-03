# 16.01C：动态工作区打开方式、显式目标与路径偏好

2026-11-03。修改前调研合同，仅新增资料；未开发产品，未执行目标程序、模型、安装或 Cargo。承接 [16.01B](16-01-open-target-shell.md)，选择完成“当前本地工作区→真实检测菜单→显式目标打开→路径/全局偏好→再次读取”的主要闭环。该合同不把现有目标子集称为官方完整目录。

## 来源及证据边界

从当前候选 `C:/Users/lus/Codex/_internal/app/resources/app.asar` 重新只读提取 5 个原始文件，逐项与 entry integrity 核对 SHA-256。包 SHA-256 为 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`；**包含已知 codex-offline 补丁，不是干净官方发行基准**。

[manifest.json](../../../.ref/parity/16.01/actual/16-01C-research/manifest.json) 记录原始文件大小/哈希与产品快照；[anchors.json](../../../.ref/parity/16.01/actual/16-01C-research/anchors.json) 记录定位片段。定位数字均为解码后原始文件的 **0-based UTF-16 字符偏移**。静态链路可证明下述代码分支存在；官方实际可用目标、账号模式、Windows 关联程序、真实菜单呈现、DPI、主题与像素仍未知。

## 已证实的真实链路

| 来源 | 静态事实与实现约束 |
| --- | --- |
| initial `D8r` @3994351 / `O8r` @3994475 附近 | `getTargets` 参数进入 JSON query key；通过 `qc.openIn.getTargets` 查询，有取消信号与一分钟 staleTime。不是固定两个目标 |
| initial `Lca` @5460727 | 工作区菜单读取/请求 `{cwd,hostId,path:undefined}`；选择时传 `{path:cwd,cwd,hostId,target,appPath,openMode:"workspace",persistPreferredTargetPath:cwd}`，不是任意当前全局项目路径 |
| initial `Rca` @5461671 | 过滤 hidden 或 unavailable 目标；everyday work 模式额外排除 editor/terminal。空目标集合不提供该菜单；尚未加载与查询失败分别呈现不可执行占位，并提示重新打开菜单。不是把失败列表永久缓存为空 |
| initial `t7r` @4007052、`n7r` @4007647 | 真实调用 `qc.openIn.open`，服务返回 `{success}`；工作区打开不写最近文件列表。Lca 对异常或 `success:false` 显示失败 toast；乐观菜单 default 不能证明系统启动成功 |
| main `s1.getTargets` @2444102 附近 | 返回 preferredTarget、availableTargets、mode、完整 metadata targets；先检测 worker command，单个检测失败记日志并令该目标不可用，Windows 图标解析失败可回退原图标。host/path 改变有远程及 native 模式分支 |
| main `Q$` @2442301、`e1` @2442676、`t1` @2442760 | 读取 `openInTargetPreferences`；finder 迁移为 fileManager，丢弃未知 target ID。偏好查询为精确 `perPath[path]` 优先，再 global；如果该偏好不在实际可用集合则取第一个可用目标。**不是目录前缀最长匹配，也没有代码证据证明 Windows key 自动忽略大小写** |
| main `n1` @2442837 | 选择保存同时写 `global=target`；提供路径时额外写 `perPath[path]=target`，保留其他路径。全局设置调用 `n1(store,null,target)`，不会主动清除已有 perPath |
| main `s1.open` @2445453 | 明确目标先检测命令；不存在/不可用目标抛错，最终返回 `success:false`，不能静默切另一个应用。解析 location 为 line/column；路径/host 与默认打开还有额外分支 |
| main `c&&(y||!M)&&n1(...)` @2447258 | 只有提供 persistPreferredTargetPath 且显式目标或此前无该路径/全局偏好时保存。**写偏好发生在目标真正执行前**；之后目标执行失败并不自动回滚。不能把“成功后才保存”当作官方事实 |
| main `GFe/KQ` @2408189 | 显式无效目标不可使用隐式平台回退；无显式目标的 Windows 分支另有 fileManager 回退。不要用该回退掩盖用户点选的编辑器丢失 |
| main `HLe` @2440049、`GLe` @2440283、`ja` @96859 | 按平台取目标目录，真实检测并执行目标专属 args/open。执行器监听 error 和 close，非零退出拒绝；仅 spawn 返回不等价于这条官方成功判定 |

偏移请以 anchors 的精确 term/offset 为准；表中“附近”数字仅用于定位链路段落，不冒充唯一 token 起点。

### 命名与目录不能凭印象补齐

本轮提取的 initial/main/preload/shared/general 五文件中**未发现字面名称 `setPreferredTargetForPath` 或 `openLocation`**。当前可追踪的真实 API 是 `getTargets`、`open`、`setGlobalPreferredTarget`，位置参数包含 line/column，路径偏好由 `persistPreferredTargetPath` 进入内部 `n1`。不得凭题目命名新增“官方接口”。该未命中仅覆盖本次五文件，不能推断包内其他 chunk 永不存在同名符号。

原始目录 VLe 是有序目标定义，经 HLe 按平台筛选；包含平台差异、editor/terminal/native、hidden、SSH 和 customFileHandlers。已证实 Windows terminal 定义调用外部 Terminal 执行器（main @2416558），并非显示应用内部终端面板。VS Code/Insiders 使用 Windows 检测，Antigravity 另有 PATH/install 检测。完整目录还包含 JetBrains/Visual Studio、Git Bash/WSL 等分支，本轮不把列举到的 ID 当作当前 Windows 全部可用目标。开发时若仍只实现现有 Rust 目标子集，必须明确保留完整目录/检测差异，不能写成目录已 1:1。

## Store 26.1021.3705.0 独立补证

同日新增更可靠来源：已核对的 Store 安装包候选 `C:/Program Files/WindowsApps/OpenAI.Codex_26.1021.3705.0_x64__2p2nqsd0c76g0/app/resources/app.asar`，640129388 bytes，SHA-256 `04862a659c6a90fc50514d8c0b8016709d97dece58839726c57495ed72f1d9f0`。[父任务来源核验目录](../../../.ref/reference/store-26.1021.3705-20261103/) 保存 Store 包状态、Authenticode 与 AppxBlockMap 证据；本节只负责独立静态链取证，不代表官方运行时或像素基准已完成。

[Store manifest](../../../.ref/parity/16.01/actual/16-01C-research/store/manifest.json) 与 [Store anchors](../../../.ref/parity/16.01/actual/16-01C-research/store/anchors.json) 独立保存 9 个 entry 的原始文件和 integrity SHA-256。**以下 offset 属于 Store 文件，绝不能套用前述旧候选 chunk/hash。**

| 行为 | 旧离线候选 | Store 26.1021.3705.0 实际链与差异 |
| --- | --- | --- |
| 精确路径偏好 | main Q$/t1/n1 | `main-BPBEjAxi.js` fQ @3544477、hQ @3544936、gQ @3545013：仍精确 perPath→global；gQ仍同时更新global与该路径；finder迁移、未知ID过滤及可用集合首项回退同义 |
| 动态目标 | main s1.getTargets | Store main getTargets @3546320：仍检测并返回metadata/available/preferred。新增对传入path的目录检测，目录令native文件识别输入归null；不可用与host过滤不应假装所有目标可用 |
| 显式打开及保存时序 | s1.open + n1 | Store main open @3547736、保存条件 @3549543：仍先验证明确目标，提供persist路径时先保存后执行；catch返回success:false；setGlobalPreferredTarget @3550333只走global调用 |
| 工作区菜单 | initial Lca/Rca | 移至 `app-primary-844e405f2b90.js` JYn @2403239、YYn @2404550。可用/hidden、everyday过滤及loading/error占位同义；**新分支按conversationId/host查询最新worktree workspaceRoot，打开时再次等待读取后重新取root**，不是永远使用菜单创建时cwd |
| 文件打开hook | initial 内联链 | 新 `use-target-apps-45913ce79d06.js`：persistPreferred明确请求才带persistPreferredTargetPath；读取/点击路径可能由异步getOpenPath提供。目标打开保留失败toast，line/column通过open参数传递 |
| 远程编辑器 | 旧候选原root传递 | Store main open新增远程VS Code/Insiders文件的Git stable-metadata根目录发现；只影响远程路径，本轮不误当本地cwd规则，也不声称已实现 |

本轮实现应优先采用 Store 证实的共同链；对 worktree conversation 的新root重查不得忽略。OC01/OC07中的“当前真实cwd”包括该最新worktree根：可在测试中让菜单打开后root变化，确认打开动作读取最新root、路径偏好记到最新root；查询失败应报错，不能误开旧目录。当前应用若没有对应服务能力，登记明确差异而非声称Store分支已等价。两个来源均未在本次提取文件中发现 `setPreferredTargetForPath` / `openLocation` 字面API；保持真实open参数链，不编造服务方法。

## 当前产品证实差距

1. `src/App.tsx` thread menu `open_with_menu` 固定 VS Code、系统终端两项；不读取目标检测、hidden、preferred 或按 cwd 隔离的加载/错误状态。
2. `open_vscode` 调 `open_in_vscode`，本次检索 `src-tauri/src` 未发现该命令实现/注册；实际通用路径为 lib 的 `open_path_external`。这是可检查的调用链缺口，不仅是菜单标签问题。
3. `open_terminal` 仅 `setShowTerminal(true)` 打开内嵌面板，与上述官方外部工作区 Terminal 目标不同。
4. `desktop_open::preferred_target_id` 仅读取 global；`set_preference` 虽保留 perPath，却不消费路径偏好；`open_external(state,path)` 无显式 target/cwd/location/persist 路径参数，只按全局偏好打开。当前 `Command::spawn` 成功即返回，不能声称目标正常启动/退出成功已验证。
5. 现有 Rust 检测、DesktopState 持久化、设置读取和外部打开可复用，不应另造一套前端静态应用清单。不要扩大为远程/云端/custom handlers 全量开发阻滞本轮主闭环。

## 修改前验收合同

| ID | 操作、预期及证明方式 |
| --- | --- |
| OC01 | 工作区菜单按当前真实 thread/workspace cwd 查询可用目标；不把 activeWorkspace 的其他项目传给当前聊天。目标随检测结果变化，未知/不可用项不能执行；加载/失败可见且重新开菜单可重试；返回空集不展示假可用目标 |
| OC02 | 选择目标传明确 target 与真实 cwd/path；目标可执行文件消失、未知 target、权限/系统启动失败均可见，不静默打开别的编辑器；错误不能显示成功提示。采用真实目标执行命令/受控进程 fixture 验证参数与非零退出 |
| OC03 | 有路径的显式选择按 n1 同时更新 global 和该精确 perPath；保持其他 perPath。读取优先精确路径→global→第一个可用目标；未知存储 ID、不可用目标与旧 finder 值有明确回归。不得自行添加目录前缀匹配语义 |
| OC04 | 普通全局设置仍只更新 global，保留路径记录；已有路径继续覆盖新全局，其他路径使用新全局。修改→重新读取→重启私有 DesktopState 后仍一致；保存错误可见、不用本地 UI 值冒充真实持久化 |
| OC05 | 保存发生在真实执行前的官方时序有测试；执行失败不得宣称目标打开成功，也不自动声称偏好已回滚。若因平台服务差异采用其他时序须登记差异 |
| OC06 | thread menu 与现有文件外部打开复用后端目标解析与真实执行边界，保留无显式目标行为；显式打开一个目标不误当另一个目标。文件参数作为独立参数，空格/Unicode/引号/元字符路径不得被 shell 拼接执行 |
| OC07 | 当前窗口切换项目/线程时，旧目标查询不覆盖新 cwd；重复点选不造成重入写与错路径保存。关闭菜单/组件后的请求可取消或忽略；失败后可重试，正常聊天/设置不被阻断 |
| OC08 | 目标 metadata 与菜单顺序来自真实检测目录，遵守 available/hidden；有默认信息时如实呈现。外部 Terminal 若尚未实现必须明确保留，不得继续把内嵌面板叫成已对齐的外部目标。完整 Windows 目录差异逐项记录，不用动态子集代替整页验收 |
| OC09 | 回归16.01B全局目标、Shell保存、新终端标签/旧session行为；回归文件预览“外部打开”和快捷入口。涉及原生进程的检查只用隔离状态、临时路径/受控helper，不改用户真实偏好 |
| OC10 | 产出源码匹配原生构建，检查菜单加载/错误/目标点击/焦点/取消后的行为；官方同环境对照与像素缺证写未验。单元自动检查通过仅进入待验，不宣称整个16.01或全部设置完成 |

## 开发及收敛范围

本轮首先闭合本地工作区动态打开菜单与显式目标、精确路径偏好，复用已有检测与持久化；修改前先为上述身份/优先级/错误/参数写回归。位置跳转行列、文档 native 关联应用、远程/WSL 路径转换、自定义 handlers、完整目录及全部平台检测仍为后续主要动作，除非实现时有直接依赖，否则不扩张本轮。静态来源并未证明官方运行时保存失败提示、实际目标程序成功行为或菜单像素；这些保持待实测。
