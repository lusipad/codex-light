# 2026-11-01 — 16.08A 账号读取身份隔离

范围：现有只读账号页的实际数据读取合同；不宣称固定包有相同额度仪表或登录页。

## 修改前依据

固定包bootstrap getAccount发送account/read(refreshToken:false)，account/updated分发认证状态。原包复用16.07哈希闭环，定位见[取证摘录](../../../.ref/parity/16.08/reference/account-trace.json)。未发现这些片段能证明本项目用量页面完整官方UI，不能用当前界面反推预期。[修改前合同](../specs/16-08-account.md)先于产品修改；真实隔离CLI 0.159.2确认未登录account:null和requiresOpenaiAuth字段，无认证/模型轮次。

## 实现

- 新增accountSnapshot，先读身份，再并行读取额度/用量，再核对身份，整体结果才进入UI；身份不同报错，不混入两个账号。
- rate响应有accountId且身份提供ID时交叉核对；不符只丢弃该额度，成功用量仍可展示。单路服务失败独立报错，不伪零。未登录不读受保护数据。
- SettingsView刷新清旧数据；请求代次防乱序与离页/卸载更新；account/updated监听触发重新读，迟到订阅释放。
- 账号页移除公共保存按钮，避免只读页面改写其他全局草稿。复用config客户端和现有显示控件，无依赖和视觉重做。accountRead显式refreshToken:false，与固定参考相同。

## 验证与限制

AC01–AC03直接执行生产helper，覆盖未登录、身份变化、额度账号不符、独立失败；AC04执行生产SettingsView回调/effect，覆盖清旧数据、乱序、通知、离页、迟到订阅。真实AC05只验证隔离未登录，不读取真实账号用量或修改认证。

现有usage未带可核对身份，前后身份栏位不能证明无ABA或后端缓存跨账号；登录/退出/刷新token、账号计划和完整图表/服务数据仍有缺口。当前配额图表和数据源的官方等价性尚未证实，不能把功能读取增量算整页完成。原生/视觉/用户未验收，未提交推送。

完整标准检查、构建、源码输入和产物见[核验记录](../../../.ref/parity/16.08/verification.md)。下一16.09个人资料先核官方读写入口，不延续当前本地Developer演示值。

最终完整标准检查与Release/MSI/NSIS退出0；248项构建输入前后指纹一致。[本批EXE](../../../dist-artifacts/16-08-account-snapshot-20261101/CodexNative.exe) SHA-256 `DCAA2AE1C79DA9CB9AFAAC80C2127674CB2FA91CB88F7A5575EA1D3A72DD59F1`。下一[16.09只读调查](../specs/16-09-profile.md)已建立。
