# 15G ChatGPT 会话归档只读来源

2026-11-06。状态：开发、完整标准检查及限定原生自验完成。不是整页、像素或用户验收。

## 依据与实施

开发前合同及来源纠正见 [15G资格与会话规格](../specs/15G-archive-eligibility.md)。本轮重新核验 Store 26.1027.3384.0 与整包 SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`；9项参考文件大小与哈希闭环。定位均为0-based UTF-16字符偏移，另注的asar绝对位置为字节。

基础Odt资格读取固定 `/backend-api/accounts/check/v4-2023-04-27` 原始账户字典，按官方排序选择第一个当前可访问成员。work-cloud范围独立读取当前token原始计划，不能与inventory或RPC计划混用；个人gate与组织settings/gate仅在必要时读取。宿主验证当前身份和完整snapshot，不向renderer暴露token、完整账户或bootstrap，也不接受renderer传入URL、gate或includeWorkCloud。刷新改变已捕获的token计划时终止旧范围请求。

固定只读conversation列表按实际offset/limit/total分页，保留原始日期用于显示，排序独立处理。每次资格重判，范围变化清空旧分页并要求首页重读；普通后续页失败保留已有页。设置归档合并本地、云端任务和ChatGPT会话，source+id独立，gizmo仅按可信实体ID精确匹配。三监听/epoch生命周期仅在两只读来源间复用，各自decoder、分页及错误状态独立。详见 [UI专项](15G-conversations-ui.md)。

本轮复核修正了初稿的账户端点、额外role/ZDR资格限制、work-cloud计划来源及额外customIDs相等限制，保留原始失败/过期证据；没有把早期测试绿灯当作最终来源正确的证明。官方SDK静态锚点和受控hash回放见 `sdk-gate-review.json`，不代表全部实时targeting等价已验证。

## 已实际验证

- 受控官方work-cloud函数224组派生结果；后端135组token/inventory/RPC计划交叉组合，覆盖原始计划独立性及刷新范围变化。
- 专用IPC、客户端解码、真实hook、范围清理、监听失败/重试、换号/取消、三来源UI及生产SettingsView接线均有回归；范围变化在普通reload和后续页两处先红后绿。宿主返回archive_scope_changed同样清旧分页并允许首页重试。
- 独立最终只读复核未发现新增可证P1/P2，未把该复核等同真实HTTP或原生验收。
- 浏览器运行真实两hook、共享生命周期、config/accountRead、服务客户端与ArchiveView；仅宿主IPC为内存，CSP禁止网络。1280×800与640×800内容约768px/552px，无横向溢出、标题唯一。并非完整SettingsView导航夹具。
- 实测同ID三来源、页失败保留/重试追加、serverProjectId拒绝猜配、无效所选日期不显示、资格denied与unknown区分、签出/换号清旧源、两来源独立监听恢复、本地筛选不新增远端读取、菜单Escape回焦及云端写操作禁用。最终源码重建夹具后再测分页、刷新范围变化、中文错误与恢复，保留final-source截图/DOM和输入哈希。
- 证据根 `.ref/parity/15/actual/15G-conversations/`；静态来源位于相邻 `15G-archive-eligibility/reference/`。截图为原始JPEG，不作为无损像素差。
- 最终非Fast标准退出0，380项检查、其中32项真实协议探针通过，零FAIL。认证服务Rust分组143项通过，含15项会话归档测试；没有另跑全库495项。被来源纠正主动停止的早期标准日志名为 `verify-all-superseded-plan-source.log`，退出1，不计通过。
- `cargo build --locked --manifest-path src-tauri/Cargo.toml --bins`退出0，默认custom-protocol内嵌当前生产dist；339项产品输入、3个资产及debug EXE哈希冻结并复核稳定，没有生成新MSI/NSIS。
- 独立私有CODEX_HOME/WebView中，原生快捷键进入设置、打开归档、刷新、两个来源未登录提示、菜单打开及Escape视觉关闭通过；没有伪空数量或真实账号请求。原生AX仅证明菜单消失，精确回焦仍未证实；浏览器回焦另有证据。关闭后初次进程检查仍见退出中的子进程，随后重新核对应用、app-server及对应WebView均已退出，没有强杀。截图/AX与构建输入清单留在证据根。

## 限制与下一步

无真实登录账号HTTP、组织gate/settings样本、完整Statsig实时SDK等价、官方同环境配对图、物理IME、多窗或用户验收。视觉score=null。云端恢复/删除、内部ChatGPT会话工作面及标题导航、历史计划任务映射、远端归档和Fuse搜索仍未完成；当前显式兼容提示/只读控件不称严格官方呈现。

没有新依赖、用户全局设置变更、真实账号变更或模型调用。两套CLI版本保持原环境：PATH为0.165.0，CODEX_CLI_PATH覆盖为0.159.2；按实际探针日志分别记录，不概称单一版本。仓库没有独立lint配置，不编造ESLint通过结果。

当前已发布preview.1不包含本阶段。阶段提交或后续发布均不改变整页与用户验收状态。
