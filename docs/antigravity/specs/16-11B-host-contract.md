# 16.11B 宿主插件操作互斥：修改前合同

2026-11-03。依据[固定Store主合同](16-11B-next-closure.md)的同plugin启禁/安装/卸载并发不变量。当前SkillsMcpView只有单组件pluginActionRef，并非跨窗口锁；app_server_call直接转发这三种写路径。

父只新增plugin_operations宿主状态、必要lib接线和隔离单测；不重构app-server。安装先用同marketplace选择器plugin/read取得实际summary.id，不按目录猜plugin ID；卸载采用pluginId；配置启禁从合法TOML quoted keyPath中提取plugins.<literal ID>.enabled。按一批写涉及全部ID原子试锁，冲突可见拒绝；不同插件可并行。guard在成功/失败/任务释放后清理，无延迟计时器。

事件仅广播plugin-management-changed空payload供其它窗口重读，不广播配置/密钥。锁只覆盖本客户端在途请求，不宣称插件服务自身具备事务或市场枚举→删除原子性；未知送达必须由客户端实际读回，不能自动重放。市场删除前重新枚举，新的已安装项或读取错误不得越过最后remove。

验证：plugin/read真实ID与安装参数不变、同插件不同动作冲突/不同插件并行、多ID冲突无半锁、错误与取消释放、quoted ID含点/引号/斜线不会串键；父串行Cargo、完整标准与构建，原生多窗/服务端原子性仍独立验收。
