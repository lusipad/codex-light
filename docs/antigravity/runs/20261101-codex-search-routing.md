# 08A 搜索模式与命令路由

日期：2026-11-01。产品修改前建立 [SR01–SR06 合同](../specs/08-search-routing.md)。本批为明确接线纠错，08 整页未验收。

## 官方取证与边界

固定原包 SHA-256 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`；两项资源直接提取并校验 integrity，见 [manifest](../../../.ref/parity/08/runs/20261101-codex-search-contract/reference/manifest.json)。command-menu 中 root/files 占位文案分支证明模式区分，Tab 分组导航的 isComposing 分支证明组合输入需避让。静态证据不证明当前账号的全部菜单、分组顺序和所有快捷键映射。

本地原先将 slash 和项目运行命令共用 onTriggerCommand，App 统一送入终端。这与已有 Composer 的 action/insertText 合同矛盾；slash 清单本身是否完整/应在官方命令面板出现仍保留待证。

## 最小实现

- `QuickSearchModal.tsx` 新增独立 onSelectSlashCommand，不再将 slash 当 Shell 命令；App 复用 handleSlashAction 与 setPromptInput，保留注册表 action/insertText 语义。
- 增加 root/files 模式。Ctrl+P 文件入口选择 files，Ctrl+K、Ctrl+Shift+P 和侧栏入口明确恢复 root。files 只显示文件且不发 thread/search。
- 远程结果携带 workspacePath，items 同时核对 query 和工作区；cache key 加模式。既有 effect 取消机制保留。
- 组合输入不执行导航/Enter/Escape/Tab；打开焦点计时器纳入 effect 清理，关闭后不再迟到抢焦点。
- 补齐 items 的 settings 回调依赖，没有新依赖、协议或相邻重构。

## 验证

`verify-search-routing.mjs` 执行生产 items、App slash/快捷入口、键盘与焦点回调，验证动作/草稿分流、文件过滤、模式恢复、工作区隔离和 IME。原搜索回归、终端命令回归、快捷键回归与类型检查退出 0。

合并后的完整标准检查与构建日志位于 [actual](../../../.ref/parity/08/runs/20261101-codex-search-contract/actual)，真实结果与绑定输入以构建身份为准。专项不调用真实 terminal_write、不创建真实提交或运行项目脚本。

- 完整检查首轮退出 1，仅 Rust check 的 generate_context 宏失败；[首轮日志](../../../.ref/parity/08/runs/20261101-codex-search-contract/actual/verify-all.log)保留。原始输出不足以判定根因；并发标准构建和 Tauri 打包均写 dist 是候选原因，不当作已证实。
- 打包结束后串行重跑完整标准检查，退出 0、ALL CHECKS PASSED；[重跑日志](../../../.ref/parity/08/runs/20261101-codex-search-contract/actual/verify-all-retry.log)。后续共享 dist 的检查/打包应顺序执行。
- Release/MSI/NSIS 退出 0，六项绑定输入前后相同；[构建身份](../../../.ref/parity/08/runs/20261101-codex-search-contract/actual/build-manifest.json)保存首轮失败和最终成功状态。
- [最新 EXE](../../../dist-artifacts/08-search-routing-20261101/CodexNative.exe)：14,038,016 bytes，SHA-256 `640887A75D8EE2E72C73612DA30D096D9CCE90E5C2658D3DA2E0107D904283AB`。包含 07B 终端增量，未执行原生 UI 验收。

## 剩余差距

完整官方命令清单/gate/分组与排序、搜索权限错误展示、远端搜索真实数据往返、文件路径边界、对话框语义与焦点约束、选择滚动和中文/官方像素仍待处理。综合模式仍保留原功能集合，不将 files 子模式修复称为完整官方搜索对齐。浏览器连接上一批已超时，本批未通过 UI 回放或原生操作。

无官方配对截图，不评分像素；用户验收未进行。下一主开发页为 09 Activity/Inbox，不让本页剩余细节阻塞整体开发，差距继续保留。
