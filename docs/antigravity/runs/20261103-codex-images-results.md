# 2026-11-03 Images与Quick Chat复核修复

先研究、后修改：17B按官方newProjectlessTask/hotkeyWindow分离入口，补多窗口审批/监听与快捷键范围；19依据真实路由、30项原包证据与CLI schema撤假图库和定时SVG，补真实会话图像消费者。规格与验收分别见17B、19A。

当前尚未完成全App，也未通过完整19页原生/像素/服务验收。复用现有线程/文件预览与样式，无新增依赖、无提交推送，保留既有未提交改动。

本轮检查日志和产物身份集中.ref/parity/19/actual；旧17B/18A产物含已识别的入口错配，不作为修复后证据。带调试参数的隔离App启动此前被自动审批拒绝，仅返回blocked by policy；未重试该动作。

最终检查与常规EXE/MSI/NSIS均退出0，167输入稳定；当前限定增量待用户验收。详细manifest见.ref/parity/19/actual/build-manifest.json。20 GPTs只读取证已完成，尚未修改产品。
