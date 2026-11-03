# 16.11B 本地插件变更与市场移除合同

2026-11-03，实施前合同。固定来源、完整行为与验收见同目录 `16-11B-next-closure.md`；本文件限定客户端存储与顺序操作，不代表权限服务、原生或像素已验。

- 本地插件启禁先 config/read(includeLayers:true,cwd)，仅真实用户层 filePath/version CAS 点写 `plugins.<literal id>.enabled`，reloadUserConfig=true。project/managed 覆盖明确拒绝；不重建 plugins 表，不因 INSTALLED_BY_DEFAULT 自行禁止启禁。
- remote source 或非 local host 不发本地写。写后读回用户 enabled 和 plugin/installed 实际 enabled，再 skills/list forceReload。保存、有效 enabled、技能刷新是独立事实；未知送达不自动重写，明确冲突与未确认分别返回。
- config.marketplaces 的真实 keys 决定 configured；目录自身 isBuiltIn 则不可移除。Git 更新资格仅 source_type=git 且 source 非空。缺路径/配置来源不清晰不可静默推断。
- 移除先完整 plugin/installed 枚举，目标市场 load errors 不是空列表；政策不可卸载、远程插件先整体阻塞。全部预检通过后顺序 plugin/uninstall，每次真实读回再累计 completedIds；未确认中止，重试先重读事实，不盲重放未知动作。全部卸载完成后才 marketplace/remove，再 config/installed 读回确认消失。
- 关闭/上下文改变只停止后续步骤，不声称撤销在途卸载。保留真实已完成进度与未知送达状态；市场 remove 未确认时只读回，不能自动重放。并发同插件锁由宿主沿用安装/卸载锁，客户端不另造只限本窗口的假锁。
- 生产夹具锁定 CAS、同名特殊字符路径、未知字段保留、remote/scope 拒绝、写后读回与刷新失败、市场完整预检/部分失败/关闭/剩余重试。私有 CODEX_HOME/本地市场探针只使用临时目录、零模型 turn，不触及真实账号。

以上为预期；结果由实际运行输出补录，未运行项不标通过。

## 实施与验证结果

客户端 `src/pluginManagement.ts` 已按以上合同落地。`setPluginEnabled` 使用本地真实用户层 CAS 单字段写，`verifyPluginEnabled` 是未知送达后的纯读取恢复入口，绑定原 configFilePath，分别核用户层、有效配置和 plugin/installed enabled；确认后独立刷新技能。远程 source/host、管理员 DISABLED_BY_ADMIN、非用户 origins 不走本地变更。INSTALLED_BY_DEFAULT 不被推导为禁止本地启禁。

固定 Store jmn 的默认安装卸载限制仅适用于 remote+installed+INSTALLED_BY_DEFAULT；本客户端不把此限制施加到 local 默认安装插件。remote 本阶段另因缺少对应服务卸载链而整体前置阻塞。该来源差异已有生产回归。

内建市场不是 RPC 的 isBuiltIn 字段。按固定 Store aJn @3707264、iJn/rJn、wJn @3710406 mapper，将名称 trim/lowercase、连续非 ASCII 字母数字改为连字符并去首尾连字符，再匹配 codex-official、openai-bundled、openai-curated、openai-curated-remote、openai-primary-runtime 五名。本客户端按此真实 mapper 排除内建市场，未新增虚构 RPC 字段；五名、别名规范化和非内建近似名均有专项。

市场移除计划冻结真实 marketplace path 与配置 source_type/source 身份；执行起始、每项卸载前和最后移除前重新核身份。同名来源替换立即停止，不将原移除意图转移给新市场。最终 marketplace/remove 前重新枚举已安装插件；出现新插件不删除市场。未知卸载或市场移除结果只读回，不自动重发。关闭不撤销已经送达的动作，保留 pendingPluginId/removePending 供重新打开后核验。

2026-11-03 实测命令：

- `node scripts/verify-plugin-management-b.mjs`：退出 0。生产逻辑夹具覆盖精确转义路径、字段保留、CAS、scope/remote/admin 拒绝、写后读回、纯读恢复原文件/来源核验、技能刷新失败、市场政策与读取预检、顺序卸载、部分失败重试、未知送达不重放、关闭、新插件竞争、同名 source/path 更换。
- `node scripts/protocol-verify/verify-plugin-management-b.mjs`：当前 CLI `0.159.2` 退出 0；固定 Store CLI `0.166.0-alpha.5.1` 同一探针退出 0。证据 `.ref/parity/16.11/actual/16-11B/protocol/plugin-management-protocol.json` 与 `protocol-store/plugin-management-protocol.json`。
- 真实探针使用全新私有 home、本地临时市场和两个真实 fixture 插件，先安装，再启禁 false/true 读取用户配置及实际 installed enabled，forceReload skills；保留 sibling 未知字段与 TOML heading，旧 CAS 版本被真实拒绝。最后完整枚举、逐一卸载读回、空检查、移除市场并读回 config/installed 不存在。零模型 turn、无真实账号写入。
- `npx tsc --noEmit`、`git diff --check`：退出 0。未运行 Cargo，父级统一原生宿主验证。

协议没有提供“冻结市场来源、禁止同时安装、卸载全部并移除”的事务。最后空检查/身份检查与实际 remove 间仍存在外部进程竞争窗口；上述客户端检查不能证明跨进程原子性。真实跨窗口同插件在途锁由父级宿主实现并单列验证。远程服务启禁/卸载、权限服务、官方配对像素和原生焦点仍未由本专项证明。
