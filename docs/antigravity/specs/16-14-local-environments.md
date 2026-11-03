# 16.14 本地环境：调研与文件动作合同

2026-11-02。以下为初始只读调查，产品范围见下方16.14A。原包editor序列化version/name、[setup] script、可选[cleanup]及平台脚本、[[actions]] name/icon/command/platform，保存带expectedRevision并区分conflict/selection-failed/success。共享schema默认文件名environment.toml，版本>=1；路径候选/选择作用域需进一步追，不可只凭默认文件名判定所有现有配置路径错误。证据见.ref/parity/16.14/reference/initial-contract.json。

当前Rust固定读写.codex/environments/default.toml，默认模板是setup_script与[actions.run]等自创形状，仅校验TOML语法，且无expectedRevision/原子写/保存后读回。SettingsView旧异步读写缺工作区/草稿保护。下一步先核原包路径/配置选择及现有worktree/终端启动消费者，再开发兼容的真实结构与磁盘冲突/读回。已有用户文件不自动迁移覆盖。

验收需覆盖真实隔离文件往返、版本冲突/无效结构/写失败保留草稿、平台脚本选择、动作进入实际终端请求及工作树setup路径；不把文本保存当环境已运行。原生/像素仍需单独采证。

编辑器保存还会先校验名称与动作的name/command完整性；Windows默认脚本候选不同于POSIX，平台为空代表全部平台。version/name/setup字段及[[actions]]均由原包序列化函数$e/et证实。当前读取/保存只表示文件I/O，尚未找到本仓库setup/cleanup/actions统一消费者，下一步不能只修模板后宣称环境可运行。

## 16.14A 开发前合同

bootstrap kH沿目录向上至仓库边界发现.codex/environments/*.toml，排序默认名优先；sW以预期revision拒绝覆盖外部变更，内容已相同视成功。原包revision为SHA-256，本项目内部用精确预期原文比较提供等价冲突判定，无新增依赖。原始证据native-contract.json。

本批范围：当前本地工作区环境目录内多文件选择（新文件默认environment.toml，保留既有default.toml，不自动迁移）、官方version/setup/cleanup/actions结构验证、写前内容比较/临时文件替换/读回、有效平台动作经既有PTY发送。设置raw编辑器保留且明确不是官方完整表单。祖先发现/配置选择持久化/worktree自动setup/cleanup及环境变量注入留缺口，不把手动动作等同自动生命周期。

LE01隔离真实磁盘缺失/多文件/结构验证/外部修改/读回；LE02无效或过期草稿不运行，动作运行前读回与快照一致并核平台；LE03生产页面单飞/失败草稿保留/离页/切文件工作区保护；LE04既有终端命令回归。用户文件不自动重写，读不创建文件。
