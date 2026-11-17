// Initial environment envelope only. Source: R10 prerequisites CP15/17;
// no official runtime code is executed or bundled here.
export interface ChatgptRequirementsEnvironment {
  screenSize: number;
  date: string;
  heapSizeLimit: number | null;
  userAgent: string;
  scriptSample?: string;
  build?: string | null;
  language: string;
  languages?: string;
  navigatorSample?: string;
  documentSample?: string;
  windowSample?: string;
  sampledAt: number;
  uuid: string;
  queryKeys: string;
  hardwareConcurrency: number;
  timeOrigin: number;
  featurePresence: readonly number[];
  startedAt: number;
  finishedAt: number;
}

function notReady(): never {
  throw new Error("ChatGPT requirements environment is not ready.");
}

export function createChatgptRequirementsKey(environment: ChatgptRequirementsEnvironment): string {
  const e = environment;
  if (!e || ![e.screenSize, e.sampledAt, e.hardwareConcurrency, e.timeOrigin, e.startedAt, e.finishedAt].every(Number.isFinite)
    || !(e.heapSizeLimit === null || Number.isFinite(e.heapSizeLimit))
    || ![e.date, e.userAgent, e.language, e.uuid, e.queryKeys].every(value => typeof value === "string")
    || e.uuid.length === 0 || !Array.isArray(e.featurePresence) || e.featurePresence.length !== 7
    || !e.featurePresence.every(value => value === 0 || value === 1)
    || ![e.scriptSample, e.languages, e.navigatorSample, e.documentSample, e.windowSample].every(value => value === undefined || typeof value === "string")
    || !(e.build == null || typeof e.build === "string")
    || typeof TextEncoder === "undefined" || typeof btoa !== "function") notReady();
  const fields = [e.screenSize, e.date, e.heapSizeLimit, 1, e.userAgent, e.scriptSample, e.build,
    e.language, e.languages, e.finishedAt - e.startedAt, e.navigatorSample, e.documentSample,
    e.windowSample, e.sampledAt, e.uuid, e.queryKeys, e.hardwareConcurrency, e.timeOrigin, ...e.featurePresence];
  const bytes = new TextEncoder().encode(JSON.stringify(fields));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `gAAAAAC${btoa(binary)}`;
}

export function collectChatgptRequirementsEnvironment(): ChatgptRequirementsEnvironment {
  if (typeof window === "undefined" || typeof document === "undefined" || typeof navigator === "undefined"
    || typeof screen === "undefined" || typeof performance === "undefined" || typeof performance.now !== "function"
    || typeof crypto === "undefined" || typeof crypto.randomUUID !== "function"
    || document.scripts == null || document.documentElement == null || typeof document.documentElement.getAttribute !== "function"
    || window.location == null || typeof window.location.search !== "string") notReady();
  const startedAt = performance.now();
  const choose = <T,>(items: readonly T[]): T | undefined => items[Math.floor(Math.random() * items.length)];
  const screenSize = screen.width + screen.height;
  const date = String(new Date());
  const heapSizeLimit = (performance as Performance & { memory?: { jsHeapSizeLimit?: number } }).memory?.jsHeapSizeLimit ?? null;
  Math.random(); // The sampled nonce is replaced with 1 in the initial envelope.
  const userAgent = navigator.userAgent;
  const scriptSample = choose(Array.from(document.scripts).map(script => script?.src).filter(Boolean));
  const build = Array.from(document.scripts || []).map(script => script?.src?.match("c/[^/]*/_")).find(match => match?.length)?.[0]
    ?? document.documentElement.getAttribute("data-build");
  const language = navigator.language;
  const languages = navigator.languages?.join(",");
  Math.random(); // The second sampled nonce is replaced with elapsed time.
  const prototype = Object.getPrototypeOf(navigator);
  if (prototype == null) notReady();
  const navigatorKey = choose(Object.keys(prototype));
  let navigatorSample: string | undefined;
  try {
    const value = (navigator as unknown as Record<string, unknown>)[String(navigatorKey)];
    navigatorSample = `${navigatorKey}−${String(value)}`;
  } catch {
    navigatorSample = navigatorKey;
  }
  const documentSample = choose(Object.keys(document));
  const windowSample = choose(Object.keys(window));
  const sampledAt = performance.now();
  const uuid = crypto.randomUUID();
  const queryKeys = [...new URLSearchParams(window.location.search).keys()].join(",");
  const hardwareConcurrency = navigator.hardwareConcurrency;
  const timeOrigin = performance.timeOrigin;
  const featurePresence = ["ai", "createPRNG", "cache", "data", "solana", "dump", "InstallTrigger"].map(key => Number(key in window));
  const finishedAt = performance.now();
  const environment = { screenSize, date, heapSizeLimit, userAgent, scriptSample, build, language, languages,
    navigatorSample, documentSample, windowSample, sampledAt, uuid, queryKeys, hardwareConcurrency,
    timeOrigin, featurePresence, startedAt, finishedAt };
  // Validate before exposing a ready snapshot; do not fabricate a fallback envelope.
  createChatgptRequirementsKey(environment);
  return environment;
}
