export interface ChatMatchRange {
  start: number;
  end: number;
}

const asciiWord = (character: string) => /^[a-z0-9]$/i.test(character);
const digit = (character: string) => /^[0-9]$/.test(character);
const uppercase = (character: string) => /^[A-Z]$/.test(character);
const lower = (character: string) => /^[a-z]$/.test(character);
const wildcard = (character: string) => character === "*" || character === " ";
const separator = (character: string) => /^[_:./\\+\-]$/.test(character);
const fold = (character: string) => character === "\\" ? "/" : character.toLowerCase();

export function createChatSearchMatcher(query: string) {
  const primary = compileMatcher(query, false);
  const path = query.trim();
  const separatorIndex = Math.max(path.lastIndexOf("/", path.length - 2), path.lastIndexOf("\\", path.length - 2));
  const basename = separatorIndex >= 0 && separatorIndex < path.length - 1
    ? compileMatcher(path.slice(separatorIndex + 1), true) : null;
  return (text: string | null | undefined) => primary(text) ?? basename?.(text) ?? null;
}

function compileMatcher(query: string, anchored: boolean) {
  const pattern = Array.from(query.trim());
  const keys = pattern.map(fold);
  let seenLowercase = false;
  const mixedCase = pattern.some(character => {
    if (lower(character)) seenLowercase = true;
    return seenLowercase && uppercase(character);
  });
  const hasPath = keys.includes("/");
  const hasDot = keys.includes(".");
  const required = keys.filter(key => !wildcard(key));

  return (text: string | null | undefined): { score: number; ranges: ChatMatchRange[] } | null => {
    if (!text || pattern.length === 0) return null;
    if (required.length === 0) return { score: 1, ranges: [] };
    if (pattern.length > 100) {
      const literal = query.trim().replaceAll("*", "");
      const start = text.toLowerCase().indexOf(literal.toLowerCase());
      return start < 0 || (anchored && start !== 0 && !keys.includes("*"))
        ? null : { score: start === 0 ? 1000 : 1, ranges: [{ start, end: start + literal.length }] };
    }

    let offset = 0, found = 0;
    const characters = Array.from(text, character => {
      const item = { character, key: fold(character), offset };
      offset += character.length;
      if (item.key === required[found]) found++;
      return item;
    });
    if (found !== required.length && !hasPath) return null;
    const isBoundary = (index: number) => {
      const character = characters[index].character;
      const previous = characters[index - 1]?.character ?? "";
      const next = characters[index + 1]?.character ?? "";
      return index === 0 || !asciiWord(character) || !asciiWord(previous) || digit(character) ||
        (uppercase(character) && (!uppercase(previous) || lower(next)));
    };
    const failed = new Set<number>();
    const search = (fromPattern: number, fromText: number, allowInterior: boolean, withinWord: boolean): number[][] | null => {
      let at = fromPattern;
      while (at < keys.length && wildcard(keys[at])) at++;
      if (at === keys.length) return [];
      const explicitGap = at !== fromPattern;
      const openGap = allowInterior || keys.slice(fromPattern, at).includes("*") || keys[at - 1] === "/";
      const state = ((at * (characters.length + 1) + fromText) * 8) +
        (openGap ? 4 : 0) + (explicitGap ? 2 : 0) + (withinWord ? 1 : 0);
      if (failed.has(state)) return null;

      const stop = anchored && fromPattern === 0 && !explicitGap ? 1 : characters.length;
      for (let start = fromText; start < stop; start++) {
        if (hasDot && !allowInterior && keys[at] !== "." && keys[at - 1] !== "." &&
            start > fromText && characters[start - 1].key === ".") break;
        if (characters[start].key !== keys[at]) continue;
        const boundary = isBoundary(start);
        if (!openGap && !boundary && !separator(keys[at])) continue;
        if (mixedCase && lower(pattern[at]) && at > 0 && !explicitGap && !separator(keys[at - 1]) && !withinWord) continue;
        if (mixedCase && uppercase(pattern[at]) && !boundary && !uppercase(characters[start].character)) continue;

        let length = 0;
        while (characters[start + length]?.key === keys[at + length] && at + length < keys.length) {
          length++;
        }
        if (at + length === keys.length) return [[start, start + length]];
        if (digit(keys[at + length]) && digit(keys[at + length - 1]) && digit(characters[start + length]?.key ?? "")) continue;
        const minimum = boundary || wildcard(keys[at + 1]) || keys[at + 1] === "/" ? 1 : 3;
        for (let run = length; run >= minimum; run--) {
          const nextPattern = at + run;
          const explicit = wildcard(keys[nextPattern]) || keys[nextPattern] === "/" || keys[nextPattern - 1] === "/";
          const tail = search(nextPattern, start + run + (explicit ? 0 : 1), false, explicit && !wildcard(keys[nextPattern]));
          if (tail) return [[start, start + run], ...tail];
        }
      }
      failed.add(state);
      return null;
    };

    const fragments = search(0, 0, true, true);
    if (!fragments) return null;
    const ranges: ChatMatchRange[] = [];
    for (const [start, end] of fragments) {
      const range = { start: characters[start].offset, end: characters[end]?.offset ?? text.length };
      const previous = ranges.at(-1);
      if (previous?.end === range.start) previous.end = range.end;
      else ranges.push(range);
    }
    const start = fragments[0][0], end = fragments.at(-1)![1];
    const prefixScore = start === 0 ? 10_000 : isBoundary(start) ? 1_000 : 0;
    const gaps = end - start - required.length;
    return { ranges, score: Math.max(1, prefixScore + required.length * 10 - gaps - start - text.length) };
  };
}
