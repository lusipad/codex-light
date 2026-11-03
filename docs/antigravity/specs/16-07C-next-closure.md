# 16.07C 记忆与账号指令下一阶段修改前合同

2026-11-03，仅只读调研完成，未实施本阶段产品或写入。固定Store26.1027.3384.0，asar SHA-256 `6fbedf054a8d8cafaf5c745b40aa59176512e106e0bd6308275ae123b60fd074`；ignored原始研究/UTF-16锚点/integrity/双CLI schemas与只读报告位于 `.ref/parity/16.07/actual/16-07C-research/`，不冒称Git随附。

## 决策与真实范围

高置信：本机Memory三行可通过真实catalog和协议实现，不应用本地指令文件替代或永久留作占位。personalization-settings-bfea882ec410.js:10995 Xr，app-initial:1656105按experimentalFeature/list中的name=memories判资格；缺能力/读失败必须显示对应状态。默认关闭不等于不支持，underDevelopment的external_agent_memory_import不是同一功能。

高置信：主开关实际为feature.enabled&&generate_memories&&use_memories，多项写不是原子事务。TFo:7905110对缺省generate/use取true、disable_on_external_context取false，仍不能绕过feature.enabled=false显示开启。当前CLI0.165.0与Store0.166.0-alpha.5.1只读实测均有stable memories、enabled/defaultEnabled=false；memory/status({})均返回{v2Ready:true,v2ConsolidatedThreads:0}，所以ready不是开启或记忆存在证明。当前版本分别以报告记录，不混同16.07B的CLI0.159.2探针。

三行按官方顺序：启用Codex记忆功能；允许从使用工具的聊天中生成记忆；删除Codex记忆。主项写features.memories和memories.generate_memories/use_memories，配置写精确user file/version/reload；允许工具聊天写disable_on_external_context反值并删除旧no_memories_if_mcp_or_web_search字段。主开关关闭和删除另有关联本机chronicle能力，缺能力不伪造已清理。

reset前必须展示真实确认，说明选定host的全部记忆。两版experimental schema的memory/reset参数null/省略、响应空object；本轮仅schema，没有执行reset。下一阶段仅在隔离home/记忆数据和明确fixture中验证删除结果、失败和半成功，不动用户真实记忆，不用清空UI或ready状态冒充删除。

账号指令单独固定GET/PATCH桥：cloud-preferences:647/1073逻辑路径/wham/settings/user，custom_instructions和expectedIdentity；现有chatgpt_service有token/routing/integrity/cancel/世代底座，但ServiceOperation没有该路由、HttpMethod没有Patch、CloudOperation是另一ASB服务。先追M_.safeGet→aht→Zg物理transport前缀，不能凭逻辑路径拼域名。写单次发送，未知结果不自动重放，成功后GET读回且核身份；能力/gate和真实只读资格确认后才展示独立账号编辑器。403/失效不转写AGENTS.md，前端不拿token。

## 保留/适配与偏离

保留真实三行、资格、状态和删除确认；Tauri复用现有配置RPC、版本/身份、错误与跨窗能力。关联写部分成功如实列出并重读，不把其中一项成功当全成功。当前仅local host，不能制造远端选择、记忆内容假列表或max_*调参。账号桥单独推进，不让受限远程服务阻塞已证本地记忆链；必要偏离写实施注记，不擅自降低1:1门槛。

## 验收合同

- MC01：完整catalog分页/失败/资格；三项中文、顺序、checked/disabled条件来自真实返回，ready不等于启用。
- MC02：user层版本化批写/删除旧键、managed/未知值锁定、冲突和多写半成功保留实际结果；新进程读回，不写真实用户配置。
- MC03：切换账号/host/连接、晚到/并发、跨窗/外部配置变化隔离；UI不先假选中。
- MC04：隔离真实记忆目录的reset确认→协议→数据结果；取消零写，失败/未知结果不显示成功；chronicle有/无能力两支分别证明或未验。
- AC01：账号固定transport操作、PATCH白名单、一次发送、取消/身份世代和读回；真实服务资格不足不以fixture或本地文件替代。
- MC05：生产专项、真实隔离协议、完整标准、相关/全Rust、同源码原生构建和输入指纹；官方runtime/原生/IME/配对像素/用户验收单列。阶段通过自验后Lore提交，远程无分叉可推送；整App目标保持未完成。

## 开工补证与实现选择

真实transport与Windows Chronicle补证见[16.07C transport](16-07C-transport.md)。官方Windows无native Chronicle（仅macOS+gate+requirements具备），reset跳过其原生清理；关闭记忆却仍走fallback写features.chronicle=false，不能遗漏关联写。三组（feature/config/chronicle）不是原子事务；宿主各组版本化写入并读回，部分失败返回实际快照和分组错误，不用旧开关掩盖已落盘状态。

此前合同对PATCH绝不401重试的推断被early transport源码反证，现明确修正：仅明确401允许同身份、同body刷新后重试一次；刷新后身份改变禁止重试；网络/超时/取消/未知送达不重放。账号桥资格仍独立于可调用操作，不能强开未知gate。

主机取真实user层文件父目录和物理身份；单个控件managed/复杂值/featureRequirements独立锁定。记忆写入复用现有协议，无依赖；跨窗事件无正文。账户桥另行隔离transport单测，暂不修改真实账号偏好。实施注记见[16.07C实施记录](16-07C-implementation-notes.md)，阶段完成才提交，官方/原生/像素和用户验收单独保留。
