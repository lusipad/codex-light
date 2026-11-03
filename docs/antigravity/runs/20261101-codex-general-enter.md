# 16.01A 通用设置：发送快捷键真实消费

日期：2026-11-01。增量自动自验通过；整个通用设置页未验收。

## 来源与实现

修改前完成[范围与合同](../specs/16-01-general-settings.md)，固定原包的[键盘与中文证据](../../../.ref/parity/16.01/runs/20261101-codex-general-settings/reference/composer-keyboard-trace.json)已核 entry integrity。多行判定来自实际文档段落/hard_break，textarea 使用实际换行；视觉折行不改变发送模式。原包不是服务端、账号能力或原生观测的替代证据。

- `composerPreferences.ts`限定 enter/cmdIfMultiline/cmdAlways 三值，未知值回退 enter。
- `App.tsx`读取独立 desktop_state 键 composerEnterBehavior，首页/会话和设置共用受控值；即时写入并读回验证。初次读取前禁用设置，写入同步锁避免重复提交，revision 防旧读取覆盖。写失败还原已加载值，写成功而读回失败保留选择并明确提示确认失败。未写 config.toml、未新增依赖。
- `SettingsView.tsx`使用官方中文三选项和描述。Windows 隐藏原本只有保存、没有执行消费者的防休眠行，其他平台默认 false，并未实现其他平台保活。
- `ComposerBox.tsx`移除每次按键读取旧 localStorage sendShortcut，三种偏好直接控制真实发送；IME guard 优先，Shift/Alt+Enter 保留换行，运行中已有相反 follow-up 快捷键保留。
- `ComposerAutocomplete.tsx`将既有候选生成复用给输入框及列表，鼠标与 Enter/Tab 选择同一项，确认补全不能同时提交模型。

## 回归与审查

GS02 红阶段捕获 cmdAlways 普通 Enter 仍发送，见 actual/before.log。GS01–05 执行生产 handler/effect/callback，覆盖三模式、实际多行、修饰键/IME、补全优先、独立键、读回、重新挂载、单飞、写失败回滚、读回失败/不一致、旧读与卸载。Windows 行条件是源码级检查，不能代替原生界面观察。

独立只读审查发现启动读取未完成时的失败回滚竞态，已用初始 pending 锁和禁用选择修复并补回归。完整检查首轮的 Composer 菜单测试 React 桩缺少 useMemo，已补桩后专项通过；失败日志保留，不隐去首次失败。

既有 composer-keys 继续执行真实 mouse send 接线和草稿清理、失败保留、late-edit、附件快照回归；composer-menus 继续检查五组菜单焦点/Escape/Tab/IME。

## 当前限制

- 旧恢复出厂按钮仅重置 desktopPreferences/colorTheme，尚未重置独立发送快捷键；不能宣称完整默认设置恢复。
- 首次偏好读取完成前 Composer 使用默认 enter，读取失败明确报错；原生启动期间的输入行为未对照官方。
- 当前运行中反向动作固定 queue，只覆盖默认 steer 的情况；尚无官方 followUpQueueMode 全量配置及反向 steer 对齐。
- textarea 没有官方富文本 code block 的 Mod+Enter 跳出块和列表语义。
- 默认编辑器、Windows 新终端 shell、语言/WSL 等后续同分区合同仍待实现，旧整页布局未证明与官方一致。
- 未进行官方运行时、原生 UI/IME/焦点及同条件像素对照；无成对截图，visual-verdict 未执行，不评分。用户未验收，未提交推送。

## 构建交付

完整 `verify-all.ps1` 退出0，全量 Rust 95项通过、0失败，Release/MSI/NSIS 退出0；九项绑定输入前后指纹一致。无独立 lint 配置，Vite 大 chunk 与既有 Node DEP0190 警告仍保留。`git diff --check` 退出0。

[本批 CodexNative.exe](../../../dist-artifacts/16-01-general-enter-20261101/CodexNative.exe)：13,962,240 bytes，SHA-256 `1EB3EBABD4E5251035E428EF43DECAD97AE742C365205D5B8F8274E219F5EB3B`。HEAD `97a4eca9f0a3bb529620c610f273b14057a4470c`，包含未提交更改，不能只用 HEAD 认定构建内容；详见[源码指纹与构建清单](../../../.ref/parity/16.01/runs/20261101-codex-general-enter/actual/build-manifest.json)。所有日志位于同目录，首轮失败单独保留。
