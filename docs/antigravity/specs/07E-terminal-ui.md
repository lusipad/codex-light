# 07E 本地交互终端呈现与回放输入

2026-11-06，修改前合同。当前 Store 26.1027.3384.0；只读资源及包来源复用 `.ref/parity/all-pages-20261104/reference/manifest.json`，本次重新核对两个 raw 的 SHA-256，均与 manifest 相符。不是官方运行时或像素验收。

| 官方事实（0-based UTF-16 偏移） | 当前实现 | 本轮动作与验收 |
|---|---|---|
| `terminal-tab-5f1486194d20.js:13014` 附近 Ye：`headerRows:[]`，本地 Xe 使用 TerminalPanel，云端分支独立 | shell/目录/字号/中断/清空常驻占用主标题行 | 收紧标签行，把现有兼容操作放入可打开的“终端操作”区；不把该操作区宣称为官方菜单；标签支持键盘导航与关闭，窄窗不挤压终端内容 |
| `terminal-panel-df49353331cc.js:9500` 后 Te：codeFontSize、code font family、主题变化刷新 renderer | xterm 固定13px、固定蓝光标与暗背景，不跟随已保存外观 | 复用当前已应用 CSS 字体/字号与主题色；外观变更更新已存在 xterm、fit 后通知真实 PTY；保留字号临时调节，不回写全局设置 |
| 同文件 `12947` 附近 onData：回放只过滤 terminal-generated，onKey/input/paste 标记用户输入 | 全部 stdin 禁用到解析回放完成 | attach 成功后允许用户输入；回放解析期间过滤自动应答，保留用户键入/粘贴；attach 前仍禁止输入。以生产回调回归证明不重放自动输入、不写已释放实例 |
| 同文件末尾 `ps-4 pt-2 pb-3`、`data-codex-terminal` | wrapper 无 flex/min-height/content padding 专属样式，硬编码暗色 | 本地内容使用16/8/12 CSS px内边距，跟随主题；记录这是静态几何依据，物理像素需等环境配对 |
| initial `j1a` 支持 left/right/bottom 工作面位置 | App 只集成底部 dock | 本轮保留真实 PTY 及底部入口；可移动/恢复工作面需要 App 工作面框架另行集成，不虚构默认方向或声称已完成 |

## 操作合同

- TU01：新建、切换、关闭、隐藏重开，原 PTY id/输出/动作去重行为不变；标签为可聚焦按钮，可继续 Tab 进入终端，方向键/Home/End 在标签集合内导航，Delete 关闭当前标签，IME 组合期间不触发。
- TU02：操作区可显式打开与关闭，Escape 关闭并归还触发器焦点；Shell 仅影响新建会话；目录显示当前标签实际启动目录，而非切换后的全局项目。
- TU03：外观字体/字号/主题变动时，已有终端更新，不创建第二个 session；字号局部调整与外观代码字号均使用8–24边界；A+/A-始终保持增减方向，到边界禁用。
- TU04：附着前用户输入不写入；已附着但回放解析中，自动 ANSI 回答不写回，明确键入及粘贴写回；解析结束自动回答恢复正常；迟到粘贴不写已关闭会话。
- TU05：重复切换、卸载时监听/observer/timer 释放；既有生命周期、命令、环境动作、输出顺序回归不退化。

发布前复核补充：已安装 xterm `src/browser/Terminal.ts:_inputEvent` 在非 insertText、`_keyPressHandled` 或 composed/keyDown 不满足时会直接返回而不产生 onData，`Clipboard.ts:handlePasteEvent` 在无 clipboardData 时亦无 onData。因此不能持久保存一个“发生过 input/paste”的布尔许可。实现必须限制在当前 DOM Event 的同步派发范围（eventPhase 非0），onKey 则匹配同一次确切 key 数据并消费；已结束的输入事件不得放行后续回放自动回答。

异步 IME 补充：`src/browser/input/CompositionHelper.ts:_finalizeComposition(true)` 通过0ms timer读取textarea实际组合段，不能只依赖同步Event。compositionstart记录textarea起点，新composition封闭上一段；compositionend后保留精确文本凭证至xterm该次finalize timer之后。只匹配实际textarea切片、消费一次，不允许ANSI自动应答继承该凭证，取消/到期/销毁必须清除。`_handleAnyTextareaChanges` 中无compositionstart的229键位路径尚未新增专项覆盖，不据本轮通过宣称Windows IME全路径一致。

## 交付边界

执行本页生产回调回归、原有终端/环境动作回归和类型检查。原生打包与全量检查由主线程冻结后统一执行。官方同环境配对图、真实 Windows 组合输入/粘贴/多窗口、移动工作面及用户验收未完成前，状态只能为阶段自验，不得标记整页1:1。
