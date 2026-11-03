# 16.08 账号与额度：只读调查入口

日期：2026-11-01。未开始本单元产品代码。

先对固定原包settings account/usage与profile入口、登录/退出调用、语言资源和模式/身份gate取证；以当前真实account/read、account/rateLimits/read和account/usage/read协议为可用数据边界，不把旧页面计划当官方可编辑范围。

当前SettingsView.loadAccountData顺序读取三个接口，分别更新状态，没有请求版本/账号身份核验；账号中途切换可能混入前一身份额度。当前accountUsageRead将缺summary降为空对象，UI是否显示0需追消费，不能把未知改成零用量。尚无本应用登录/退出闭环，页面明确只读；下一轮核真实可用协议后再定义授权和退出交互，不修改真实账号来测试。

修改前需补：官方入口/中文/数据范围；身份稳定键与通知更新；部分失败的独立状态；空/不适用/API Key/Bedrock不混判；额度窗口与单位/重置时间/无限余额；隔离未登录探针与生产回放。原生/官方账号与配对像素仍为最终验收要求。

## 16.08A 修改前限定合同

固定包bootstrap getAccount发送account/read(refreshToken:false)，account/updated分支通知认证状态消费者；原始锚点见.ref/parity/16.08/reference/account-trace.json，原包哈希沿用16.07复测。该证据不证明当前自创用量仪表的完整官方UI。现有account协议schema仅作为本地数据边界，先补真实未登录读取探针再改。

当前限定范围：刷新先清旧快照，读身份→并行读额度/用量→再读身份，身份不一致丢弃结果；rate返回accountId时与身份比对；account/updated立即清数据并触发新请求，代次隔离晚响应与卸载。无账号不读受保护用量，不把失败当0；同次部分读取失败允许另一项成功。保存按钮不能对只读账号页写其他全局配置。

用例AC01未登录只读账号且额度/用量为空，AC02前后身份变化拒绝混合、额度accountId不符拒绝，AC03部分失败与空值不伪零，AC04旧请求/离开/通知/迟到订阅释放，AC05实际未登录探针。真实登录退出、token刷新、账号ABA变化、官方完整UI和原生像素待后续，不扩大本增量完成口径。
