# 16.07B 实施注记

计划：[修改前合同](16-07-next-closure.md)。本阶段开发中，未声明交付或验收。

## 决策

- 当前本地app-server真实user层决定执行home，不自创远程host选择；读取返回真实路径和物理host身份，写入必须带已观察路径/host并重新派生。
- 本轮全局导航guard覆盖路由/历史/新会话/会话选择与设置分区，dirty确认或busy拒绝发生在副作用之前。
- UI/状态与宿主可独立实现并行，父负责App/Settings接线和回归；Cargo统一串行。

## 偏离

- 无已确认统一AGENTS.md资格，先保持旧本机Codex指令分支；账号/Memory独立服务不借本地文件冒充。

## 发现

- 初始研究未发现CtrlEnter的说法被vi:33689原始片段反证。父独立核对后纠正合同；局部Ctrl/Cmd+Enter保留，全局Cmd/Ctrl+S来自Ei注册，不能把研究遗漏变成功能删除。

## 待复核

- 原生关闭/IME、多窗、官方gate实际资格和同条件像素均须独立证据，浏览器夹具不能替代。

## 实施结果与首败留证

- 宿主专项六项真实临时磁盘/并发回归退出0。默认CLI0.159.2与Store0.166分别零模型turn探针通过home一致性和四组指令消费，报告分开保留。
- 旧项目/权限/通知夹具缺新增guard ref的失败已补真实空guard，不改原断言；误调用不存在verify-native-notifications脚本只属命令选择错误，已改仓库真实verify-notification-delivery并通过，不把不存在命令当测试结果。
- 浏览器explicit reload焦点首败保留，修复只增加显式替换成功后的受保护restoreFocus；不把后台refresh变成抢焦点。初次完整标准已通过，但焦点修复后的最终完整检查另跑；输入快照分开保留。
