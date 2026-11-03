import { useEffect, useRef, useState } from "react";
import { callAppServer, tauriListen } from "./bridge";
import { getMetadata, readFileBytes } from "./fsClient";

export const IMPORT_PROVIDERS = ["claude-code", "cursor"] as const;
export type ImportProvider = typeof IMPORT_PROVIDERS[number];
export interface MigrationItem {
  itemType: string;
  description: string;
  cwd?: string | null;
  details?: Record<string, unknown> | null;
}
export interface ImportChoice { provider: ImportProvider; item: MigrationItem }
export interface ImportOutcome {
  itemType: string;
  source?: string | null;
  target?: string | null;
  message?: string;
  readback?: string;
}
interface TypeResult { itemType: string; successes: ImportOutcome[]; failures: ImportOutcome[] }
interface ImportCompletion { importId: string; itemTypeResults: TypeResult[] }
export interface ImportReport { provider: ImportProvider; importId: string; successes: ImportOutcome[]; failures: ImportOutcome[] }
const sourceParams = (provider: ImportProvider) => provider === "cursor" ? { migrationSource: "cursor" } : {};
export const importChoiceId = (choice: ImportChoice) => JSON.stringify([choice.provider, choice.item]);

export async function detectImportProvider(provider: ImportProvider, cwd: string, includeHome: boolean): Promise<MigrationItem[]> {
  const result = await callAppServer<{ items: MigrationItem[] }>("externalAgentConfig/detect", {
    includeHome, cwds: cwd ? [cwd] : [], ...sourceParams(provider),
  });
  if (!Array.isArray(result?.items) || result.items.some(item => !item || typeof item.itemType !== "string" || typeof item.description !== "string")) {
    throw Error("导入检测响应格式无效");
  }
  return result.items;
}

export class ImportResultUnknown extends Error {}

export async function executeExternalImport(
  provider: ImportProvider, items: MigrationItem[], onProgress: (count: number) => void,
): Promise<ImportReport> {
  if (!items.length) throw Error("未选择导入项");
  let importId: string | null = null;
  const early = new Map<string, ImportCompletion>();
  let disconnected = false;
  let resolveCompletion: ((value: ImportCompletion) => void) | null = null;
  let rejectCompletion: ((error: Error) => void) | null = null;
  let statusUnlisten: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sent = false;
  const unlisten = await tauriListen<{ method?: string; params?: ImportCompletion }>("app-server:notification", event => {
    if (event.method !== "externalAgentConfig/import/completed" && event.method !== "externalAgentConfig/import/progress") return;
    const value = event.params;
    if (!value || typeof value.importId !== "string") return;
    if (event.method.endsWith("/completed")) {
      if (value.importId === importId) resolveCompletion?.(value);
      else if (!importId) early.set(value.importId, value);
    } else if (value.importId === importId && Array.isArray(value.itemTypeResults)) {
      onProgress(value.itemTypeResults.reduce((count, row) => count + (row.successes?.length || 0) + (row.failures?.length || 0), 0));
    }
  });
  try {
    statusUnlisten = await tauriListen<{ connected: boolean }>("app-server:status", status => {
      if (!status.connected) {
        disconnected = true;
        rejectCompletion?.(new ImportResultUnknown("服务连接中断，后台导入结果未知，请勿重复导入。"));
      }
    });
    sent = true;
    const accepted = await callAppServer<{ importId: string }>("externalAgentConfig/import", {
      migrationItems: items, ...sourceParams(provider), providerId: provider, source: "app",
    });
    if (!accepted?.importId || typeof accepted.importId !== "string") throw new ImportResultUnknown("未返回导入任务 ID，结果未知。");
    importId = accepted.importId;
    const completion = early.get(importId) ?? await new Promise<ImportCompletion>((resolve, reject) => {
      if (disconnected) return reject(new ImportResultUnknown("服务已断连，导入结果未知，请勿重复导入。"));
      resolveCompletion = resolve; rejectCompletion = reject;
      timer = setTimeout(() => reject(new ImportResultUnknown("等待导入完成超时，后台任务可能仍在执行，请勿重复导入。")), 120000);
    });
    if (!Array.isArray(completion.itemTypeResults) || completion.itemTypeResults.some(row => !Array.isArray(row.successes) || !Array.isArray(row.failures))) {
      throw new ImportResultUnknown("导入完成结果格式无效，不能确认写入结果。");
    }
    const successes = await Promise.all(completion.itemTypeResults.flatMap(row => row.successes).map(async outcome => {
      try {
        if (!outcome.target) return { ...outcome, readback: "服务未返回目标，尚未读回" };
        if (outcome.itemType === "SESSIONS") {
          const value = await callAppServer<{ thread: { id: string } }>("thread/read", { threadId: outcome.target, includeTurns: false });
          if (value?.thread?.id !== outcome.target) throw Error("会话身份不一致");
          return { ...outcome, readback: "已读取目标会话" };
        }
        const metadata = await getMetadata(outcome.target);
        if (metadata.isFile) {
          const bytes = await readFileBytes(outcome.target);
          return { ...outcome, readback: `已读取目标文件（${bytes.length} 字节）` };
        }
        if (metadata.isDirectory) return { ...outcome, readback: "已核对目标目录存在" };
        throw Error("目标不是普通文件或目录");
      } catch (error) { return { ...outcome, readback: `目标读回失败：${String(error)}` }; }
    }));
    return { provider, importId, successes, failures: completion.itemTypeResults.flatMap(row => row.failures) };
  } catch (error) {
    if (sent && !(error instanceof ImportResultUnknown)) throw new ImportResultUnknown(`请求已提交，导入结果未确认：${String(error)}`);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    unlisten(); statusUnlisten?.();
  }
}

export function useExternalImports(onImported: () => Promise<void>) {
  const [choices, setChoices] = useState<ImportChoice[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [phase, setPhase] = useState<"idle" | "detecting" | "choosing" | "importing" | "finished">("idle");
  const [scope, setScope] = useState({ cwd: "", includeHome: true });
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<ImportReport[]>([]);
  const [progress, setProgress] = useState(0);
  const [uncertain, setUncertain] = useState(false);
  const locked = useRef(false);
  const uncertainRef = useRef(false);
  const generation = useRef(0);
  const notify = useRef(onImported);
  notify.current = onImported;
  useEffect(() => () => { generation.current += 1; }, []);
  const detect = async (cwd: string, includeHome: boolean) => {
    if (locked.current) return;
    locked.current = true;
    const version = generation.current;
    setPhase("detecting"); setError(null); setSelected([]); setScope({ cwd, includeHome });
    try {
      const result = await Promise.allSettled(IMPORT_PROVIDERS.map(async provider =>
        (await detectImportProvider(provider, cwd, includeHome)).map(item => ({ provider, item }))));
      if (version !== generation.current) return;
      setChoices(result.flatMap(value => value.status === "fulfilled" ? value.value : []));
      const errors = result.flatMap((value, i) => value.status === "rejected" ? [`${IMPORT_PROVIDERS[i]}：${String(value.reason)}`] : []);
      setError(errors.length ? errors.join("\n") : null); setPhase("choosing");
    } finally { if (version === generation.current) locked.current = false; }
  };
  const start = async () => {
    if (locked.current || uncertainRef.current || !selected.length) return;
    locked.current = true;
    const version = generation.current;
    const live = () => version === generation.current;
    const chosen = choices.filter(choice => selected.includes(importChoiceId(choice)));
    setPhase("importing"); setError(null); setReports([]); setProgress(0);
    let wrote = false;
    try {
      for (const provider of IMPORT_PROVIDERS) {
        const items = chosen.filter(choice => choice.provider === provider).map(choice => choice.item);
        if (!items.length) continue;
        const fresh = await detectImportProvider(provider, scope.cwd, scope.includeHome);
        if (!live()) return;
        if (items.some(item => !fresh.some(value => JSON.stringify(value) === JSON.stringify(item)))) {
          throw Error("检测来源已变化，请重新检测并选择后再导入。");
        }
        const report = await executeExternalImport(provider, items, count => { if (live()) setProgress(count); });
        wrote = true;
        if (!live()) return;
        setReports(previous => [...previous, report]);
      }
      if (live()) { setSelected([]); setPhase("finished"); }
    } catch (error) {
      if (live()) {
        if (error instanceof ImportResultUnknown) { uncertainRef.current = true; setUncertain(true); }
        setError(String(error)); setPhase("finished");
      }
    } finally {
      if (wrote && live()) {
        try { await notify.current(); }
        catch (error) { if (live()) setError(`导入已有结果，但刷新失败：${String(error)}`); }
      }
      if (live()) locked.current = false;
    }
  };
  return { choices, selected, setSelected, phase, scope, error, reports, progress, uncertain, detect, start };
}
export type ExternalImportsState = ReturnType<typeof useExternalImports>;
