// Reference: app-primary-84ad97f06929.js, UTF-16 316119–324100.
// Heuristic snapshot-string redaction only; asset bytes are handled separately.
export const SHARE_SNAPSHOT_MAX_BYTES = 10 * 1024 * 1024;

type MatchRule = {
  pattern: RegExp;
  validate?: (value: string, match: RegExpExecArray) => boolean;
  allowPlaceholder?: boolean;
};

const servicePatterns: RegExp[] = [
  /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}\b/g,
  /\bAIza[A-Za-z0-9_-]{30,4096}\b/g,
  /\b(?:github_pat_[A-Za-z0-9_]{30,4096}|gh[pousr]_[A-Za-z0-9]{20,4096})\b/g,
  /\b(?:glpat-[A-Za-z0-9_-]{20,4096}|gldt-[A-Za-z0-9_-]{20}|glptt-[a-f0-9]{40}|glrt-[A-Za-z0-9_-]{20,4096})\b/gi,
  /\b(?:xox[baprs]-[A-Za-z0-9-]{10,4096}|xapp-\d-[A-Z0-9]+-\d+-[A-Za-z0-9]+|xoxe(?:\.xox[bp]-\d-[A-Z0-9]{163,166}|-\d-[A-Z0-9]{146}))\b/gi,
  /\b(?:sk|rk)_(?:test|live|prod)_[A-Za-z0-9]{10,99}\b/g,
  /\bSG\.[A-Za-z0-9_.=-]{66,4096}(?=$|[^A-Za-z0-9_.=-])/g,
  /\b[a-f0-9]{32}-us\d{1,3}\b/gi,
  /\b(?:hf_[A-Za-z0-9]{20,4096}|api_org_[A-Za-z]{34})\b/g,
  /\bpypi-[A-Za-z0-9_-]{20,1000}\b/gi,
  /\bnpm_[A-Za-z0-9]{20,4096}\b/gi,
  /\b(?:sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,4096}|sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20})\b/g,
  /\bA3-[A-Z0-9]{6}-(?:[A-Z0-9]{11}|[A-Z0-9]{6}-[A-Z0-9]{5})-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}\b/g,
  /\bops_eyJ[A-Za-z0-9+/]{250,4096}={0,3}/g,
  /\bAGE-SECRET-KEY-1[QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L]{58}\b/g,
  /\bpat[A-Za-z0-9]{14}\.[a-f0-9]{64}\b/g,
  /\bLTAI[A-Za-z0-9]{20}\b/gi,
  /\bsk-ant-(?:admin01|api03)-[A-Za-z0-9_-]{93}AA\b/g,
  /\bAKCp[A-Za-z0-9]{69}\b/g,
  /\bcmVmd[A-Za-z0-9]{59}\b/g,
  /\bABSK[A-Za-z0-9+/]{109,269}={0,2}/g,
  /(?:^|[\\'"\x60\s>=:(,)])(?<secret>[A-Za-z0-9_~.]{3}\dQ~[A-Za-z0-9_~.-]{31,34})(?=$|[\\'"\x60\s<),])/g,
  /\bv1\.0-[a-f0-9]{24}-[a-f0-9]{146}\b/gi,
  /\bdapi[a-f0-9]{32}(?:-\d)?\b/gi,
  /\bdo[opr]_v1_[a-f0-9]{64}\b/gi,
  /\bdp\.pt\.[a-z0-9]{43}\b/gi,
  /\bdt0c01\.[a-z0-9]{24}\.[a-z0-9]{64}\b/gi,
  /\bEZ(?:AK|TK)[a-z0-9]{54}\b/gi,
  /\bEAA[MC][A-Za-z0-9]{100,4096}\b/g,
  /(?:\bfo1_[\w-]{43}\b|\bfm1[ar]_[A-Za-z0-9+/]{100,4096}={0,3}|\bfm2_[A-Za-z0-9+/]{100,4096}={0,3})/g,
  /(?:\bglc_[A-Za-z0-9+/]{32,400}={0,3}|\bglsa_[A-Za-z0-9]{32}_[A-Fa-f0-9]{8}\b)/g,
  /\b[A-Za-z0-9]{14}\.atlasv1\.[A-Za-z0-9_=-]{60,70}(?=$|[^A-Za-z0-9_=-])/gi,
  /\bHRKU-AA[A-Za-z0-9_-]{58}\b/g,
  /\blin_api_[a-z0-9]{40}\b/gi,
  /\bpk\.[a-z0-9]{60}\.[a-z0-9]{22}\b/gi,
  /\b[A-Za-z0-9]{6}_[A-Za-z0-9]{29}_mmk\b/g,
  /\b(?:NRJS-[a-f0-9]{19}|NRII-[a-z0-9-]{32}|NRAK-[a-z0-9]{27})\b/gi,
  /\bntn_[0-9]{11}[A-Za-z0-9]{35}\b/g,
  /\bsha256~[\w-]{43}\b/g,
  /\bpplx-[A-Za-z0-9]{48}\b/g,
  /\bpscale_(?:tkn|oauth|pw)_[\w=.-]{32,64}(?=$|[^\w=.-])/gi,
  /\bPMAK-[a-f0-9]{24}-[a-f0-9]{34}\b/gi,
  /\bpnu_[A-Za-z0-9]{36}\b/g,
  /\bpul-[a-f0-9]{40}\b/gi,
  /\brubygems_[a-f0-9]{48}\b/gi,
  /(?:\bsntryu_[a-f0-9]{64}\b|\bsntrys_eyJpYXQiO[A-Za-z0-9+/]{10,200}(?:LCJyZWdpb25fdXJs|InJlZ2lvbl91cmwi|cmVnaW9uX3VybCI6)[A-Za-z0-9+/]{10,200}={0,2}_[A-Za-z0-9+/]{43})/g,
  /\bshp(?:at|ca|pa|ss)_[a-f0-9]{32}\b/gi,
  /\b(?:EAAA|sq0atp-)[\w-]{22,60}\b/g,
  /\bSK[0-9a-fA-F]{32}\b/g,
  /(?:\bhvb\.[\w-]{138,300}|\bhvs\.[\w-]{90,120})/g,
];

function cleanValue(value: string): string {
  return value.trim().replace(/^["']+|["']+$/g, "");
}

function isPlaceholder(value: string): boolean {
  const cleaned = cleanValue(value);
  const lower = cleaned.toLowerCase();
  return !lower || ["${", "$(", "{{", "<", "[", "process.env", "os.environ"].some(prefix => lower.startsWith(prefix))
    || /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(cleaned)
    || ["example", "dummy", "placeholder", "changeme", "replace_me", "redacted", "masked"].some(word => lower.includes(word))
    || ["password", "passwd", "secret", "token", "apikey", "api_key", "none", "null", "true", "false", "undefined"].includes(lower)
    || new Set(cleaned).size <= 3;
}

function hasComplexity(value: string, minimum: number): boolean {
  const cleaned = cleanValue(value);
  return cleaned.length >= minimum && cleaned.length <= 4096
    && !isPlaceholder(cleaned) && !/^\d+$/.test(cleaned) && new Set(cleaned).size >= 4;
}

const rules: MatchRule[] = [
  ...servicePatterns.map(pattern => ({ pattern })),
  {
    pattern: /\b(?<name>TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL|COOKIE|[A-Z][A-Z0-9_]{1,80}(?:TOKEN|SECRET|PASSWORD|PASSWD|_PWD|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL|COOKIE|_PAT))\b[^\n\r]{0,30}?[:=]\s*["']?(?<secret>[A-Za-z0-9._~+/=%:@!#$^&*?-]{8,4096})/gi,
    validate: (value, match) => {
      const name = match.groups?.name?.toUpperCase();
      return name != null && !value.includes("://")
        && hasComplexity(value, ["PASSWORD", "PASSWD", "_PWD"].some(part => name.includes(part)) ? 8 : 16);
    },
  },
  { pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9]{8,128}\/[A-Za-z0-9]{8,128}\/[A-Za-z0-9]{16,512}/g },
  {
    pattern: /\bAuthorization\s*:\s*(?:Bearer|Basic)\s+(?<secret>[A-Za-z0-9._~+/=-]{16,4096})/gi,
    validate: value => hasComplexity(value, 16),
  },
  {
    pattern: /\b(?:https?|mongodb|mysql|postgres(?:ql)?|redis):\/\/[^\s:/@"'<>]{1,80}:[^\s@"'<>]{3,160}@[^\s"'<>]+/gi,
    allowPlaceholder: true,
    validate: value => {
      const password = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^:/@]+):([^@]+)@/.exec(value)?.[2];
      return password != null && hasComplexity(password, 8);
    },
  },
  {
    pattern: /https?:\/\/(?=[^\s"'<>]{0,4096}[?&](?:token|sig|X-Amz-Signature|X-Amz-Security-Token)=)[^\s"'<>]{1,4096}/gi,
    allowPlaceholder: true,
  },
];

function redactText(text: string): { text: string; count: number } {
  if (/^data:image\/[A-Za-z0-9.+-]+;base64,/i.test(text)) return { text, count: 0 };
  const ranges: { start: number; end: number }[] = [];
  const privateKeys = /-----BEGIN (?<kind>(?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?)PRIVATE KEY-----[\s\S]{20,16384}?-----END \k<kind>PRIVATE KEY-----/g;
  for (const match of text.matchAll(privateKeys)) ranges.push({ start: match.index, end: match.index + match[0].length });
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      const value = match.groups?.secret ?? match[0];
      if ((!rule.allowPlaceholder && isPlaceholder(value)) || (rule.validate && !rule.validate(value, match))) continue;
      const start = match.index + match[0].lastIndexOf(value);
      ranges.push({ start, end: start + value.length });
    }
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: typeof ranges = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  let cursor = 0;
  const pieces: string[] = [];
  for (const range of merged) {
    pieces.push(text.slice(cursor, range.start), "<SECRET>");
    cursor = range.end;
  }
  pieces.push(text.slice(cursor));
  return { text: pieces.join(""), count: merged.length };
}

export function redactShareSnapshot<T>(snapshot: T): { findingCount: number; redactedSnapshot: T } {
  let findingCount = 0;
  const visit = (value: unknown): unknown => {
    if (typeof value === "string") {
      const result = redactText(value);
      findingCount += result.count;
      return result.text;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value != null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
    }
    return value;
  };
  const redactedSnapshot = visit(snapshot) as T;
  return { findingCount, redactedSnapshot };
}

export function serializeRedactedShareSnapshot<T>(snapshot: T): {
  findingCount: number; redactedSnapshot: T; json: string; byteLength: number;
} {
  const encode = (value: T) => {
    const json = JSON.stringify(value);
    if (json === undefined) throw new Error("分享快照必须可序列化为 JSON");
    const byteLength = new TextEncoder().encode(json).byteLength;
    if (byteLength > SHARE_SNAPSHOT_MAX_BYTES) throw new Error("分享快照超过 10 MiB 限制");
    return { json, byteLength };
  };
  encode(snapshot);
  const redacted = redactShareSnapshot(snapshot);
  return { ...redacted, ...encode(redacted.redactedSnapshot) };
}
