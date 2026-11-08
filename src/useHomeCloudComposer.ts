import { useEffect, useRef, useState } from "react";
import { readCloudEnvironmentAccess } from "./cloudEnvironmentAccess";
import { loadCloudCatalog, loadRepositoryName, type CloudSummary } from "./cloudEnvironmentService";
import { serviceErrorMessage, type ServiceIdentity } from "./chatgptService";
import type { CloudDraftSession } from "./cloudDraftSession";
import { readPublishedCloudStart, startPublishedCloudChat, type PublishedCloudTarget } from "./cloudPublishedChat";

type Choice = {
  active: boolean;
  identity: ServiceIdentity | null;
  items: CloudSummary[] | null;
  repositoryNames: ReadonlyMap<string, string>;
  loading: boolean;
  catalogError: string | null;
  target: PublishedCloudTarget | null;
  prompt: string;
  entry: ReturnType<typeof readPublishedCloudStart>;
  busy: boolean;
  error: string | null;
};
const empty: Choice = { active: false, identity: null, items: null, repositoryNames: new Map(), loading: false, catalogError: null, target: null,
  prompt: "", entry: null, busy: false, error: null };
const sameIdentity = (a: ServiceIdentity, b: ServiceIdentity) =>
  a.accountId === b.accountId && a.userId === b.userId && a.generation === b.generation;
const savedConfig = /^(?:[A-Za-z0-9_-]+~)?asenvcfg_[A-Za-z0-9_-]+(?![\s\S])/;
const catalogFreshMs = 10 * 60 * 1000;

export function useHomeCloudComposer(scope: string | null) {
  const [snapshot, setSnapshot] = useState({ scope, choice: empty });
  const lifetime = useRef<AbortController | null>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const reading = useRef(false);
  const catalogReadAt = useRef<number | null>(null);
  const catalogRevision = useRef(0);
  const sending = useRef(false);
  const choice = snapshot.scope === scope && scope !== null ? snapshot.choice : empty;
  const update = (patch: Partial<Choice> | ((value: Choice) => Partial<Choice>)) => setSnapshot(value =>
    value.scope === scope ? { scope, choice: { ...value.choice, ...(typeof patch === "function" ? patch(value.choice) : patch) } } : value);
  const current = (request: AbortController) =>
    lifetime.current === request && !request.signal.aborted && scopeRef.current === scope;

  useEffect(() => {
    setSnapshot({ scope, choice: empty });
    reading.current = false;
    catalogReadAt.current = null;
    sending.current = false;
    if (scope === null) return;
    const request = new AbortController();
    lifetime.current = request;
    void readCloudEnvironmentAccess(request.signal, true).then(access => {
      if (current(request) && access.canStartChat) update({ identity: access.identity });
    }).catch(() => {});
    return () => request.abort();
  }, [scope]);

  const load = async (force = false) => {
    const request = lifetime.current, identity = choice.identity;
    if (!request || !current(request) || !identity || reading.current) return;
    if (!force && catalogReadAt.current !== null && Date.now() - catalogReadAt.current < catalogFreshMs) return;
    reading.current = true;
    update({ loading: true, catalogError: null });
    try {
      const catalog = await loadCloudCatalog(identity, request.signal);
      if (!current(request)) return;
      const items = catalog.items.filter(item => savedConfig.test(item.id) && item.name.trim() && item.versionId.trim());
      const revision = ++catalogRevision.current;
      update({ items, repositoryNames: new Map() });
      for (const id of new Set(items.flatMap(item => item.repositories.map(repo => repo.id)))) {
        void loadRepositoryName(id, identity, request.signal).then(({ name }) => {
          if (name && current(request) && catalogRevision.current === revision)
            update(value => ({ repositoryNames: new Map(value.repositoryNames).set(id, name) }));
        }).catch(() => {});
      }
    } catch (cause) {
      if (current(request)) update({ catalogError: serviceErrorMessage(cause) });
    } finally {
      if (current(request)) {
        catalogReadAt.current = Date.now();
        reading.current = false;
        update({ loading: false });
      }
    }
  };

  const select = (item: CloudSummary) => {
    const identity = choice.identity, request = lifetime.current;
    if (!identity || !request || !current(request) || !choice.items?.includes(item) || sending.current) return;
    const target: PublishedCloudTarget = {
      versionId: item.versionId,
      session: { identity, binding: { accountId: identity.accountId, userId: identity.userId,
        configId: item.id, draftId: null, environmentId: null, name: item.name, repositoryNamesById: {}, conversation: true } },
    };
    try { update({ target, entry: readPublishedCloudStart(target), error: null }); }
    catch (cause) { update({ target: null, entry: null, error: serviceErrorMessage(cause) }); }
  };

  const send = async (open: (session: CloudDraftSession) => boolean) => {
    const request = lifetime.current, target = choice.target;
    if (!request || !current(request) || !choice.active || !target || sending.current ||
      (choice.entry ? !choice.entry.threadId : !choice.prompt.trim())) return;
    sending.current = true;
    update({ busy: true, error: null });
    try {
      const access = await readCloudEnvironmentAccess(request.signal, true);
      if (!current(request)) return;
      if (!access.canStartChat || !sameIdentity(access.identity, target.session.identity))
        throw Error("当前账号已无法使用此云端环境。");
      await startPublishedCloudChat(target, choice.prompt, request.signal, session =>
        current(request) && open(session));
    } catch (cause) {
      if (current(request)) update({ error: serviceErrorMessage(cause) });
    } finally {
      if (current(request)) {
        sending.current = false;
        update({ busy: false });
        try { update({ entry: readPublishedCloudStart(target) }); }
        catch (cause) { update({ target: null, entry: null, error: serviceErrorMessage(cause) }); }
      }
    }
  };

  return {
    ...choice, available: choice.identity !== null, load, select, send,
    filterItems: (query: string) => {
      const search = query.trim().toLocaleLowerCase();
      return choice.items?.filter(item => item.name.toLocaleLowerCase().includes(search) ||
        item.repositories.some(({ id }) => (choice.repositoryNames.get(id) ?? id).toLocaleLowerCase().includes(search)));
    },
    setActive: (active: boolean) => {
      if (!sending.current && (!active || choice.identity)) update({ active, error: null });
    },
    setPrompt: (prompt: string) => {
      if (!sending.current && !choice.entry) update({ prompt });
    },
    canSend: !!choice.target && !choice.busy && (choice.entry ? !!choice.entry.threadId : !!choice.prompt.trim()),
  };
}
