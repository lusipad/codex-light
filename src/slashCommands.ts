/**
 * 官方风格斜杠命令注册表（Slash Command Registry）
 *
 * 数据来源：`.ref/reference/REFERENCE-INVENTORY.md` §5.3「斜杠命令（完整清单）」
 * （官方 Codex App 的 `composer.*SlashCommand.*` i18n 文案与 review-slash-command 子菜单）。
 * 本文件是**纯数据模块**：无副作用、无 React 依赖，可被 composer / 命令面板 / 快捷键层复用。
 *
 * 字段约定：
 * - `id`          稳定标识（沿用现有 ComposerAutocomplete item id，保证既有行为不回归）
 * - `command`     命令字面量（以 "/" 开头，用于展示与过滤）
 * - `title`       官方风格标题（英文原文）
 * - `description` 展示用描述（与现有 Composer 下拉文案保持一致的中文说明）
 * - `kind`        "insert" = 选中后把 `insertText` 填入输入框；"action" = 触发 `action` 回调
 * - `action`      交给宿主（App.tsx `handleSlashAction`）处理的动作 id
 * - `insertText`  填入 composer 的完整文本（action 类命令可省略/为空）
 */

export type SlashCommandKind = "insert" | "action";

export interface SlashCommand {
  id: string;
  command: string;
  title: string;
  description: string;
  kind: SlashCommandKind;
  action?: string;
  insertText?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  /* ── 现有 composer 命令（id / action / insertText 语义保持不变）────────── */
  {
    id: "goal",
    command: "/goal",
    title: "Goal",
    description: "设定持续推进的目标 (Set a goal to keep pursuing)",
    kind: "action",
    action: "open_goal_dialog",
    insertText: "",
  },
  {
    id: "review",
    command: "/review",
    title: "Code review",
    description: "审阅当前 Git 工作区或分支代码改动",
    kind: "insert",
    insertText:
      "/review 请审阅当前 Git 工作区中所有未提交的代码变动，总结修改点并指出潜在缺陷或重构建议。",
  },
  {
    id: "plan",
    command: "/plan",
    title: "Plan mode",
    description: "开启计划模式，先制定分步实施方案再执行",
    kind: "action",
    action: "toggle_plan",
    insertText:
      "/plan 请针对以下需求先制定详尽的分步实施计划，待我确认后再执行：",
  },
  {
    id: "fast",
    command: "/fast",
    title: "Fast 2x",
    description: "切换 Fast 2x 极速推理档位",
    kind: "action",
    action: "toggle_fast",
    insertText: "",
  },
  {
    id: "init",
    command: "/init",
    title: "Init",
    description: "分析项目架构并生成 AGENTS.md 规范",
    kind: "insert",
    insertText:
      "/init 分析当前项目结构、依赖关系与技术栈，为项目初始化并完善 AGENTS.md 指南。",
  },
  {
    id: "compact",
    command: "/compact",
    title: "Compact",
    description: "压缩当前长会话上下文，释放模型窗口",
    kind: "insert",
    insertText: "/compact 请总结当前会话的核心决策与未决事项，压缩上下文历史。",
  },
  {
    id: "worktree",
    command: "/worktree",
    title: "Worktree",
    description: "切换到独立 Git Worktree 隔离环境运行",
    kind: "action",
    action: "toggle_worktree",
    insertText: "",
  },
  {
    id: "test",
    command: "/test",
    title: "Test",
    description: "扫描近期改动模块并编写完备单元测试",
    kind: "insert",
    insertText: "/test 请为当前改动的核心模块编写自动化单元测试，并运行验证。",
  },
  {
    id: "terminal",
    command: "/terminal",
    title: "Terminal",
    description: "打开底部内置交互式终端面板",
    kind: "action",
    action: "open_terminal",
    insertText: "",
  },
  {
    id: "diff",
    command: "/diff",
    title: "Diff",
    description: "打开右侧代码变更审阅工作台",
    kind: "action",
    action: "open_diff",
    insertText: "",
  },

  /* ── 新增官方命令（§5.3 清单）────────────────────────────────────────── */
  {
    id: "fork",
    command: "/fork",
    title: "Fork chat",
    description: "在当前工作区或新 worktree 中分叉此会话，保留上下文继续推进",
    kind: "action",
    action: "fork_thread",
  },
  {
    id: "side",
    command: "/side",
    title: "Side",
    description: "开启临时侧边会话，不打断当前主线",
    kind: "action",
    action: "open_side_chat",
  },
  {
    id: "new",
    command: "/new",
    title: "New chat",
    description: "在同一工作区中开启一个空白新会话",
    kind: "action",
    action: "new_chat",
  },
  {
    id: "model",
    command: "/model",
    title: "Model",
    description: "为当前会话切换模型",
    kind: "action",
    action: "open_model_picker",
  },
  {
    id: "reasoning",
    command: "/reasoning",
    title: "Reasoning",
    description: "调整当前会话的推理强度档位",
    kind: "action",
    action: "open_reasoning_picker",
  },
  {
    id: "speed",
    command: "/speed",
    title: "Speed",
    description: "关闭服务层加速档位，回到标准速度",
    kind: "action",
    action: "toggle_fast",
  },
  {
    id: "status",
    command: "/status",
    title: "Status",
    description: "查看会话 ID、上下文用量与速率限制",
    kind: "action",
    action: "show_status",
  },
  {
    id: "usage",
    command: "/usage",
    title: "Usage & billing",
    description: "打开用量与账单设置",
    kind: "action",
    action: "open_usage_settings",
  },
  {
    id: "mcp",
    command: "/mcp",
    title: "MCP",
    description: "查看 MCP 服务器连接与运行状态",
    kind: "action",
    action: "open_mcp_status",
  },
  {
    id: "project",
    command: "/project",
    title: "Work in a project",
    description: "为新会话选择项目工作区",
    kind: "action",
    action: "open_project_picker",
  },
  {
    id: "cloud",
    command: "/cloud",
    title: "Cloud",
    description: "在云端运行当前会话",
    kind: "action",
    action: "switch_mode_cloud",
  },
  {
    id: "local",
    command: "/local",
    title: "Local",
    description: "在本地运行当前会话",
    kind: "action",
    action: "switch_mode_local",
  },
  {
    id: "ide",
    command: "/ide",
    title: "IDE context",
    description: "把 IDE 当前选区与打开文件作为上下文接入",
    kind: "action",
    action: "toggle_ide_context",
  },
  {
    id: "memories",
    command: "/memories",
    title: "Memories",
    description: "管理记忆开关，或从 ChatGPT 导入记忆",
    kind: "action",
    action: "open_memories",
  },
  {
    id: "rename",
    command: "/rename",
    title: "Rename",
    description: "重命名当前会话",
    kind: "action",
    action: "rename_thread",
  },
  {
    id: "archive",
    command: "/archive",
    title: "Archive",
    description: "归档当前会话",
    kind: "action",
    action: "archive_thread",
  },
  {
    // 官方命令名为 /star，本项目沿用 /pin 作为「Pin chat」入口。
    id: "pin",
    command: "/pin",
    title: "Pin chat",
    description: "将当前会话固定在侧边栏",
    kind: "action",
    action: "toggle_thread_pin",
  },
  {
    id: "feedback",
    command: "/feedback",
    title: "Feedback",
    description: "发送关于当前会话的反馈",
    kind: "action",
    action: "open_feedback",
  },
  {
    id: "pet",
    command: "/pet",
    title: "Pet",
    description: "唤醒或收起桌面宠物",
    kind: "action",
    action: "toggle_pet",
  },
  {
    id: "queue",
    command: "/queue",
    title: "Queue follow-up",
    description: "把后续消息加入当前运行队列",
    kind: "action",
    action: "set_followup_queue",
  },
  {
    id: "steer",
    command: "/steer",
    title: "Steer",
    description: "用后续消息引导当前正在执行的回合",
    kind: "action",
    action: "set_followup_steer",
  },
  {
    id: "approve",
    command: "/approve",
    title: "Approve",
    description: "批准最近一次自动审批拒绝",
    kind: "action",
    action: "approve_recent_denial",
  },
];

/**
 * 按查询词过滤斜杠命令（大小写不敏感；兼容是否带前导 "/"）。
 * 空查询返回完整注册表（保持注册表顺序，不改变既有下拉排序）。
 */
export function findSlashCommands(query: string): SlashCommand[] {
  const normalized = (query ?? "").trim().toLowerCase().replace(/^\/+/, "");
  if (!normalized) return SLASH_COMMANDS;

  return SLASH_COMMANDS.filter((cmd) => {
    const command = cmd.command.toLowerCase();
    return (
      command.includes(normalized) ||
      cmd.id.toLowerCase().includes(normalized) ||
      cmd.title.toLowerCase().includes(normalized) ||
      cmd.description.toLowerCase().includes(normalized)
    );
  });
}
