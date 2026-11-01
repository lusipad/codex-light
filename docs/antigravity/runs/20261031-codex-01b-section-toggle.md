# 01B A11：当前分区再次选择移出

日期：2026-10-31。修改前合同；01B 开发中，不放行 01C。

## 依据与范围

固定候选官方版本 26.928.21956，asar 哈希沿用已核对的基准；本轮重新核验 initial chunk SHA-256 为 `577a50e29502f573e2fbccf4940b9bd875339db420d6d5a9798a0d201ee0aff1`。参考清单和有界片段保存在 `.ref/parity/01/runs/20261031-codex-01b-section-toggle/reference/`。定位均为 0-based UTF-16 字符偏移。

- `LSo` 7150970：sidebar 普通会话菜单按类型、能力、状态组装，组织动作、续聊、复制、窗口、通知、生命周期分组。不能将包内动作视为所有账号均可见。
- `o1` 6919038：组织动作中重命名、置顶、已读状态有明确顺序；当前实现的完整内容和顺序仍有差距。
- `jSo` 7147345 / `cmo` 6919680：项目移动和分区移动是不同的菜单来源，不能将二者混为同一协议。
- `$$` 6894363：自定义分区受 `vs` 门控；每个目的分区是 checkbox，checked 取决于当前归属；选择当前分区调用 `X$` 移出，选择其他分区调用 `Ppo` 移入；末项可创建新分区。
- `Ppo` 6889060 / `X$` 6889702：有账号、分区存在性、置顶、服务排序等分支。本轮不复制未验证的 gate 或置顶事务，不宣称所有组织功能已对齐。

官方运行时尚未对照。shared `kyi` 证明右键/键盘菜单有原生优先分支，“更多”点击有 dropdown 路径；安装依赖的 Tauri JS 文档与 Windows 底层 popup 返回时序需要单独实测，不凭 API 名称实现关闭/焦点/资源生命周期。本轮不切换菜单渲染器。

本项目已有 `thread/section/move` 及分区清单；本轮仅修复已有可用分区菜单的再次选择语义和可访问勾选状态，复用真实协议封装与原成功/失败处理。不新建菜单框架、依赖、协议字段、CSS 或 Rust 模块。允许文件为 `CodexSidebar.tsx`、现有 Sidebar 测试 harness、分区专项、标准检查入口及本轮记录。

## 修改前验收合同

| ID | 操作 | 预期 |
|---|---|---|
| ST01 | 已属 A 的会话，打开菜单→分区→再选 A | 仅请求一次 `thread/section/move`，`sectionId: null`；成功后无选中分区 |
| ST02 | 已属 A 的会话选择 B | 仅请求一次 B；成功后仅 B 的 `aria-checked` 为 true |
| ST03 | 无分区会话选择 A→重开→再次选 A | 先移入 A，再移出；请求顺序与菜单状态一致 |
| ST04 | ST01 / ST02 请求失败 | 原归属不变，显示真实错误，不发送刷新成功通知 |
| ST05 | 请求待定时重开菜单 | 保留已确认归属；成功后更新，失败不乐观覆盖；动作关闭菜单且不选择聊天 |
| ST06 | 展开分区后键盘向下导航 | checkbox 项可被菜单导航聚焦，勾选语义不丢失；实际浏览器激活和原生焦点另验 |
| ST07 | 真实 `thread/list` 返回 `{section:{id,name,appearance}}` 后冷加载 | 从对象 ID 恢复归属与勾选；再次选择当前项仍发 null，重启读回一致 |

执行实际生产组件和 `threadSections.ts`，只在 `callAppServer` 服务边界控制返回；G3 必须先记录失败，再做最小修改。完整标准与 Release 构建检查来源；真实协议读回、当前原生、官方运行时、像素与用户验收分开记录，不以组件测试替代。

## 实施与验证

修改前专项已按预期失败：测试让当前所属的 A 分区发起请求，却观察到 `{sectionId: "s-a"}`；合同要求 `{sectionId: null}`。结果保存在本轮 `.ref/parity/01/.../before.log`。

最小修改：

- 再选当前分区时复用现有 `handleMoveThreadToSection`，将 section ID 变为 `null`；其他分区请求保持原 ID。
- 将分区父项文案改为官方中文资源“移至分区”，改用真实箭头图标；子项改用 `menuitemcheckbox`/`aria-checked` 和官方式勾选标记，移除本地文件夹 emoji、“当前”文字 badge 及 selected 底色。样式仅为既有检查图标预留 14px 对齐位，尚未做像素比较。
- 让菜单初始化焦点与方向键遍历接受 menuitem checkbox；“无分区提示”和其他 menuitem 不变。
- 测试通过现有 sidebar harness 实例化真实组件和 `threadSections.ts`，只 mock `callAppServer` 传输边界，真实执行协议包装、回调、loading 和错误分支。

`verify-sidebar-section-toggle.mjs` 覆盖 ST01–ST06：移入、当前分区移出、两个分区间切换、往返、写入等待时读到的仍是已确认归属、失败保持状态/真实错误、成功更新及键盘焦点。三个内存突变（恢复旧移入语义、移除 checkbox role、恢复只接受 menuitem 的导航选择器）均被专项断言捕获。组件和协议回归是 L2，无法证明线上数据持久化。

完整 `verify-all.ps1` 最终退出码 0，日志为 `verify-all.log`、结构化结果为 `actual/standard-result.json`：包含会话菜单与本轮专项、所有既有专项、`tsc`/Vite、Cargo check、标准脚本选择的 automations Rust 测试和六项隔离协议探针。最后一轮检查包含 ST07 冷加载对象样本。该命令不代表官方运行时对照、原生 UI 或像素验收。

最终 `npm run tauri build` 退出码 0；16 项关键构建输入前后哈希一致（不是全仓库文件指纹），manifest 记录 HEAD 与未提交工作树身份。EXE 为 13,307,392 bytes，SHA-256 `1917F8334396E11570AB207790831BA6B4E291C3005C8120C325ED43CD0B8970`，归档于 `dist-artifacts/01B-section-toggle-20261031/CodexNative.exe`；详情见 `actual/build-result.json`。初次构建包装脚本只在预设 `src-tauri/target` 寻找产物，和仓库 `src-tauri/.cargo/config.toml` 设置的外部 target-dir 不符；构建日志显示 Rust 编译及 MSI/NSIS 都成功，随后以正确 target 验证并归档。最终记录对应已修复 `ThreadSummary.section` 对象类型的第二次构建。

真实隔离 CLI 协议写后读：本轮离线 fixture 创建两条显式 user-message 回放线程和两个分区，以 `thread/section/move` 对 A 执行 A→B→null→A，每次 `thread/list` 读回 section 对象与目标 ID 匹配。随后启动新的 app-server 进程读回，A 的 section ID 和两个分区仍在。无凭据复制、无 `turn/start`、无模型生成；记录为 `actual/fixture.json` 和 `actual/restart-readback.json`，脚本在 `cases/`。这证明 CLI 协议语义和此隔离数据的跨进程持久化，并不验证 Tauri UI 回调触发或用户账号的真实数据。

没有运行当前 EXE 的菜单 UI 自动化或官方运行时配对。本轮读过 Computer Use 技能并初始化 `@oai/sky` 后，文档中的 `list_windows` 调用返回 `is not a function`，`list_apps`、`get_window_state` 的类型均为 `undefined`。未用其他 Windows 自动化方式绕过该限制，没有启动新窗口，也没有选取或操作历史验收窗口。当前 EXE 启动、原生焦点、官方菜单差异、Windows 缩放/主题配对、截图像素对照仍待验。没有同条件截图，不执行 visual-verdict 或生成评分。01B 本增量已完成代码/协议自验，但原生 UI 待验证，页面整体未验收。

### 协议读回新增发现

真实隔离 CLI 的首次写后读断言失败：`thread/list` 返回的是分区对象 `{id,name,appearance}`，不是本项目类型及样本假定的 ID 字符串。首次原日志在重试时被覆盖，其工具输出摘录明确标注保存在 `actual/prepare-native-home-first-failure.log`；产品对象响应的修改前失败原日志为 `actual/protocol-object-before.log`。第二次 fixture 尝试复用旧 home 得到 4 条而非预期 2 条，也以失败保留在 `actual/prepare-native-home.log`；最终 fixture 使用新建随机目录，数据与操作序列完整通过。范围扩到 `types.ts` 和侧栏读取 ID，不更改服务协议，保留既有字符串兼容。ST07 先失败后修复；首次 Release 不作为最终交付。
