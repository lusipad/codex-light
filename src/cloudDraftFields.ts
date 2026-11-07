import { saveCloudDraftFields, type ServiceIdentity } from "./chatgptService";
import { readBoundCloudDraft, type CloudDraftBinding } from "./cloudDraftBindings";
import { parseCloudDetail, type CloudDetail } from "./cloudEnvironmentService";
import { draftNetworkPolicy, sameDraftNetwork } from "./cloudDraftNetwork";

export function draftFieldValues(draft: NonNullable<CloudDetail["draft"]>) {
  return { installScript: draft.installScript ?? "", startSkill: draft.startSkill ?? "", network: draft.network };
}
type Fields = ReturnType<typeof draftFieldValues>;
type Draft = NonNullable<CloudDetail["draft"]>;

export function draftMetadataValues(detail: CloudDetail) {
  return { name: detail.name, description: detail.description ?? "", shareSettings: detail.shareSettings };
}
type Metadata = ReturnType<typeof draftMetadataValues>;

export function draftMetadataChanges(previous: Metadata, values: Metadata) {
  const name = values.name.trim();
  return {
    ...(name === previous.name ? {} : { name }),
    ...(values.description === previous.description ? {} : { description: values.description }),
    ...(values.shareSettings === previous.shareSettings ? {} : { shareSettings: values.shareSettings }),
  };
}

export function compareDraftMetadata(previous: Metadata, values: Metadata, current: Metadata) {
  const changes = draftMetadataChanges(previous, values);
  const keys = Object.keys(changes) as (keyof Metadata)[];
  if (keys.every(key => current[key] === changes[key])) return "applied";
  return keys.every(key => current[key] === previous[key]) ? "unchanged" : "conflict";
}

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

export async function saveBoundDraftMetadata(binding: CloudDraftBinding, baseline: Draft, previous: Metadata, values: Metadata, identity: ServiceIdentity, signal: AbortSignal) {
  if (baseline.id !== binding.draftId) throw Error("环境草稿与请求身份不匹配。");
  const metadata = draftMetadataChanges(previous, values);
  const current = await readBoundCloudDraft(binding, identity, signal);
  const comparison = compareDraftMetadata(previous, values, draftMetadataValues(current));
  if (comparison === "applied") return current;
  if (comparison === "conflict" || current.draft?.baseVersionId !== baseline.baseVersionId
    || current.draft?.revision !== baseline.revision) throw { code: "conflict" };
  if (metadata.shareSettings === "private" && current.isOwner === false) throw Error("请环境所有者将其设为私密。");
  const result = await saveCloudDraftFields({ configId: binding.configId, draftId: binding.draftId,
    baseVersionId: baseline.baseVersionId, expectedRevision: baseline.revision, metadata }, identity, signal);
  signal.throwIfAborted();
  try { return parseCloudDetail(result, binding.configId, binding.draftId); }
  catch { throw { code: "cloud_draft_save_unconfirmed" }; }
}
