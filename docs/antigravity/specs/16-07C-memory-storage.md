# 16.07C 记忆宿主存储与状态合同

2026-11-03，当前实现不等于官方/原生/像素或用户验收。主合同[16.07C](16-07C-next-closure.md)，固定来源/Windows Chronicle见[transport](16-07C-transport.md)。

## API与范围

memory_preferences_read无任意路径参数，真实config/read(includeLayers,cwd:null)选择user层；其本机文件父目录物理身份派生hostId。缺层、相对路径、Windows非本机磁盘、链接/重解析路径拒绝。返回hostId/hostName/userFile/version、完整分页memory feature、config/origins/requirements、独立status或statusError、chronicle.available=false及每控件锁定。userValues只返回六个相关键以核验持久目标层，未为此传额外用户配置或凭据。

memory_preferences_write({expectedHostId,expectedVersion,operation:'enabled'|'external-context',value:boolean})重读真实主机和版本再写。主项分feature、generate/use配置、Windows禁用chronicle三组；external写disable_on_external_context反值并删除旧字段。每组真实config/batchWrite固定user file/version/reloadUserConfig，组后重新读回；只对本次前序写的版本推进，不覆盖外部改变的后续目标键。托管来源、featureRequirements、未知复杂值和缺能力拒绝/锁定，不接受任意key/filePath。

三组不假称事务：各组失败记录，不重放同一请求。最终有实际快照时返回snapshot本身及mutation:{complete,errors}，即使部分失败也显示真实状态；不能把已关闭保留成旧开启。读回失败明确已写结果需核对；不自动重复未知写。检查用户层、有效配置及runtime catalog启用值，配置文件为true不能覆盖目录false。read/status.ready不证明开启，status失败不替换假0或true。

memory_preferences_reset({expectedHostId})先重读确认主机/真实能力，单次memory/reset(params:null)并检查确认响应，再读取状态。返回{snapshot,reset:true,chronicleCleared:false}；Windows原生Chronicle本就不注册，按官方路径跳过其清理，不把未调用写成已清除。重置后读失败明确服务已确认/后续状态未核，不重新发送reset。前端必须显式确认，取消零调用。状态计数/ready不能单独作为数据删除证明。

跨窗Tokio mutex串行写/reset，事件memory-preferences-changed仅hostId，含未知写结果后也提醒其它窗口重新读取，不传正文或宣称成功。前端读期可离开，写/reset期global guard拒导航；身份/连接/卸载晚响应隔离。当前只有local host，没有伪远程/WSL控制。

## 已执行验证与限制

生产read/write/reset函数通过受控RPC单测；初始catalog覆盖缺陷已先红复现，再保留真实runtime并补“持久true/目录false”与目录未确认写入不通过用例。最终专项七项退出0。账号传输专项八项另见[账号合同](16-07C-account-storage.md)，不混作记忆数据验证。

隔离CLI探针scripts/protocol-verify/verify-memory-preferences.mjs用自己创建的临时home、固定key/file、空认证、mutation白名单，零模型turn。显式npm0.165.0与Store0.166.0-alpha.5.1均验证用户CAS/新进程消费/工具聊天反值与旧键删除/关闭chronicle、v1/v2 artifact与SQLite记忆行删除；保持非记忆job、threads.memory_mode、项目/AGENTS/config等sentinel。公开固定源码commit与哈希保留在.ref evidence，未将其产品源码复制进应用。

首轮探针错误种kind=stage1并误期望所有jobs清空，实际失败保留；据固定源码查得精确memory_stage1/memory_consolidate_global jobs，最终同时种真实memory jobs和非memory job，要求前者删除后者保留。不是删断言伪通过。node:sqlite不可用时脚本明确标数据库UNVERIFIED；本机Node25实际dbVerified=true，未新增依赖。未测试在线生成记忆、真实账号写入、原生GUI/IME/多窗或官方同条件像素。
