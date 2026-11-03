import { configBatchWrite, configRead } from "./config";
import { listHooks, type HookInfo } from "./hooksClient";

export async function writeHookState(cwds: string[], selected: HookInfo[], change: "trust" | boolean, options: { isCurrent?: () => boolean } = {}) {
  const checkCurrent = () => { if (options.isCurrent?.() === false) throw Error("Hook 操作上下文已改变，请重新读取。"); };
  checkCurrent();
  if (!selected.length) throw Error("没有选中的 Hook。");
  const before = await listHooks(cwds);
  checkCurrent();
  const targets = selected.map(hook => {
    const current = before.hooks.find(item => item.id === hook.id && item.cwd === hook.cwd);
    if (!current || current.isManaged || current.trustStatus === "managed" || !current.currentHash || current.raw?.key !== current.id) {
      throw Error("Hook 已移除、由组织托管或缺少标识，请重新读取。");
    }
    if (current.currentHash !== hook.currentHash) throw Error("Hook 定义已变化，请重新读取并审阅后再操作。");
    if (current.source !== hook.source || current.sourcePath !== hook.sourcePath || (current.pluginId ?? null) !== (hook.pluginId ?? null)) {
      throw Error("Hook 来源已变化，请重新读取并审阅后再操作。");
    }
    if (change !== "trust" && current.trustStatus !== "trusted") throw Error("请先审阅并信任 Hook 定义，再更改启用状态。");
    return current;
  });
  const snapshot = await configRead(undefined, true);
  checkCurrent();
  const layer = snapshot.layers?.find((entry: any) =>
    entry?.name?.type === "user" && !entry.name.profile && !entry.disabledReason
  ) as { name: { file: string }; version: string } | undefined;
  if (!layer?.name.file || !layer.version) throw Error("无法确定可写的用户配置层，请重新读取。");
  const edits = [...new Map(targets.map(hook => [hook.id, hook])).values()].map(hook => ({
    keyPath: `hooks.state.${JSON.stringify(hook.id)}.${change === "trust" ? "trusted_hash" : "enabled"}`,
    value: change === "trust" ? hook.currentHash : change,
    mergeStrategy: "upsert" as const,
  }));
  if (new Set(targets.map(hook => `${hook.id}:${hook.currentHash}`)).size !== new Set(targets.map(hook => hook.id)).size) {
    throw Error("同一 Hook 标识包含不同定义，请重新读取并审阅。");
  }
  checkCurrent();
  const result = await configBatchWrite(edits, {
    filePath: layer.name.file, expectedVersion: layer.version, reloadUserConfig: true,
  });
  checkCurrent();
  const updated = await listHooks(cwds);
  checkCurrent();
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
