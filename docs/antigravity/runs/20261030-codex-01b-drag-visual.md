# 01B续：拖动源行、预览与插入指示

2026-10-30，修改前合同。01B整体开发中。

固定official候选26.928.21956/build12404，initial SHA577a50e29502f573e2fbccf4940b9bd875339db420d6d5a9798a0d201ee0aff1、shared SHA1ffb0654bdfcba23be50c06c8698e665bdb17330d923758001d01262aa81cb5b。

- Flo6788865：单条拖动opacity-20，交互子控件不得继续触发；ilo67759xx将预览portal到body、pointer-events-none、无drop动画。
- g$6784851：标题预览，20图标盒、gap8、px8、max320、text-base14，透明容器没有凭空增加卡片阴影。Dlo引用GJe，经shared export确认是chat-bubble-light-16，而不是Codex knot图标。
- dEo7245362/共享b1r5404807：只在有效且会改变顺序的目标显示dropIndicatorTarget；以去掉active后的beforeId（末尾为null）表示，原位置/相邻no-op不显示。
- V$6863169：零布局高度、线高2，右8；一般左8/圈左4，indented左32/圈左28；圈8、border2，surface-secondary背景、text-info色。当前项目布局与官方container坐标未校准，不能把移植数值直接写成物理像素达标。
- 阈值仍为欧氏距离>6；松手只提交既有同列表存序；取消、失焦、缩放、隐藏、模式变化清理源行与浮层，不能残留遮挡或保存未提交顺序。

计划：纯目标函数和实际组件先失败→复用既有拖动ref/完整存序，增加只在激活后出现的视图状态、body portal和canonical边界指示→回归阈值、before/after/末尾/no-op/离开、目标隔离、无中途写入和取消清理→标准检查、当前release真实拖动及可获得的中间态证据。

本轮允许Sidebar、sidebarOrder、styles.css及相关回归；无新依赖。预览图标先复用已安装lucide的MessageCircle，禁止把近似图标标为官方原图一致；不拷贝未核验许可的新官方资源。源码中的行高与theme变量有作用域，预览先继承源行高度并记录该差异，待官方运行时核查；不猜测DPI或App缩放。原生工具不能逐帧暂停时，中间态只能标为组件/受控渲染证据，不能冒充真实鼠标截图。跨项目迁移、选中多条与auto-scroll不是本轮已完成项。

## 2026-10-31 实施与验证

- `src/sidebarOrder.ts`新增有效插入边界计算，排除自身、缺失项及不改变顺序的位置，不修改输入；复用原有完整存序函数。
- `CodexSidebar.tsx`复用拖动ref、阈值和提交路径，激活后才呈现源行淡化、body portal预览、同列表插入提示。悬停不写存储，取消统一清理；收起项目或源条目消失同样清理。样式仅增加拖动状态，无新依赖。
- 纯函数和实际组件先失败后通过，日志见本轮`cases/order-before.log`、`order-after.log`、`sidebar-before.log`、`sidebar-after.log`。组件覆盖阈值、边界、无效位置、无中途写入、目标隔离、取消和卸载。测试桩useCallback修正为按依赖缓存，以匹配React真实生命周期。
- 完整`verify-all.ps1`退出0，见`cases/verify-all.log`。包含现有Rust automations过滤测试，不能宣称全量Rust单测或原生/像素验收通过；无独立lint配置。TypeScript检查另通过。
- 实际组件浏览器受控回放见`browser/index.html`、`actual/browser-replay.json`及三张PNG。中间态DOM读取证实源行opacity 0.2、预览BODY portal/pointer-events none、插入线2px；松手后05移到01前，预览/指示/淡化均清零；再次回放后取消保持顺序。该入口显式替换pointer capture并合成事件，不是原生鼠标中间态、不调用模型、不证明官方一致。测试页及本轮Vite进程已关闭。

## 当前限制

2026-10-31后续补验：新版项目标题构建已通过定向Raise恢复截图目标，并实测拖动及完整退出重启保序，见`20261031-codex-01b-project-options.md`。这些证据对应该新版EXE，不能改写本节下方旧EXE未验证事实；中间态和在途取消依旧未验证。

当前可运行构建：`dist-artifacts/01B-drag-visual-20261031/CodexNative.exe`，SHA-256 `6a89b0408389913ca4e44a45cda2e1c8ec11f76920ab3d6975fbabf6e2966415`，13,280,256字节。release退出0，115项源码/配置输入和5项dist构建前归档、构建后重新校验匹配，见本轮`build-inputs.json`、`source/`、`frontend-dist/`、`build.json`。基于HEAD 380c32c7及已归档未提交工作树，不能仅用HEAD代表全部源码。

原生验证未通过门槛：以既有隔离CODEX_HOME及WebView profile启动当前EXE，使用真实CLI读取明确的离线回放，不发送任务。UIA显示正确CodexNative树且app-server已连接，但窗口截图显示另一个应用；一次按元素点击因geometry unavailable在发送前失败。发现不一致后未执行坐标点击或拖动，也未验证重启保序。仅停止本轮启动且路径匹配的测试PID 168144。见`actual/native-verification.json`；不沿用上一版原生拖动结论。本轮用户可复测：手动模式下同项目内拖到另一行上下半部，观察淡化/标题预览/插入线，松手后无残留；再拖动按Escape取消，顺序应不变；完整退出重启后核对已提交顺序。

用户本轮再次回复官方显示环境“未知”，Windows缩放、App缩放、语言和主题均保留未知。缺少同环境官方拖动参考图，不能计算像素通过率。MessageCircle不是官方原图；继承源行高度、现有accent-blue颜色、App缩放、官方inert可访问性语义及容器坐标尚未校准。当前使用子控件pointer-events及事件守卫，不声称恢复完整inert树。原生中途取消/逐帧拖动呈现、跨项目、多选和自动滚动仍待验证或实现。01B整体保持开发中，未放行用户验收或后续单元。
