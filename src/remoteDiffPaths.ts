export interface RemoteDiffFile {
  basePath: string | null;
  headPath: string | null;
  label: string;
  patch: string;
  unavailable: boolean;
}

function decodePath(value: string): string | undefined {
  if (!value.startsWith('"')) return value;
  if (!value.endsWith('"')) return;
  const bytes: number[] = [], encoder = new TextEncoder();
  const escapes: Record<string, string> = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\", '"': '"' };
  for (let i = 1; i < value.length - 1; i++) {
    if (value[i] === "\\") {
      const octal = /^[0-7]{1,3}/.exec(value.slice(i + 1, -1));
      if (octal) { const byte = parseInt(octal[0], 8); if (byte > 255) return; bytes.push(byte); i += octal[0].length; }
      else { const escaped = escapes[value[++i]]; if (escaped === undefined) return; bytes.push(...encoder.encode(escaped)); }
    } else {
      const character = String.fromCodePoint(value.codePointAt(i)!);
      bytes.push(...encoder.encode(character)); i += character.length - 1;
    }
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes)); } catch { return; }
}

function safePath(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 && !/[\\\u0000-\u001f\u007f]/.test(value) &&
    !value.startsWith("/") && !/^[A-Za-z]:/.test(value) && value.split("/").every(part => part !== "" && part !== "." && part !== "..");
}

export function parseRemoteDiffFiles(diff: string): RemoteDiffFile[] {
  return diff.split(/(?=^diff --git )/m).filter(block => block.startsWith("diff --git ")).map((patch, index) => {
    const headers = patch.split("\n").slice(1);
    let base: string | null | undefined, head: string | null | undefined, invalid = false;
    let baseHeader = false, headHeader = false;
    for (const line of headers) {
      if (line.startsWith("@@")) break;
      const side = line.startsWith("--- ") ? "base" : line.startsWith("+++ ") ? "head" : null;
      if (side) {
        const path = decodePath(line.slice(4).split("\t")[0]);
        const prefix = side === "base" ? "a/" : "b/";
        const parsed = path === "/dev/null" ? null : path?.startsWith(prefix) ? path.slice(2) : undefined;
        if (side === "base") { if (baseHeader || (base !== undefined && base !== parsed)) invalid = true; base = parsed; baseHeader = true; }
        else { if (headHeader || (head !== undefined && head !== parsed)) invalid = true; head = parsed; headHeader = true; }
      } else if (line.startsWith("rename from ") && base === undefined) base = decodePath(line.slice(12));
      else if (line.startsWith("rename to ") && head === undefined) head = decodePath(line.slice(10));
    }
    const unavailable = invalid || (base === null && head === null) ||
      (base !== null && !safePath(base)) || (head !== null && !safePath(head)) ||
      /^GIT binary patch$|^Binary files /m.test(patch);
    return { basePath: base ?? null, headPath: head ?? null,
      label: head ?? base ?? `无法识别路径的文件 ${index + 1}`, patch, unavailable };
  });
}

// Match the official full-content metadata rule: unchanged gaps and every hunk
// must agree with both full files; an unreadable/mismatched patch is not empty.
export function matchesRemoteFilePatch(patch: string, baseContent: string, headContent: string): boolean {
  const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const base = lines(baseContent), head = lines(headContent), rows = patch.split("\n");
  let oldPosition = 0, newPosition = 0, seen = false;
  const sameGap = (oldEnd: number, newEnd: number) => oldEnd <= base.length && newEnd <= head.length &&
    oldEnd - oldPosition === newEnd - newPosition &&
    base.slice(oldPosition, oldEnd).every((line, i) => line === head[newPosition + i]);
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].startsWith("@@")) continue;
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(rows[i]);
    if (!match) return false;
    const oldCount = Number(match[2] ?? 1), newCount = Number(match[4] ?? 1);
    const oldStart = Math.max(Number(match[1]) - (oldCount ? 1 : 0), 0);
    const newStart = Math.max(Number(match[3]) - (newCount ? 1 : 0), 0);
    if (oldStart < oldPosition || newStart < newPosition || !sameGap(oldStart, newStart)) return false;
    oldPosition = oldStart; newPosition = newStart; seen = true;
    let deleted = 0, added = 0;
    while (deleted < oldCount || added < newCount) {
      const row = rows[++i];
      if (row === undefined || ![" ", "+", "-"].includes(row[0])) return false;
      let text = row.slice(1) + "\n";
      if (rows[i + 1] === "\\ No newline at end of file") { text = row.slice(1); i++; }
      if (row[0] !== "+") { if (++deleted > oldCount || base[oldPosition++] !== text) return false; }
      if (row[0] !== "-") { if (++added > newCount || head[newPosition++] !== text) return false; }
    }
  }
  return seen ? sameGap(base.length, head.length) : baseContent === headContent;
}
