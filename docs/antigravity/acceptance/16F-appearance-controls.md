# 16F 外观颜色与导入：阶段记录

合同：[16F 动作合同](../specs/16F-appearance-controls.md)。当前限定自动/浏览器验证和原生打包通过；原生交互受工具阻塞，外观整页和用户验收未通过。

## 实现与简化

- `AppearanceColorPicker.tsx/.css`：页面内136×136 HSV色板，24px色相轨、28px指针，固定定位/夹紧/翻转/滚动更新，鼠标与触摸pointer capture，方向键每步5%或18度，Escape关闭归焦、外点关闭、监听清理。
- `appearanceColor.ts`：仅颜色转换；177项结果与固定官方包转换函数实际执行的样本一致。保留浮点运算顺序，避免 `h/60` 与 `h/360*6` 在半通道边界相差1。
- `AppearanceSettings.tsx`：完整颜色立即写，不完整输入失焦还原；连续编辑累积最新主题patch，复用原 `saveTheme` 串行写入及真实读回。等待期间忽略较早读回，不丢最终选择、不清除字体/对比度；失败后回到真实已读值。导入改单行code输入、完整分享校验、form/Enter提交、关闭按钮、保存锁和同步重复提交锁。
- 删除本次替换后孤立的系统颜色控件CSS、颜色错误状态与textarea样式；复用现有主题解析、分享、保存队列及读回，不新增依赖或后端接口。

## 已有证据

原始包清单：`.ref/parity/16/actual/16F-appearance-controls/manifest.json`，本轮重新计算整个asar哈希并核对两个entry integrity。

- `ui-red.log`：修改前新用例真实失败，`#bad` 失焦没有恢复 `#181818`。
- `verify-appearance-color.mjs`：72个hex→HSV及105个HSV→hex官方样本，生产控件方向键、禁用、pointer capture、边界夹紧、失败读回后释放手势恢复。
- `verify-appearance-theme-ui.mjs`：原预设/字体保值/竞态/导入/剪贴板/焦点用例保持；新增即时颜色/IME、连续颜色patch、非法分享禁用、重复提交、失败留稿、忙时隐藏关闭按钮。
- 浏览器使用真实SettingsView/外观组件/偏好hook，桥为内存写→读回，CSP禁外网，未写真实配置。仅证明此传输下的前端行为。
- 1280×800与640×800：色板均136×136 CSS px，窄窗页面scrollWidth/clientWidth均640，弹层没有越界；打开不夺焦，Escape归圆点；不完整色值失焦恢复；损坏分享禁用、有效分享Enter成功后关闭归焦；Tab/Shift+Tab环绕及取消/Escape；控制台无error。
- 真实浏览器连续拖动 `(940,420)→(1040,490)` 得到最终 `#370909`；拖出面板到 `(1180,300)` 后夹紧为S=100%、V=100%、`#ff0000`，随后恢复测试背景。浏览器pointer注入不等于物理设备/原生窗口验证。
- 截图：`.ref/parity/settings-16F-20261104/browser-settings/{color,import}-{wide,narrow}.jpg`。原始JPEG，不当作无损像素差图。结构化视觉判断在 `.omx/state/parity-16F/ralph-progress.json`，缺官方配对图，score=null，未评分。

## 未验及后续

- Windows computer-use 的 `node_repl` 初始化返回 `failed to write kernel assets: 系统找不到指定的路径 (os error 3)`，未能启动原生UI自动化。因此真实Tauri焦点、物理键鼠、中文IME、触摸及多窗保持未验；构建不能代替它们。
- 字体目录/字形接口尚未接入，字体仍为手动输入；账户强调色、Mode官方图形、官方Dialog精确几何及Popover原生焦点规则仍未对照。未以静态资源存在宣称当前账号可用。
- 官方DPI/缩放和同环境截图缺失，不能宣布像素或外观整页1:1；本轮只交付颜色与导入阶段。
- 下一批继续外观字体目录及样式选择，先定位原生目录形状/字体标识与fallback，再实现；不跳到通知页。

## 自动检查

- 完整非Fast `verify-all.ps1` 退出0，包含其实际分组Rust与隔离协议探针，不称为本轮另跑全量464 Rust测试；原始日志/退出码在 `.ref/parity/16/actual/16F-appearance-controls/verify-all.{log,exit}`。
- 标准运行中继续收敛了手势失败恢复、浮点顺序、大小写与即时草稿显示。冻结最终源码后，五项外观回归再次全部退出0，各自日志与颜色官方样本保留；不声称标准启动至结束输入完全不变。
- 568个构建/测试输入清单在 `.ref/parity/settings-16F-20261104/inputs-frozen.json`，仅约束后续原生构建前后。源码构建中自带TypeScript与前端生产构建，最终构建结果另列。
- `git diff --check` 退出0；未配置独立lint，不编造lint或静态分析通过。

## 原生交付

- `npm run tauri build` 退出0，TypeScript、前端生产包、release EXE、MSI、NSIS均成功。568个构建/测试输入在构建前后逐项SHA复核一致；未将早期截图或旧EXE用于本轮构建结论。
- 8项产物（EXE、MSI、NSIS和5项主题许可）保存于 `dist-artifacts/settings-16F-20261104/`，清单在 `.ref/parity/settings-16F-20261104/build-manifest.json`。
- 可运行EXE：`dist-artifacts/settings-16F-20261104/CodexNative.exe`，22,841,856 bytes，SHA-256 `8fcf83cb566c67a11b761e8f05e20ad59e7d798cb7ece30c7b1eb1df8cff1da9`。
- 构建基线 `0e6e7120b646ff089e323c10640d250a8dc50c83` 加本轮16F改动；源码通过冻结输入绑定。阶段提交不代表原生交互或整页验收；本轮只留本地提交，未推送、未触发新的远端CI。

测试路径：设置→外观→点击背景/前景色圆点，拖动/方向键/Escape；输入不足六位后失焦；导入主题，分别输入损坏字符串与同模式有效分享串，用Enter提交。物理IME和原生焦点仍需在此EXE上独立补验。
