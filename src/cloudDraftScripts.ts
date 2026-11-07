import { saveCloudDraftScripts, type ServiceIdentity } from "./chatgptService";
import type { CloudDraftBinding } from "./cloudDraftBindings";
import { parseCloudDetail, type CloudDetail } from "./cloudEnvironmentService";

export function draftScriptValues(draft: NonNullable<CloudDetail["draft"]>) {
  return { installScript: draft.installScript ?? "", startSkill: draft.startSkill ?? "" };
}

export async function saveBoundDraftScripts(binding: CloudDraftBinding, baseline: NonNullable<CloudDetail["draft"]>, values: ReturnType<typeof draftScriptValues>, identity: ServiceIdentity, signal: AbortSignal) {
  signal.throwIfAborted();
  if (binding.accountId !== identity.accountId || binding.userId !== identity.userId || baseline.id !== binding.draftId) {
    throw Error("环境草稿与当前账号不匹配。");
  }
  const previous = draftScriptValues(baseline);
  const changes = {
    ...(values.installScript === previous.installScript ? {} : { installScript: values.installScript }),
    ...(values.startSkill === previous.startSkill ? {} : { startSkill: values.startSkill }),
  };
  if (!Object.keys(changes).length) throw Error("草稿没有更改。");
  const result = await saveCloudDraftScripts({ configId: binding.configId, draftId: binding.draftId,
    baseVersionId: baseline.baseVersionId, expectedRevision: baseline.revision, ...changes }, identity, signal);
  signal.throwIfAborted();
  try { return parseCloudDetail(result, binding.configId, binding.draftId); }
  catch { throw { code: "cloud_draft_save_unconfirmed" }; }
}
