# 2026-11-03 实验功能持久化

取证先于修改：[合同](../specs/16-20-experimental-features.md)，原包片段/哈希位于 `.ref/parity/16.20/reference/`。

旧实现将所有阶段特性暴露成独立管理页，并通过 runtime enablement/set 切换，无法保证跨进程持久化。现在复用 config/batchWrite/configRead，按原包 Beta predicate 筛选，通用设置承载，旧路由兼容跳转。写前重新核可见性，写后核用户层并识别覆盖；不热重载，提示重启。组件整组单飞，断连/卸载隔离，读回失败必须重读。完整分页遇循环/无效响应/页数上限报错。

RED证据：`.ref/parity/16.20/actual/unit-red.log`，旧重复游标未拒绝。协议探针首轮只因 CLI 空白分隔解析失败，保留原日志；修正输出解析后真实持久化验证通过。

构建与完整检查证据归档在同目录 actual；最终以 build-manifest.json 和 verification.md 为准。原生UI和像素未执行。
