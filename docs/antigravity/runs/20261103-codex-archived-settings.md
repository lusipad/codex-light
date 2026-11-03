# 2026-11-03 已归档聊天设置统一

[规格](../specs/16-19-archived-chats-settings.md) / [待验](../acceptance/16-19A.md) / [证据](../../../.ref/parity/16.19/verification.md)。

先核15A原包合同与当前Settings旧列表，修改前ARS01回归在threads_meta_get断言失败。随后删除旧本地列表/恢复/删除回调，直接接入ArchiveView及App已有查看/恢复/删除/toast处理器和同一刷新标识。未修改共享归档组件或Rust，避免复制状态机。复用现有容器/CSS，无新依赖。

ARS01–05、AA01–06、受影响设置回归和类型检查通过；最终标准/构建/隔离协议结果见manifest。功能统一不等于布局1:1；官方多主机/云端/项目筛选/批量及原生像素缺口保留。下一16.20实验功能先取证。
