# 15F 云端任务归档只读增量

2026-11-06。状态：开发、完整标准及限定原生自验完成；不是整页或用户验收。

## 来源与范围

开发前合同见 [15F规格](../specs/15F-cloud-archive-read.md)，官方固定 Store 26.1027.3384.0；继承15E刚重核的asar SHA及原始资源，任务hook `kDn/NDn`、投影 `_Dn/OJ`、日期 `gn` 均有定位。新增资格研究见 [15G](../specs/15G-archive-eligibility.md)：资格路径已查清，尚未接线，不能把研究计为已实现。

仅设置的“已归档的聊天”启用云端任务读取。真实宿主固定 GET `/backend-api/wham/tasks/list`，固定 archived/limit20，仅接收受限opaque cursor；复用既有认证、身份代次、网络策略、取消和一次401刷新。最终401/403/404保留HTTP状态并按该来源合同返回空，不吞IP策略拒绝、429、5xx或坏JSON；不开放任意URL/方法。没有云端变更或模型请求。

前端复用账号读取、ChatGPT服务客户端、归档列表和项目菜单。三条失效监听就绪才读取；账号/连接变化清旧结果，普通后续页失败保留已读页。跨源同ID独立，任务不调用本地恢复/删除，不用cwd或环境名猜项目。原生宿主回包身份不匹配标为account_changed，以清除旧列表；专项先红后绿。

## 本轮实际结果

- 后端 `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib archive_cloud_tasks`：6通过，0失败/忽略，474过滤，退出0。不是全库480项执行。隔离transport覆盖固定路由、参数先验证、HTTP策略、取消及身份变化。
- 三个 `verify-archive-cloud-*`、ARS01–06、既有服务回归退出0；另有独立只读复核，未发现新增可证实P1/P2。
- 真实React hook、config/accountRead、chatgptService、ArchiveView的浏览器集成通过；仅bridge/宿主IPC为内存夹具，CSP禁止网络。1280×800归档内容约768px，640×800约552px，无横向溢出，外层标题唯一。
- 浏览器实际执行空字符串cursor分页、失败保留3条、关闭故障后重试得4条且去重、ISO日期显示、A→B清旧任务、签出保留2条本地且服务计数不增加、监听失败禁读及重试恢复、环境搜索不新增读取、键盘打开菜单及Escape焦点返回。云端动作disabled。
- 证据根 `.ref/parity/15/actual/15F-cloud-archive/`：后端日志、envelope红灯、browser来源哈希/截图/DOM/results分别保存。截图原始JPEG，不用于无损像素差。
- 完整非Fast `verify-all.ps1`退出0，32项真实协议探针通过，零FAIL；包含现有ChatGPT服务Rust分组及新专项，没有另跑全库480项。标准脚本已纳入新三项前端回归，发布回放清单同步加入。
- 环境存在两套CLI：PATH的`codex`为0.165.0，继承的`CODEX_CLI_PATH`指向`C:/Users/lus/Codex/_internal/app/resources/codex.exe`，实测0.159.2；宿主优先该覆盖，采用此覆盖的协议探针日志也明确0.159.2。未修改用户环境，不把所有探针概称0.165.0验证。
- `cargo build --locked --manifest-path src-tauri/Cargo.toml --bins`退出0；默认custom-protocol构建内嵌当前生产dist，不依赖开发服务器。336项产品输入、3个前端资产及debug EXE哈希冻结于`native-inputs.json`。这次没有生成新MSI/NSIS。
- 独立私有CODEX_HOME/WebView配置下，原生实际打开设置归档、刷新、显示未登录来源、菜单打开及Escape关闭；无假空列表或完整数量声明。原生未登录场景不验证云端服务可调用性；未执行模型、登录或删除。截图/AX保存，验证窗口及其WebView子进程均已退出。

## 限制与后续

ChatGPT conversation读取与15G资格尚未接入；云端恢复、删除、导航、历史定时任务映射、远端主机归档及官方模糊搜索仍未完成。任务来源只读，不称完整“全部归档”。

没有真实云端账号HTTP、官方同环境配对像素、物理IME、多窗或用户验收；视觉分数null。浏览器夹具外层仅复用设置标题结构，完整设置导航另由ARS生产接线及本轮原生进入覆盖，不将夹具称完整App验证。原生精确焦点未从AX证明；浏览器Escape回焦与原生视觉关闭分别记录。

仓库未配置独立lint命令；本轮执行TypeScript、现有静态合同回归及空白检查，不编造ESLint通过结果。

本阶段保留本地提交，待15G会话来源形成更完整阶段后再统一决定推送和下一预览版；当前发布的v0.2.0-preview.1不含本轮改动。
