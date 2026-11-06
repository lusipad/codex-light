export interface GptTool { type: string; title: string; description?: string }
export interface GptResource {
  id: string;
  name: string;
  description: string;
  author?: string;
  authorId?: string;
  avatarUrl: string | null;
  usage?: string;
  tags: string[];
  tools: GptTool[];
  raw: Record<string, unknown>;
}
export interface GptSection {
  id: string;
  title: string;
  description?: string;
  displayGroup: string | null;
  displayType: string | null;
  locale: string | null;
  items: GptResource[];
  cursor: string | null;
  rawItemCount: number;
}
export interface GptDiscovery { sections: GptSection[]; locale: string | null; workspaceFiltered: boolean }
export type GptRestriction = "interactions_disabled" | "fedramp_incompatible" | "openai_gpt_workspace_disabled" | "workspace_disabled";
export interface GptWorkspaceContext { isWorkspaceOwner?: boolean; allowThirdPartyGpts?: string }
export type GptAboutBlock =
  | { type: "generic_title_subtitle"; title: string; subtitle: string; raw: Record<string, unknown> }
  | { type: "rating"; avg: number; count: string; raw: Record<string, unknown> }
  | { type: "category"; category: string; categoryRanking?: number; categoryLocale?: string; raw: Record<string, unknown> };

function object(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw Error("GPT 服务响应格式无法识别。");
  return value as Record<string, unknown>;
}
function optionalText(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") throw Error("GPT 服务返回了无法识别的文本。");
  return value;
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw Error("GPT 服务返回了无法识别的资源。");
  return value;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw Error("GPT 服务返回了无法识别的列表。");
  return value;
}

export function gptTools(value: unknown): GptTool[] {
  const tools: GptTool[] = [];
  const seen = new Set<string>();
  for (const item of value == null ? [] : list(value)) {
    const type = optionalText(object(item).type);
    let tool: GptTool | undefined;
    switch (type) {
      case "browser": tool = { type, title: "网页搜索" }; break;
      case "canvas": tool = { type, title: "画布" }; break;
      case "python": tool = { type, title: "代码解释器与数据分析" }; break;
      case "dalle": case "image_gen": tool = { type: "image_gen", title: "图像生成" }; break;
      case "memory": tool = { type, title: "记忆", description: "学习以往的聊天内容，以改善今后的对话" }; break;
      case "plugin": tool = { type, title: "操作", description: "检索 ChatGPT 之外的信息或执行外部操作" }; break;
      case "connector": tool = { type, title: "应用" }; break;
    }
    if (tool && !seen.has(tool.type)) { seen.add(tool.type); tools.push(tool); }
  }
  return tools;
}

export function parseGptResource(value: unknown): GptResource | null {
  const wrapper = object(value);
  const raw = object(wrapper.resource ?? wrapper);
  const gizmo = object(raw.gizmo);
  const id = identifier(gizmo.id);
  if (optionalText(gizmo.gizmo_type) === "snorlax") return null;
  const display = gizmo.display == null ? {} : object(gizmo.display);
  const author = gizmo.author == null ? {} : object(gizmo.author);
  const metrics = gizmo.vanity_metrics == null ? {} : object(gizmo.vanity_metrics);
  const tags = gizmo.tags == null ? [] : list(gizmo.tags).map(tag => {
    if (typeof tag !== "string") throw Error("GPT 服务返回了无法识别的限制标签。");
    return tag;
  });
  return {
    id, name: optionalText(display.name)?.trim() || id,
    description: optionalText(display.description) ?? "",
    author: optionalText(author.display_name)?.trim() || undefined,
    authorId: optionalText(author.user_id),
    avatarUrl: optionalText(display.profile_picture_url)?.trim() || null,
    usage: optionalText(metrics.num_conversations_str)?.trim() || undefined,
    tags, tools: gptTools(raw.tools), raw,
  };
}

export function parseGptSection(value: unknown): GptSection {
  const section = object(value), info = object(section.info), page = object(section.list);
  const items = list(page.items);
  const id = identifier(info.id);
  return {
    id, title: optionalText(info.title) ?? id, description: optionalText(info.description),
    displayGroup: optionalText(info.display_group) ?? null, displayType: optionalText(info.display_type) ?? null,
    locale: optionalText(info.locale) ?? null,
    items: items.map(parseGptResource).filter((item): item is GptResource => item !== null),
    cursor: optionalText(page.cursor) || null, rawItemCount: items.length,
  };
}

export function parseGptDiscovery(value: unknown): GptDiscovery {
  const data = object(value);
  if (data.workspace_filtered != null && typeof data.workspace_filtered !== "boolean") throw Error("GPT 目录筛选状态无法识别。");
  return {
    sections: list(data.cuts).map(parseGptSection).filter(section => section.cursor !== null || section.items.length > 0),
    locale: optionalText(data.locale) ?? null, workspaceFiltered: data.workspace_filtered === true,
  };
}

export function parseGptSearch(value: unknown): GptSection {
  const page = object(value), items = list(page.items);
  return {
    id: "search", title: "搜索结果", displayGroup: null, displayType: null, locale: null,
    items: items.map(parseGptResource).filter((item): item is GptResource => item !== null),
    cursor: optionalText(page.cursor) || null, rawItemCount: items.length,
  };
}

export function appendGptPage(section: GptSection, page: GptSection): GptSection {
  if (section.id !== page.id) throw Error("GPT 分类在读取期间发生变化，请刷新。");
  const items = new Map(section.items.map(item => [item.id, item]));
  for (const item of page.items) items.set(item.id, item);
  return { ...section, items: [...items.values()], cursor: page.cursor, rawItemCount: section.rawItemCount + page.rawItemCount };
}

export function gptRestriction(tags: readonly string[], context: GptWorkspaceContext = {}): GptRestriction | null {
  for (const restriction of ["interactions_disabled", "fedramp_incompatible", "openai_gpt_workspace_disabled"] as const)
    if (tags.includes(restriction)) return restriction;
  return tags.includes("workspace_disabled") && !(context.isWorkspaceOwner === true && context.allowThirdPartyGpts === "allow_specific")
    ? "workspace_disabled" : null;
}

export function parseGptAbout(value: unknown): GptAboutBlock[] {
  const blocks: GptAboutBlock[] = [];
  for (const item of list(object(value).about_blocks)) {
    const raw = object(item);
    switch (raw.type) {
      case "generic_title_subtitle":
        blocks.push({ type: raw.type, title: optionalText(raw.title) ?? "", subtitle: optionalText(raw.subtitle) ?? "", raw }); break;
      case "rating":
        if (typeof raw.avg !== "number" || !Number.isFinite(raw.avg)) throw Error("GPT 评分数据无法识别。");
        blocks.push({ type: raw.type, avg: raw.avg, count: optionalText(raw.count_str) ?? "", raw }); break;
      case "category": {
        if (raw.category_ranking != null && (typeof raw.category_ranking !== "number" || !Number.isFinite(raw.category_ranking)))
          throw Error("GPT 分类排名无法识别。");
        blocks.push({ type: raw.type, category: optionalText(raw.category_str) ?? "", categoryRanking: raw.category_ranking as number | undefined,
          categoryLocale: optionalText(raw.category_locale_str), raw }); break;
      }
    }
  }
  return blocks;
}
