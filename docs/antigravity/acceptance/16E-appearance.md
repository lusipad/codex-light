# 16E 外观定向自验

合同：[16E 外观逐控件纠偏](../specs/16E-appearance.md)。当前结论：定向回归完成，主阶段浏览器/原生和官方配对视觉仍待验；用户未验收。

## 变更

| 文件 | 变化 |
|---|---|
| `src/components/AppearanceSettings.tsx` | 有名称的三模式预览radio、紧凑主题设置、导入复制图标、真实菜单、px字号行、重排高级区、有改动才显重置 |
| `src/components/AppearanceSettings.css` | 仅外观作用域，移除大卡效果，272px模式组、176px主题触发器、96×28px颜色控件 |
| `scripts/verify-appearance-theme-ui.mjs` | 结构与默认重置回归；原预设竞态/字体保值/输入法/导入焦点等断言保留，适配共享菜单边界 |

简化：删除无官方来源的 Aa 预览块与色条，复用常规设置菜单和现有保存/重置/导入逻辑；未新增依赖或扩展后端。

## 已执行证据

路径：`.ref/parity/16/actual/16E-appearance/`。

| 检查 | 退出码 | 说明 |
|---|---:|---|
| 新结构回归 `ui-red.log` | 1 | 旧源码没有模式预览，0 != 3；真实失败保留 |
| `node scripts/verify-appearance.mjs` | 0 | 生产偏好hook、读回、写失败回滚、样式声明 |
| `node scripts/verify-appearance-theme.mjs` | 0 | 2688项固定版本语义比较及主题模型/分享 |
| `node scripts/verify-appearance-theme-state.mjs` | 0 | 双主题独立、顺序写入、部分失败、读回、跨窗事件清理 |
| `node scripts/verify-appearance-theme-ui.mjs` | 0 | 结构、顺序、默认reset、预设保值与竞态、复制/导入、颜色IME、Dialog Tab/Escape/焦点 |
| `npx tsc --noEmit` | 0 | 当前组合源码类型检查 |
| `git diff --check` | 0 | 未发现空白错误 |

没有配置独立lint，不编造lint通过。未在子任务执行Cargo、全标准、原生构建、账号HTTP、真实配置写入或提交。

## 仍需主阶段核验及缺口

以下是16E当时的未验项，颜色与导入的后续实现和核验见[16F阶段记录](16F-appearance-controls.md)；16E历史截图不自动升级为16F证据。

- 1280/640宽窄截图与菜单开合、溢出由主线程统一浏览器夹具核验；共享菜单自身的键盘及fixed portal定位由常规组专项覆盖。
- 无同环境官方截图，视觉score为null；Mode图形是结构示意、原生SVG/tooltip未像素对齐，按钮图标也未宣称官方资产一致。
- 官方导入弹层形态、完整系统字体搜索/字形选择、账户强调色与官方颜色popover尚未恢复。
- Windows backdrop支持能力、pointer cursors等额外偏好未新增；默认reset条件按已支持高级字段判定，不代替官方全偏好集合。
- 原生IME、焦点、多窗以及用户验收仍未完成；自动回归不表示页面1:1。
