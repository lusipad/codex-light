# 16 设置中心 (Settings 逐分区 16.01-16.26) 调研与实现

日期：2026-10-27。状态：调研完成，代码实现与全量验证通过。

## 1. 范围与证据

本单元覆盖设置中心全部 26 个分区的完整生命周期、数据源作用域与读写闭环：
- 个人分组 (Personal)：
  - 16.01 `general-settings`：启动、语言、休眠保活、默认编辑器；
  - 16.02 `appearance`：主题配色（8 套官方配色方案）、字体字号、深浅模式；
  - 16.03 `keyboard-shortcuts`：真实快捷键注册表（来自 `shortcuts.ts`）与搜索过滤；
  - 16.04 `notifications`：通知策略、系统权限、提示音音量与音效主题；
  - 16.05 `providers-models`：模型目录、提供商配置与默认模型；
  - 16.06 `agent`：智能体推理、审批策略、沙箱级别、联网开关；
  - 16.07 `personalization`：个性化提示词与自定义对话偏好；
  - 16.08 `account`：登录账号、额度、用量与使用限制；
  - 16.09 `profile`：个人资料与头像信息；
  - 16.10 `connections`：MCP 服务器状态、连接与热重载；
  - 16.11 `plugins-settings`：插件更新策略与市场配置；
  - 16.12 `hooks-settings`：生命周期挂钩真实列表（`hooks/list`）与实时运行记录；
  - 16.13 `git-settings`：Git 分支前缀、force-with-lease 策略；
  - 16.14 `local-environments`：本地环境与工作区配置；
  - 16.15 `worktrees`：隔离工作树保留与清理语义；
  - 16.16 `code-review`：审查触发时机与严重性阻断阈值；
  - 16.17 `import`：从 VSCode / Cursor / Windsurf 导入配置；
  - 16.18 `storage`：磁盘存储真实统计（`storage_stats_get`）与清理确认；
  - 16.19 `archived-chats`：与归档会话视图同构的数据管理与恢复；
  - 16.20 `experimental`：实验特性开关（`experimentalFeature/list` 与 `enablement/set`）；
  - 16.21 `voice`：语音输入设备与转写；
  - 16.22 `computer-use`：屏幕与系统操控权限说明与配置；
  - 16.23 `appshots`：应用截屏快照与快捷键；
  - 16.24 `browser-use`：无头/远程浏览器与 CDP 连接策略；
  - 16.25 `pets`：虚拟宠物伴侣状态与交互；
  - 16.26 `cloud-settings`：Codex 云端工作区与同步偏好。

### 官方基准
- 官方固定版本：`26.928.21956 / build 12404`。
- 本机 app-server 实际版本：CLI `0.159.2`。

## 2. 验证与回归设计

设计回归脚本 `scripts/verify-settings-partitions.mjs`，包含：
1. 断言 `types.ts` 中的 `SettingsSectionSlug` 覆盖全部 26 个分区；
2. 断言 `SettingsView.tsx` 中的 `SETTINGS_NAV_GROUPS` 包含全部 26 个分区且无遗漏；
3. 断言服务端配置读写（`config/read`、`config/batchWrite`、`experimentalFeature/*`）完整；
4. 断言本地偏好持久化（`desktop_state_get` / `desktop_state_set`）正确区分作用域。

## 3. 实施与验证结果

1. **测试转绿与全量验证**：
   - `node scripts/verify-settings-partitions.mjs` 全部 26 个分区及协议检查通过（退出码 0）；
   - 接入 `scripts/verify-all.ps1`，全量标准检查 PASS。
