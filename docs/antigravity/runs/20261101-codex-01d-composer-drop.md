# 01D Composer 主体：真实路径拖放

## 修改前调研与合同

按用户最新要求，在 01C 已有内容回归后推进 Composer；前序最终验收欠项保留。本轮聚焦 A22 实际文件拖入，不扩展语音/模型/权限菜单或图片粘贴。

固定候选 Windows 官方 26.928.21956 / build 12404 的 `app-initial-fd3c4b862660.js`（SHA-256 `577A50E29502F573E2FBCCF4940B9BD875339DB420D6D5A9798A0D201EE0AFF1`）：

- `Qds` @8619141 附近通过 `electronBridge.getPathForFile` 或非空 `file.path` 取得实际路径，去重；不是把 `file.name` 伪装为磁盘路径。该函数是共享拖放路径工具，不能单独证明 Composer 所有运行时分支。
- @10819604 附近的图片附件分支通过桥接路径或临时文件持久化取得 `localPath`。这里只移植实际文件路径能力，不声称覆盖图片粘贴/远程上传全部分支。

本机已安装 `@tauri-apps/api` 2.12.4 的 `webview.d.ts` 明确 `onDragDropEvent` 提供 `enter/over/drop/leave` 与 `paths`，位置为 WebView 左上起算的物理像素；现有 capability 已有 `core:event:default` / `core:webview:default`，不添加权限或依赖。

当前 `ComposerBox.handleDrop` 用 `(file as any).path || file.name` 创建附件，但标准 WebView 的 File 不提供原始路径，且当前组件没有原生拖放订阅。验收合同：

| ID | 操作 | 预期 |
|---|---|---|
| CD01 | 原生 enter/over 进入/离开 Composer 区域 | 物理像素按当前 devicePixelRatio 换算，提示只在 Composer 内显示 |
| CD02 | 原生 drop 文本/图片路径 | 复用 `createAttachedFileItem` 与当前草稿回调，保持真实绝对路径，不发送任务 |
| CD03 | 原生 drop 到 Composer 外、leave | 不附加，清理拖入提示 |
| CD04 | DOM drop 只有文件名 | 不生成伪附件，提示改用附件按钮 |
| CD05 | 原生环境同时出现 DOM drop | 只由原生事件提交，避免双重添加 |
| CD06 | 卸载发生在监听注册完成前/后 | 均释放监听；卸载后事件不能写入新草稿 |
| CD07 | 草稿回调更新 | 原生监听使用最新回调，不将附件写入旧会话闭包 |

L2 测试直接执行生产 effect 与 drop handler，真实操作系统拖动、图片预览和后端保存需原生验证，不能由事件样本直接记为通过。

## 同单元补充：多行输入主体

继续检查 A23：当前 textarea 固定两行，`max-height` 不会使其随内容增长。官方 initial chunk @1329451 的实际编辑器 class 为 `overflow-y-auto`、`max-h-[min(25dvh,var(--composer-editor-max-height,25dvh))]`（form 另有限制 7lh，不套用到当前 Codex Composer）。本项目使用 textarea 等价实现：文本增长时按 scrollHeight 增高，清空后缩回 CSS 最小高度，宽度变化时重算；高度上限按官方 25dvh 约束，不改变已有最小高度或字体数值。CM01–CM03 执行生产 layout effect 验证增高/缩回、宽度重算和 observer 卸载；浏览器另验实际高度与滚动范围。

浏览器同时确认 Composer 无项目时仍显示 `codex-app-offline`。沿用 01C 同哈希 `app-primary.js` 的 `kAt`，`composer.localCwdDropdown.noProject` / `chooseProject` 的固定中文资源均为“选择项目”，`selectProjectTooltip` 为“选择一个项目来运行聊天”。同步使用真实目录名工具函数，保持首页两处显示同一工作区；不新增第二套选择状态。

## 本轮结果

- CD04 修改前失败：只有 `file.txt` 文件名时仍生成 `path: "file.txt"` 的伪磁盘附件。修复后 CD01–CD07 生产 effect/handler 回归通过；接入 Tauri 原生拖放，按物理位置限制接收区域，订阅使用最新草稿回调，异步注册前/后卸载均释放，DOM 路径缺失时提示使用附件按钮。
- CM01 修改前失败，实际浏览器也复现：18 行内容 `scrollHeight=376`，输入框仍约 56px。修复后生产 layout effect 的增高、缩回、宽度重算、observer 清理回归通过。
- 浏览器实际复验：767×719 视口长输入约 179.86px，改短后约 56px；960×640 视口长输入 160px；1568×934 视口约 233.57px，均采用计算后的 25dvh 上限并保留内部滚动。两种固定视口 pageScrollWidth 均等于视口宽，没有页面水平溢出；测试后清空草稿并还原临时视口。
- 三个专项与 TypeScript、完整 `verify-all.ps1` 最终版本检查退出 0；包含 8 组隔离协议探针及标准脚本所选 Rust 过滤用例，不代表全量 Rust 测试。未配置独立 lint。
- [浏览器尺寸读回](../../../.ref/parity/01/runs/20261101-codex-01cd-main-flow/actual/browser-multiline.json)、[960×640 截图](../../../.ref/parity/01/runs/20261101-codex-01cd-main-flow/actual/browser-home-960x640.png)、[1568×934 截图](../../../.ref/parity/01/runs/20261101-codex-01cd-main-flow/actual/browser-home-1568x934.png)均保存。本轮不含真实模型调用。浏览器缺少 Tauri 服务，故截图是无项目/无账号能力状态，不能替代官方等价场景或原生协议验证。
- 仍待：操作系统真实文件拖入、原生缩放下的命中范围、真实附件保存/图片预览、图片粘贴、IME 物理选字与官方同条件像素。语音/模型/权限菜单另由 01E 或后续单元处理；本页未用户验收。
- 独立 Tauri Release/MSI/NSIS 构建退出 0；[当前 EXE](../../../dist-artifacts/01CD-home-composer-20261101/CodexNative.exe) 为 14,032,896 bytes，SHA-256 `E918DDE6EFF30AD54730F14B8E03E5C679DD53BAC7C34EED35A6D7213C741BD2`。[构建清单](../../../.ref/parity/01/runs/20261101-codex-01cd-main-flow/actual/build-manifest.json)记录父提交、未提交文件与输入哈希，核验检查/构建前后相同。该 EXE 尚未原生交互，未提交/推送。
