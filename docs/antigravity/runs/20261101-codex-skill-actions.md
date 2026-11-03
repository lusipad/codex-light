# 13A 技能内容、身份与写操作

日期：2026-11-01。专项自验；13 整页未验收。

## 官方依据

[修改前合同及补证](../specs/13-skill-actions.md)，固定原包 SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`；四项原包资源 integrity 与大小见 [manifest](../../../.ref/parity/13/runs/20261101-codex-skill-actions/reference/manifest.json)。官方 preview 的 error/retry/null-content 状态、data hook 的 roots/host 及安装代次是局部依据，不证明本项目双栏编辑器对应官方完整页面。

本地协议 fs/readFile 返回 dataBase64，复用 fsClient 解码；plugin/skill/read 返回 contents。旧 file_read 命令没有 Rust 注册，旧失败后拼接的 YAML 不能视作实际内容。

## 修改

- `SkillsMcpView.tsx`：移除按名字回退绑定本地技能；仅规范化完整路径匹配，插件技能保持只读，避免项目同名技能误改用户目录。
- 远程内容用 readFileText，插件路径读取失败可按 pluginId 拆分引用读取 contents；空文件有效。全部失败显示错误和重试，不生成替代文档。选择/新建/项目切换使旧读失效。
- 启停、保存、种子安装、删除共享同步写锁并显示忙态，失败释放、草稿保留；写后通过已有列表接口读取。写完成后上下文已变时不继续更新新项目。
- 编辑revision保护保存/删除的晚到结果；保存期间可继续编辑或切换，旧结果不替换新草稿。刷新仅更新列表，不自动选中第一项覆盖编辑区。已有安装技能ID只读，不擅自实现重命名/复制。
- 本地与协议列表按请求代次/项目context失效，旧finally不结束新loading；本地读取错误可见并重试。复用上一轮插件context，无新依赖。
- `config_skills.rs`：保存严格验证ID，不再静默过滤非法字符；删除验证安全单段目录名，兼容既有含点/中文名称；拒绝不存在或缺少SKILL.md的安装源。内部helper接受临时skills root，测试无需修改真实CODEX_HOME。

## 验证范围

SA01–SA06 生产函数回归先红（仓库技能被同名用户对象错误匹配）后绿，覆盖精确路径、插件只读、迟到详情、新建/本地切换、空内容、真实contents字段、读失败、写锁/失败解锁、保存及删除晚到、刷新不覆盖草稿、远程列表乱序和跨项目本地读取失效。

旧技能、PA01–PA06插件动作、PC01–PC04目录渲染及类型检查退出0。Rust隔离测试 `config_skills::tests::skill_writes_reject_invalid_ids_and_invalid_sources_without_changing_existing_files` 验证非法保存/删除不触及原目标/外部哨兵、无效来源不覆盖旧文件、有效导入保留嵌套文件及有效保存删除；审查发现的含点/中文目录卸载回退已修复，隔离用例验证准确删除对应目录且外部哨兵不变。

完整标准检查、全量Rust与原生打包的日志/绑定结果见 [actual](../../../.ref/parity/13/runs/20261101-codex-skill-actions/actual)，最终结论以该目录结果为准。没有向真实用户技能目录写入或删除。

最终复核修正后，完整 `verify-all.ps1` 退出0，全量 `cargo test` 93项通过、0失败，`npm run tauri build` 退出0，Release/MSI/NSIS成功。四项关键输入构建前后SHA-256一致。审查修正前的成功日志另存 `pre-review-*`，不用于绑定最终EXE。当前无独立lint配置；Vite大chunk警告保留。

归档 [CodexNative.exe](../../../dist-artifacts/13-skill-actions-20261101/CodexNative.exe)，14,014,976 bytes，SHA-256 `F20ED53E6F500CA1B73275801602EB5140F24DE160478D76E3C29E7CD38A7F6A`。源码HEAD、未提交差异摘要、输入指纹及退出码见 [build-manifest.json](../../../.ref/parity/13/runs/20261101-codex-skill-actions/actual/build-manifest.json)。独立只读审查发现的删除兼容性问题已修正并复核，记录见 `actual/increment-review.json`。

## 未验证与限制

官方完整技能页/推荐源/编辑入口、系统/管理员作用域策略、原生键盘/焦点/IME、真实隔离服务启停往返、官方同条件截图与像素仍未验。当前仅将精确匹配的本地用户技能作为编辑对象，项目/未映射远程技能继续只读，不以此声称官方编辑能力已全覆盖。

保存沿用既有有效字符集但拒绝静默改名；删除保留既有含点/中文单段目录名兼容性，拒绝路径分隔符、前缀和特殊段。符号链接/junction的物理边界、导入原子性/复制中断残留、磁盘外部修改冲突、同一窗口路由卸载后的草稿持久化仍待处理。源导入期间不支持服务端撤销；请求失效仅防止晚到结果污染当前视图。

新增按钮状态/错误提示尚无官方配对视觉证据，不打视觉分数。原生构建通过不能替代 UI 与真实服务验收。13 未完成，未提交/推送。
