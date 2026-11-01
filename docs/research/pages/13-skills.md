# 13 Skills (技能扩展) 调研与实现

日期：2026-10-27。状态：调研完成，代码实现与全量验证通过。

## 1. 范围与证据

本单元覆盖技能列表、启停、创建、编辑与目录直达等核心功能：
- 技能数据源与发现：
  - 调用 app-server 协议 `skills/list`（`listSkills`）获取远端/插件提供的技能；
  - 本地种子与自定义技能扫描（`~/.codex/skills/` 与工作区 `.codex/skills/`）；
  - `buildSkillRows` 算法融合 local 与 remote 技能，精准匹配作用域（用户/仓库/系统/管理员/本地/种子）；
- 技能启停开关：
  - 调用 `skills/config/write`（`writeSkillEnabled`），按路径或名称精确更新 `enabled` 状态；
  - 界面实时反映切换忙态与错误捕获；
- 技能创建与编辑：
  - 支持创建新技能（`SKILL.md` 包含 YAML frontmatter 与提示词指令）；
  - 调用 Tauri 命令 `skill_save_or_install` 保存；
  - 支持一键安装离线种子技能到 `~/.codex/skills/`；
  - 支持卸载本地技能（`skill_delete`）；
- 物理文件与目录联动：
  - 在技能编辑栏提供“打开目录”按钮，调用 `reveal_path_in_explorer` 快速定位技能文件夹。

### 官方基准
- 官方固定版本：`26.928.21956 / build 12404`。
- 本机 app-server 实际版本：CLI `0.159.2`。

## 2. 源码差距与问题清单

| ID | 问题描述 | 影响 | 状态 |
|---|---|---|---|
| SK01 | 技能编辑面板缺少打开技能所在目录的按钮 | 用户无法从界面一键定位到物理 SKILL.md 文件夹 | 已解决 |
| SK02 | 技能启停协议写操作需要与 app-server 状态严格同步 | 避免界面状态与实际配置不同步 | 已解决 |

## 3. 验证与回归设计

设计回归脚本 `scripts/verify-skills.mjs`，包含：
1. 断言 `plugins.ts` 支持 `skills/list` 与 `skills/config/write`；
2. 断言 `SkillsMcpView.tsx` 具备 `handleToggleSkill` 真实启停调用；
3. 断言 `SkillsMcpView.tsx` 具备“打开目录”按钮与 `reveal_path_in_explorer`；
4. 断言 `SkillsMcpView.tsx` 支持本地技能新建与保存。

## 4. 实施与验证结果

1. **最小修改实施**：
   - 在 `SkillsMcpView.tsx` 的技能编辑动作栏补充“打开目录”按钮（`FolderOpen` + `reveal_path_in_explorer`）；
   - 保证本地与远程技能均可方便定位。
2. **测试转绿与全量验证**：
   - `node scripts/verify-skills.mjs` 全部通过（退出码 0）；
   - 接入 `scripts/verify-all.ps1`，全量标准检查 PASS（退出码 0，日志存档于 `.ref/parity/12/verify-plugins-skills-final.log`）。
3. **原生构建与指纹**：
   - 原生 Release 编译完成（退出码 0）；
   - 产物归档于 `dist-artifacts/12-plugins-skills-20261027/CodexNative.exe`；
   - SHA-256：`30C175EB27D2C9C8F94CBF8FE0D0755E5156F56E55E2E26FDED17D487F93BFDF`（记录于 `.ref/parity/13/build-skills.json`）。
