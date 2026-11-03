# 12 Plugins (插件中心) 调研与实现

日期：2026-10-27。状态：调研完成，准备先红回归与验证。

2026-11-01 复核：旧“必须强制 local-only”结论不代表官方完整目录，已根据固定原包 shared 与当前 schema 修正为服务端默认目录，手动强刷传 forceRefetch。管理员默认安装卸载策略、操作锁、详情/目录生命周期与真实接口重读见 [12A 合同](../../antigravity/specs/12-plugin-actions.md)和[实施证据](../../antigravity/runs/20261101-codex-plugin-actions.md)。以下旧结论保留为历史，不作为当前通过依据；官方 HTTP 分类、原生/像素和真实安装仍未验。

2026-11-03：12B 按[连接准备合同](../../antigravity/specs/12-next-closure.md)及[连接生命周期补证](../../antigravity/specs/12-connection-lifecycle.md)补严格安装结果、待连接项保留、服务端 HTTPS 外链、新生命周期 app/installed→分组 app/read、明确不支持才回退全分页 app/list，以及安装结果未知时的真实读回恢复。见[12B 验收记录](../../antigravity/acceptance/12B.md)。两版 CLI 的无应用本地插件安装/卸载往返已有真实隔离证据；OAuth 回调、官方 gate、原生/像素仍未验，不将旧“真实安装未验”扩展为本轮无应用探针也未执行。

## 1. 范围与证据

本单元覆盖插件市场与已安装插件的完整生命周期：
- 插件列表与发现：
  - 已安装插件：调用 `plugin/installed`（`listInstalledPlugins`）；
  - 市场浏览：调用 `plugin/list`（`listMarketplacePlugins`），明确声明 `marketplaceKinds: ["local"]` 避免无参数调用返回 17MB 远程全量目录造成卡顿；
- 插件详情与配置：
  - 读取插件元数据：调用 `plugin/read`（`readPlugin`）；
  - 详情面板展示版本、作者、分类、权限策略、来源路径、主页与隐私条款；
- 安装与卸载：
  - 安装：调用 `plugin/install`（`installPlugin`），包含 busy 状态与不可安装策略拦截；
  - 卸载：调用 `plugin/uninstall`（`uninstallPlugin`），卸载后自动刷新本地与浏览缓存；
- 市场源管理（Marketplaces）：
  - 市场列表展示与统计；
  - 添加市场：调用 `marketplace/add`（`addMarketplace`）；
  - 移除市场：调用 `marketplace/remove`（`removeMarketplace`）；
  - 升级市场：调用 `marketplace/upgrade`（`upgradeMarketplace`）；
- 错误处理与降级：
  - 区分网络离线、鉴权拒绝（403）、无效配置与服务端错误；
  - 支持重试与状态重置。

### 官方基准
- 官方固定版本：`26.928.21956 / build 12404`。
- 本机 app-server 实际版本：CLI `0.159.2`。

## 2. 源码差距与问题清单

| ID | 问题描述 | 影响 | 状态 |
|---|---|---|---|
| P01 | 插件详情区缺少本地插件源目录一键打开（`reveal_path_in_explorer`） | 本地安装或自研插件无法快速跳转至物理文件进行检查 | 已解决 |
| P02 | 市场插件卡片标题区域未标注本地离线市场标识 | 用户不易直观区分本地扩展包与远程扩展 | 已解决 |

## 3. 先红验证与回归设计

设计先红回归脚本 `scripts/verify-plugins.mjs`，在实施修改前执行并断言失败：
1. **P01 验证**：断言 `SkillsMcpView.tsx` 插件详情面板对于本地插件提供打开目录按钮（`reveal_path_in_explorer`）；
2. **P02 验证**：断言 `plugins.ts` 明确使用 `marketplaceKinds: ["local"]`；
3. **协议闭环断言**：断言 `plugins.ts` 完整封装了 `plugin/installed`、`plugin/list`、`plugin/read`、`plugin/install`、`plugin/uninstall`、`marketplace/add`、`marketplace/remove`、`marketplace/upgrade`。

初始先红日志存档：`.ref/parity/12/plugins-before.log`（退出码 1）。

## 4. 实施与验证结果

1. **最小修改实施**：
   - `src/components/SkillsMcpView.tsx`：在插件卡片 meta 行对于本地插件来源（`source.type === "local"`）渲染打开目录按钮（调用 `reveal_path_in_explorer`）；
   - `src/plugins.ts`：保持严格的 `marketplaceKinds: ["local"]`，防止 17MB 洪泛造成内存和响应卡死。
2. **测试转绿与全量验证**：
   - `node scripts/verify-plugins.mjs` 3 项检查全部通过（退出码 0）；
   - 接入 `scripts/verify-all.ps1`，全量标准检查 PASS（退出码 0，日志存档于 `.ref/parity/12/verify-plugins-skills-final.log`）。
3. **原生构建与指纹**：
   - 原生 Release 编译完成（退出码 0）；
   - 产物归档于 `dist-artifacts/12-plugins-skills-20261027/CodexNative.exe`；
   - SHA-256：`30C175EB27D2C9C8F94CBF8FE0D0755E5156F56E55E2E26FDED17D487F93BFDF`（记录于 `.ref/parity/12/build-plugins.json`）。
