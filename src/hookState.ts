import { configBatchWrite, configRead } from "./config";
import { listHooks, type HookInfo } from "./hooksClient";

export async function writeHookState(cwds: string[], selected: HookInfo[], change: "trust" | boolean) {
  if (!selected.length) throw Error("没有选中的 Hook。");
  const before = await listHooks(cwds);
  const targets = selected.map(hook => {
    const current = before.hooks.find(item => item.id === hook.id && item.cwd === hook.cwd);
    if (!current || current.isManaged || !current.currentHash || !current.raw?.key) {
      throw Error("Hook 已移除、由组织托管或缺少标识，请重新读取。");
    }
    if (current.currentHash !== hook.currentHash) throw Error("Hook 定义已变化，请重新读取并审阅后再操作。");
    return current;
  });
  const snapshot = await configRead(undefined, true);
  const layer = snapshot.layers?.find((entry: any) =>
    entry?.name?.type === "user" && !entry.name.profile && !entry.disabledReason
  ) as { name: { file: string }; version: string } | undefined;
  if (!layer?.name.file || !layer.version) throw Error("无法确定可写的用户配置层，请重新读取。");
  const edits = [...new Map(targets.map(hook => [hook.id, hook])).values()].map(hook => ({
    keyPath: `hooks.state.${JSON.stringify(hook.id)}.${change === "trust" ? "trusted_hash" : "enabled"}`,
    value: change === "trust" ? hook.currentHash : change,
    mergeStrategy: "upsert" as const,
  }));
  const result = await configBatchWrite(edits, {
    filePath: layer.name.file, expectedVersion: layer.version, reloadUserConfig: true,
  });
  const updated = await listHooks(cwds);
  if (result.status === "okOverridden") throw Error("其他配置层覆盖了此次修改，请检查组织或项目配置。");
  for (const target of targets) {
    const hook = updated.hooks.find(item => item.id === target.id && item.cwd === target.cwd);
    if (!hook || hook.currentHash !== target.currentHash ||
      (change === "trust" ? hook.trustStatus !== "trusted" : hook.enabled !== change)) {
      throw Error("写入已返回，但有效状态读回不一致，请重新读取后核对。");
    }
  }
  return updated;
}
