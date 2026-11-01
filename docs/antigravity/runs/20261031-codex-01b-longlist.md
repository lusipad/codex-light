# 01B A12：长列表滚动与固定区

日期：2026-10-31。先完成开发前调研，再以当前 hoverCard release 和隔离列表数据执行可达的原生路径；本轮未发现可证明的产品缺陷，因此未改产品代码。不把分页旧版原生结果直接套用到当前 release。

## 范围

本增量只检查 Sidebar 长列表：项目/会话数量超过视口后，滚轮作用区域、顶部产品栏与“新聊天”入口的固定关系、项目分组标题和末尾条目的可达性、滚动条以及窄侧栏的横向溢出。数据分页和5→15→25增量规则已有独立实现与记录，本轮不更改这些规则。

## 官方依据与证据边界

基准仍为官方 Codex App 26.928.21956；asar SHA-256 为 `17e75ce60122666aa46598a9876a0c56d1da30589824708bdb59c90d8377f5eb`。当前已核实的官方前端静态来源：

- `app-initial-fd3c4b862660.js` SHA-256 `577a50e29502f573e2fbccf4940b9bd875339db420d6d5a9798a0d201ee0aff1`：01B 分页记录已追到 `gos`、`Dos`、`Ofo`，每项目初始5条、每次增加10条，中文按钮为“展开显示”。这些规则说明数据呈现批次，不证明滚动容器或 sticky 行为。
- `app-shared-a906948d8868.js` SHA-256 `1ffb0654bdfcba23be50c06c8698e665bdb17330d923758001d01262aa81cb5b`：约 UTF-16 offset 2,215,333 可见 `data-app-action-sidebar-scroll` 等 sidebar action selector 注册。该代码说明存在专用滚动区域的定位锚点，但 action selector 本身不证明滚动高度、固定头尾或 overscroll 规则。
- 同 shared chunk 约 UTF-16 offset 6,419,311 的 `hyi` helper 可用 `overflow-y-auto` 与 `scrollSection/fixedSection` 包裹内容；其CSS模块类在 `app-shared-342447930c78.css` UTF-16 offset 53,532 处将滚动最大高度绑定到 `--dropdown-section-height`，`fixedSection` 的 `five-rows` 高度也由菜单项行高计算。这个证据指向下拉菜单分段；未找到Sidebar对该helper的调用链，不能将其作为Sidebar固定头尾的依据。
- `app-shared-342447930c78.css` SHA-256 `916d8fa55c82aedbf6ca0f53eec06274ec9eafe08397bb7e9e495d089781f93d` 含 sidebar 滚动 header mask/fade 相关 token 与 overflow utilities；没有静态调用链前，不断言 mask、固定头、固定尾已用于当前 Sidebar。

官方 26.928.21956 GUI 当前不在可用窗口清单中；不可实测滚动方向、滚动条显隐、顶部/底部边界吸附、项目标题是否随滚动、侧栏滚动与菜单/hoverCard交互，以及窄窗重排。因此这些项目仍是“官方运行时待采证”，不是已知事实。

## 当前实现基线

- React Sidebar 在 `src/components/CodexSidebar.tsx` 将项目树、分区和会话列表放在单一 `.sidebar-threads-scroll` 内；产品栏、“新聊天”主操作在其外。当前 `src/styles.css` 为列表区设置 `flex: 1; overflow-y: auto; padding: 0 8px 12px`，滚动条宽4px。
- 2026-10-30旧 pagination release 使用28条隔离回放样本原生验证5→15→25→28，25条后曾在侧栏内部滚动；该轮结果见 `20261030-codex-01b-pagination.md` 和 `.ref/parity/01/runs/20261030-codex-01b-pagination/actual/`。这是旧 EXE 证据，不证明当前 hoverCard release。
- 当前 hoverCard release 原有隔离 home 只有两条会话，无法形成溢出；因此本次先准备了显式标注的28条离线回放 fixture，再测试当前 release。

## 修改前动作合同

| ID | 操作 | 预期/记录 |
|---|---|---|
| LS01 | 在隔离 home 准备明确标注的28条离线回放会话，启动当前源码对应 release | 显示数量与列表顺序一致；只使用隔离fixture，不触发 `turn/start` 或模型请求 |
| LS02 | 指针在 sidebar threads 区向下滚动 | 列表内容滚动；顶部品牌栏与“新聊天”入口不随列表滚走；滚动到末项后末项可完整到达 |
| LS03 | 在顶/底边界继续滚轮，观察页面或主区是否被误带动 | 记录当前实现结果；无官方实测前不把任何 overscroll 预期称作官方合同 |
| LS04 | 滚到项目/Recent分段边界 | 记录项目标题、列表行与展开按钮如何出入视口；不得把普通列表标题推断为 sticky |
| LS05 | 当前 release 调整到窄宽度，检查滚动区内的横向溢出与触控目标 | 留截图/尺寸；DPI、官方App缩放未知时只做本构建内部结构观察，不作官方像素结论 |
| LS06 | 滚动前后检查 hoverCard 与行菜单开关 | 仅在实际操作路径验证卡片跟随当前行、菜单不因滚动而留在旧位置；没有执行就登记未测 |

## 开发门槛

先对当前 release 执行上述可验证路径并记录结果。若只观察到与合同一致，不改产品；若找到可复现缺陷，追加最小失败回归后再改 `CodexSidebar`/相关 CSS。未经官方运行时证据，不新增 sticky 标题、渐变遮罩、自动跟随等“看起来合理”的行为。

## 当前 release 原生观察

使用 `scripts/protocol-verify/verify-thread-list-pagination.mjs` 的副本，在独立临时 CODEX_HOME 中创建并通过真实 CLI `thread/list` 读取 28 条标注为 `01B list sample NN` 的离线回放记录。游标读取跨10页，没有 `turn/started`。使用副本是为了把回放报告保存在本轮 run 目录，不覆盖既有 `.ref/protocol-probe/thread-list-pagination.json`。没有发送模型请求。

- 当前 release 顶部稳定态截图显示项目的初始5条及“展开显示”；Recent中可见同一批离线记录。顶部 Codex 产品栏和“新聊天”入口位于滚动区外。
- 当前 release 两次点击“展开显示”，现场观察到项目条数从5增至15、再增至25；28条样本尚余3条，按钮仍显示。对应顶部及项目末段截图已持久化。
- 临时将隔离样本标题设为83字符混合中英文后，当前Sidebar行单行截断；hoverCard标题换行成3行并停在窗口底边内，时间与项目名仍可见。随后恢复为 `01B list sample 01`，并从Accessibility树确认原标题已回读。截图见 `release-hovercard-long-title-bottom.jpg`。
- 对 Sidebar 列表区域滚轮向下后，项目/Recent头部随内容滚出，产品栏和“新聊天”仍在原位。继续滚至底边可见最后一条 `01B list sample 01`；列表滚动条位于 Sidebar 内。
- 在空白主视图区滚轮后，Sidebar 仍保持先前滚动位置，主页面空态及 Composer无可观察变化；回滚Sidebar列表至顶部后，项目和Recent头部重新可见。
- 这证明当前构建的该隔离样本可在列表内部滚动并到达最后一项，也证明当前 release 的5→15→25展开路径。它不证明官方头部/尾部规则、overscroll、scrollbar样式、窄窗布局或长名称卡片定位一致。新归档截图尺寸1463×866，显示中文与深色；系统缩放/App缩放未知，截图为JPEG，不能作像素差结论。运行时 accessibility tree 不可用。
- 已持久化初始5条、25条列表顶部、项目末段、Recent末项及长标题卡片截图。窗口还原/最大化成功，但边缘拖动误选了页面文字，未达到窄窗；最终已恢复最大化。只使用会话重命名菜单临时改名并恢复测试样本，未执行其他菜单动作。具体动作见 `.ref/parity/01/runs/20261031-codex-01b-longlist/actual/native-scroll-observations.json`。

机器可读的真实CLI回放响应在 `.ref/parity/01/runs/20261031-codex-01b-longlist/cases/real-cli-longlist.json`。官方对照、窄窗、hoverCard水平翻转及视觉像素仍未验证。本轮状态为隔离样本操作自验完成、待用户验收；01B仍开发中，不放行01C。

## 2026-10-31 窄窗续验

- 通过进程路径、PID `142760`、窗口 ID `264938` 唯一定位当前 hoverCard Release；窗口Accessibility树仍显示28条隔离样本，名称保持已恢复状态。构建 SHA-256 仍为 `61B736DE1D7BFBA1C3ECED5CDC1CE17D93CB55FE7D61022159636D4CC0CA6937`。
- 原生窗口还原控件可用，但 Computer Use 支持的窗口 API 没有设置边界/尺寸的方法。通过截图边缘拖动未改变窗口宽高；随后一次标题栏拖动使窗口短暂移出可视区域，立即用最大化控件恢复。没有修改测试 fixture 或产品状态，最终窗口为最大化状态。
- 因未取得可确认的窄窗客户区尺寸与完整截图，横向溢出、hoverCard 水平翻转、滚动期间卡片定位仍为未验证；不将受控 CSS viewport 或源码定位计算替代原生窄窗观察。无需改产品代码。
