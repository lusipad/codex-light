# 03B 执行与回答顺序

日期：2026-11-01。范围：当前回合非用户内容的呈现顺序。功能增量开发完成，检查与构建结果以本轮 evidence 为准；官方分组、原生与像素尚未验收。

## 调研与实现

修改前建立 [TO01–TO06 合同](../specs/03-timeline-order.md)。复用 03A 固定原包提取的 timeline 片段与 integrity 清单：官方遍历转换后的顺序序列，而当前源码将所有命令、文件、MCP 与回答分批渲染。静态证据支持修复相对顺序，不支持宣称已复刻官方连续 activity 分组。

- 将现有各类 JSX 回调保留为当前 turn 内的 render 函数，按 `turn.items.map` 和 item.type 逐项派发；不新增通用渲染框架或依赖。
- 思考正文按各自 item 提取，不再将后续思考汇入最前面的同一正文。展开状态仍沿用既有回合级状态，官方 activity 折叠机制另验。
- 用 item ID 维持 Fragment 与命令卡身份；同一 item 流式完成不重置展开。
- 仅系统事件的回合现在也显示。用户 optimistic/server 去重与提问操作保留；复制回答仍使用按原顺序提取的全部消息。
- 删除不再用于展示/状态的分类数组，保留正在执行提示所需的命令、文件与思考聚合。协议处理和业务回调复用，无新增服务调用。

## 验证

证据目录：`.ref/parity/03/runs/20261101-codex-timeline-order/actual/`。

- `verify-timeline-order.mjs` 直接提取生产派发回调：混合 13 项依次呈现，完成更新身份稳定，每项思考独立，系统事件单独可见，用户保留原独立路径。
- 命令/文件/MCP/搜索/图片/系统卡测试改为提取其实际命名渲染回调，原行为断言保留；不是以移除测试换取通过。
- 思考、计划、命令、工具卡、杂项卡与 TypeScript 专项通过。一次调用不存在的 `verify-reasoning.mjs` 失败，随后运行实际的 `verify-reasoning-rendering.mjs` 通过，不将错误命令计为测试。
- [完整检查结果](../../../.ref/parity/03/runs/20261101-codex-timeline-order/actual/verify-all-result.json)与 [日志](../../../.ref/parity/03/runs/20261101-codex-timeline-order/actual/verify-all.log)记录真实退出码，含隔离协议探针。
- 浏览器从 App 源码抽取 9 个实际 render 函数与派发回调，使用本地样本回放。DOM 顺序为回答→命令→思考→文件→回答→MCP→系统事件→回答；Enter 展开命令后完成更新，展开保持、footer 显示成功。
- 960×680 与 600×680 回放截图和 [DOM 记录](../../../.ref/parity/03/runs/20261101-codex-timeline-order/actual/browser-verification.json)保留，document scrollWidth 分别为 960、600。此为组件回放，不是真实命令执行或完整 App 验收。
- [构建结果](../../../.ref/parity/03/runs/20261101-codex-timeline-order/actual/build-result.json)、[输入绑定](../../../.ref/parity/03/runs/20261101-codex-timeline-order/actual/build-inputs.json)与 [构建身份](../../../.ref/parity/03/runs/20261101-codex-timeline-order/actual/build-manifest.json)记录对应源码及 EXE。既有 chunk 大小警告保留。

## 限制与下一项

官方连续 activity 分组、合并/折叠与助手附加活动仍未实现；当前一项一个现有卡片不等于官方完整 timeline。用户 steer 中途插入位置未覆盖，仍走既有用户消息路径。真实通知场景、原生点击/键盘、官方配对像素与用户验收待完成。

下一主要项为 MCP 工具结果的原始输出展开入口及错误/结果呈现，先沿固定原包分支取证；不继续在顺序功能上打磨未经测量的细节。03 整页仍未验收。未提交或推送。
