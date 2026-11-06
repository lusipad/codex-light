# 15I 云端永久删除

2026-11-06。状态：阶段自验完成，待用户验收，不属于preview.2已发布内容。完整归档页、配对像素与真实账号删除仍未验收。

## 来源与范围

按[开发前合同](../specs/15I-cloud-delete.md)实现设置归档行的两种固定DELETE。官方Store26.1027.3384.0整包SHA重新匹配，原7项资源与补入的同版共享错误解析资源核验留证；静态锚点为0-based UTF-16偏移。

task任何404可视为已不存在；conversation只有按官方优先级解析为conversation_deleted的404才认可。两者确认后的弹窗、失败提示和Retry不同，不套用本地聊天删除链，不执行真实账号删除。

## 实施与验证记录

- 客户端DCT01–05先真实红灯（删除方法缺失），实现后通过：固定IPC、来源/ID输入、request/account/user/generation回包、accepted/already-absent、明确宿主失败与晚取消未知；仅IPC夹具，无HTTP。
- 任务错误Retry需全局toast action。复用现有toast样式和计时，补真实button、关闭后调用与一次激活；TA01–04先红灯后通过，覆盖同tick旧计时器不清新toast。独立复核这两部分未发现可证P1/P2，尚不代表真实键鼠或完整页面通过。
- Rust首个固定路由用例在可编译stub上退出101，精确not_implemented，1失败/510过滤；不是编译错误。随后才补正式实现。
- 正式后端9项云端删除专项，加既有本地删除共16项通过；完整160项认证服务回归通过；全库Cargo512项通过、0失败/忽略/过滤，退出0。覆盖真实curl参数及无正文文件、2xx/两类404、一次401/明确拒绝/不确定结果、取消和身份ABA；没有调用真实账号HTTP。
- 页面DU01–12及旧恢复/读取回归、tsc通过，独立复核无新增可证P1/P2。浏览器另复现HTML dialog Tab短暂落body，DU13先红后增加局部双向循环和busy根焦点，再实测通过；物理IME仍未验。
- 同版Modal/按钮/CSS3源23锚点补取证：420px候选宽、20px内边距、18px标题及electron20px圆角（支持superellipse时25px）；仅本弹窗覆盖，保留旧rename。真实浏览器发现旧行danger选择器覆盖padding/background，修正局部特异性；busy焦点的UA轮廓按HSn outline-none纠正，按钮焦点仍保留。主题色复用现有token，不能称官方色值已配对。
- 浏览器为真实双reader、ArchiveView、客户端和从App提取的真实toast回调/JSX，只有host IPC是内存；CSP禁外连。宽窗实测1280×720、DPR1.75；视口覆盖API未改变实际尺寸，窄窗使用同源iframe真实640×800 CSS viewport，未冒称原生窗缩放。最终dialog420px/标题18/25px superellipse/按钮横16纵6、窄文档无横溢出。分别验证取消零写/归焦、busy Escape、失败留窗、task Retry、来源同ID隔离、unknown只读解锁、换号及Tab循环，具体源码边界见browser/results.json。JPEG无官方配对，score=null。

证据根：`.ref/parity/15/actual/15I-cloud-delete/`，完整Rust计数以实际执行范围区分。

## 冻结后统一验证

610项产品与检查输入冻结后，完整非Fast标准385项、32项隔离协议探针通过，退出0；类型检查、生产构建与脚本所列Rust分组均通过。全库512项是另外实际执行的完整Cargo结果，不以标准分组代替；CLI实际0.159.2，无模型turn或真实账号删除。未配置单独ESLint。

提交空白检查另发现新transport验证脚本末尾多一空行，仅删该空白；转译结果逐字相同，DCT专项再执行通过，证据post-check-whitespace.json。341产品输入与EXE未变，未为纯空白再重跑全套。

Tauri debug构建退出0，341项产品输入、3项前端产物和EXE哈希绑定保存。私有CODEX_HOME/WebView实例实际执行Ctrl+,→设置归档→刷新，两来源未登录提示、筛选菜单/Escape及正常关闭，相关主进程和私有WebView已退出；未登录原生验证不能证明已登录DELETE或本次云端确认窗已在原生跑过，AX只报告RootWebArea，精确原生归焦未证。没有本地MSI/NSIS或新的远端CI。

可运行阶段EXE：`dist-artifacts/archive-15I-20261106/CodexNative.exe`，SHA-256 `b9d243b285bd56c6b8ac8b0f4b685b395aa443c30e1a622137b016ed6f14c418`；附build-inputs.json。此为本轮debug产物，与已发布preview.2安装包区分。阶段本地提交，后续页面增量完整后再推送/决定新预览版。

## 限制

真实账号永久删除、服务器提交/取消竞态、完整内部viewer及跨工作面缓存引用、官方同环境配对像素、物理IME、多窗与用户验收仍未验证。task Retry专用中文键在固定语言包缺失，默认Retry的实际官方运行时呈现未证。全局toast保留本项目原布局/3200ms计时，不宣称官方像素或时长一致。
