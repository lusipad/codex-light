# 16.02A 外观模式、双字号和减少动态效果

日期：2026-11-01。功能增量自动自验通过；整个外观分区未验收。

## 合同与实现

先完成[修改前合同](../specs/16-02-appearance.md)，固定原包五项资源与[消费者及写入语义](../../../.ref/parity/16.02/runs/20261101-codex-appearance-research/reference/consumer-trace.json)核验。引用偏移为原始 UTF-16，未将 scratch 换行后的偏移作为原包定位。

- 新增 `appearancePreferences.ts`：独立读取 `appearanceTheme`、`sansFontSize`、`codeFontSize`、`reduced-motion-preference`，复用真实 desktop_state 持久化。初始读取和写入使用同步锁，成功后读回校验；读取失败可重试，卸载后不回填。
- 模式 system/light/dark，订阅系统 matchMedia；固定模式覆盖系统。模式按官方语义等待写入确认再更新，其余三项乐观更新、写失败回滚。写入已成功但确认失败保留新字号并明确报错，不假装已回滚。
- `AppearanceSettings.tsx`提供模式、减少动态效果三态及两个数字输入。界面字号11–16、代码8–24，默认14/12，支持小数；blur/Enter解析校验，相同值不写，非法恢复，IME期间不提交。输入框区分 saved/unconfirmed/failed，避免确认失败时显示旧值并在下一次失焦覆盖已存新值。
- root 写独立 UI/code 字号；UI 12个文字token按sans/14后取整。现有 CSS 和 TSX 固定字号改为token或比例表达式，固定行高随UI字号缩放，默认14尽量保持原尺寸。聊天代码、diff、工具输出、审批命令、原始JSON、编辑器等独立消费代码字号，未在缺乏合同的情况下改变xterm字号。
- 既有配色只写 palette 变量，避免 inline 背景/文字直接压过浅色模式。旧色板保留兼容，未称其为官方完整主题集合。减少动态效果合并系统偏好，并由全局动画、过渡和滚动规则消费。

复用现有 React、持久化、表单和样式变量，没有新依赖。产品改动涉及共享文字消费者，不能只凭设置控件回放宣称所有页面视觉通过。

## 验证与证据边界

`verify-appearance.mjs`执行生产hook与实际输入框commit：范围和小数、真实命令形状/读回、系统切换和固定覆盖、双字号独立、减少动态效果、乐观更新及失败回滚、初始读期间拒写、同步单飞、重新读取恢复、卸载晚到与监听清理。输入框部分成功回归已通过。上述为L2执行回放；CSS消费者检查为L1声明检查，未称浏览器computedStyle通过。

首页专项回归通过，默认标题字号28px/行高34px保持合同。完整 `verify-all.ps1` 退出0，含TypeScript、前端生产构建、隔离协议探针及现有回归。全量Rust和原生构建结果以本批 actual 日志及最终 manifest 为准。无独立lint配置；Vite大chunk、Node DEP0190和既有Git换行警告保留。

## 未验证与剩余缺口

1. 真实官方同环境宽窄截图、像素差异、所有页面字号变化后的裁切/弹层/滚动、原生焦点/IME/重启均未验证。没有成对图片，visual-verdict记not_executed、score null，不评假分。
2. 浏览器导航/重新附着均超时；临时fixture没有产生可用computedStyle。空的DOM文件和浏览器日志不算通过。Vite测试进程已停止。
3. 隔离无头浏览器验证命令被自动审批拒绝，仅返回 `blocked by policy`，无更具体原因；未绕过限制继续执行。
4. 完整浅/深配色与代码主题、指针偏好、原生系统主题桥、恢复默认覆盖独立设置尚未完成；模式表单布局仍需官方视觉校准。matchMedia订阅回放不能替代Windows系统变化实测。
5. 用户未验收；未提交推送。本次构建会包含前序尚未提交的开发增量，必须结合manifest的HEAD、dirty摘要与输入指纹识别。

下一分区[16.03快捷键合同草案](../specs/16-03-keyboard-shortcuts.md)已先保存原始归档三项核验；改绑、冲突和持久化仍需进一步追踪，不沿用静态列表作为完整实现。

## 最终构建

完整标准检查退出0、全量Rust **100项通过，0失败**、Release/MSI/NSIS退出0。223项输入（全部src、Rust源码、capabilities、scripts与构建配置）前后SHA-256一致。限定范围只读复核未发现新的阻断缺陷；专项复跑退出0。

[本批EXE](../../../dist-artifacts/16-02-appearance-20261101/CodexNative.exe)：14,084,608 bytes，SHA-256 `716B3FE1B9281C656245800B40EEB3A171BF23015D9454B4859BD315616D0AE1`。HEAD `97a4eca9f0a3bb529620c610f273b14057a4470c`，包含未提交改动；[build-manifest](../../../.ref/parity/16.02/runs/20261101-codex-appearance/actual/build-manifest.json)保存指纹、dirty摘要和退出码。原生构建通过不代表原生操作或像素通过。
