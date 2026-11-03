# 02C 会话富内容：用户 Markdown 增量合同

日期：2026-11-01。先调研后开发；本增量覆盖用户正文 Markdown、图片转链接和折叠区域可达性，助手现有渲染必须回归。数学、复杂嵌套、引用链接、插件提及和附件另有缺口，不能以本轮代表全部富内容完成。

## 官方证据

- 固定 asar SHA-256 `17E75CE60122666AA46598A9876A0C56D1DA30589824708BDB59C90D8377F5EB`，候选 26.928.21956 / build 12404；[原包提取与 integrity 清单](../../../.ref/parity/02/runs/20261101-codex-rich-content/reference/manifest.json)。
- `user-formatted-text-a359f923a9ed.js` 的 `d`：用户正文走 Markdown，variant `user-message`、tone `user-message`；p 默认零外边距，相邻 p 间距为 mt-5；列表内距 ps-6，外层 whitespace-pre-wrap。
- `user-message-markdown-5b5c3cf92e14.js` 的 `userMessageImage`/`u`：图片语法转成 `!` 和链接，不直接加载 img。composerLink 及 Sites 提及使用专门扩展，现有解析器不能自动宣称等价。
- shared `ONr`：移除 Markdown 目标中的 `codex-text-link://` 前缀，保留原始复制文本；原包定位片段另存本轮 reference。
- `collapsible-user-message-content-48088e642db4.js` 的 `v/y/b`：折叠时跟踪交互元素，完全不可见链接及未完整可见其他控件设 inert/aria-hidden，展开/卸载恢复；边界切到完整 code-block 时把裁切边界延到代码块底部。IntersectionObserver/ResizeObserver/MutationObserver 均释放。
- 上述均为静态合同，官方焦点/原生链接打开、实际字体与像素未实测。

## 修改前验收

| ID | 操作 | 预期 |
|---|---|---|
| RC01 | 用户提交粗体/行内代码/列表/标题/表格/围栏代码 | 按结构展示；用户 heading 级别保留；原文复制回调保持不变 |
| RC02 | 用户普通连续换行/空行 | 同段软换行保留；空行建立新段；段间距按用户样式作用域 |
| RC03 | 用户 `![alt](https://…)` | 显示 `!` 与链接，没有 img 或图片自动加载；助手原有图片仍显示 |
| RC04 | composer 前缀本地链接 | 去前缀后走现有文件预览回调；危险协议不变为可执行链接 |
| RC05 | 折叠文本含底部链接/代码工具栏 | 隐藏交互不能 Tab 进入；展开后恢复，已有 inert 不被撤销 |
| RC06 | 裁切边界落在代码块内 | 整个代码块可见，不能切掉其内部控件或代码 |
| RC07 | 文本变化/窗口缩放/查找展开/卸载 | 重测、可达性更新与观察者释放；查找仍能揭示隐藏内容 |
| RC08 | 助手现有场景 | 原有围栏、表格、安全链接与文件动作回归，不改默认分支 |

复用 MarkdownView 并加用户 variant，不新增依赖，不复制官方运行时代码。变更限于 MarkdownView、UserMessageBubble、App 用户正文接线、用户作用域样式及相应回归。浏览器回放明确隔离于真实会话；官方像素与原生往返另验。
