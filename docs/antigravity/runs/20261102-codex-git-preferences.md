# 16.13A Git偏好与实际消费者

先追固定原包GitSettings/共享ON及ACn→NCn，确认EN=global-state而非相邻DN persisted-atom；key/default/用途见[合同](../specs/16-13-git-settings.md)。

新增gitPreferences和GitSettings，App单一共享状态，精确键独立保存/读回；设置撤下旧自创无消费者表单并保留旧偏好字段。DiffDrawer有效diffMode强制本轮，禁止对应Git读取、隐藏模式与Git动作，从真实会话补丁展示内容。force-with-lease/draft默认接入现有真实请求。没有发起真实外部推送或PR。

专项GT01–GT03与Git/编辑/审查回归通过，完整检查/原生打包与源码输入哈希见.ref/parity/16.13/verification.md。没有新增依赖或Rust改动。分支前缀/指令/PR合并方式/原生与像素仍待实现或验收，不将限定增量标为整页通过。

[待验](../acceptance/16-13A.md)。下一16.14本地环境，先核环境文件版本/路径与启动消费者。未提交推送。
