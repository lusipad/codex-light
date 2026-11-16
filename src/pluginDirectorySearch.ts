import { useEffect, useRef, useState } from "react";
import { isUnsupportedPluginSearch, searchPlugins, type PluginSearchResponse } from "./plugins";

interface SearchOptions {
  query: string;
  cwds?: string[];
  identity: string;
  enabled: boolean;
}

interface SearchState {
  key: string;
  result: PluginSearchResponse | null;
  loading: boolean;
  error: string | null;
  unsupported: boolean;
  paging: boolean;
  pageError: string | null;
}

function uniqueRows(rows: PluginSearchResponse["data"]): PluginSearchResponse["data"] {
  const seen = new Set<string>();
  return rows.filter(row => {
    const key = JSON.stringify([row.marketplaceName, row.marketplacePath ?? null, row.plugin.id]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const message = (error: unknown) => error && typeof error === "object" && "message" in error
  ? String(error.message) : String(error);

/** Main-directory CLI search intentionally omits scope; home sections are not a search corpus. */
export function usePluginDirectorySearch({ query, cwds, identity, enabled }: SearchOptions) {
  const term = query.trim();
  const rootsKey = JSON.stringify(cwds ?? []);
  const key = JSON.stringify([term, rootsKey, identity, enabled]);
  const [revision, setRevision] = useState(0);
  const empty: SearchState = {
    key, result: null, loading: enabled && !!term, error: null,
    unsupported: false, paging: false, pageError: null,
  };
  const [state, setState] = useState<SearchState>(empty);
  const currentKey = useRef(key);
  currentKey.current = key;
  const active = useRef<{
    key: string; live: boolean; paging: boolean;
    result: PluginSearchResponse | null; consumed: Set<string>;
  } | null>(null);

  useEffect(() => {
    const request = { key, live: true, paging: false, result: null as PluginSearchResponse | null, consumed: new Set<string>() };
    active.current = request;
    const current = () => request.live && active.current === request && currentKey.current === key;
    setState({ ...empty });
    if (!enabled || !term) return () => { request.live = false; };
    const timer = setTimeout(() => {
      void searchPlugins(term, JSON.parse(rootsKey) as string[], null).then(response => {
        if (!current()) return;
        const result = { ...response, data: uniqueRows(response.data) };
        request.result = result;
        setState({ ...empty, loading: false, result });
      }).catch(error => {
        if (!current()) return;
        setState({ ...empty, loading: false, error: message(error), unsupported: isUnsupportedPluginSearch(error) });
      });
    }, 200);
    return () => { request.live = false; clearTimeout(timer); };
    // Serialized roots preserve the request scope without restarting for equivalent array instances.
  }, [key, revision]);

  const loadMore = () => {
    const request = active.current;
    const cursor = request?.result?.nextCursor;
    if (!request?.live || request.key !== key || currentKey.current !== key || request.paging || !cursor || request.consumed.has(cursor)) return;
    request.paging = true;
    setState(previous => ({ ...previous, paging: true, pageError: null }));
    const current = () => request.live && active.current === request && currentKey.current === key;
    void searchPlugins(term, JSON.parse(rootsKey) as string[], cursor).then(response => {
      if (!current()) return;
      request.consumed.add(cursor);
      const repeatedCursor = !!response.nextCursor && request.consumed.has(response.nextCursor);
      const result = {
        data: uniqueRows([...(request.result?.data ?? []), ...response.data]),
        nextCursor: response.nextCursor && !request.consumed.has(response.nextCursor) ? response.nextCursor : null,
      };
      request.result = result;
      request.paging = false;
      setState(previous => ({ ...previous, result, paging: false,
        pageError: repeatedCursor ? "目录分页返回重复游标，结果可能不完整；请重新搜索。" : null }));
    }).catch(error => {
      if (!current()) return;
      request.paging = false;
      setState(previous => ({ ...previous, paging: false, pageError: message(error) }));
    });
  };

  const visible = state.key === key ? state : empty;
  return {
    result: visible.result, loading: visible.loading, error: visible.error,
    unsupported: visible.unsupported, paging: visible.paging, pageError: visible.pageError,
    nextCursor: visible.result?.nextCursor ?? null, loadMore,
    retry: () => { if (active.current) active.current.live = false; setRevision(value => value + 1); },
  };
}
