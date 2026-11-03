# 2026-11-02 代码审查本地偏好

纠正统计页与设置页错配，追到CodeReviewPluginSettings及官方插件hAl/sAl，再写合同后开发。云端wham策略没有认证桥，不能继续把本地开关当成自动审查/门禁成功。

[规格](../specs/16-16-code-review-settings.md) / [待验](../acceptance/16-16A.md) / [证据](../../../.ref/parity/16.16/verification.md)。

Rust在已有state manager锁内合并两个官方persisted atom键并持久化，前端共享状态真实读回。PR链接按目的地消费，个人指令只附带到PR入口请求；3秒自动保存/立即保存/快捷键/flush，失败保稿。复用已有PR详情和Windows ShellExecuteW，不新增依赖。

完整官方云端策略、固定PR快照/结果schema、多provider及原生像素仍缺。下一16.17导入：先从ImportSettings真实detect/import数据链调查，优先处理旧导入覆盖desktopPreferences及假成功的问题。

验证：全量Rust113通过，完整标准检查退出0，原生EXE/MSI/NSIS打包退出0，153项产品输入无漂移。原生交互、真实PR审查和像素未验。
