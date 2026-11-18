# 09E 清除已读聊天

按[开发前规格](../specs/09E-activity-clear-read.md)在优先事项标题旁接入「清除已读聊天」。按钮只在当前优先事项有已读空闲条目时出现。复用现有活动状态判定和快照，保留未读、运行、待响应及错误条目。

- 专项回归验证清除范围包括未展开的成员，保留显示上限、打开时间和已见 ID，刷新不复活已清除项。后续活动可使同一聊天重新进入。旧身份或空集合不修改快照，操作不调用协议。
- 隔离 Windows 原生用真实 CLI 0.165.0 生成 12 条未读。先将一条标记为已读，按钮随即出现。点击后只移除这一条，展开显示其余 11 条，按钮消失。前后只读 SQLite 对比确认 12 条会话、11 条未读、0 条归档，且每条已读回执的 revision 均一致。
- 117 项前端回放、TypeScript 和 Windows EXE、MSI、NSIS 打包通过。实测 EXE SHA-256 为 `a97432696c00625a0c5ca980aa63fc73b5a483ad6588c67f9f567a9d0728c6aa`。证据位于 `.ref/parity/09/actual/09E-activity-clear/`。
- 官方配对像素、完整活动分组和批量归档仍待验证或实现。完整 Rust 和协议探针未在本阶段重跑。Windows 远端作业仍待账户付款或支出上限恢复。[GitHub Actions 记录](https://github.com/lusipad/codex-light/actions/runs/42511523252)
