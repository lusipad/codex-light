export interface ModelReviewComment {
  id: string;
  threadId: string;
  turnId: string;
  rootPath: string;
  file: string;
  absolutePath: string;
  title: string;
  body: string;
  startLine: number;
  endLine: number;
  side: "right";
  priority?: number;
}

export interface UnresolvedReviewFinding {
  id: string;
  threadId: string;
  turnId: string;
  file: string;
  title: string;
  body: string;
  startLine: number;
  endLine: number;
  priority?: number;
  reason: string;
}

export interface ReviewFindingContext {
  threadId: string;
  turnId: string;
  cwd?: string | null;
  workspaceRoots?: readonly string[];
}

function normalizedPath(path: string): string {
  const slash = path.replace(/\\/g, "/");
  const prefix = slash.startsWith("//") ? "//" : slash.startsWith("/") ? "/" : "";
  const parts: string[] = [];
  for (const part of slash.split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop();
    else parts.push(part);
  }
  return prefix + parts.join("/");
}

function absolute(path: string): boolean {
  return /^(?:[a-z]:\/|\/)/i.test(path);
}

function pathKey(path: string): string {
  return /^(?:[a-z]:|\/\/)/i.test(path) ? path.toLowerCase() : path;
}

function within(path: string, root: string): boolean {
  const key = pathKey(path), parent = pathKey(root);
  return key === parent || key.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
}

function locate(file: string, context: ReviewFindingContext): { rootPath: string; file: string; absolutePath: string } | null {
  const roots = [...new Set([...(context.workspaceRoots ?? []), ...(context.cwd ? [context.cwd] : [])]
    .map(normalizedPath).filter(absolute))];
  const path = normalizedPath(file);
  let target = absolute(path) ? path : context.cwd ? normalizedPath(`${context.cwd}/${path}`) : null;
  if (!absolute(path)) {
    // Official D1 also accepts paths containing a workspace folder segment.
    const candidates = roots.flatMap(root => {
      const segment = root.split("/").at(-1);
      if (!segment) return [];
      const windows = /^[a-z]:|^\/\//i.test(root);
      const search = windows ? path.toLowerCase() : path;
      const needle = windows ? segment.toLowerCase() : segment;
      const index = search.indexOf(`${needle}/`);
      return index >= 0 && (index === 0 || search[index - 1] === "/")
        ? [{ root, target: normalizedPath(`${root}/${path.slice(index + segment.length + 1)}`) }] : [];
    }).sort((a, b) => b.root.length - a.root.length);
    if (candidates.length) target = candidates[0].target;
  }
  if (!target) return null;
  const rootPath = roots.filter(root => within(target!, root)).sort((a, b) => b.length - a.length)[0];
  if (!rootPath || pathKey(rootPath) === pathKey(target)) return null;
  const relative = target.slice(rootPath.length + (rootPath.endsWith("/") ? 0 : 1));
  return { rootPath, file: relative, absolutePath: `${rootPath}${rootPath.endsWith("/") ? "" : "/"}${relative}` };
}

function attributes(text: string): Record<string, string> | null {
  const result: Record<string, string> = {};
  let cursor = 0;
  while (cursor < text.length) {
    const key = /^\s*([\w-]+)\s*=\s*/.exec(text.slice(cursor));
    if (!key) return text.slice(cursor).trim() ? null : result;
    cursor += key[0].length;
    const quote = text[cursor];
    let value = "";
    if (quote === '"' || quote === "'") {
      cursor++;
      let closed = false;
      while (cursor < text.length) {
        const char = text[cursor++];
        if (char === quote) { closed = true; break; }
        if (char === "\\" && (text[cursor] === quote || text[cursor] === "\\")) value += text[cursor++];
        else value += char;
      }
      if (!closed) return null;
    } else {
      const match = /^\S+/.exec(text.slice(cursor));
      if (!match) return null;
      value = match[0]; cursor += value.length;
    }
    result[key[1]] = value;
  }
  return result;
}

function integer(value: string | undefined): number | undefined {
  if (value == null || !value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : undefined;
}

export function parseReviewFindings(text: string, context: ReviewFindingContext): {
  comments: ModelReviewComment[];
  unresolved: UnresolvedReviewFinding[];
} {
  const comments: ModelReviewComment[] = [], unresolved: UnresolvedReviewFinding[] = [];
  const seen = new Set<string>();
  let fence: { marker: string; length: number } | null = null;
  for (const line of text.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (marker) {
      if (!fence) fence = { marker: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.marker && marker[1].length >= fence.length && !line.slice(marker[0].length).trim()) fence = null;
      continue;
    }
    if (fence) continue;
    const directive = /^ {0,3}::code-comment\{(.*)\}\s*$/.exec(line);
    if (!directive) continue;
    const attrs = attributes(directive[1]);
    if (!attrs) continue;
    let title = attrs.title?.trim();
    const body = attrs.body?.trim(), file = attrs.file?.trim();
    if (!title || !body || !file) continue;
    const priority = integer(attrs.priority);
    if (priority != null && !/^(?:<sub>\s*)*\[p\d\](?:\s*<\/sub>)*\s*/i.test(title)) title = `[P${priority}] ${title}`;
    const startLine = Math.max(1, integer(attrs.start) ?? 1);
    const endLine = Math.max(startLine, integer(attrs.end) ?? startLine);
    const location = locate(file, context);
    const id = JSON.stringify([context.threadId, location ? pathKey(location.rootPath) : null,
      location ? (/^[a-z]:|^\/\//i.test(location.rootPath) ? location.file.toLowerCase() : location.file) : file,
      "right", startLine, endLine, title, body]);
    if (seen.has(id)) continue;
    seen.add(id);
    const common = { id, threadId: context.threadId, turnId: context.turnId, title, body, startLine, endLine,
      ...(priority == null ? {} : { priority }) };
    if (location) comments.push({ ...common, ...location, side: "right" });
    else unresolved.push({ ...common, file, reason: "无法将该路径定位到当前审查工作区" });
  }
  return { comments, unresolved };
}

export function buildQuickReviewPrompt(scope: string, focus?: string): string {
  return ["## Code review guidelines:", REVIEW_GUIDELINES.trim(), scope.trim(), "## My request:", focus?.trim() || scope.trim()].join("\n");
}

export function isQuickReviewPrompt(text: string): boolean {
  return text.startsWith("## Code review guidelines:\n# Review Guidelines\n") && text.includes(REVIEW_GUIDELINES.trim());
}

// Official static contract: code-review-e186157cbafd.js M (14B research).
const REVIEW_GUIDELINES = "# Review Guidelines\n\nYou are acting as a reviewer for a proposed code change made by another engineer.\n\nReview the change and respond in normal Markdown. Do not return JSON, XML, a findings object, or any structured review schema.\n\nWhen feedback should be attached directly to a changed line, emit one `::code-comment{...}` directive for that issue. The directive creates an inline code comment in the review UI; keep the visible response as normal Markdown. Emit no directives when there are no actionable inline comments.\n\nRequired `code-comment` attributes: `title`, `body`, and `file`. Optional attributes: `start`, `end`, and `priority`. Use the shortest useful line range. `file` should be an absolute path or include the workspace folder segment.\n\nFocus on discrete, actionable issues the original author would likely fix if they knew about them. Prefer no issues over speculative or low-signal feedback.\n\nGeneral guidelines for whether to call out an issue:\n\n1. It meaningfully impacts correctness, performance, security, or maintainability.\n2. It is discrete and actionable.\n3. It was introduced by the change under review.\n4. The author would likely fix it once aware.\n5. It does not rely on unstated assumptions about intent.\n6. It identifies the affected behavior clearly rather than speculating broadly.\n\n## Repository Rule Attribution\n\nUse the root and scoped project instruction files applicable to changed files, respecting normal project-document precedence (`AGENTS.override.md`, `AGENTS.md`, then configured fallback filenames) and selecting at most one file per directory. Guidance may use headings, checklists, bullets, tables, or concise prose; do not require formal IDs or schemas. More-specific guidance wins on conflict, and user instructions about review scope or style take precedence.\n\nReview the diff independently and deduplicate findings by changed location and defect/remedy. A finding is rule-supported only when applicable guidance materially contributes repository-specific scope, an invariant, remedy, convention, or confirmation behavior beyond generic correctness advice. Preserve and union rule support when candidates merge, then check every final candidate against the applicable rules. Do not omit ordinary findings or invent findings solely because a rule file exists.\n\nWhen collaboration is available, use at most one focused investigator per applicable rule. For each rule-supported finding, verify the applicable project instruction file that supplies the rule and its smallest supporting line range, then include one compact Markdown or local-file reference in the visible comment body. Do not fabricate citations or add hidden metadata.\n\nWhen you call out an issue, include the relevant file and line or function in prose, explain the scenario where it matters, and keep the explanation concise. Use priority labels such as `[P1]` or `[P2]` only when helpful to communicate severity.\n\nIf there are no actionable issues, say that directly and briefly.\n";
