# 16H 常规页本地通知分组纠偏合同

状态：修改前合同，未用户验收。范围是本地五项设置及其挂载位置；独立ChatGPT账户通知页的远端服务不在本阶段实现。

## 主要决定

- 固定Store26.1027.3384.0的通知独立路由ct只渲染受gate控制的ChatGPT账户组；本地lt经general-settings的va挂在Dc末尾的通知组。将当前本地五项移到常规页，独立页明确账户能力尚不可用，不冒用本地偏好。可信度高：真实import/export/call链；账号资格是否与本项目相同仍未知。
- 按setting-row结构恢复左文案、右侧紧凑menu/switch；菜单menuWide=240px，现有GeneralPreferenceSelect复用且仅本地覆盖宽度。真实保存/读回、音频导入/取消/错误、离页停止不丢失。可信度高：静态实现；1px几何仍需配对。
- 本地组使用本客户端实际可用的本地偏好服务。官方Dc/Oc及账户gate尚无完整运行时映射，保留为适配差异；不强开官方gate、不伪造账户能力。

## 假设与偏差政策

同一固定asar已由本轮只读重新hash，相关entry integrity核验，引用见 `.ref/parity/16/actual/16H-notifications/reference/`。中文来自同包zh-CN。DPI/应用缩放/官方账号gate未知。保留当前额外ExperimentalFeatures真实消费者，但不称其为官方同位置控件；通知组置现常规内容末尾。旧声音许可/资源依赖及跨窗限制不在此轮解决。

遇缺证仅保留现有真实能力并登记，不造服务、不加依赖、不改系统权限、不触发OS测试通知。破坏性配置迁移/扩大安全权限须停止；普通可逆UI选择自动推进。

## 语义与验收清单

| ID | 官方行为与计划 | 验证 |
|---|---|---|
| NH01 | adapt：本地通知组挂常规，独立页不承载五项；账户组缺真实服务明确不可用 | 生产SettingsView回放、导航及搜索 |
| NH02 | keep：turn→permission→question→dot→sound，中文及三种turn值保持 | JSX顺序和实际保存读回 |
| NH03 | keep：Windows初查loading、disabled/not-determined禁控；unknown不是disabled | 延迟/失败/乱序/焦点重查 |
| NH04 | adapt：240px端对齐menu、行尾switch；复用菜单键盘/Escape/IME | 宽1280/窄640、几何、键盘 |
| NH05 | keep：声音选择/同值重选/自定义原生导入与取消、试听/保存真实时序 | 官方回调锚点、回归；不以无声夹具证明实际音频 |
| NH06 | keep：真实逐字段保存、失败保留旧值、晚到隔离、离页停止 | 原回归、协议、最终原生重启读回 |

## 实施与验证

仅改通知组件/局部CSS、SettingsView挂载/检索、必要的共享菜单ref接入及相关回归。开发记录使用16H验收文档的决定/偏差/意外/待审项，边实施边记。先定向回归，再类型/构建与完整标准检查；最终源码原生包验证本地偏好往返。无官方配对图score=null；物理IME/实际音色/账户gate未测即保留，不以本地阶段提交宣称整页通过。
