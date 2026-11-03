# 16.18 存储设置：官方云端配额与本地误实现纠偏

2026-11-03，修改前合同；范围16.18A，只纠正错误本地清理入口与能力缺口呈现，云端功能仍阻塞。

## 官方取证

固定asar SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`，含既知offline补丁，非原始正式发行闭环。storage-settings-6f17def9c29b.js 的 ChatGptStorageSettings / De 通过共享 kY.safeGet(`/files/library/storage/usage`) 读取云端配额。共享 kY 为带 additional headers 的服务客户端，并非 app-server RPC。定位、hash及片段在[参考合同](../../../.ref/parity/16.18/reference/storage-contract.json)。原包26.928.21956候选；Windows缩放/App缩放未知，运行时gate未测。

官方数据包含allowed_bytes、used_bytes、remaining_bytes、is_over_limit和breakdown_by_file_type。加载时skeleton，失败时alert+重试；成功时使用量/进度条，文件与图像分类。打开/space/files或/library，tab=all/images，entry_point=settings。清理指引让用户删除云端文件，**不是删除设备文件**。中文error文案来自实际zh-CN语言包。

当前源码检索未发现这一认证服务客户端/usage桥；account/read登录状态不能证明可调用此API。不能读出并转存用户token、臆造未支持RPC、以本地磁盘填充云端统计。云端认证、来源分流、gate、升级入口与成功/重试状态另待实现和实测。

## 本轮合同与差异

- STG01：进入storage不扫描CODEX_HOME、不展示本地容量冒充云端配额；明确当前云端连接缺失。不伪造0配额、骨架永转或可用重试。
- STG02：删除页面一键清理控件，同时撤销storage_clean_cache的Tauri注册/函数和底层旧实现，防遗留调用继续删除rollouts。历史会话/日志/配置不迁移不删除。
- STG03：设置通用保存/刷新/成功横幅不适用于只读存储能力页；页面无虚假的可保存值。
- STG04：storage_stats_get保留给已有Images/pets消费者，本轮不改其统计语义，也不宣称其准确。自定义worktree目录统计属于其他本地功能缺口，不能混入云端存储页。
- STG05：类型检查、相关回归、完整标准检查、Rust全量和当前原生构建；原生UI与同条件像素缺证据必须记未执行。

## 验收方法

JSX实际渲染能力提示，拦截任何除React以外依赖，确保无调用/写入；AST检查storage分支已接入独立页且通用保存排除；检查Tauri命令及底层删除函数无残留。对照旧源运行回归应先失败，再做最小删除。功能仍为外部依赖阻塞，不等于官方整页通过。
