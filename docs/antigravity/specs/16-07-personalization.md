# 16.07 个性化：下一单元只读调查

日期：2026-11-01。未开始本单元产品代码。

固定参考的settings-page与use-visible-settings-sections注册personalization；后者可见性分支为visible:true。这些片段只证明注册/可见性分支，不证明具体页面控件或渲染消费者。原始来源复用16.05哈希闭环，定位与摘录见 .ref/parity/16.07/reference/registration-trace.json，0-based UTF-16。固定包补丁与运行时模式限制保留。

本项目当前语气/代码风格/角色保存在desktopPreferences，App仅看到部分读取；代码风格/角色尚未发现会话发送消费者。自定义指令同时存在本地偏好与config instructions，需核对真实消费、优先级、清空与重启，不得先承诺全部自动注入。

下一步先追真正页面renderer、中文文案、指令存储/消费链及模型/产品模式gate，再定义编辑/取消/失败保稿/只写本分区/读回/重启的用例。不能因本地UI可编辑或字符串有存储就认定官方有该能力。

## 修改前合同：16.07A Codex指令

原包主进程codex-agents-md→bootstrap eo→$a，codex-agents-md-save→to→$a。$a取所选主机Codex home/AGENTS.md，确保文件存在；eo读取contents和旁边非空AGENTS.override.md的hasOverride；to原样写contents。renderer hi在native Codex编辑入口打开13行textarea，dirty时可保存，Ctrl+S及Ctrl+Enter（IME不触发），保存成功返回，取消直接返回，返回时提示未保存。中文取实际zh-CN资源，不从英文推测。原包与integrity哈希闭环见reference/manifest.json和instructions-trace.json。基准补丁/正式发行来源、运行时与像素仍待核对。

当前范围：本机Codex指令概览入口和编辑/取消/返回确认、真实主机home文件读写/读回、override提示；撤下自创语气/代码风格/角色，不迁移旧偏好自动改全局文件。不改ChatGPT账号指令/记忆/语气服务、不假装远端账号保存。现有旧数据保留，其他设置分区公共保存问题单列。

用例：PI01隔离home文件创建/原文读写/清空/override；PI02实际落盘失败和外部内容冲突保留原文件；PI03概览→编辑→取消/返回确认；PI04双击单飞、失败保稿、卸载响应失效；PI05Ctrl+S/Enter与IME；PI06用真实隔离app-server证明AGENTS.md由新会话读取和override优先级（无模型轮次），不能仅凭UI存储证明消费。先跑生产回归和真实磁盘测试，再完整检查/构建；原生与像素未测不记通过。
