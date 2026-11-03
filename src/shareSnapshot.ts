import type { TurnData, TurnItem } from "./types";

export const SHARED_IMAGE_UNAVAILABLE = "codex:shared-image-unavailable";
export type ShareAssetCandidate = { kind: "image" | "visualization"; source: string };
export type ShareAssetDimension = { asset_id: string; width: number; height: number };
type AssetUrl = `codex:shared-asset/${string}` | typeof SHARED_IMAGE_UNAVAILABLE;
type SharedItem =
  | { type: "userMessage"; content: ({ type: "text"; text: string } | { type: "image"; url: AssetUrl })[] }
  | { type: "agentMessage"; text: string; phase?: "commentary" }
  | { type: "reasoning"; summary: string }
  | { type: "fileChange"; status: "completed"; changes: { path: string; diff: string }[] }
  | { type: "imageView"; url: AssetUrl }
  | { type: "imageGeneration"; status: "completed"; result: AssetUrl };
export interface ShareSnapshot {
  version: 1;
  title?: string;
  assets?: Record<string, { width: number; height: number }>;
  turns: { items: SharedItem[]; durationMs?: number }[];
}
export interface ShareThreadInput {
  name?: string;
  cwd?: string | null;
  turns: readonly Pick<TurnData, "items" | "startedAt" | "completedAt" | "durationMs">[];
}

const assetIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
function assetId(reference: string): string | null {
  const prefix = "codex:shared-asset/";
  const id = reference.startsWith(prefix) ? reference.slice(prefix.length) : "";
  return assetIdPattern.test(id) ? id : null;
}
function imageReference(source: string, assets: ReadonlyMap<string, string>): AssetUrl {
  const result = assets.get(source);
  return result && assetId(result) ? result as AssetUrl : SHARED_IMAGE_UNAVAILABLE;
}

function delegation(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("<codex_delegation>") || !trimmed.endsWith("</codex_delegation>")) return null;
  const source = /<source_thread_id>\s*([\s\S]*?)\s*<\/source_thread_id>/i.exec(trimmed);
  const input = /<input>\s*([\s\S]*?)\s*<\/input>/i.exec(trimmed);
  return source && input ? input[1].trim().replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&") : null;
}
function userInput(item: TurnItem): { text: string; images: string[] } | null {
  if (item.type === "userMessage") {
    if (!Array.isArray(item.content)) throw new Error("Unsupported share user content");
    return {
      text: item.content.filter(part => part.type === "text").map(part => part.text).join("\n"),
      images: item.content.flatMap(part => part.type === "localImage" ? [part.path] : part.type === "image" && "url" in part ? [part.url] : []),
    };
  }
  const supported = item.namespace === "codex_app" && ["create_thread", "send_message_to_thread", "handoff_thread"].includes(item.name)
    || item.namespace === "cloud_threads" && item.name === "send_message";
  return item.type === "functionCallOutput" && supported && typeof item.output === "string" && delegation(item.output) !== null
    ? { text: item.output, images: [] } : null;
}
function cleanUserText(text: string): string {
  return stripDirectiveLines(text.split(/## My request(?: for Codex)?:/).at(-1)!);
}
function stripDirectiveLines(text: string): string {
  return text.replace(/^::[a-zA-Z0-9-]+.*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}
function reasoningText(summary: unknown): string {
  if (!Array.isArray(summary) || summary.some(part => typeof part !== "string")) throw new Error("Unsupported share reasoning summary");
  if (summary.length < 2) return summary[0] ?? "";
  return [summary[0].startsWith("**") ? summary[0] : `**${summary[0]}**`, ...summary.slice(1)].join("\n\n");
}

// Keep code opaque: Markdown images/directives inside it are literal text.
function codeMask(text: string): string {
  let masked = text.replace(/^( {0,3})(`{3,}|~{3,})[^\n]*(?:\n|$)[\s\S]*?(?:^\1\2[~`]*[ \t]*(?=\n|$)|$(?![\s\S]))/gm,
    match => match.replace(/[^\n]/g, " "));
  masked = masked.replace(/(`+)([\s\S]*?)\1(?!`)/g, match => match.replace(/[^\n]/g, " "));
  return masked;
}
const referenceKey = (label: string) => label.replace(/\\([!-/:-@[-`{-~])/g, "$1").trim().replace(/\s+/g, " ").toLowerCase();
const unescapeDestination = (value: string) => value.replace(/\\([!-/:-@[-`{-~])/g, "$1")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
type Replacement = { start: number; end: number; value: string };
function replaceRanges(text: string, ranges: Replacement[]): string {
  return ranges.sort((a, b) => b.start - a.start).reduce((result, range) => result.slice(0, range.start) + range.value + result.slice(range.end), text);
}

/**
 * Supported Markdown is rewritten without reformatting unrelated prose. The official
 * remark serializer normalizes formatting; exact byte parity is not asserted here.
 * Ambiguous nested/reference syntax is rejected instead of leaking a destination.
 */
function markdownImages(text: string, resolve: (source: string) => string): string {
  const masked = codeMask(text);
  if (masked.includes("![") && /(?:^|\n)(?:[ \t]*>[ \t]*|[ \t]{4,})\[[^\]\n]+\]:|(?:^|\n) {0,3}\[[^\]\n]+\]:[ \t]*\n/.test(masked))
    throw new Error("Unsupported share image reference definition");
  const definitions = new Map<string, { source: string; start: number; end: number }>();
  for (const match of masked.matchAll(/^ {0,3}\[([^\]\n]+)\]:[ \t]*(?:<([^>\n]*)>|(\S+))(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?[ \t]*$/gm)) {
    const key = referenceKey(match[1]);
    if (!definitions.has(key)) definitions.set(key, { source: unescapeDestination(match[2] ?? match[3]), start: match.index, end: match.index + match[0].length });
  }
  const changes: Replacement[] = [], converted = new Set<string>();
  const escaped = (at: number) => {
    let slashes = 0;
    while (at > 0 && text[--at] === "\\") slashes++;
    return slashes % 2 === 1;
  };
  for (let start = 0; start < masked.length; start++) {
    if (masked.slice(start, start + 2) !== "![" || escaped(start)) continue;
    let close = start + 2;
    for (; close < masked.length; close++) {
      if (masked[close] === "[" && !escaped(close)) throw new Error("Unsupported nested share image label");
      if (masked[close] === "]" && !escaped(close)) break;
    }
    if (close === masked.length) continue;
    const alt = text.slice(start + 2, close), next = masked[close + 1];
    if (next === "(") {
      let cursor = close + 2;
      while (/\s/.test(masked[cursor] ?? "") && cursor < masked.length) cursor++;
      const urlStart = cursor;
      let sourceEnd: number;
      if (masked[cursor] === "<") {
        cursor++;
        while (cursor < masked.length && (masked[cursor] !== ">" || escaped(cursor))) cursor++;
        if (cursor === masked.length) throw new Error("Unsupported share image destination");
        sourceEnd = ++cursor;
      } else {
        let depth = 0;
        for (; cursor < masked.length; cursor++) {
          const char = masked[cursor];
          if (!escaped(cursor)) {
            if (char === "(") depth++;
            if (char === ")") { if (depth === 0) break; depth--; }
            if (/\s/.test(char) && depth === 0) break;
          }
        }
        sourceEnd = cursor;
      }
      let quote = "";
      while (cursor < masked.length) {
        const char = masked[cursor];
        if (!escaped(cursor)) {
          if (quote && char === quote) quote = "";
          else if (!quote && (char === '"' || char === "'")) quote = char;
          else if (!quote && char === ")") break;
        }
        cursor++;
      }
      if (cursor === masked.length || quote) throw new Error("Unsupported share image title");
      const raw = text.slice(urlStart, sourceEnd);
      if (/&#(?:x[0-9a-f]+|\d+);/i.test(raw)) throw new Error("Unsupported share image URL entity");
      const source = unescapeDestination(raw.startsWith("<") ? raw.slice(1, -1) : raw);
      changes.push({ start: urlStart, end: sourceEnd, value: resolve(source) });
      start = cursor;
    } else {
      let end = close + 1, label = alt;
      if (next === "[") {
        const referenceEnd = masked.indexOf("]", end + 1);
        if (referenceEnd === -1) throw new Error("Unsupported share image reference");
        label = text.slice(end + 1, referenceEnd) || alt;
        end = referenceEnd + 1;
      }
      const key = referenceKey(label), definition = definitions.get(key);
      if (!definition) {
        // Unresolved image references remain literal Markdown, matching the AST parser.
        continue;
      }
      changes.push({ start, end, value: `![${alt}](${resolve(definition.source)})` });
      converted.add(key);
      start = end - 1;
    }
  }
  const withoutImages = replaceRanges(masked, changes.map(change => ({ ...change, value: " ".repeat(change.end - change.start) })));
  for (const key of converted) {
    const definition = definitions.get(key)!;
    let retained = false;
    for (const link of withoutImages.matchAll(/(?<!!)\[([^\]\n]+)\](?:\[([^\]\n]*)\])?(?!\()/g)) {
      if (link.index === definition.start || withoutImages[link.index + link[0].length] === ":") continue;
      if (referenceKey(link[2] || link[1]) === key) retained = true;
    }
    if (!retained) changes.push({ start: definition.start, end: definition.end, value: "" });
  }
  return replaceRanges(text, changes).trim();
}
function agentDirectives(text: string, assets: ReadonlyMap<string, string>, candidates?: ShareAssetCandidate[]): string {
  const masked = codeMask(text), changes: Replacement[] = [];
  if (masked.includes("visualize")) throw new Error("Unsupported legacy share visualization marker");
  if (/(?:^|\n)[ \t]*:::/.test(masked)) throw new Error("Unsupported container share directive");
  for (const match of masked.matchAll(/::([A-Za-z][A-Za-z0-9_-]*)(?:\{((?:"(?:\\.|[^"\\])*"|'[^']*'|[^}"'\n])*)\}|(?=[ \t]*(?:\n|$)))/g)) {
    if (match.index > 0 && masked[match.index - 1] === ":") throw new Error("Unsupported container share directive");
    let value = "";
    if (match[1] === "codex-inline-vis") {
      const rawAttributes = text.slice(match.index, match.index + match[0].length);
      const attributes: Record<string, string> = {};
      for (const attribute of rawAttributes.matchAll(/([\w-]+)=(?:"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s}]+))/g)) {
        attributes[attribute[1]] = attribute[2] !== undefined ? JSON.parse(`"${attribute[2]}"`) : attribute[3] ?? attribute[4];
      }
      if (/(?:^|\s)expandable(?=\s|})/.test(rawAttributes)) attributes.expandable = "true";
      const source = attributes.path ?? attributes.file, reference = assets.get(source), id = reference ? assetId(reference) : null;
      if (source) candidates?.push({ kind: "visualization", source });
      if (id) value = `::codex-inline-vis{${[
        `file=${JSON.stringify(`${id}.html`)}`, `asset=${JSON.stringify(reference)}`,
        ...["title", "mode", "expandable"].flatMap(key => attributes[key] === undefined ? [] : [`${key}=${JSON.stringify(attributes[key])}`]),
      ].join(" ")}}`;
    }
    changes.push({ start: match.index, end: match.index + match[0].length, value });
  }
  return replaceRanges(text, changes).trim();
}

function normalizedPath(path: string): string {
  return path.replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\(?=[A-Za-z]:[\\/])/, "").replaceAll("\\", "/");
}
const windowsPath = (path: string) => /^[A-Za-z]:\//.test(path) || /^\/\/[^/]+\/[^/]+/.test(path);
const absolutePath = (path: string) => path.startsWith("/") || windowsPath(path);
function sharedPath(path: string, cwd?: string | null): string {
  const normalized = normalizedPath(path), root = cwd == null ? undefined : normalizedPath(cwd);
  if (!absolutePath(normalized)) return normalized;
  if (root && absolutePath(root) && windowsPath(normalized) === windowsPath(root)) {
    const segments = (input: string) => input.split("/").reduce<string[]>((parts, part) => {
      if (part === "..") parts.pop();
      else if (part && part !== ".") parts.push(part);
      return parts;
    }, []);
    const child = segments(normalized), parent = segments(root);
    const same = (a: string, b: string) => windowsPath(root) ? a.toLowerCase() === b.toLowerCase() : a === b;
    if (parent.every((part, index) => child[index] !== undefined && same(part, child[index]))) return child.slice(parent.length).join("/");
  }
  return normalized.replace(/\/+$/, "").split("/").at(-1) ?? normalized;
}
function generatedSource(item: TurnItem): string | null {
  const value = typeof item.savedPath === "string" && item.savedPath.trim() ? item.savedPath : item.result;
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  const normalized = normalizedPath(trimmed);
  if (absolutePath(normalized)) return /^[A-Za-z]:\//.test(normalized) ? `/${normalized}` : normalized;
  return /^(?:data:image\/|https?:\/\/|file:\/\/|app:\/\/|\/@fs)/i.test(trimmed) ? trimmed : `data:image/png;base64,${trimmed}`;
}

export function collectShareAssetCandidates(thread: ShareThreadInput): ShareAssetCandidate[] {
  const candidates: ShareAssetCandidate[] = [];
  for (const turn of thread.turns) for (const item of turn.items) {
    const input = userInput(item);
    const images: string[] = [], visualizations: ShareAssetCandidate[] = [];
    const collect = (source: string) => { images.push(source); return source; };
    if (input) {
      markdownImages(cleanUserText(delegation(input.text) ?? input.text), collect);
      images.push(...input.images);
    } else if (item.type === "agentMessage" && ["commentary", "final_answer"].includes(item.phase)) {
      markdownImages(stripDirectiveLines(item.text!), collect);
      agentDirectives(item.text!, new Map(), visualizations);
    } else if (item.type === "reasoning") markdownImages(stripDirectiveLines(reasoningText(item.summary)), collect);
    else if (item.type === "imageView") images.push(item.path);
    else if (item.type === "imageGeneration" && item.status === "completed") {
      const source = generatedSource(item);
      if (source) images.push(source);
    }
    const current: ShareAssetCandidate[] = [...images.map(source => ({ kind: "image" as const, source })), ...visualizations];
    if (item.type === "agentMessage") current.sort((a, b) => item.text!.indexOf(a.source) - item.text!.indexOf(b.source));
    candidates.push(...current);
  }
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = `${candidate.kind}\0${candidate.source}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function buildShareSnapshot(thread: ShareThreadInput, assets: ReadonlyMap<string, string>, dimensions: readonly ShareAssetDimension[] = []): ShareSnapshot {
  const metadata: Record<string, { width: number; height: number }> = {};
  for (const dimension of dimensions) {
    if (!assetIdPattern.test(dimension.asset_id)) throw new Error("Invalid share asset ID");
    if (![dimension.width, dimension.height].every(value => Number.isInteger(value) && value > 0)) throw new Error("Invalid share asset dimension");
    if (metadata[dimension.asset_id]) throw new Error("Duplicate share asset ID");
    metadata[dimension.asset_id] = { width: dimension.width, height: dimension.height };
  }
  const text = (value: string) => markdownImages(agentDirectives(value, assets), source => imageReference(source, assets));
  const turns: ShareSnapshot["turns"] = [];
  for (const turn of thread.turns) {
    const items: SharedItem[] = [];
    for (const item of turn.items) {
      const input = userInput(item);
      if (input) {
        const delegated = delegation(input.text);
        const clean = markdownImages(cleanUserText(delegated ?? input.text), source => imageReference(source, assets));
        const xml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
        const content: Extract<SharedItem, { type: "userMessage" }>["content"] = [];
        const userText = delegated === null ? clean : `<codex_delegation>\n  <source_thread_id></source_thread_id>\n  <input>${xml(clean)}</input>\n</codex_delegation>`;
        if (clean || input.images.length) {
          if (userText) content.push({ type: "text", text: userText });
          content.push(...input.images.map(source => ({ type: "image" as const, url: imageReference(source, assets) })));
          items.push({ type: "userMessage", content });
        }
      } else if (item.type === "agentMessage" && ["commentary", "final_answer"].includes(item.phase)) {
        const value = text(item.text!);
        if (value) items.push({ type: "agentMessage", text: value, ...(item.phase === "commentary" ? { phase: "commentary" as const } : {}) });
      } else if (item.type === "reasoning") {
        const value = text(reasoningText(item.summary));
        if (value) items.push({ type: "reasoning", summary: value });
      } else if (item.type === "fileChange" && item.status !== "failed" && item.status !== "declined") {
        const changes = (item.changes ?? []).flatMap(change => {
          const effectivePath = change.kind?.type === "update" ? change.kind.move_path ?? change.path : change.path;
          if (/(?:^|[\\/])(?:\.codex|(?:\.codex-workspaces|OpenAI[\\/]Codex[\\/]workspaces)(?:[\\/]instances[\\/][0-9a-f-]+)?)[\\/]visualizations[\\/]\d{4}[\\/]\d{2}[\\/]\d{2}[\\/][a-zA-Z0-9_-]+[\\/][a-z0-9]+(?:-[a-z0-9]+)*\.html$/.test(effectivePath)) return [];
          if (!["add", "delete", "update"].includes(change.kind?.type)) throw new Error("Unsupported share file change");
          let diff = change.diff.replaceAll("\r\n", "\n").split("\n")
            .filter((line: string) => !/^(?:diff --git |index |--- |\+\+\+ |(?:old|new|deleted file|similarity index|rename from|rename to) )/.test(line)).join("\n").trim();
          if (!diff) return [];
          if (change.kind.type !== "update") diff = diff.split("\n").map((line: string) => `${change.kind.type === "add" ? "+" : "-"}${line}`).join("\n");
          return [{ path: sharedPath(change.path, thread.cwd), diff }];
        });
        if (changes.length) items.push({ type: "fileChange", status: "completed", changes });
      } else if (item.type === "imageView") items.push({ type: "imageView", url: imageReference(item.path, assets) });
      else if (item.type === "imageGeneration" && item.status === "completed") {
        const source = generatedSource(item);
        if (source) items.push({ type: "imageGeneration", status: "completed", result: imageReference(source, assets) });
      }
    }
    if (!items.length) continue;
    const duration = turn.durationMs ?? (turn.startedAt != null && turn.completedAt != null ? (turn.completedAt - turn.startedAt) * 1000 : null);
    turns.push({ items, ...(items.some(item => item.type === "reasoning" || item.type === "agentMessage" && item.phase === "commentary")
      && duration !== null && Number.isFinite(duration) && duration >= 0 ? { durationMs: duration } : {}) });
  }
  return { version: 1, ...(thread.name === undefined ? {} : { title: thread.name }), ...(Object.keys(metadata).length ? { assets: metadata } : {}), turns };
}
