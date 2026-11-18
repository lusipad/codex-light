# Codex Light 开发交接

更新于 2026-11-18。Windows 产品更名提交为 `8d3035f`，默认分支为 `master`。项目日常开发、构建说明和仓库地址见 [README](README.md)。

## 本地优先的工作顺序

先读[仓库协作约定](AGENTS.md)和[完整复刻总计划](docs/FULL-REPLICA-PLAN.md)中的「当前优先级」。11 月 16 日的[功能盘点](docs/PRODUCT-GAP-INVENTORY-20261116.md)反映当时的起点，之后的修改和用例按日期查[实施日志](docs/IMPLEMENTATION-LOG.md)。

当前工作集中在设置与官方 Windows App 的逐分区对照。常用本地设置之后，继续首页和跨窗口操作。Sites 创作、远端插件授权及云服务进阶功能按总计划后续推进。插件、Appshots、电脑操控、浏览器各有独立的宿主与权限要求，不能沿用设置入口走查的结论。

## 已经实测到哪一步

| 范围 | 已取得的证据 | 待补的证据 |
|---|---|---|
| 本地工作台 | 隔离 Git 仓库中创建零模型轮次会话、编辑保存、查看差异、运行 PTY 命令。重启后重开工作树及同一会话，外部写入触发冲突并保留草稿，暂存和取消暂存经 Git 索引核对。[原生工作台记录](docs/antigravity/acceptance/11-local-workbench-native.md) | 首条真实模型消息、物理键鼠与中文输入法；保存前读盘到实际写盘之间的并发窗口仍有风险 |
| 设置功能 | 未登录原生窗口逐一导航 26 个分区，8 个本地设置样本重启后读回。另测了导入取消与确认、取消本地归档并打开、钩子信任与启停、本地 STDIO MCP 保存与握手。[原生设置验收表](docs/antigravity/acceptance/16-settings-native-coverage.md) | 远端 MCP/OAuth、钩子命令实际执行、云端归档、真实账号读写及其余控件的逐项读回 |
| 设置布局与常规 | 26 个分区在四档原生 WebView 视口宽度下检查横向溢出；六类弹层在窄窗检查位置、关闭与焦点。固定版本对照另核左侧宽度、常规标题和设置行。[布局实测](docs/antigravity/acceptance/16-settings-layout-native.md) · [设置外壳与常规](docs/antigravity/acceptance/16-settings-reference-shell.md) | 同环境官方窗口配对图、账号和权限导致的控件差异；语言、关闭窗口策略、系统启动项等仍缺实际消费者 |
| 外观 | 三种模式、预设主题、有效与无效导入和重启读回已测。模式图内区与官方 SVG 在同一 WebView 中绘制，六组共 22,152 个像素的 RGB 比较均一致。[外观对照记录](docs/antigravity/acceptance/16-appearance-reference-windows.md) | 整页截图配对、字体栅格化、条件控件与用户验收 |

这些记录各自标明测试源码、构建及用例。原始 PNG、JSON 与构建日志存于本机忽略目录 `.ref/`，普通克隆可读到上表的验收文档。如需复验原始图像，从记录列出的目录取证，或在同一环境重新采集。

## 下一轮设置验收怎么做

1. 沿用本轮设置的官方 Windows Store 基准 `26.1111.2228.0`（package `26.1111.21308`）。先核验 asar 版本与哈希，再记录目标分区在相同语言、主题、账号状态、DPI、缩放及客户区下的官方宽窄窗口。切换官方版本时另建基线。
2. 从官方截图和控件来源列出可见条件、尺寸、动作、焦点及保存预期。优先补常规、外观的整页配对图，再按总计划的设置表推进其他分区。
3. 用对应源码构建原生应用，在隔离 Git 仓库、`CODEX_HOME` 与 WebView2 配置中复现相同操作。改动后除界面反馈外，还要从磁盘或 app-server 独立读回，再重启验证。涉及账号、系统权限或真实服务的场景单独记结果。
4. 在分区验收记录附上来源、参考图、实际图、差异和测量条件，列出仍未验证的动作。功能、整页像素、原生输入及用户验收各自记录。

## 开发与交付

在仓库根目录使用 PowerShell。启动桌面开发窗口前先按 [README](README.md) 准备依赖。

```powershell
npm run tauri dev
```

本地检查与打包可按修改范围选择对应命令。

```powershell
pwsh -NoProfile -File ./scripts/verify-all.ps1
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

标准脚本运行前端检查、指定的 Rust 测试和协议探针，`-Fast` 跳过协议探针。运行全库 Rust 测试请使用上面的独立命令。托管 CI 当前暂停。安装和构建方法见 [README](README.md)，旧安装迁移说明见[更新日志](CHANGELOG.md)。
