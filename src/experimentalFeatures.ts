import { configBatchWrite, configRead, experimentalFeatureListAll, getConfigValue, type ExperimentalFeature } from "./config";

export function isVisibleBetaFeature(feature: ExperimentalFeature) {
  return feature.stage === "beta" &&
    !["memories", "multi_agent", "plugins", "plugin", "remote_control", "chronicle",
      "workspace_dependencies", "default_mode_request_user_input"].includes(feature.name) &&
    !feature.name.startsWith("realtime_");
}

export async function loadBetaFeatures() {
  const [features, snapshot] = await Promise.all([experimentalFeatureListAll(), configRead(undefined, true)]);
  return features.filter(isVisibleBetaFeature).map(feature => {
    const effective = getConfigValue(snapshot.config, `features.${feature.name}`);
    return { ...feature, enabled: typeof effective === "boolean" ? effective : feature.enabled };
  });
}

export async function saveBetaFeature(name: string, enabled: boolean) {
  const features = await experimentalFeatureListAll();
  if (!/^[a-z0-9_]+$/.test(name) || !features.some(feature => feature.name === name && isVisibleBetaFeature(feature))) {
    throw Error("该实验功能当前不可用，请重新读取。");
  }
  const keyPath = `features.${name}`;
  const result = await configBatchWrite([{ keyPath, value: enabled, mergeStrategy: "upsert" }],
    { filePath: null, expectedVersion: null, reloadUserConfig: false });
  try {
    const snapshot = await configRead(undefined, true);
    const user = snapshot.layers?.find((entry: any) =>
      entry?.name?.type === "user" && !entry.name.profile && !entry.disabledReason
    ) as { config: Record<string, unknown> } | undefined;
    if (!user || getConfigValue(user.config, keyPath) !== enabled) throw Error("用户配置值与提交值不同");
    const effective = getConfigValue(snapshot.config, keyPath);
    return { enabled: typeof effective === "boolean" ? effective : enabled,
      overridden: result.status === "okOverridden" || (typeof effective === "boolean" && effective !== enabled) };
  } catch (error) {
    throw Error(`写入已返回成功，但读回核验失败；请重新读取后核对：${String(error)}`);
  }
}
