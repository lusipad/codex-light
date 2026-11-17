# 设置外观页的固定版本对照

基线为 Windows Store 26.1111.2228.0，package 26.1111.21308。直接读取安装目录的 asar 并重新计算 SHA-256，结果为 `2551cba1057a05cdc5cf5d75b146fac4092bff4ce77a10c43e3286c88d24c82d`。四份清单覆盖 8 个不同资源和 167 个 UTF-16 片段，原始字节、asar header integrity 和片段哈希均通过核对。原料在 `.ref/parity/16/appearance-authorized-layout/` 和 `.ref/parity/16/appearance-authorized-mode/`。

| 控件 | 本次实现与验收 |
|---|---|
| 系统、浅色、深色 | 系统使用两张独立的 40×60 矢量，浅色与深色各使用一张 80×60 矢量。保留阴影、裁剪、currentColor、选中环和 radio 操作。宽窗组宽 272、间距 16 CSS px，窄窗等比缩放。三个模式均完成原生保存读回 |
| 模式卡与主题卡 | 模式独立成卡，第二张卡内依次为主题、强调色、背景、前景、字体。原生测量 1280、960、640 三档 CSS 宽度，卡片间隙均为 16 CSS px，正文无横向溢出 |
| 主题预设 | 触发器为 176 CSS px，带当前主题的圆形 Aa。240 CSS px 主菜单显示默认 ChatGPT 与 Codex 主题入口。宽窗使用侧向子菜单，640 宽窗使用内联子层。原生选择 Dracula 后保持菜单打开，选中态与宿主存储一致。Escape 分层退出后回到触发器 |
| 导入与复制 | 两个动作使用固定版 20×20 矢量及 32×32 按钮。导入无效内容时提交禁用，导入有效的深色分享串后，宿主读回强调色 `#365a9f`，成功提示可见、焦点回到导入。复制成功与失败反馈通过受控回归验证 |
| 高级 | 默认收起。展开后先显示字号组，再显示减少动态效果与分别设置浅深主题的组。减少动态效果使用行内分段，开启、关闭和恢复原值都经宿主读回。分别设置开启后可查看两套主题的普通与高级卡片 |

**预览图的像素比较。** 将安装包对应 SVG 独立提取为四个参考文件，在与原生产品相同的 WebView、主题、位置和尺寸绘制，截取 PNG。每枚图只比较内侧矩形，四边各退 4 CSS px 后向内取整，以排除控件边框和圆角合成。每组实际比较 3,692 个像素。修改前每组有 2,216 至 2,886 个像素不同。最终浅色、深色各测三枚，六组共 22,152 个像素，逐 RGB 比较差异均为零。该结论适用于模式图形内区，整页仍缺少同环境官方窗口截图。

**执行记录。** 隔离应用重启后仍显示 Dracula、深色模式和导入的强调色。12 个相关前端专项、TypeScript、前端构建和原生 Debug 构建通过。初次动效检查过早读取按钮状态，改为等待保存完成和选中态更新后重跑。独立像素检查使用宿主已有 Pillow，未添加依赖。

原生证据在 `.ref/native-local-journey/appearance-reference-60897587/`，重点为 `source-integrity.json`、`before-pixel-results.json`、`final-pixel-results.json`、`final-metrics.json`、`final-preset-metrics.json`、`native-import.json` 与 `after-restart.json`。完整窗口对照、字体栅格化、物理输入法以及 Pages、系统背景等条件控件仍待验证。未运行托管 CI，未推送。

普通 Release EXE 位于 `dist-artifacts/settings-appearance-26.1111-20261118/CodexNative.exe`，SHA-256 为 `2d905e42d885c4cddaaff5d17d1be460592be80f56b6fa1676b12caae838c057`。原生交互与截图使用同源码的 Debug 测试构建。
