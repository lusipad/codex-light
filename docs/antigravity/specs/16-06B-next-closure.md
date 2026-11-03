# 16.06B 配置页完整本地链：修改前计划与验收

2026-11-03。修改前阶段合同。先读取新包真实路由和官方配置文档，再实施；整体复刻目标保持不变，阶段自验不等于官方或用户验收。

## 需要重点核对的决策

1. **本地 ConfigurationPanel 是本轮主页面**（高置信）。agent→configuration-panel，官方中文“配置”；Work 面板的复用 title 不决定路由。反证是后续固定原包/运行时路由改变。出处见[本地研究](16-06B-local-research.md)、[Work 对照](16-06B-work-research.md)。
2. **六项设置、即时保存、项目/用户/管理员范围**（高置信）。依序审批、沙盒、条件网络、搜索、详细度、推理摘要；移除不属于该页的模型/推理力度/reviewer表单。保留真实复杂策略显示和管理员锁，不能归一化覆写。
3. **真实双存储路径**（高置信，已有隔离证据）。当前CLI的 config/value/write 对project返回 configLayerReadonly，不能伪装协议支持。用户层使用版本化RPC；项目层像官方一样保注释修改白名单TOML，宿主校验真实层/要求/版本/原始内容，写后重新读取验证；不作为用户RPC失败fallback。
4. **配置进入发送上下文**（高置信）。缺省/自定义权限从目标cwd有效config解析；显式preset才覆盖；已有线程使用服务真实权限。不能继续每次发送硬编码network false/workspaceWrite。官方resolver精确锚点见本地研究第8节。
5. **未知能力不假放行**（高置信）。Work、实验性功能、依赖安装各有独立gate和服务；本阶段不虚造这些区块。缺官方截图/DPI时保留未验，不用夹具分数替代。

## 假设与偏离规则

用户要求持续按大阶段推进并自主提交；已授权低风险可逆实现及隔离验证，不重复询问。以Store26.1027.3384.0原包哈希和当前CLI双版本为证据；在线官方配置参考可能更新，只解释键/继承，不覆盖固定版本UI合同。

保守偏离指保留未知字段/注释、不降低权限、不覆写其它scope、不把服务失败转写本地文件；发现真实协议不支持时按官方已证实的项目文本路径适配并记证据。不新增依赖，不更改官方安装与真实用户配置。用户层/项目层默认只承诺新聊天，不强改已有线程。 destructive migration或未授权发布才需停止确认；无此动作继续实现。

| 官方行为 | 处理 | 原因与证据 |
| --- | --- | --- |
| 项目/用户/管理员scope，继承与锁定 | 保留 | 真实层数据和requirements决定，不自创全局表单 |
| 逐控件即时保存，失败不假选中 | 保留 | 对照onSelect/onChange与写入链 |
| 用户CAS RPC与项目保注释写入 | 适配 | Tauri宿主用已有toml_edit，独立路径，不复制Electron代码 |
| 六项值进入后续新聊天配置 | 保留 | 实际App协议参数回归，不只测保存 |
| Work远程/实验依赖隐藏分支 | 保留准入边界 | 无运行时资格不强开或伪造安装 |
| Electron内部组件实现 | 改用现有React/Tauri | 外部语义等价，未复制官方源码资产 |

## 实施分工

- 宿主：真实scope读取、白名单/requirements/managed校验、用户RPC、项目保注释与冲突检测、打开config和跨窗事件，复用现有依赖。
- 前端状态：scope默认/继承、版本与选项、即时写/重读、并发/迟到/身份隔离、只改当前scope。
- 页面：使用既有设置行/样式token，中文顺序/条件网络/锁定/行错误/打开文件。
- App：缺省有效权限与明确preset分开，真实会话设置恢复，send/queue/review/goal共享解析，保留已有审批/沙箱约束。
- 记录偏离在本文件实施注记中；阶段完成更新验收表与IMPLEMENTATION-LOG，构建/验证后Lore提交，远程无分叉再推送。

## 修改前验收合同

- AC-B01：cwd/层变化默认project→user；管理员/disabledProject/无文件只读，旧响应不覆盖新scope。
- AC-B02：六项及中文顺序、workspace-write才有network，未知旧值可读不新选、web indexed版本阈值与requirements过滤。
- AC-B03：managed origin、无合法选项及复杂对象禁止写；RPC/文件失败原值保留、行错误可见、可重试。
- AC-B04：用户版本CAS单key与读回；跨窗冲突拒绝/重读，不丢其它键。
- AC-B05：项目指定config文件保留注释/多行/未知键，坏TOML/inline network/旧内容/旧版本/替换路径拒绝且文件不变；独立临时目录验证。
- AC-B06：新聊天实际读cwd config解析readOnly/workspace roots/network/approval/reviewer；已有thread真实权限与显式preset分别测试，不静默放宽。
- AC-B07：实际send/goal/review/queue/steer参数回归；网页与输出键真实配置读回，模型请求未发起不得宣称执行。
- AC-B08：真实打开文件、Tab/Escape/IME、宽窄截图与官方配对像素待各自证据；浏览器夹具只证明其覆盖。
- AC-B09：完整标准、针对性/全Rust、同源码原生构建/输入指纹、文档与Lore提交；未验项逐项保留。

## 实施注记

- 调研已纠正旧资料将Work面板误当本地agent的结论；旧报告保留历史来源限制，当前入口以本合同为准。
- 首轮隔离project RPC测试按真实返回失败，明确 `Only writes to the user config are allowed`；没有吞异常或转称RPC通过。
