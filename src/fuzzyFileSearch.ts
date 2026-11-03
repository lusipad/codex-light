import { callAppServer, tauriListen } from "./bridge";

export interface FuzzySearchResponse {
  query: string;
  files: unknown[];
}

// One controller belongs to one open files view and one set of roots.
export function createFuzzyFileSearch(
  roots: string[],
  callbacks: {
    onResults: (response: FuzzySearchResponse) => void;
    onLoading: (loading: boolean) => void;
    onError: (error: unknown) => void;
  },
) {
  const sessionId = crypto.randomUUID();
  let disposed = false;
  let query = "";
  let revision = 0;
  let resultRevision = -1;
  let supported = true;
  let created = false;
  let started: Promise<void> | undefined;
  let restarting: Promise<unknown> | undefined;
  let unlisten: (() => void) | undefined;
  const unsupported = (error: unknown) =>
    /-32601|method not found|unknown (?:method|variant).*fuzzyFileSearch\/session/i.test(String(error));

  async function start() {
    try {
      const stop = await tauriListen<{ method: string; params?: {
        sessionId?: string; query?: string; files?: unknown[];
      } }>("app-server:notification", (event) => {
        if (disposed || event.params?.sessionId !== sessionId || !query) return;
        if (event.method === "fuzzyFileSearch/sessionUpdated" && event.params.query === query) {
          resultRevision = revision;
          callbacks.onResults({ query, files: event.params.files ?? [] });
        } else if (event.method === "fuzzyFileSearch/sessionCompleted" && resultRevision === revision) {
          callbacks.onLoading(false);
        }
      });
      if (disposed) { stop(); return; }
      unlisten = stop;
      try {
        await callAppServer("fuzzyFileSearch/sessionStart", { sessionId, roots });
        created = true;
      } catch (error) {
        if (!unsupported(error)) throw error;
        supported = false;
        unlisten?.(); unlisten = undefined;
      }
    } catch (error) {
      unlisten?.(); unlisten = undefined;
      started = undefined;
      throw error;
    }
  }

  return {
    update(nextQuery: string) {
      if (disposed) return Promise.resolve();
      query = nextQuery.trim();
      const current = ++revision;
      callbacks.onLoading(Boolean(query));
      if (!query) {
        callbacks.onResults({ query: "", files: [] });
        return Promise.resolve();
      }
      const ready = started ??= start();
      // Coalesce queries still waiting for startup, but a slow old update
      // acknowledgment must not block the user's next query.
      const work = (async () => {
        await ready;
        if (disposed || current !== revision) return;
        const requestedQuery = query;
        if (supported) {
          if (restarting) await restarting;
          if (disposed || current !== revision) return;
          try {
            await callAppServer("fuzzyFileSearch/sessionUpdate", { sessionId, query: requestedQuery });
          } catch (error) {
            if (!/fuzzy file search session not found/i.test(String(error))) throw error;
            if (disposed || current !== revision) return;
            restarting ??= callAppServer("fuzzyFileSearch/sessionStart", { sessionId, roots })
              .finally(() => { restarting = undefined; });
            await restarting;
            if (disposed || current !== revision) return;
            await callAppServer("fuzzyFileSearch/sessionUpdate", { sessionId, query: requestedQuery });
          }
        } else {
          const result = await callAppServer<{ files?: unknown[] }>("fuzzyFileSearch", {
            roots, query: requestedQuery, cancellationToken: sessionId,
          });
          if (disposed || current !== revision) return;
          callbacks.onResults({ query: requestedQuery, files: result.files ?? [] });
          callbacks.onLoading(false);
        }
      })().catch((error) => {
        if (!disposed && current === revision) {
          callbacks.onError(error);
          callbacks.onLoading(false);
        }
      });
      return work;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      revision++;
      unlisten?.(); unlisten = undefined;
      const creation = restarting ?? started;
      if (creation) return creation.then(async () => {
        if (created) await callAppServer("fuzzyFileSearch/sessionStop", { sessionId });
      }).catch(callbacks.onError);
    },
  };
}
