# 01B续：拖动取消生命周期

日期2026-10-30。状态：限定组件合同自验通过；01B整体未验收。

## 修改前合同

固定initial SHA-256 `577a50e29502f573e2fbccf4940b9bd875339db420d6d5a9798a0d201ee0aff1`。证据在`.ref/parity/01/runs/20261030-codex-01b-drag-cancel/reference/static-evidence.json`，偏移均为0-based UTF-16。

- T1n指针传感器的handleKeydown在Escape时handleCancel；attach监听Resize、VisibilityChange并取消。O$r额外监听window blur及document visibilitychange，隐藏时取消。
- 取消后松开指针不能提交重排。已经激活的拖动取消后应抑制其尾随点击，避免误打开聊天；尚未开始的普通点击不受影响。
- 监听必须在卸载时释放；普通按键、可见状态变化、没有拖动时的窗口事件不修改排序。

范围：仅CodexSidebar拖动生命周期与实际组件回归；不改CSS、不新增依赖、不调整官方设置。先用实际组件失败用例锁定Escape/失焦/缩放/隐藏后松手的错误，再做最小修复并验证清理与原有重排回归。

本轮同时核实官方S1n键盘码和uBr坐标获取器存在，尚不能单凭库的默认键位证明聊天行触发优先级和完整交互；键盘重排继续列为待实现，不以取消修复替代它。

## 实现及验证

仅修改`src/components/CodexSidebar.tsx`，新增手动模式的Escape、blur、resize、visibilitychange监听；取消时清除在途拖动，已激活时抑制尾随点击，卸载/切模式释放监听。复用已有拖动ref和点击抑制ref，没有新抽象、依赖或CSS。

`scripts/verify-sidebar-projects.mjs`增加真实组件的事件分发与effect清理测试边界。修改前`cases/before.log`退出1：Escape后松手实际`t0/t2/t1`，预期`t0/t1/t2`。修复后`cases/after.log`退出0，覆盖四类取消、尾随点击、新一次普通点击、无关按键、可见文档与卸载零剩余监听；既有项目折叠、分页、排序和存储回归继续通过。事件由受控window/document派发，这是L2组件合同，不能写成原生中途取消实测。

`cases/verify-all.log`完整标准检查退出0，包含类型、前端构建、Rust检查、17项automations单测和既有真实协议探针；13项Rust测试被过滤。协议使用本轮隔离CODEX_HOME且清空API keys，无模型生成请求。没有配置的额外lint不报告通过。

## 后续键盘入口取证

进一步追踪Flo：外层`onKeyDownCapture`接受无Ctrl/Meta/Shift的Alt+ArrowUp/ArrowDown，目标必须是HTMLElement且role为button，再调用controller.moveThread；其内层拖动包装明确`onKeyDown:void 0`，不能据传感器默认Space/Enter给聊天行增加键盘拖动。moveThread按显示列表相邻索引移动，越界返回。原始片段见`reference/keyboard-call-chain.json`。下一轮应核对目标按钮和焦点的具体结构，再定义相邻移动合同；本轮未实现此功能。

## 剩余验证限制

本轮未通过原生输入在“指针按住并移动”中间插入Escape/失焦/缩放事件，故这几项原生状态保留未验证，不能由组件通过替代。上一轮原生拖动/重启证据仅对应上一轮EXE。官方同环境无损截图仍缺，未进行有效像素比较或视觉评分。整页和用户验收均不通过自动检查自行放行。

最终构建：dist-artifacts/01B-drag-cancel-20261030/CodexNative.exe。SHA-256：05cdfe2fcea4b5c5f279467cd19a25c50ebb51f69e042385c73d94542fb49f1c。release退出0；build.json核对115项源码输入和5项dist匹配，归档source/与frontend-dist/。基于380c32c7及现有未提交改动构建，未提交推送。
