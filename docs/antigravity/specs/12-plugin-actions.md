# 12A 插件操作与目录证据合同

日期：2026-11-01。范围：插件安装/卸载的重复操作和策略、详情关闭后旧响应、目录读取与写后读回。12 整页未验收。

## 官方证据

固定原包 SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`，本轮直接提取资源并核验 integrity，见 `.ref/parity/12/runs/20261101-codex-plugin-actions/reference/manifest.json`。

- plugin-detail-actions-e66339e25bc2.js，0-based UTF-16 30329 `let l=a||i||r`：卸载项在更新、卸载中或 isInstalledByDefault 时禁用；30777 `plugins.installedByDefault.actionLabel` 对应 Installed by admin。中文需另查语言包，不把英文默认值当作官方中文。
- use-plugin-installation-353c942e1704.js 引用全局安装状态和 isPluginInstallationActive/isPluginUninstalling；只能证明有活动状态区分，不能证明所有并发策略。
- plugins-query/category-plugins-query 使用远程 /ps API 与分页。现有强制 local 的“浏览市场”只证明局部目录，不能声称官方完整市场对齐；完整请求与能力另记录，不以响应体积为理由永久缩减目标。
- 后续只读调研补证：原包 app-shared-a906948d8868.js UTF-16 5227513 的 dHr 在远程开启且不选 vertical/额外分类时返回 null；5233735 的调用据此省略 marketplaceKinds，forceRefetch 来自强刷状态。本地 PluginListParams 只有 cwds、marketplaceKinds、forceRefetch，无网络分页；采用不强开 gate 的默认目录，前端每次显示 50 项。完整官方 HTTP 分类/身份仍待补。
- 中文原包 zh-CN-3ed9eb1db28a.js UTF-16 1168209 对应“由管理员安装”，本轮使用此文案。

## 操作与验收

| ID | 操作 | 预期 |
|---|---|---|
| PA01 | 同插件快速重复安装/卸载 | 同 ID 只有一个在途写；不同插件可独立操作，锁在失败后释放 |
| PA02 | 不可安装插件/管理员默认插件 | 回调自身执行策略校验；默认安装插件不弹确认、不发卸载请求 |
| PA03 | 展开详情，读取未完成时收起 | 失效在途读取，清理加载/上下文；旧成功或错误不重新填充 |
| PA04 | 强制重读目录，旧成功/失败最后返回 | 最新请求写入；旧 finally 不提前结束新加载态 |
| PA05 | 安装/卸载成功 | 失效旧目录，重新读取真实已安装状态与当前浏览目录，不用本地 patch 冒充读回 |
| PA06 | 操作失败 | 错误可见，不写成功状态，可重试 |
| PC01–PC04 | 目录普通/强刷、搜索和显示更多 | 默认不传 marketplaceKinds，强刷传 true；不编造 cursor；完整目录先筛选再每次显示 50 项，不漏后段搜索结果 |

允许文件：SkillsMcpView.tsx、plugins.ts（仅已取证目录能力必要修改）、相关测试和资料。无新依赖，不操作真实账号安装配置；使用受控 Promise 执行生产回调。完整 OAuth/ON_INSTALL、远程目录分类与分页、跨项目缓存、市场写锁、原生/像素仍需逐项验证，不以本批通过替代整页完成。
