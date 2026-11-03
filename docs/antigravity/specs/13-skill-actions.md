# 13A 技能内容与操作合同

日期：2026-11-01。范围：真实详情内容、技能身份、启停和编辑操作的异步保护；13 整页未验收。

## 依据与边界

固定原包 SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`，本轮原包提取与 integrity 校验见 `.ref/parity/13/runs/20261101-codex-skill-actions/reference/manifest.json`。use-skills-page-data 使用 workspaceRoots/host 查询、安装请求代次和 forceReload；官方技能预览显示读取错误并允许重试，不能把自行拼接的描述当作实际技能文件。

已有协议 `fs/readFile` 返回 dataBase64，可复用 fsClient.readFileText。PluginSkillReadParams 的三个字段为 remotePluginId、remoteMarketplaceName、skillName。当前 Rust 不注册 file_read；调用失败后生成 YAML 的旧实现不能证明内容已读到。具体官方页面/gate、推荐技能安装和中文/像素仍待验证。

补充取证：plugin-skill-preview-3f1d822b4682.js UTF-16 1714/1892/2125 分别定位 detailError、retry、contentsError。PluginSkillReadResponse 真实字段为 `contents`（string/null），不是旧实现的 content。config_skills 的 ID 过滤/删除和缺失来源可能误写/误报，本轮采用保存严格ID校验、删除安全单段目录名校验和临时root测试，禁止静默把非法ID改成另一ID。

## 验收合同

| ID | 操作 | 预期 |
|---|---|---|
| SA01 | 路径不同但同名，或插件技能与本地同名 | 不按名字把远程技能错误绑定为可编辑的本地技能；有路径时仅按路径匹配，插件保持只读 |
| SA02 | 连续选远程A、本地B、新建；A迟到成功/失败 | 当前编辑区不被A覆盖；读失败可见，可重试，不生成冒充文件的内容 |
| SA03 | 技能内容读取 | 使用真实 fs/readFile；空文本也是成功；本地读取失败且存在插件引用时可尝试 plugin/skill/read；都失败显示错误 |
| SA04 | 保存/安装/删除/启停快速点击 | 写请求有同步保护，失败释放，编辑草稿保留；成功重读真实列表 |
| SA05 | 保存期间修改草稿/选择其他技能，保存晚到 | 不覆盖新草稿或新选择，不因刷新自动选中第一项覆盖编辑 |
| SA06 | A项目列表读取未结束切B，再切A | 旧本地/远程技能结果、错误、loading不污染当前上下文 |
| SA07 | 非法技能ID/缺少安装源 | 拒绝路径跨越，不静默改写ID覆盖另一目录；不存在/无SKILL.md源不能把旧目标当作安装成功；已有含点/中文目录仍可按精确名称删除，目录外不受影响 |

允许修改 SkillsMcpView、现有 fsClient 的调用、config_skills 保存/删除校验和测试。复用原协议，无新依赖；不对真实用户配置执行写操作。项目技能任意路径编辑/删除和完整官方编辑入口需另取证，不在本批凭猜测开放。
