# 15I 设置归档云端删除 UI 自验

状态：前端行为专项自验完成，待统一集成、浏览器和原生复验及用户验收。此记录不表示整页完成或像素一致。

## 范围与来源

按 [15I 合同](../specs/15I-cloud-delete.md) 和同版 26.1027.3384.0 的 hn/Jqn/BOn/n2i 已证行为实现。UI 调用专用 `deleteCloudArchiveItem`，接受主线程提供的 accepted/already-absent 分类；task 任意 404 与 conversation 特定 conversation_deleted 的判定在该服务和宿主层，不由 UI 重复猜测。

修改 `src/components/ArchiveView.tsx`：设置内两种云端行启用真实受信 reader 的删除入口，新增紧凑原生 dialog，复用已有 RenameThreadDialog 样式、spinner 和 source:id 操作锁。未修改全局 ArchiveView、本地删除与全部删除的目标范围。

- 打开/取消确认零请求；task 确认立刻关窗，conversation 确认留窗 busy，阻止取消、Escape 和外点关闭。
- task 明确失败显示“无法删除聊天。请重试。”及 Retry action；conversation 明确失败显示“无法删除已归档的聊天”，保持原窗可再次确认，无 task action。
- 正常成功和专用 already-absent 清理对应来源缓存并刷新，不新增成功 toast，不将云端 ID 传入本地 thread 操作或导航。
- 恢复/删除共享 source:id 同步互斥；不同来源相同 ID 独立。操作、确认和 Retry 绑定 reader epoch、身份和 token，旧确认、旧结果不能关闭新窗或清理新 pending。
- unknown 禁止直接重放；显式读取后，只有新的有效成功快照仍包含目标才解除锁，用户需再次确认。失败/部分页不当作独立不存在证据。
- accepted 后读取或账号快照校验失败保留“聊天已删除，但列表刷新失败。”事实，刷新仅重读，不再 DELETE；新成功读回可清已解决详情，不把缓存移除当服务器独立确认。

## 回归与结果

新增 `node scripts/verify-archive-delete-ui.mjs`，执行生产 ArchiveView 和真实 dialog 函数，只有账号/服务与宿主数据边界使用内存夹具。实际测试无网络、无真实删除。

| 用例 | 结果与边界 |
|---|---|
| DU01 | 可信行入口；开窗和取消零 DELETE |
| DU02 | task 即关与 conversation 留窗 busy |
| DU03 | conversation 明确失败保留原窗可重试；专用 already-absent 只移目标来源 |
| DU04 | task 失败 Retry 不重开窗；成功无伪造 toast、无本地回调 |
| DU05 | 已取消旧确认回调不可再次写；该项先红后绿 |
| DU06 | unknown 不重放；读取失败仍锁，成功新快照含目标后可显式再确认 |
| DU07 | 删除与恢复同 source:id 互斥；跨来源同 ID 可独立操作 |
| DU08 | 旧 Retry 不穿透另一个确认窗；旧 reader epoch 不可写新页 |
| DU09 | 账号 generation 变化使旧请求取消；旧 accepted/finally 不清新 pending 或新行 |
| DU10 | accepted 后读取失败保持执行事实，刷新零写，详情可清，目标仍见也不重删 |
| DU11 | 生产 modal 标题保持 React 文本；IME/组合输入、同 tick submit、busy Escape/外点保护、unknown 可取消与刷新；不代替浏览器或原生焦点验证 |
| DU12 | accepted 后账号快照改变，登记读版本后可清恢复详情；该项先红后绿 |

DU01–12 退出 0；`npx tsc --noEmit` 退出 0。兼容回归 `verify-archive-unarchive-ui.mjs`（UU01–11）、`verify-archive-cloud-ui.mjs`（AC01–08）、`verify-archive-conversations-ui.mjs`（CV01–07）、`verify-archive-settings-projection.mjs`（AS01–10）、`verify-archive-cloud-tasks.mjs`、`verify-archive-conversations.mjs`、`verify-archived-settings.mjs`（ARS01–07）均退出 0。AC/CV 保留不可信 reader disabled 与直接回调零云端写断言，新增不能打开确认窗检查，未删除安全约束。

## 未验证与适配

- 本记录不覆盖主线程专用服务、Rust transport、真实 HTTP 删除结果；相应专项由主线程另记。
- task 专用 Retry 的中文 fallback 未实测，使用来源 defaultMessage “Retry”，不猜官方中文。
- native dialog 初始聚焦取消、关闭后回原控件/容器以及更严格 epoch/卸载保护属于可靠性适配，不能说已证官方默认完全相同。
- 本轮复用既有 modal 样式，未自行改视觉 token。尚缺同环境官方配对图，visual score 为 null，未证明 1px 几何或像素一致。
- 真实浏览器/原生 Tab、焦点环、Esc、中文 IME、窄窗、toast action 和双源并发由主线程后续验证；没有在此记录宣称通过。
- 完整来源缓存广播、内部 cloud/conversation 查看页尚未实现；普通刷新会重新从第一页读取，未声称与官方无限查询页保留完全一致。
- 未运行 Cargo、完整标准入口或产品构建，未提交或推送；统一阶段检查由主线程完成。

主线程后续集成：按同版Modal/按钮/CSS来源仅局部覆盖删除弹窗的18px标题、electron圆角与medium按钮；浏览器发现并修复行danger选择器覆盖。真实Tab路径短暂落body由DU13红灯锁定，再补双向循环与busy根焦点，独立复核及浏览器通过；同版HSn outline-none去除根UA轮廓，保留按钮焦点。故上列“未改CSS/未做浏览器”仅指UI子任务交接时范围，最终结果、窄iframe视口边界及未测项以[整合记录](15I-cloud-delete.md)为准。
