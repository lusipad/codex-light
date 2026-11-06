# 15F-A 云端任务归档 UI 增量

2026-11-06。状态：本地生产组件回归通过；主线程后续浏览器、标准及限定原生终态见[15F整合记录](15F-cloud-archive-read.md)，不是完整云端归档验收。来源及开发前动作合同见 [15F规格](../specs/15F-cloud-archive-read.md)。

## 实施边界

`ArchiveView` 仅type-only导入 `ArchivedCloudTasksState`；设置入口由主线程传真实hook状态，global不消费云端项或调用新来源动作。真实task与本地线程同一项目组、三种排序、搜索投影；row key为local/task来源与ID复合值，跨源同ID两条独立。task只取显式projectless/assignment归属，不用本地workspace override/cwd/hint或环境名猜项目。项目筛选、组排序和标题平局规则复用15E已证合同。

task行非导航span、云图标，按hn/gn使用云端更新时间null时退创建（已选时间无效则不显示日期）；单组显示环境label，分组不重复环境。取消归档和删除均明确disabled只读，无本地删除/恢复handler，不把task ID送本地thread或导航回调。原本本地全删、确认、锁和真实回调完全保留，task数不进入本地删除集合；本地同ID恢复读回不移除任务项。

云端/all独立显示加载、签出、不支持登录方式、错误、HTTP专用空来源状态、后续页错误/重试及加载更多。空字符串cursor仍视为真实下一页。来源失败保留其他成功列表；local模式不显示无关云端状态。全部/云端始终说明ChatGPT会话归档尚未接入和来源不完整，不能把task列表称完整云端归档；不可用或错误零结果不显示成功空态/计数。

## 本轮实际验证

先新增整生产组件 `verify-archive-cloud-ui.mjs`，旧源码真实红灯AC01：预期2条cloud row，实际0；随后最小实现。测试保留Object.is useMemo/useCallback依赖缓存，只有隔离RPC/hook fixture，没有真实HTTP/账号/模型。

- AC01–AC08退出0：跨源同ID、显式任务项目归属与不猜hint、三排序/跨源标题平局、搜索环境名、真实props更新memo、只读行无mutation/链接、空cursor加载更多、分页重试与loading禁用、部分失败保留本地、local无云端故障、签出无伪空计数、本地同ID真实恢复后task仍在。
- 原AS01–AS10退出0，原回归仅适配local row复合key；全局key保持原ID。
- 既有AA、AB、archive-service、archive、ARS回归退出0。
- `npx tsc --noEmit`退出0。

UI按钮复用现有archive-action样式，新增云来源状态布局和云行图标/窄窗操作换行。未新增依赖，未改App/Settings/hook/backend，未运行Cargo、全库构建、Git或真实HTTP。

## 未测与限制

- hook身份/订阅/网络权限/分页服务回归由数据层与主线程独立记录；UI fixture通过不能证明真实账号可调用。
- ChatGPT conversations、durable/remote归档及本地资格完整性仍未知；定时任务历史映射仍未实现，页面明确缺口。
- 云端恢复/删除/跳转未实现，按钮disabled是本阶段兼容呈现，不称官方完整动作。
- 搜索继续已登记的子串兼容，未实现官方Fuse模糊或全部markdown标题清理。
- 图标适配现有lucide；没有官方同环境配对截图、像素得分、原生物理IME或用户验收。视觉分数null，浏览器/原生最终结果由主线程补记。

## 15G来源日期核对增量

官方gn允许数字秒或日期字符串，和_Dn/OJ仅有限number参与排序是两条规则。UI改用数据层保留的raw chosen `displayTime=updated_at??created_at`：number乘1000，string直接Date解析；chosen无效不回退创建日期。createdAt/updatedAt仍单独用于数值排序，未将ISO解析结果写入排序时间。

AC03新增生产回归先在ISO显示真实红灯后转绿，同时验证ISO不参与numeric排序、无效更新字符串即使创建日期有效也不显示日期。AC01–08、AS01–10、AA/AB/ARS（含设置真实hook接线ARS06）均退出0；数据层displayTime字段落盘后tsc退出0。未改其他动作/服务。
