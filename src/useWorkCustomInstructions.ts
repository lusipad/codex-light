import { useLayoutEffect, useMemo, useRef } from "react";
import { createWorkCustomInstructionsCache } from "./workCustomInstructions";

type Cache = ReturnType<typeof createWorkCustomInstructionsCache>;

/** A stable consumer with a fresh cache for each committed mount. React's
 * development effect replay must not reuse a permanently disposed instance. */
export function useWorkCustomInstructions(): Cache {
  const instance = useRef<Cache | null>(null);
  const current = () => {
    if (!instance.current) throw Object.assign(Error("账户指令读取器尚未就绪。"), { code: "custom_instructions_unmounted" });
    return instance.current;
  };
  const consumer = useMemo<Cache>(() => ({
    update: (identity, enabled) => current().update(identity, enabled),
    refresh: signal => current().refresh(signal),
    refreshOnce: () => current().refreshOnce(),
    read: identity => current().read(identity),
    dispose: () => { const retired = instance.current; instance.current = null; retired?.dispose(); },
  }), []);
  useLayoutEffect(() => {
    const mounted = createWorkCustomInstructionsCache();
    instance.current = mounted;
    return () => {
      if (instance.current === mounted) instance.current = null;
      mounted.dispose();
    };
  }, []);
  return consumer;
}
