# 02B 会话用户消息展示增量

状态：自验中，02 整页未用户验收。

修改前规格与用例：[02B 用户消息规格](../specs/02-thread-messages.md)。

## 本轮实施

- 核验官方 asar SHA-256，并只读提取 user-message、collapsible-user-message-content 和 user-formatted-text 五个资源，逐项校验 archive integrity；清单见规格。
- 新增 `UserMessageBubble` 以保存每条消息独立的布局测量与展开身份；正文超过 20 行高度加 1px 容差时折叠为 19 行和省略号，使用固定中文“显示更多 / 收起”。保留完整文本，不修改会话数据。
- 复用既有气泡宽度、内距、圆角和主题，不套用其他 static/compact 变体。ResizeObserver 处理自然换行和宽度变化，卸载释放；文本身份决定展开状态。
- 提问导航仅在已加载提问至少 4 条时显示；包含既有 `user` 类型，预览不拼接助手内容；跳到 `turn-user-ID`，没有助手回复也能定位。
- 用户消息操作采用既有 SVG/已安装 lucide 图标，保留收藏、复制、重新填入和分叉的原业务路径；focus-within 使键盘聚焦时工具栏可见。没有新增依赖。
- `ThreadFindBar` 在滚动到用户消息前展开其已折叠内容，避免查找命中隐藏行却看不到正文；复制/重新填入仍接收完整 `userText`。

## 检查与浏览器证据

- `node scripts/verify-user-message-presentation.mjs`：UM01–UM11 生产组件/effect/JSX 回调通过；覆盖容差、19行裁切、展开切换、文本变化、布局重测、释放、全文动作、导航阈值/目标、查找展开顺序。已接入完整标准入口。
- `node scripts/verify-thread-content.mjs`：17/17 通过；消息去重专项、旧02检查与 `npx tsc --noEmit` 退出 0。旧02字符串断言只证明相关实现存在，不作为整页完成证据。
- 实际浏览器使用忽略目录中的显式“组件回放，非真实会话”fixture，直接渲染生产 `UserMessageBubble` 和 `ThreadFindBar`，没有调用模型或构造服务执行成功。
- 40 行、24px 行高：原始高度约 960px，折叠正文约 456px，展开约 960px；960×640 与 1568×934 均无页面水平溢出。按显示更多后焦点保留在收起按钮。
- 查找第35行得到 `1 / 1`，自动展开且焦点仍在搜索输入；短提问正文约24px、没有折叠按钮；Tab 后回放操作聚焦，工具栏 opacity=1。
- 单段长文本在960px视口原始高度约1296px、600px补充视口约1968px，折叠正文均456px；600px是组件窄内容测试，不是原生窗口最小宽度验收。
- [浏览器测量](../../../.ref/parity/02/runs/20261101-codex-thread-messages/actual/browser-verification.json)、[960截图](../../../.ref/parity/02/runs/20261101-codex-thread-messages/actual/message-collapsed-960x640.png)、[1568截图](../../../.ref/parity/02/runs/20261101-codex-thread-messages/actual/message-collapsed-1568x934.png)。宽图保留滚动后的视口位置，不作为默认首屏几何基准。

## 保留差距与下一单元

- 用户消息目前仍为纯文本，官方富文本、图片/文件附件、编辑回滚、完整导航预览/当前项与原生持久化不是本轮完成项。
- 当前“编辑”仍为重新填入 Composer，不能声称实现官方修改历史消息的服务语义。未改变此操作，等待完整合同。
- 同条件官方截图/缩放、原生物理输入与真实会话交互未采证，visual-verdict 使用未验证信号，不报告相似度或1px通过。
- 查找揭示隐藏行已验证；收起后阅读位置保持与官方精确行为仍待对照。后续推进02A顶栏、02C富内容，不在本轮继续扩张菜单细节。

## 最终构建与检查

- 完整 `pwsh -NoProfile -File scripts/verify-all.ps1` 退出 0，包含8组隔离协议探针及既有过滤 Rust 测试；没有新增独立 lint，不是全量 Rust 单测/原生验收。既有 Vite chunk 大小与 DEP0190 警告保留。
- `npm run tauri build` 退出 0，Release/MSI/NSIS 成功；[归档 EXE](../../../dist-artifacts/02B-user-messages-20261101/CodexNative.exe)，14,034,432 bytes，SHA-256 `6C5DA2F2A0F0FF50CF66C10E7C86454245C32870D84D6BDC3C9F4C568BD0FBA3`。
- [构建清单](../../../.ref/parity/02/runs/20261101-codex-thread-messages/actual/build-manifest.json)、[专项](../../../.ref/parity/02/runs/20261101-codex-thread-messages/actual/message-presentation.log)、[完整检查](../../../.ref/parity/02/runs/20261101-codex-thread-messages/actual/verify-all.log)、[打包日志](../../../.ref/parity/02/runs/20261101-codex-thread-messages/actual/tauri-build.log)保存于本轮目录；6项绑定输入哈希未变，父提交与dirty摘要已记录。
- 临时浏览器视口已恢复，回放页与本轮 Vite 进程已关闭。新 EXE 尚未原生交互；未提交/推送。
