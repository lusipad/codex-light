import { saveCloudDraftFields, type ServiceIdentity } from "./chatgptService";
import type { CloudDraftBinding } from "./cloudDraftBindings";
import { parseCloudDetail, type CloudDetail } from "./cloudEnvironmentService";
import { draftNetworkPolicy, sameDraftNetwork } from "./cloudDraftNetwork";

export function draftFieldValues(draft: NonNullable<CloudDetail["draft"]>) {
  return { installScript: draft.installScript ?? "", startSkill: draft.startSkill ?? "", network: draft.network };
}
type Fields = ReturnType<typeof draftFieldValues>;

export function draftFieldChanges(previous: Fields, values: Fields) {
  return {
    ...(values.installScript === previous.installScript ? {} : { installScript: values.installScript }),
    ...(values.startSkill === previous.startSkill ? {} : { startSkill: values.startSkill }),
    ...(sameDraftNetwork(previous.network, values.network) ? {} : { networkPolicy: draftNetworkPolicy(values.network) }),
  };
}

export function draftFieldsMatch(previous: Fields, values: Fields, current: Fields) {
  const changes = draftFieldChanges(previous, values);
  return (changes.installScript === undefined || current.installScript === values.installScript)
    && (changes.startSkill === undefined || current.startSkill === values.startSkill)
    && (changes.networkPolicy === undefined || sameDraftNetwork(current.network, values.network));
}

export async function saveBoundDraftFields(binding: CloudDraftBinding, baseline: NonNullable<CloudDetail["draft"]>, values: Fields, identity: ServiceIdentity, signal: AbortSignal) {
  signal.throwIfAborted();
  if (binding.accountId !== identity.accountId || binding.userId !== identity.userId || baseline.id !== binding.draftId) {
    throw Error("环境草稿与当前账号不匹配。");
  }
  const changes = draftFieldChanges(draftFieldValues(baseline), values);
  if (!Object.keys(changes).length) throw Error("草稿没有更改。");
  const result = await saveCloudDraftFields({ configId: binding.configId, draftId: binding.draftId,
    baseVersionId: baseline.baseVersionId, expectedRevision: baseline.revision, ...changes }, identity, signal);
  signal.throwIfAborted();
  try { return parseCloudDetail(result, binding.configId, binding.draftId); }
  catch { throw { code: "cloud_draft_save_unconfirmed" }; }
}
