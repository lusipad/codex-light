# 16.16B 本地审查偏好与提供商选择增量

状态：本地限定增量自验及构建归档完成，待用户验收；整16.16与官方1:1仍未完成。

## 范围与来源

基准与修改前合同见[16.16B](../specs/16-16B-next-closure.md)，实现过程见[实施记录](../16-16B-implementation-notes.md)。固定Store 26.1027.3384.0，asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`。官方运行时DPI/缩放仍未知，不能用于像素通过声明。

本次提交范围是个人指令保存、链接偏好与错误入口纠偏、真实能力读取、提供商/GitHub实例偏好写入。不是完整Code Review页面交付。

| 合同 | 本次实现和验证边界 |
|---|---|
| CRB01/02 | 官方github/code-review-tab枚举、configured缺失区别、未知值保留；真实通用配置读取，原生浏览器面板不可用时外部回退。动态reviewTabDefault虽读取但尚未接消费者；专用tab未实现。 |
| CRB03/04 | rows=10、3000ms debounce/已保存反馈、立即保存/IME guard、同draft去重与不同draft串行、失败保草稿、离页flush；生产hook/组件回放，原生IME未验。 |
| CRB05 | 私有文件中真实单字段merge、写后读取、未知值/兄弟atom保留、写失败不更新内存；未运行原生GUI重启往返。 |
| CRB06 | 请求身份/代次绑定、scope立即遮蔽、取消/晚响应/晚注册释放、跨窗订阅；跨窗通知保存中合并排队，身份变化仍取消。VM验证不代替真实多窗。 |
| CRB07/08 | 真实bootstrap完整快照解析、未知gate保持null；GitLab gate回退不写回；GitHub真实连接读取与原生新鲜成员复核、同锁expectedValue/CAS；查询失败独立呈现。GitLab企业枚举尚未实现。 |
| CRB09 | 阻止用本地同名branch冒充私人PR审查；远程exact comparison/真实账号消费者仍未接入，入口明确不可用。 |
| CRB10/11 | cloud个人/仓库/权限、官方运行时、原生GUI与配对像素未验。 |

## 本轮修复与证据

证据根：`.ref/parity/16.16/actual/`，本次最终检查和构建位于 `16-16B-provider-ui/`。

- `16-16B-subscription/concurrent-link-save-initial-fail.*`保留旧失败：链接保存读回并发远程指令时，未编辑旧草稿误判为dirty。修复后clean/dirty两交错通过并独立复核。
- `16-16B-provider-ui/peer-save-initial-fail.*`保留旧失败：另一窗口偏好广播静默取消本窗口保存。改为同身份通知合并排队，保存结束重读且保留错误/重试；成功、失败、双广播回归通过，独立复核确认。
- `browser/provider-current.png`为生产组件与隔离IPC夹具的实际Chrome截图；已测企业实例选择、保存失败不冒成功、重试后读回。没有同环境官方参考图，visual-verdict缺输入，不给分或宣称像素通过。
- Rust provider/原子持久专项4项、账号服务专项85项、客户端/指令/UI回归、TypeScript及前端构建均有独立退出0日志。最新完整 `pwsh -NoProfile -File scripts/verify-all.ps1`（非Fast）退出0，含隔离协议探针，日志 `verify-full-final.log/.exit`。本次未另跑全量cargo test，不把标准的专项组合冒称全Rust426项通过。
- 当前源码 `npm run tauri build` 退出0，EXE/MSI/NSIS和5个许可文件已归档，构建前后297项产品输入逐路径/SHA一致。基点64168d8加本次未提交源码的快照详见[构建清单](../../../.ref/parity/16.16/actual/16-16B-provider-ui/build-manifest.json)及inputs-frozen.json；不是上阶段EXE。保留已有Vite大chunk和queue.cancel_owner dead_code警告，独立lint未配置。
- 提交前暂存检查首次发现新组件EOF多余空行（退出2），已修正为单换行并复检退出0；初轮日志保留。完整标准后仅此无行为空白修改；为保持原生构建与最终输入一致重新冻结并打包，首轮构建及输入以before-eof前缀保留，不伪称首次检查通过。
- [可运行EXE](../../../dist-artifacts/16-16B-review-local-20261104/CodexNative.exe)：21,877,760 bytes，SHA-256 `12fdc9d4d3e83c806c5c4a82cbf1f69baf38ac1882bad1d98d5a086869786d7c`。MSI/NSIS和许可同目录。构建通过不代表原生交互或官方像素通过。

## 验收操作与未完成项

使用隔离CODEX_HOME和测试数据，避免修改真实用户偏好：

1. 输入A并保存，在保存期间继续编辑B；确认A结果不清B，B最终原文读回。注入写失败后保留草稿，显式保存恢复。
2. 两窗口分别改链接/指令/提供商字段，确认干净草稿同步、脏草稿保留；保存期间另一窗口通知不能静默取消当前操作。真实Tauri多窗仍待执行。
3. 核真实账号能力后选择可用GitHub实例，重新读取确认三字段；断网、失效连接、旧值CAS冲突应显示失败并保留已保存值。当前仅宿主隔离测试/夹具通过，真实HTTP未验。
4. 验证Tab、输入法、Ctrl+S、关闭重开及窗口操作，再以同尺寸/语言/主题/DPI/缩放对照官方宽窄窗。当前均不标通过。

下一阶段按已补证GitLab模板→授权link→详情过滤合同实现企业实例枚举与原生授权写入，再推进真实provider消费者、专用审查tab、gate默认和远程私人审查；cloud设置另立单元。所有未完成项保留，不以阶段提交关闭全App复刻目标。
