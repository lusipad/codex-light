export type NavigationAction = (() => void) & { onDeferred?: () => void; onCancelled?: () => void };
export interface NavigationRef { current: NavigationAction | null }
export type NavigationGuard = (action: NavigationAction) => boolean;

export function cancelNavigation(pending: NavigationRef): void {
  const action = pending.current;
  pending.current = null;
  action?.onCancelled?.();
}

export function deferNavigation(pending: NavigationRef, action: NavigationAction): void {
  cancelNavigation(pending);
  pending.current = action;
  action.onDeferred?.();
}

export function takeNavigation(pending: NavigationRef): NavigationAction | null {
  const action = pending.current;
  pending.current = null;
  return action;
}

/** A false guard result can mean busy or a real confirmation. Only a leaf's
 * explicit deferred notification keeps this continuation awaiting a decision. */
export function awaitGuardedNavigation(
  guard: NavigationGuard | null | undefined,
  action: () => boolean | void | Promise<boolean | void>,
  signal: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let settled = false, started = false, deferred = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true; signal.removeEventListener("abort", abort); resolve(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true; signal.removeEventListener("abort", abort); reject(error);
    };
    const abort = () => finish(false);
    const continuation: NavigationAction = () => {
      if (settled || started || signal.aborted) return;
      started = true;
      try { Promise.resolve(action()).then(result => finish(result !== false), fail); }
      catch (error) { fail(error); }
    };
    continuation.onDeferred = () => { deferred = true; };
    continuation.onCancelled = () => finish(false);
    if (signal.aborted) { finish(false); return; }
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (!guard || guard(continuation)) continuation();
      else if (!deferred && !started) finish(false);
    } catch (error) { fail(error); }
  });
}
