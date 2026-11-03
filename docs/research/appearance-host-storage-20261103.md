# 外观宿主存储补证与 16.02B 配置适配

2026-11-03。承接 [16.02B 修改前合同](../antigravity/specs/16-02-next-closure.md)。本文区分官方静态链路、隔离真实协议与本轮实现；不代表官方运行时、跨窗时序或像素验收。

## 来源与关键修正

使用 Store `26.1021.3705.0` 原包 `C:/Program Files/WindowsApps/OpenAI.Codex_26.1021.3705.0_x64__2p2nqsd0c76g0/app/resources/app.asar`（640129388 bytes，SHA-256 `04862a659c6a90fc50514d8c0b8016709d97dece58839726c57495ed72f1d9f0`）。四个新增只读 entry 各自 SHA-256 与原包 entry integrity 匹配。完整路径、大小、哈希在 [.ref host manifest](../../.ref/parity/16.02/actual/16-02B-research/host/manifest.json)；[anchors](../../.ref/parity/16.02/actual/16-02B-research/host/anchors.json) 保存原文定位片段，数字均为 **0-based UTF-16 字符偏移**。

| Store 文件与偏移 | 已证实结论 |
| --- | --- |
| `.vite/build/bootstrap-BYjpvKBK.js` @512624、513795 | `KO` 为 `config.toml`，settings store 由 `codexHome/config.toml` 与 global state 创建。不是任意项目配置 |
| `.vite/build/startup-requirements-CuyNnLmn.js` @95613、99989 | 构造时从 TOML 顶层 `desktop` 读取；读取失败记录警告，不能证明运行时恢复全部成功 |
| 同文件 @96370 | initialize 用实际 `config.desktop` 更新 store，保留 pending writes；不是初始化时直接清空旧值 |
| 同文件 @98831 | persistPendingSettings 统一发送 `config/batchWrite`，`keyPath: desktop.${key}`、`mergeStrategy: replace`，成功后才移除迁移值/挂起项 |
| 同文件 @99691、100701 | `hostStorage.kind` 用于从旧 configuration/global-state/persisted-atom 取迁移值。**不能由 reduced-motion 的 global-state 分类推断当前仍只保存在 global-state**；该值也进入统一 desktop 配置写链 |
| 同文件 @97320 | setAndPersist 支持失败回滚已应用状态并发出 change listener；官方 write side effects 在主进程另有链路，静态支持不证明跨窗口延迟 |
| 同文件 @2858、2893 | TOML encode 对 schema 对象内的 null 字段省略；decode 补 nullable 字段。主题 `fonts` 直接带 null 发协议会失败，不能照搬前端 JSON |
| `.vite/build/src-CTNXdakG.js` @144336、146170 | 本轮八键与 schema：appearanceTheme、sansFontSize、codeFontSize、reduced-motion-preference、浅/深 ChromeTheme、浅/深 CodeThemeId；schema/默认值并非 CSS 反推 |

`.vite/build/main-BPBEjAxi.js` 已核验原始提取见 `.ref/parity/16.01/actual/16-01C-research/store/manifest.json`：SHA-256 `2327d031e32c8d80c0dbf9bd81144466a90f8e49d3bc64e6604c23fbab900d7f`；@5056659 的 `getUserSavedConfiguration()` → `settingsStore.initialize` → `batchWriteConfigValues` 回调明确委派 app-server `config/batchWrite`。这与上述 store 形成读写闭环。

## 本轮实现合同

`src-tauri/src/appearance_preferences.rs` 与 `lib.rs` 注册独立命令，复用已有 app-server 连接，不加依赖、不修改官方包：

- `appearance_preferences_read`：`config/read {includeLayers:true}`，不传项目 cwd。返回八键对象。有效配置 `desktop` 中存在该 key 时使用它；只在 key 缺省时读取旧 desktop_state JSON，保留旧值且不自动迁移写入。
- `appearance_preference_write {key,value}`：只允许八键，验证模式、字号、完整主题结构/颜色/对比度/字体与官方 preset enum；单个共享异步锁串行化读写。写前读配置，选择 `name.type=user` 且无 profile 的层，明确传其 filePath 与 expectedVersion，防止写入当前项目或静默覆盖外部编辑。
- 实际写 `desktop.${key}`，replace 与 reloadUserConfig。只接受服务 `ok/okOverridden`；后者不等于有效值一致，前端必须再读并比较。写入成功后仅向调用方以外的 webview 定向发送 `appearance-preferences-changed {key}`，不携带偏好内容；调用窗使用自己的确认读取，避免组合保存期间被自身事件重载锁打断；广播失败不把已经提交的写入伪装成失败。
- 写命令不做确认读取；前端独立 read+比较。这样写成功而确认失败可报告“已写但未确认”，不会不当回滚已经保存的真实结果。
- theme 的 fonts.code/ui/content 为 null 时写前省略；读回 theme 时补三者为 null。其余 schema 验证和前端规范化仍须保留。
- 旧 `desktop_state_set` 不增加重复广播，其他偏好存储行为不改。本轮不删除 JSON 中的旧外观值。

## 隔离真实协议结果

运行：`node .ref/parity/16.02/actual/16-02B-research/host/probe.mjs`，退出码 **0**。实际版本、临时 home、请求、响应保存在 [protocol-appearance-preferences.json](../../.ref/parity/16.02/actual/16-02B-research/host/protocol-appearance-preferences.json)。该脚本只允许 initialize/config/read/configRequirements/read/config/batchWrite，独立临时 CODEX_HOME、清空API key、隐藏子进程窗口，无账号认证和模型 turn（0）。

已实测：用户层/版本存在；八键（含完整浅深 theme 对象与代码 preset）写入并重新读取；原始 fonts:null 导致 `configValidationError: invalid type: null, expected any valid TOML value`；按官方规则省略后全部读回相符；陈旧 expectedVersion 拒绝且未覆盖；null 顶层编辑删除字段。测试只在临时 home 写配置，不修改真实用户/官方配置。

Rust 限定回归在本模块 `tests`：只从缺省键读 legacy、用户层精确选择及版本、不允许未知/非法值、TOML nullable 字体往返。委派约定不在此子任务运行 Cargo；由主线程统一串行执行，不提前宣称通过。

## 未验边界

此证据不包含官方实际双窗口时序、系统 native theme API、像素/DPI对照、原生焦点、跨设备强调色或透明窗口。事件仅通知本应用实例的已连接 Tauri webviews，外部手工改 TOML 的主动文件监听尚未实现；重读能发现变化。组合 theme/preset 的事务与失败恢复由前端队列负责，后端每次命令单键写；不声称服务器支持跨命令原子事务。官方模型执行/服务权限没有通过本次设置协议探针验证。
