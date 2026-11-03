# 2026-11-01 — 16.07A 个性化指令真实文件链

范围：本机Codex自定义指令概览和编辑器。不是完整ChatGPT个人偏好或远端主机设置。

## 调研结论

原始asar复测SHA-256为17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb。personalization-settings通过codex-agents-md和codex-agents-md-save调用主进程，bootstrap Ea/Da分别导出eo/to；$a定位主机Codex home/AGENTS.md并创建缺失文件，eo另读非空AGENTS.override.md。

renderer有概览入口、独立编辑器、13行textarea、dirty保存、取消/返回、未保存确认、Ctrl+S/Enter以及override提示。中文采用实际zh-CN文本。[原始哈希清单](../../../.ref/parity/16.07/reference/manifest.json)及[定位摘录](../../../.ref/parity/16.07/reference/instructions-trace.json)有0-based UTF-16偏移。固定包有补丁标记，仍不宣称正式官方包可信度或运行时像素闭环。

## 实现与简化

- PersonalizationSettings替换原本语气/代码风格/角色和TOML混合保存UI，使用真实“编辑 Codex 自定义指令”入口；没有自动迁移旧偏好。
- personal_instructions Rust模块只读写本机Codex home下固定文件，复用codex_home_dir与规范化路径；读取/写入/override错误真实返回。写入前比对已加载文本防止已观察到的外部冲突；写后原文读回，不trim指令、不动override和项目文件。这个检查不是对任意外部并发写入的跨进程原子事务承诺。
- 保存同步锁与卸载身份保护、失败草稿、原样空白/清空、返回确认/取消、保存快捷键IME保护；切换设置分区保留编辑草稿。公共保存按钮不再干扰此页。
- 复用已有card/textarea/button样式和原生dialog，不引入依赖。全局页面路由离开保护、完整原生焦点/窗口关闭仍待实测；不能以beforeunload替代Tauri关闭确认。

## 验证与限制

Rust隔离测试验证空文件创建、原文读回、清空、空白/非空override、外部冲突及IO失败。生产JSX回归验证概览/编辑/取消/返回、单飞、失败保稿、跨设置分区保稿、监听清理、卸载旧响应和IME快捷键。

真实隔离CLI 0.159.2以fs/writeFile保存全局文件后创建新会话、注入离线fixture以落盘，再检查真正的response_item中的AGENTS指令。四组分别证明全局生效、非空override优先、空白override回退全局、清空后项目指令仍保留；同一服务进程无需重启，零模型轮次，无认证/付费。它证明当前CLI的新会话消费，不证明官方UI行为、已有会话更新、模型遵循程度或所有账号。

完整标准检查、全量Rust测试、原生构建和输入指纹已归档于[核验记录](../../../.ref/parity/16.07/verification.md)，手工路径见[待验表](../acceptance/16-07A.md)。visual-verdict缺成对官方/本批原生图，not_executed/score:null。没有用户验收，没有提交推送。

下一分区16.08账号与额度先核官方入口、实际协议、账号身份和旧响应隔离；不可用数据不显示为零用量。

本批[EXE](../../../dist-artifacts/16-07-personalization-20261101/CodexNative.exe)：14,216,704 bytes，SHA-256 `A576462FF0D93B398C1DE552BF82D4AB6D1780B6E243B5CFE3391A6029A8446C`。下一单元已建立[16.08账号调查](../specs/16-08-account.md)。
