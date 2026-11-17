import { readWorkCustomInstructions, type ServiceIdentity, type WorkCustomInstructions } from "./chatgptService";
export type { WorkCustomInstructions } from "./chatgptService";
type Reader = (identity: ServiceIdentity, signal: AbortSignal) => Promise<WorkCustomInstructions>;
const same = (left: ServiceIdentity, right: ServiceIdentity) => left.userId === right.userId
  && left.accountId === right.accountId && left.generation === right.generation;
const failure = (code: string, message: string) => Object.assign(Error(message), { code });

/** Account instructions are remote user settings, never the local AGENTS file.
 * Refresh failures retain the last confirmed value, as in the fixed Uc cache.
 * Unknown qualification is distinct from a confirmed absence of instructions.
 */
export function createWorkCustomInstructionsCache(reader: Reader = readWorkCustomInstructions) {
  let identity: ServiceIdentity | null = null, enabled: boolean | null = null, disposed = false;
  let owner = {}, cached: WorkCustomInstructions | null = null;
  let attempted: object | null = null;
  let pending: { controller: AbortController; promise: Promise<void> } | null = null;
  const cancel = () => { pending?.controller.abort(); pending = null; };
  const unavailable = () => failure("custom_instructions_not_ready", "尚未确认账户自定义指令资格。");
  const cache = {
    update(next: ServiceIdentity | null, qualified: boolean | null) {
      if (disposed) return;
      if (identity === null ? next !== null : next === null || !same(identity, next)) {
        owner = {}; cached = null; cancel();
      }
      if (qualified !== true) { owner = {}; cached = null; cancel(); }
      identity = next === null ? null : { ...next }; enabled = qualified;
    },
    refresh(signal?: AbortSignal): Promise<void> {
      if (disposed || identity === null || enabled === false) return Promise.resolve();
      if (enabled !== true) return Promise.reject(unavailable());
      // The first refresh owns its cancellation signal. A joining caller cannot
      // replace or cancel the already shared source promise.
      if (pending) return pending.promise;
      if (signal?.aborted) return Promise.resolve();
      attempted = owner;
      const expected = { ...identity }, token = owner, controller = new AbortController();
      const combined = AbortSignal.any([controller.signal, AbortSignal.timeout(5000), ...(signal ? [signal] : [])]);
      const promise = Promise.resolve().then(async () => {
        try {
          if (combined.aborted) return;
          const value = await reader(expected, combined);
          if (!disposed && !combined.aborted && owner === token && identity !== null && same(identity, expected) && enabled === true) {
            if (!(value.customInstructions === null || typeof value.customInstructions === "string")
                || typeof value.communicationGuide !== "string" || typeof value.communicationGuideEnabled !== "boolean") return;
            cached = { ...value };
          }
        } catch { /* A failed refresh is not a successful empty replacement. */ }
        finally { if (pending?.controller === controller) pending = null; }
      });
      pending = { controller, promise };
      return promise;
    },
    refreshOnce(): void {
      if (disposed || identity === null || enabled === false) return;
      if (enabled !== true) throw unavailable();
      if (attempted !== owner) void cache.refresh().catch(() => {});
    },
    read(expected: ServiceIdentity): string | null {
      if (disposed || identity === null) return null;
      if (!same(identity, expected)) throw failure("account_changed", "账户自定义指令的身份已变化。");
      if (enabled === false) return null;
      if (enabled !== true) throw unavailable();
      if (cached === null) return null;
      return [cached.customInstructions, cached.communicationGuideEnabled ? cached.communicationGuide : null]
        .filter(value => value?.trim()).join("\n\n") || null;
    },
    dispose() { disposed = true; owner = {}; cached = null; cancel(); identity = null; },
  };
  return cache;
}
