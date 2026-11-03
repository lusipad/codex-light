# 02C 用户富内容增量

日期：2026-11-01。依据：[修改前规格及 RC01–RC08](../specs/02-rich-content.md)。范围为用户 Markdown 接线、图片转链接、折叠可达性和代码边界；02 整页及全部富内容尚未验收。

## 依据与实现

- 从固定官方包提取 5 项资源并核对 archive integrity，保存[manifest](../../../.ref/parity/02/runs/20261101-codex-rich-content/reference/manifest.json)。shared 的 composer 前缀转换使用原包 `ONr`，定位与片段见[证据](../../../.ref/parity/02/runs/20261101-codex-rich-content/reference/composer-prefix.txt)，未直接采用 scratch 的未核验偏移。
- `MarkdownView.tsx` 新增 `user-message` variant：复用现有解析器，支持用户普通段落的连续换行、空行分段、真实 h1–h6 级别和既有基础格式/列表/表格/代码；用户 image 语法转为 `!` 与链接，不生成 img；composer 文件引用去前缀后走现有文件预览。用户代码没有终端执行入口；助手默认分支保留。
- `UserMessageBubble.tsx` 接入上述 variant；App 复用现有文件预览状态，没有新增协议、依赖或渲染框架。全文复制/重新填入仍基于原始 userText。
- 折叠时观察交互元素：链接至少部分可见、其他控件完整可见才可交互，否则设置 inert/aria-hidden；展开/卸载恢复原 aria-hidden，保留预先存在的 inert，释放 Resize/Intersection/MutationObserver。没有把隐藏文本删除，查找仍能自动展开。
- 裁切边界落在代码块内时延长到代码块底部。浏览器首次发现标题外边距使内容原点偏移，代码底部 617.14、裁切底部 600.43，仍切约 16.71 CSS px；[失败记录](../../../.ref/parity/02/runs/20261101-codex-rich-content/actual/code-boundary-before.json)保留。改以裁切容器原点计算，并补 18px 原点偏移回归；复测代码底部 617.14、裁切底部 618.43，代码区不再 inert。
- `styles.css` 仅新增用户模式作用域：继承消息字体/行高、段落零边距、相邻段落 20px、列表 24px 内距等；没有以这些静态样式推断完整视觉一致。

## 验证

- `verify-thread-content.mjs`：23/23，含 RC01–RC04/RC07/RC08 用户模式与原有 17 项助手/查找回归。
- `verify-user-message-presentation.mjs`：原 UM01–UM11 保留；增加 RC05–RC06，覆盖隐藏/部分可见交互、aria-hidden 恢复、保留已有 inert、观察者释放、代码块完整显示与原点偏移。原“DOM 中保持原始 Markdown 字符串”断言改为完整原文传入生产渲染器，并补真实 SSR 的 40 行正文全量保留；Markdown 格式符转为 DOM 后不再要求字符逐字出现。
- `npx tsc --noEmit` 退出 0。完整标准检查及构建最终退出码见[检查结果](../../../.ref/parity/02/runs/20261101-codex-rich-content/actual/verify-all-result.json)与[构建结果](../../../.ref/parity/02/runs/20261101-codex-rich-content/actual/build-result.json)。完整脚本包含 8 组隔离协议探针及选定的 automations Rust 单测，不等于全量 Rust 或原生 UI 通过；本轮未改 Rust，无独立 lint 配置。
- [浏览器证据](../../../.ref/parity/02/runs/20261101-codex-rich-content/actual/browser-verification.json)：导入生产组件，未接真实服务。折叠时 Tab 从顶部链接跳到“显示更多”，隐藏链接 inert/aria-hidden=true；展开后恢复、焦点留“收起”。文件预览回调取得 `src/App.tsx`。宽 960/窄 600（高 800）均无 img，代码区完整可见。
- [960 图](../../../.ref/parity/02/runs/20261101-codex-rich-content/actual/rich-960.png)、[600 图](../../../.ref/parity/02/runs/20261101-codex-rich-content/actual/rich-600.png)为组件回放；通过点击标题将其滚入可视区，不作为官方或默认滚动基准。回放中保持原文本身份的展开状态，不能把切回曾展开文本后的可达链接误判成折叠失败。
- 创建初版 fixture 的组合 shell 命令被自动审批以 policy blocked 拒绝；改用 apply_patch 写文件并单独启动隐藏 Vite 成功，没有绕过浏览器安全或修改审批设置。结束恢复视口、关闭临时 tab，核对 PID/命令行后停止本轮 Vite。

## 保留差距

- 自定义 Markdown 解析器仍未完整覆盖复杂嵌套列表、多段列表、引用式链接/图片、转义和嵌套行内格式、数学、Sites/插件提及与特殊资源。空 alt、链接 title 等边界仍待扩充；不能称为 CommonMark/GFM 全量兼容。
- 标题、引用、表格和代码工具栏大部分复用现有样式，精确间距、字号、语言/行数文案、颜色/图标与官方 tone 尚未逐项对照。
- 本次文件预览只验证前端回调；真实文件读取、外部链接原生打开、真实会话往返及中文物理输入另验。
- 没有同条件官方运行图，visual-verdict 记录未评分，不生成像素通过结论。当前 EXE 原生 UI 与用户验收未完成；后续按队列推进消息/执行卡等主要差距，并保留上述富内容缺口。
- 独立只读审查指出全局 composer 前缀转换也会改写代码中的相同字面内容，并影响代码块复制。复核官方 `user-formatted-text` 在 Markdown 前调用 `ONr`、原包 `ONr` 全局 replaceAll 后，本轮不将其改为仅处理 href，以免偏离已取证合同；保留“代码展示/代码复制可能不同于消息原文复制”的限制，官方运行时实际复制行为仍待对照。审查在其余指定范围未发现新增 P1/P2；此结论不是整页审查通过。
