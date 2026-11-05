# 16G 系统字体与字形阶段记录

合同：[16G字体合同](../specs/16G-appearance-fonts.md)。状态：阶段自验完成、待用户验收，未完成用户验收，不表示外观整页1:1。

## 变更和简化

- `system_fonts.cpp`、`system_fonts.rs`：Windows SDK DirectWrite真实目录，字体族、字形显示名、完整名、PostScript名和等宽属性；UTF-16同步回调、错误传播、只读缓存与异步Tauri命令。复用原MSVC构建脚本与工具链，不新增依赖。
- `systemFonts.ts`、`AppearanceFontPicker.tsx/.css`：共用目录请求、晚到清理、真实字体与字形菜单，系统/内容随UI默认、代码字体所有face等宽筛选、目录不可用时菜单内CSS自定义值。普通菜单复用GeneralPreferenceSelect，fallback只补该流程所需的输入菜单。
- `AppearanceSettings.tsx`：替换手工字体输入，界面family/style分别位于主区和高级区，内容和代码在同一行放family/style；保存仍走原完整主题patch和读回。删除替换后不再使用的手工字体保存分支，颜色输入逻辑保留。
- `appearanceTheme.ts`、`appearancePreferences.ts`：CSS family列表不再重复引用；只有face与首family匹配才插入 `Codex selected …`，本地PostScript/fullName加载、同别名去重缓存、失败保留family fallback。迟到字体仅加入字体集合，不改当前主题选择。

## 已执行证据

证据根 `.ref/parity/16/actual/16G-fonts/`，原始引用见 `reference/{README.md,manifest.json,anchors.json,raw/}`。本轮复算整个固定asar哈希；6个entry integrity匹配。

- 定向原生真实目录测试通过，读取本机249个字体族、620个face、19个全部face等宽的字体族；这些是样本统计，不是产品常量。仅测试环境变量可向明确绝对路径导出证据，不扩展产品写接口。
- `theme-red-corrected.log`：用Git基线真实主题源码运行修正后的预期，旧实现输出 `"Keep Bold", sans-serif`，不能满足官方alias + 原family合同。最初红测曾误写fixture名称Keep UI，原日志另留，不将那个测试文案错误当产品缺陷。
- `verify-system-fonts.mjs`：首face不假定Regular、默认/字形元数据、全face等宽筛选、未知值保留、目录缓存和卸载晚到隔离、fallback及IME防提交；CSS列表/转义、local加载/并发去重/失败重试回归。
- 原外观模型、UI、偏好和主题队列回归继续通过；静态和生产回放不等于原生或像素验收。
- 浏览器1280×800与640×800，真实SettingsView和本机目录，保存传输仅为内存桥/CSP禁外网。常规family菜单250项含系统，代码菜单20项含系统且无Arial。实际浏览器本地加载Arial Bold、Consolas Italic，测试夹具只读观察FontFaceSet.add后的status均为loaded，CSS别名和原family列表同时存在。
- 窄窗scrollWidth/clientWidth均640；样式菜单220px未越界，Escape归回相应trigger；fallback的带引号CSS列表Enter保存后保留语义并归焦。浏览器console无error。原始JPEG与记录见 `.ref/parity/settings-16G-20261105/browser-settings/`，不作无损像素差图。

## 标准检查的环境故障

首轮标准检查在Rust review preferences编译时报 `debug/incremental/.../dep-graph.part.bin: 磁盘空间不足 (os error 112)`；之前步骤通过，失败记录保留于 `verify-all-first.log`。停止该进程后恢复约2.85GB空间。

清理本仓库专用增量缓存的操作被自动审批拒绝，只返回“被策略阻止”，因此没有删除缓存，也未改用其他工具删除。后续仅在私有检查进程设置 `CARGO_INCREMENTAL=0`，保留全局配置。

为避免重跑已通过的前段，生成原标准脚本从失败步骤开始的完整原样尾段，包含所有后续Rust检查与非Fast协议探针；仅将脚本工作目录固定为仓库。来源哈希、起始位置和尾段一致性见 `standard-resume-manifest.json`。该补验不应描述成“原完整脚本单次退出0”。尾段退出1，仅Rust worktree root contracts再遇LLVM磁盘空间错误，其他尾段检查和非Fast协议探针均通过。随后使用同一target、关闭增量并限单个编译任务，单独重跑worktree_root，4项通过、0失败，退出0（worktree-root-recheck.log/.exit）。最终system_fonts原生回归1项通过，249族/620字形/19等宽族不变；Segoe UI首字形为实际默认Regular，原目录另存before-default-adaptation，未声称与Electron顺序相同。

## 尚未证明的对齐

- DirectWrite默认face适配、系统目录分组/locale/变量字体及顺序与官方Electron仍缺运行时数组对照。
- 官方字体菜单menuWide/menuNarrow的精确几何未量测，目前复用220px菜单；图标、字形栅格化与同环境配对像素未验。visual-verdict score=null，未评分。
- 最终EXE已验证真实目录、保存/重启读回、Escape关闭与空格重开焦点；原生物理IME、完整Tab顺序、多窗口同步及官方配对仍未验证。
- 外观其他已登记缺口（账户强调色、Mode图形、官方弹层精确几何等）没有自动通过；用户未验收。


## 独立复核补正

只读复核发现：导入system-ui/monospace等通用CSS family时，trigger显示系统但菜单未勾选。generic-system-red.log先复现actual monospace/expected空默认项；修复默认项选中身份，并仅在此情形使用共享选择器的可选onReselect清原值和face。fallback也标记系统。共享组件原消费者同值不写语义保留；八项相关前端脚本及TypeScript补验退出0。最终原生包将按新冻结输入重新构建，旧构建不作当前源码交付。

最后补验重新生成隔离浏览器fixture并载入最终目录，1280×800截图fonts-final-wide.jpg确认Arial Bold真实loaded；fallback输入system-ui后，generic-system-checked.jpg及AX确认系统勾选且文本保留。旧原生构建虽然编译打包成功，但冻结输入校验发现最后修复，主动拒绝归档；原日志保留native-build-before-review-fix.log，重新冻结574项并重建，不拿旧包验新源码。


## 最终构建与原生闭环

- 最终 `npm run tauri build` 退出0；EXE/MSI/NSIS及主题许可共8项归档 `dist-artifacts/settings-16G-20261105/`。574项源码/脚本/资源冻结输入前后不变；构建记录 `.ref/parity/settings-16G-20261105/build-manifest.json`。独立lint未配置，不虚构lint通过。
- EXE SHA256：`866503bcf5a1c35e70f0938227c6a3d8dce5b0f5cba5983acc142156343cbbb1`。基于a8e3956加本阶段改动，提交后的产品输入与冻结清单一致；文档不作为产品构建输入。
- 使用本阶段独立CODEX_HOME、WebView2用户目录和workspace，清除子进程API凭据，不登录、不发模型turn；真实app-server config/batchWrite及config/read承载保存。未安装沙箱或更改安全配置；首页提示notConfigured是隔离环境已观察状态。
- 真目录菜单成功，代码菜单显示19族加系统。选择Arial/Bold、Consolas/Italic；磁盘config.toml保存正确CSS family与两个face的family/fullName/PostScript。保存完成后退出（确认原PID消失），以同一私有配置重启，新PID；界面恢复Arial/Bold、Consolas/Italic，配置SHA256重启前后完全相同。
- 原生Escape关闭代码样式菜单，触发器可见焦点环；随后按空格重开同一菜单，Italic勾选，证明焦点回到trigger。UIA focused_element仅报Web文档根，所以以可见焦点环及实际键盘动作交叉验证，没有伪造DOM焦点读数。
- 初次隐藏启动截图捕获了前景窗口，未用作证据或操作依据；激活精确EXE对应窗口后重新采集。重启一次UIA click报coordinate input geometry unavailable，重新选择唯一窗口、刷新截图后一次重试成功。保留工具限制，不当产品失败。
- 原生JPEG尺寸1442×914，DPI/官方缩放未知；`native-font-menu.jpg`、`native-fonts-after-restart.jpg`及AX、`native-verification.json`留证。这些不是官方同条件像素比较。测试应用已关闭。
- 最后共享组件增量仅涉及可选onReselect；原常规/设置消费者与六项外观/字体共8脚本、TypeScript补验通过，原生最终包包含该修复；独立只读复核无新增阻断问题。

阶段功能、自验及上述原生用例可交付；官方目录顺序/分组、菜单精确几何、配对像素、物理IME、多窗口仍未验，用户尚未验收。
