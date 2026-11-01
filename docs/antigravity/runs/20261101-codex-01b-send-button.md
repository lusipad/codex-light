# 01B A09：鼠标发送与草稿清理

当前单元仍为 01B，不放行 01C。沿用固定官方版本 `26.928.21956` 的 scope/viewState 与发送快照调研，见[已有附件发送合同](20261031-codex-01b-text-send-attachment.md)。本项修复本项目按钮接线缺陷，不新增官方能力、协议或持久化推断。

## 修改前发现与计划

`ComposerBox` 将 `onSendMessage` 直接作为按钮 `onClick`；`App` 将同一回调接到带可选 `overrideText` 参数的 `handleSendMessage`。React 点击事件因此成为 truthy 的 `overrideText`：虽然文本构造检查了参数类型，但后续 `!overrideText` 清理条件被跳过。键盘处理调用 `onSendMessage()`，不会传事件。原生 shim 测试中已观察到成功回包后原文字仍留在输入框；该观察与接线缺陷一致，仍需修复后的对应构建复验。

1. 执行生产 JSX 按钮回调并传入点击事件，再进入生产发送回调，先复现成功不清草稿。
2. 按钮显式无参调用发送回调；复用现有清理和错误保护，仅修改这一处接线。
3. 运行鼠标/键盘、文字/附件草稿专项、完整标准检查与原生构建，复验原生点击发送。竞态夹具失败保留，不冒充通过。

## 修改前验收合同

| ID | 操作/结果 | 预期 |
|---|---|---|
| SB01 | 点击发送，纯文字成功 | 原文字进入唯一一次 `turn/start`，成功后原草稿清空 |
| SB02 | 点击发送，请求失败 | 文字草稿保留 |
| SB03 | 点击发送，等待时修改文字，再成功 | 新文字保留 |
| SB04 | 点击发送，包含附件 | pending save 标记允许在保存成功后清理原 Composer 快照 |

专项执行实际生产 JSX 表达式和发送回调，属于 L2，不替代真实服务、原生输入或官方对照。界面样式不变，本项不产生像素评分。

## 实施记录

- SB01 修改前退出码 1：`mouse send success must apply the same draft cleanup as keyboard send`，actual `hello`、expected 空字符串。SB01–SB04 修复后退出码 0；文字和附件草稿专项也通过。
- 产品仅将 `onClick={onSendMessage}` 改为 `onClick={() => onSendMessage()}`，不修改发送函数、协议、样式或存储。显式覆盖文本的其他调用点继续使用既有参数。
- 前述原生竞态续测均无效：第一轮仍超出 59 秒释放窗口；第二轮曾有夹具脚本换行错误，修正后又被旧释放标记提前放行。排除原因、时间戳和日志路径保留在[续测排除记录](../../../.ref/parity/01/runs/20261101-codex-01b-attachment-native-race/actual/native-send-button-discovery.json)。不得把 `released:true` 单独当作时序通过，必须核对请求、chip 及回包时间。
- 完整 `pwsh -NoProfile -File scripts/verify-all.ps1` 退出码 0，含 TypeScript、Vite、Cargo check、Rust `automations` 17 项、`workspace` 40 项、`project_` 27 项筛选测试及 8 组隔离协议探针。这些筛选有重叠，不相加冒充全量 Rust 单测。没有 lint 脚本；既有 Vite 大 chunk / SettingsView 导入警告及 Node DEP0190 警告仍存在。
- 首次 `npm run tauri build` 因现有窗口占用旧 Release EXE 失败，完整失败日志保留。没有关闭用户原有窗口；复制既有编译缓存至独立 `CARGO_TARGET_DIR` 后打包退出码 0，EXE、MSI、NSIS 均生成。
- 新构建归档为 [CodexNative.exe](../../../dist-artifacts/01B-send-button-20261101/CodexNative.exe)，14,032,384 bytes，SHA-256 `D30CEDF211D1EE655AF74D7C6CB8589872ACBCDC2F2C8AEA99FD702F77A9EB53`。192 项源码/配置/验证文件在构建前后核对：产品源码不变，仅测试脚本补两处 Composer 接线断言，补充后已重跑专项。HEAD、未提交清单和 dist 哈希见[构建清单](../../../.ref/parity/01/runs/20261101-codex-01b-send-button/actual/build-manifest.json)及同目录 `sources-before.json`。

## 当前哈希的原生复验

在独立 `CODEX_HOME`、WebView profile 和本地 shim 下，真实鼠标点击新 EXE 的发送按钮；UIA 记录发送前 `Value: SB01 native mouse send`，成功回包后 Composer 编辑控件没有 Value，消息区保留已发送文字。Rust bridge 捕获到恰好一次 `thread/start` 和一次 `turn/start`，输入只含原文字，没有附件协议请求。

验收脚本交叉核对请求/回包 ID、时间顺序、输入快照、发送前后 UIA 和构建退出码，退出 0。见[结构化原生证据](../../../.ref/parity/01/runs/20261101-codex-01b-send-button/actual/native-verification.json)，可用 `node .ref/parity/01/runs/20261101-codex-01b-send-button/actual/verify-evidence.mjs` 重核。测试窗口 PID 213996 已退出，既有窗口保留。

该结果只通过 SB01 的当前构建原生路径，回复来自本地 shim，不代表真实模型执行或官方行为对照。SB02–SB04 当前只有 L2。截图为 JPEG、官方配对图与缩放未知，不作像素判定。TS/AS 原生附件时序、官方运行时、IME、同条件像素与用户验收仍未完成，01B 仍开发中。
