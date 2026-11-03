# 14 Code Review (代码审查) 调研与实现

2026-11-01 复核：以下“实现与全量验证通过”为历史声明，旧字符串断言不能证明当前功能或官方对齐。固定原包新取证显示快捷审查沿普通 turn 封装分 inline/detached 路径，不能直接等同当前无条件新会话加 review/start；PR head/base 语义也待核对。见[下一批启动链路复核草案](../../antigravity/specs/14-review-start.md)。本轮未修改代码审查产品实现，14 整页未验收。

日期：2026-10-27。状态：调研完成，代码实现与全量验证通过。

## 1. 范围与证据

本单元覆盖官方内联代码审查（Code Review）流程：
- 审查目标选择（4 种模式）：
  - `uncommittedChanges`：未提交改动（暂存、未暂存与未跟踪文件）；
  - `baseBranch`：指定基准分支全量对比；
  - `commit`：指定具体提交记录（带 shortHash 与提交说明）；
  - `custom`：自由输入自定义审查指令与关注点；
- 协议执行链路：
  - `thread/start` 创建专用审查会话；
  - `review/start` 调用官方内联审查服务（`delivery: "inline"`，准确传参 `target`）；
  - 审查会话流式交互并产出结构化审查意见与代码修复建议；
- PR 审查集成：
  - GitHub CLI 探测与 PR 列表加载（`git_list_prs`）；
  - 一键拉取远程 PR 分支并启动专项审查。

### 官方基准
- 官方固定版本：`26.928.21956 / build 12404`。
- 本机 app-server 实际版本：CLI `0.159.2`。

## 2. 源码闭环与设计

1. `src/components/CodeReviewView.tsx`：提供 4 种审查目标选择卡片、分支选择器、提交历史选择器、自定义 Prompt 输入框、PR 列表与忙态禁用；
2. `src/App.tsx`：`handleStartCodeReview` 封装 `review/start` 协议调用，处理 4 类 Target 形状，审查启动后自动拉取会话列表并跳转至审查会话；
3. 快捷键与菜单支持：`shortcuts.ts` 注册 `Ctrl+Shift+R` 快捷唤起审查界面。

## 3. 验证与回归设计

设计回归脚本 `scripts/verify-code-review.mjs`，包含：
1. 断言 `App.tsx` 中的 `handleStartCodeReview` 完整支持 4 类 review target 形状；
2. 断言 `CodeReviewView.tsx` 声明了 4 类 ReviewKind 并正确提供表单；
3. 断言 `shortcuts.ts` 注册了 `open-review` / `code-review` 快捷键动作。

初始先红日志存档：`.ref/parity/14/code-review-before.log`（退出码 1）。

## 4. 实施与验证结果

1. **测试转绿与全量验证**：
   - `node scripts/verify-code-review.mjs` 3 项检查全部通过（退出码 0）；
   - 接入 `scripts/verify-all.ps1`，全量标准检查 PASS（退出码 0，日志存档于 `.ref/parity/14/verify-review-archive-final.log`）。
2. **原生构建与指纹**：
   - 原生 Release 编译完成（退出码 0）；
   - 产物归档于 `dist-artifacts/14-review-archive-20261027/CodexNative.exe`；
   - SHA-256：`E5276064234414EA0ECF0F44D3FBC448907329228D433EFC2B75C96CAC0C2687`（记录于 `.ref/parity/14/build-code-review.json`）。


## 2026-11-03 纠偏：14B

以上2026-10-27记录仅历史证据，不代表当前整页验收。当前快捷branch/uncommitted已由14A接普通turn，14B补完整审查提示、真实终态和模型行评论，commit/custom仍保留review/start。详见[14B合同](../../antigravity/specs/14-next-closure.md)和[14B待验表](../../antigravity/acceptance/14B.md)。官方运行时、原生UI、配对像素及用户验收仍未完成。
