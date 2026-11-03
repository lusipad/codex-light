# 16.03B 工作台快捷键消费者附录

2026-11-03；承接 [B 阶段合同](16-03-next-closure.md)。这是静态来源与本地实现映射，未表示官方运行时、原生或像素验收通过。

## 开发前来源核对

只读 Store `26.1021.3705.0`，原包与 [主合同](16-03-next-closure.md) 相同。重新从 asar 读取下列两个消费者，计算 SHA-256 与 entry integrity 全部匹配；原文、manifest 和 UTF-16 定位见 `.ref/parity/16.03/actual/16-03B-research/workbench-consumers/`。

| 文件及 0-based UTF-16 偏移 | 可证明的行为 |
| --- | --- |
| `local-conversation-git-actions-ec9ad83472b0.js` @7522、8219 | `git.commit` 注册消费者设置 `commit` 状态；有工作树前置条件时先走分支设置。命令不是立即执行 Git commit |
| 同文件 @7662、8340、7839、8496 | 普通 PR 调用 `Z(t)`，草稿 PR 调用 `Z(t,{defaultToDraft:true})`；消费者受到运行状态/PR 能力条件约束 |
| 同文件 import，`git-action-new-branch-field-b355da04a284.js` 导出映射 | `Z` 对应 `Nn`，`Xe` 对应 `Mn` |
| `git-action-new-branch-field-b355da04a284.js` @17489、17594 | `Mn` 设置 `commit` / `worktree-branch-setup`；`Nn` 设置 `create-pr` / `create-draft-pr` / 分支前置状态。均不直接发出提交或创建 PR 请求 |

消费者 SHA-256 分别为 `339c7b220ef7337faec65feb91e037f9e45092a26280484afdb93eacc8d1179b` 与 `72b4ef5b727e1e23fdf63ec213161a7bc91f4157c9657b8999aa281d1d81fc86`。

## 本地合同与实现

`DiffDrawer` 接收 `shortcutRequest:{id,requestId,cwd}` 与 `onShortcutHandled(requestId)`。App 负责实际键位匹配、打开/关闭工作台、可用工作区与作用域；组件不新增 window 全局监听。

- `git-commit` 切换变更页，打开现有提交控件并聚焦说明输入；不生成说明、不提交、不推送。
- `git-create-pull-request` / `git-create-draft-pull-request` 打开现有 PR 表单并聚焦标题；保留既有草稿偏好，草稿命令显式设置草稿，不外发 PR。
- 显式 Git 命令允许显示现有 dock，不修改 `git-review-mode` 偏好；工作区变化或关闭后清除该次显式显示状态。已有 Git 写入/PR 创建期间不打开竞争表单。
- `toggle-file-tree` 切换现有 Files 页；再次切换关闭行为由 App 处理。
- `next-tab` / `previous-tab` 在当前真实 `openTabs` 循环，`focus-tab-1..9` 选择已有编号；缺失槽不创建演示 tab。当前本地工作台 tab 与官方完整 app shell tab 模型仍有差异，不能据此声称所有官方 tab 语义完成。
- 本地文件 textarea 早已有 `Ctrl+S` → `saveEditedFile`；保留这条局部链。官方目录未发现 `file-save`，不新增可配置官方目录项。组件内部请求保留同一保存入口，限定 Files 中可编辑且 dirty 的真实预览。
- `requestId` 去重、`cwd` 精确匹配，关闭/旧工作区请求只确认不执行。焦点在控件挂载后的 effect 处理，无延迟计时器或卸载后回调；焦点不能跨工作区。

## 验证与剩余差距

`node scripts/verify-keyboard-workbench.mjs` 执行从真实 TSX 解析的生产 effects、DOM ref 定位及现有文件按键回调，覆盖普通/草稿表单、无外发、重复请求、关闭/换工作区隔离、忙状态、tab 循环/缺失槽与文件保存条件。该夹具不运行真实 Git 写入。

2026-11-03：上述专项、`verify-file-editor-lifecycle.mjs`、`verify-git-preferences.mjs`、`verify-git-worksurface.mjs`、`verify-git-lifecycle.mjs` 及 `npx tsc --noEmit` 均退出 0。主线程集成后须重新运行标准检查。

未接入文件语言服务、定义/引用跳转、文件历史、环境动作槽或行号输入，不能用现有 textarea 冒充完整编辑器。官方分支前置流程与本地现有 PR 表单形态存在差距；真实原生键位派发、焦点、IME、跨窗口和官方等环境像素对照仍待验证。
