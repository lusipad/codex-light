import React from "react";
import type { AppInfo, PluginDetail } from "../plugins";

const googleAppIds = new Set([
  "connector_gmail", "connector_google_bigquery", "connector_google_calendar", "connector_google_contacts",
  "connector_google_docs", "connector_google_drive", "connector_google_sheets", "connector_google_slides",
]);
const memoryUrl = "https://help.openai.com/en/articles/8590148-memory-faq";
const riskUrl = "https://help.openai.com/en/articles/20001062-elevated-risk-labels";
const appsUrl = "https://help.openai.com/en/articles/11487775-apps-in-chatgpt";
const googleUrl = "https://help.openai.com/en/articles/10408842-google-app-for-chatgpt-data-controls-faq";

function LegalLink({ href, children }: { href?: string | null; children: React.ReactNode }) {
  let safe = false;
  if (href) {
    try { const url = new URL(href); safe = url.protocol === "https:" && !url.username && !url.password; } catch { /* Missing/invalid metadata remains plain text. */ }
  }
  return safe ? <a href={href!}>{children}</a> : <>{children}</>;
}

export function PluginDirectoryLegal({ detail, apps }: { detail: PluginDetail; apps?: AppInfo[] }) {
  // Only normalized, validated templates count. Unknown template fields do not mean an unconfigured app.
  const unconfigured = (detail.appTemplates ?? []).filter((value): value is { materializedAppIds: string[]; canonicalConnectorId?: string | null } => {
    if (!value || typeof value !== "object") return false;
    const template = value as Record<string, unknown>;
    return Array.isArray(template.materializedAppIds) && template.materializedAppIds.every(id => typeof id === "string")
      && template.materializedAppIds.length === 0
      && (template.canonicalConnectorId == null || typeof template.canonicalConnectorId === "string");
  });
  const count = detail.apps.length + unconfigured.length;
  if (count === 0) return null;
  const info = detail.summary.interface;
  const name = info?.displayName ?? detail.summary.name;
  const google = detail.apps.some(app => googleAppIds.has(app.id)
    || apps?.find(item => item.id === app.id)?.branding?.developer?.trim().toLowerCase() === "google")
    || unconfigured.some(template => template.canonicalConnectorId != null && googleAppIds.has(template.canonicalConnectorId));
  return <div className="plugin-detail-legal">
    {count === 1 ? <p>连接到 {name} 后，ChatGPT 可能会与此应用分享相关聊天和记忆，以便为你的请求提供上下文。{name} 对这些数据的使用受其 <LegalLink href={info?.termsOfServiceUrl}>条款</LegalLink> 和 <LegalLink href={info?.privacyPolicyUrl}>隐私政策</LegalLink> 约束。如果你已启用 <LegalLink href={memoryUrl}>记忆</LegalLink>，来自该应用的数据可能会用于主动提供有用信息或建议。ChatGPT 始终遵守你的训练数据偏好设置，包括来自已连接应用的数据。使用应用可能会带来 <LegalLink href={riskUrl}>较高风险</LegalLink>。你可以随时在设置中管理偏好设置或断开与应用的连接。<LegalLink href={appsUrl}>了解更多</LegalLink></p>
      : <p>此插件可能包含上方列出的一个或多个应用。连接到应用后，ChatGPT 可能会与该应用分享相关聊天和记忆，以帮助为你的请求提供上下文。应用对此类数据的使用受其条款和隐私政策约束，相关条款和隐私政策可在应用页面找到。如果你已启用 <LegalLink href={memoryUrl}>记忆</LegalLink>，来自该应用的数据可能会用于主动提供有用信息或建议。ChatGPT 始终尊重你的训练数据偏好设置，包括来自已连接应用的数据。使用应用可能存在<LegalLink href={riskUrl}>较高风险</LegalLink>。你可随时在设置中管理偏好设置，或断开与应用的连接。<LegalLink href={appsUrl}>了解更多</LegalLink></p>}
    {google && <p>关于 Google 应用的说明：此插件可能包含上文列出的一个或多个 Google 应用。从这些应用同步的任何数据都可能用于向你提供相关且个性化的信息。我们不会使用这些数据或其衍生内容训练通用模型，但你在反馈中提交的内容或 ChatGPT 回复中包含的内容除外。你可以删除对话，这也会删除这些对话中使用的任何应用数据。<LegalLink href={googleUrl}>了解更多</LegalLink></p>}
  </div>;
}
