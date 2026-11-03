# 16.03B：宿主键位文件边界与迁移样本

2026-11-03。补充 `16-03-next-closure.md`；本附录区分 Store 静态语义、产品前向兼容策略和当前验证范围。

## 官方静态迁移样本（Windows）

来源：`.ref/parity/16.03/actual/16-03B-research/raw/src-Dl21kCYQ.js`，原包与 SHA 见主合同。下列是直接根据该文件 `QS / $S / eC / nC` 分支列出的固定样本，不执行官方代码、不代表官方运行时已实测。

| 输入片段 | 官方转换或写出语义 | 原始锚点 |
| --- | --- | --- |
| `{"command":"closeTabOrWindow","key":"Ctrl+W"}` | 展开为 `closeTab` 与 `closeWindow` 两条同键记录 | `wS={closeTabOrWindow:`、`function QS` |
| `{"command":"newThread","key":"Ctrl+N"}` | command 改为 `newTask` | `wS` |
| `focusQuickChat`，没有 `openAvatarOverlay` 记录 | command 改为 `openAvatarOverlay`；已有规范记录时忽略旧别名 | `function QS` |
| `globalDictationToggle`，key非null，且没有 `globalDictationHold` | 转为 `globalDictationHold` | `function QS` |
| 同时有 `globalDictationHold=Ctrl+D` 与 `globalDictationToggle=Ctrl+D` | toggle转为 `globalDictationSingleTap` 的null记录；已有singleTap时不再迁移toggle | `function QS` |
| Windows `composer.startDictation` | 过滤；只有Linux且没有hold时转为hold | `function QS` |
| `nextRecentThread=Ctrl+Tab` / `previousRecentThread=Ctrl+Shift+Tab` | 去掉旧recent绑定，不追加到菜单 | `function $S` |
| `nextRecentThread=Ctrl+J` | 移至 `openCommandMenu`，合并现有/默认菜单键并去重 | `function $S` |
| 未带version的 `nextTab=Ctrl+Tab` 与 `nextTab=Ctrl+PageDown` | Windows旧tab双组合迁移移除Ctrl+Tab，保留Ctrl+PageDown；有null记录或未命中至少两个旧默认候选时不触发该阶段 | `function eC` |
| 同组任意 `nextTab` 记录带 `version:1` | 跳过该组旧双组合迁移；之后仍有与thread命令前缀冲突裁剪 | `function eC` |
| 写出 `nextTab` / `previousTab` | 额外写 `version:1`，防止下次误当旧格式重迁移 | `async function nC` |

Rust文件层不负责解释这些命令、平台别名或默认键。迁移由前端真实命令解析层统一实施；Rust保留原始command、key、version和其他字段，避免文件层与前端双重迁移。以上样本是前端实现的输入，不表示本附录已完成迁移验证。

## 新宿主边界

- `keyboard_bindings_read` 返回 `{bindings,warning,revision}`；`revision` 是不透明的 `content:` + 文件原始字节base64，缺失时为 `missing`。它精确比较文件内容，不是SHA、不应展示或写入日志，不承诺跨实现稳定性。
- `keyboard_bindings_write` 必须传 `{bindings,expectedRevision}`。同宿主窗口写入受共享mutex串行保护；写前重读。Windows以share mode 0打开同一文件handle，在独占期间再次读取并比较原始字节后写入；缺失文件用create_new避免覆盖并发创建。
- 未知command、version与extra字段可原样往返。无法安全消费的记录（如null、没有command/key或错误类型）以及非数组/损坏内容返回warning和空运行态，任何写操作都拒绝，原文件不变。此保守前向兼容策略不同于官方对已知可配置命令的过滤。
- 写成功后读回比较，向其他webview定向发送 `keyboard-bindings-changed {changed:true}`；源窗自行消费写回结果。事件不携带原始文件内容，接收者重新读取。事件链不是任意外部编辑watcher。
- Windows独占语义不代表Unix跨进程锁；Unix只有宿主mutex与写前比较。文件原地写入不承诺断电/磁盘故障时原子替换。
- `keyboard_number_target_read/write` 分别返回 `{value:'tabs'|'sidebar'}`。它与键位文件是两条存储链：读取真实app-server config/read，缺少配置时可读取旧desktop_state，再默认tabs；写入只针对显式versioned用户层的 `desktop.primary-number-shortcut-target`，使用filePath与expectedVersion，写后再次读取有效配置。被上层覆盖不会伪报与请求值一致。

## 验证责任

`cargo test --manifest-path src-tauri/Cargo.toml keybindings` 覆盖私有临时目录的保存/重启、unknown字段与version、并发旧revision、外部修改、损坏/未来格式拒写、精确字节revision、存储失败、编号默认/legacy/配置优先、versioned用户层参数。此子任务遵循串行Cargo归属，未自行执行该命令；以主线程日志为准。未写真实CODEX_HOME、未启动官方GUI、未完成两窗原生事件或官方像素验证。
