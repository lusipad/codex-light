# 16.09 个人资料：只读调查

日期：2026-11-01，未开始产品代码。固定设置注册将profile和account指向同一app-primary Yr组件；profile可见性case受lt&&!ft等条件控制，需继续追身份/gate，而不是始终显示本地编辑器。原始use-visible-settings-sections取自16.05哈希闭环，0-based UTF-16锚点profile component 26124、可见性34568、模式映射40290。

本项目当前profile字段预设Developer/codex_user及英文bio，仅写desktopPreferences；检索未发现这些字段的实际账号更新消费者，不能冒充官方资料更新。下一步追app-primary导出/远程协议/中文资源，明确是否共享account页面、可编辑字段与账号服务。只读导出的profile/account相关chunk见.ref/parity/16.09/reference/manifest.json，尚不证明真正页面来源。

预期改动前须先定义真实身份读/写范围、失败保稿、读取更新与多账号隔离；无可用服务则撤下假成功入口，并保留原数据。完整资料页和像素验收仍未完成，不按旧本地表单当官方事实。

## 16.09A 修改前纠偏合同

原包profile-ab5e9e0709fe.js存在账号头ChatGPT-Account-ID、profiles远端写入与用户名验证服务；displayName/bio/photo等保存由真实回调执行。profile-settings存在profile-v2/账号/产品gate，不能复制任意分支强开。定位见profile-contract.json及manifest，属于静态发现未实测。当前app-server schema未提供相应资料写方法，仓库无可用认证HTTP桥。

当前增量：删除示例Developer/codex_user/bio编辑展示及假本地账号保存，保留旧存储字段不自动清除/迁移。独立只读组件读取真实account/read（不读私密令牌），区分未登录/ChatGPT/API Key/Bedrock；明确没有接入资料编辑。读请求代次/通知/卸载保护、重试/加载/错误。此为纠偏增量，不接受为完整资料页或官方视觉替代。

PF01账号类型真实展示，无默认模拟身份；PF02刷新/通知清旧数据，晚响应隔离；PF03订阅迟到/卸载释放；PF04此页不写desktopPreferences/config，不出现保存按钮。真实登录资料服务、头像/公开主页等功能保持未实现，继续16.10无依赖工作，不据此宣称资料页完成。
