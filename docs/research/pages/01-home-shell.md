# 01 首页与公共壳调研入口

2026-11-15。当前按[整页交付计划](../../WHOLE-PAGE-DELIVERY-PLAN.md)执行。状态为开发/自验中，严格1:1及用户验收未完成。

本页详细来源、区域树、H01–H15差异及动作合同维护于[01H整页规格](../../antigravity/specs/01H-whole-home.md)，执行结果维护于[01H整页验收记录](../../antigravity/acceptance/01H-whole-home.md)。旧局部批次不作为当前整页放行依据。

## 固定参考

- 已安装Windows Store版本26.1103.4239.0，app.asar SHA-256为`fb47d6491dc3006b708cb1e14de479b882bf50f88b7daa81818f154c253266aa`。
- 普通Codex入口605278→634175，与Quick Chat及共享Work/Chat首页分开。
- 主内容、Composer wrapper、标题样式及平台覆盖取证见`.ref/parity/01/whole-page/reference/layout/report.md`、`composer-report.md`与清单。数字为UTF-16偏移，提取条目核验asar integrity。
- Windows菜单顶条36px、普通Electron主toolbar46px、导航轨52px、默认侧栏340px、内容wrapper768px均是当前已追踪静态分支的CSS合同。真实DPI、缩放及账号门控待核定，不能直接声称1物理像素验收通过。

## 当前闭环重点

无项目/项目草稿、模型cwd、权限槽和请求归属保持一致。第一次创建失败时保留草稿作用域，显式选项目后重试使用所选目录。无真实Git分支时不生成main。侧栏拖动保存后读回，并串行处理折叠重挂的在途保存。

真实回调与组件回放、隔离原生GUI、真实app-server协议探针分别留证。原生GUI夹具明确拒绝模型执行，不冒充真实模型完成。物理IME、完整焦点顺序、多窗口及官方同条件截图仍未完成。

## 当前限制

官方注册应用被工具映射到ChatGPT.exe，computer-use规则禁止自动操作ChatGPT桌面UI，未绕过该限制。需要人工或用户提供匹配版本、尺寸、主题、语言及缩放的官方首页和弹层证据。远端Windows CI另受GitHub账户付款/支出上限阻塞；未通过同提交托管CI前不发布。
