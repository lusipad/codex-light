# 21H Sites域名写入与操作

2026-11-07，接本地b4bfdbf URL阶段。先已有[21G完整开发前规格](21G-sites-url-domains.md)第3–6节，再实施本阶段，不从本项目旧域名行反推官方预期。

固定官方26.1027.3384.0，五原始资源SHA与九个完整UI函数UTF-16片段重新核对，0失败；另保留原export映射和完整API/schema锚点。来源`.ref/parity/21/actual/21G-sites-url-domains/reference/`，本次复核`.ref/parity/21/actual/21H-sites-domain-actions/reference/recheck.json`。未重算整包、未操作官方GUI或真实账号HTTP。

## 完整范围和顺序

本阶段仍需完成添加→DNS设置、已有域名状态/刷新/移除及确认。DNS根域识别需要官方声明的tldts公共/私有后缀行为，新增依赖仍待明确答复，未安装。不用手写后缀表、点数量、默认域名或假记录替代；先推进不依赖解析器的真实写接口及已有域名操作。Add/DNS入口尚未接入时必须记为未完成，不将本阶段缩成仅刷新/移除后标整页通过。

## 请求和结果

- 共用既有私有typed settings命令，只新增`domain_add{hostname}`、`domain_refresh{domain_id}`、`domain_remove{domain_id}`；调用者不能指定URL、方法或头。
- add：固定POST `/websites/{site_id}/custom_domains`，body只有JS trim后的hostname，保留大小写，不额外验证hostname语法、截断或剥URL。
- refresh：固定POST `/websites/{site_id}/custom_domains/{domain_id}/refresh`；remove：固定DELETE `/websites/{site_id}/custom_domains/{domain_id}`；两者无body、不附JSON Content-Type。
- 三者均返回完整CustomDomain，不接受204/布尔success。完整校验aNi所有required字段、nullable字段和validation_records optional键；绑定project_id，refresh/remove再绑定id。保留provider_status、worker_name、created_at、updated_at，不能在前端投影时丢弃。
- 域名写入按站点互斥，保既有title/environment/slug独立字段锁。沿用身份、代次、网络、取消与完整性检查；不自动重发POST/DELETE。明确服务拒绝保状态；已发但未确认、坏成功响应等保unknown，界面须先显式GET恢复。
- 仅当detail.type为invalid_project且detail.message精确`Publish the Site before adding a custom domain`时给出先发布的专用安全code；不把任意服务文本搬入提示，也不将全部400当先发布。

## 界面和适配

- 官方dr的常规组顺序为名称、URL、域名、共享；原项目把域名放环境变量之后需纠正。bn仅空列表且已取回、无error时出现Add；没有owner专用门槛，不复用slug gate。
- xn每项split row左侧“自定义域名”，右侧hostname；pending为“DNS 更改待处理。可能需要 24 小时才会生效。”，failed为“DNS 设置未成功。请检查 DNS 记录。”，last_error为“上次错误：{message}”。不展示伪verified标签或原始status单词。
- pending/failed显示刷新与DNS设置，active隐藏二者；所有状态有移除。刷新/移除进行中锁冲突操作。DNS设置仍待解析器约束解决，不新增假弹窗。
- 移除compact420 CSS px/92vw居中；标题“移除 {hostname}？”，说明“访客将无法再使用此域名访问该站点”。提供取消与危险确认操作；pending隐藏X、禁取消/Escape/外点，错误保留dialog与提示。不要求输入slug。默认焦点尚缺官方运行时证据，若采用取消聚焦应记为保守适配。
- 原mutation缓存消费真实完整返回；本项目另做实际GET读回，是适配验证而非已实测官方流程。remove只有实际列表缺目标才移除，refresh以实际列表状态为准；unknown只读恢复前禁止重复写，不自动重放，恢复后仍须用户显式确认。
- refresh返回active或remove的原域名active时重读站点详情，原子同步metadata和截图授权；详情读回错误与域名结果区分，不回滚已确认域名。
- 复用既有trackRequest保跨页身份监听；constructor无订阅副作用，挂载/清理可重入。切号、换站、晚回包、StrictMode、关闭后的焦点、中文IME和共享表单影响分别测试。

## 验证要求

1. typed variant真实先红；固定方法/路径/body、完整响应、ID绑定、互斥、401/5xx/取消/身份、精确先发布分支回归。
2. 实际wrapper/client解析与写入/unknown/取消测试，保旧读取、slug、环境/名称断言。
3. 状态和真实组件动作：刷新pending/failed/active、取消不写、单飞、移除读回、失败保留、未知GET不重放、跨页/切号、详情授权成对同步、恢复按钮不触发默认submit。
4. 真实浏览器宽窄和原生对应构建；完整范围冻结后标准、全Rust及构建统一跑，避免每个小修重复无关完整检查。
5. 官方配对像素、真实账号HTTP、物理IME、Add/DNS及用户验收缺失时不得标整单元1:1或完成。
