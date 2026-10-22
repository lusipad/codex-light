import React, { useMemo, useState } from "react";
import {
  CommandExecutionApprovalDecision,
  CommandExecutionRequestApprovalParams,
  FileChangeRequestApprovalParams,
  PermissionsRequestApprovalParams,
  ToolRequestUserInputParams,
  ToolRequestUserInputQuestion,
  classifyServerRequest,
  commandApprovalResponse,
  describeCommand,
  fileChangeApprovalResponse,
  permissionsApprovalResponse,
  userInputResponse,
} from "../protocol";
import { PendingServerRequest } from "../types";
import { ShieldIcon, HandApprovalIcon, CheckIcon, CloseIcon, DiffIcon } from "./Icons";

interface ApprovalCenterProps {
  requests: PendingServerRequest[];
  onRespond: (id: any, result: any) => void;
  onRespondError: (id: any, message: string) => void;
}

/**
 * Approval / interactive-request surface, replaced the previous generic card.
 * Wire shapes mirror the official Codex app (verified against app.asar renderer):
 *  - command:   { decision: "accept" | "acceptForSession" | {acceptWithExecpolicyAmendment} | {applyNetworkPolicyAmendment} | "decline" | "cancel" }
 *  - fileChange:{ decision: "accept" | "acceptForSession" | "decline" | "cancel" }
 *  - permissions:{ permissions: {fileSystem, network}|{}, scope: "turn"|"session", strictAutoReview }
 *  - userInput: { answers: { [questionId]: { answers: string[] } } }
 *  - optionPicker:{ action: "select"|"dismiss", selectedOptions: string[], freeformAnswer: string|null }
 */
export const ApprovalCenter: React.FC<ApprovalCenterProps> = ({
  requests,
  onRespond,
  onRespondError,
}) => {
  if (!requests.length) return null;
  return (
    <div className="approval-center">
      {requests.map((req) => (
        <ApprovalCard
          key={String(req.id)}
          request={req}
          onRespond={onRespond}
          onRespondError={onRespondError}
        />
      ))}
    </div>
  );
};

const ApprovalCard: React.FC<{
  request: PendingServerRequest;
  onRespond: (id: any, result: any) => void;
  onRespondError: (id: any, message: string) => void;
}> = ({ request, onRespond, onRespondError }) => {
  const kind = classifyServerRequest(request.method, request.params);
  switch (kind) {
    case "command":
      return <CommandApprovalCard request={request} onRespond={onRespond} onRespondError={onRespondError} />;
    case "fileChange":
      return <FileChangeApprovalCard request={request} onRespond={onRespond} onRespondError={onRespondError} />;
    case "permissions":
      return <PermissionsApprovalCard request={request} onRespond={onRespond} onRespondError={onRespondError} />;
    case "userInput":
      return <UserInputCard request={request} onRespond={onRespond} />;
    default:
      return <GenericRequestCard request={request} onRespond={onRespond} onRespondError={onRespondError} />;
  }
};

/* ------------------------------------------------------------------ */

const CardShell: React.FC<{
  tone?: "warn" | "info";
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}> = ({ tone = "warn", icon, title, subtitle, children, footer }) => (
  <div className={`approval-card approval-${tone}`}>
    <div className="approval-header">
      {icon ?? <ShieldIcon size={18} />}
      <div className="approval-heading">
        <strong>{title}</strong>
        {subtitle && <span className="approval-subtitle">{subtitle}</span>}
      </div>
      <span className={`approval-risk-dot risk-${tone}`} aria-hidden="true" />
    </div>
    <div className="approval-body">{children}</div>
    <div className="approval-btn-group">{footer}</div>
  </div>
);

const CommandApprovalCard: React.FC<{
  request: PendingServerRequest;
  onRespond: (id: any, result: any) => void;
  onRespondError: (id: any, message: string) => void;
}> = ({ request, onRespond, onRespondError }) => {
  const params = (request.params ?? {}) as CommandExecutionRequestApprovalParams;
  const [rememberExec, setRememberExec] = useState(false);
  const command = describeCommand(params);
  const cwd = params.cwd || "";
  const reason = params.reason || "";
  const network = params.networkApprovalContext;
  const amendment = params.proposedExecpolicyAmendment;
  const networkAmendments = params.proposedNetworkPolicyAmendments || [];

  const answer = (decision: CommandExecutionApprovalDecision) =>
    onRespond(request.id, commandApprovalResponse(decision));

  return (
    <CardShell
      title={params.kind === "writeStdin" ? "需要确认终端输入" : "需要批准命令执行"}
      subtitle={reason || "Codex 请求在当前工作区运行命令"}
      footer={
        <>
          <button
            type="button"
            className="btn-approve"
            onClick={() => {
              if (rememberExec && amendment?.length) {
                answer({ acceptWithExecpolicyAmendment: { execpolicy_amendment: amendment } });
              } else {
                answer("accept");
              }
            }}
          >
            <CheckIcon size={14} /> 允许一次
          </button>
          <button
            type="button"
            className="btn-session"
            onClick={() => answer("acceptForSession")}
          >
            本会话允许
          </button>
          {networkAmendments.length > 0 && (
            <>
              <button
                type="button"
                className="btn-session"
                onClick={() =>
                  answer({
                    applyNetworkPolicyAmendment: {
                      network_policy_amendment: networkAmendments[0],
                    },
                  })
                }
              >
                记住该主机策略
              </button>
            </>
          )}
          <button type="button" className="btn-decline" onClick={() => answer("decline")}>
            拒绝
          </button>
          <button type="button" className="btn-cancel" onClick={() => answer("cancel")}>
            <CloseIcon size={14} /> 拒绝并中断
          </button>
        </>
      }
    >
      {command && (
        <div className="approval-command-block">
          <code>
            <span className="shell-prompt">$</span> {command}
          </code>
        </div>
      )}
      {cwd && (
        <div className="approval-meta-line">
          <span className="approval-meta-label">工作目录</span>
          <span className="mono ellipsis" title={cwd}>
            {cwd}
          </span>
        </div>
      )}
      {network && (
        <div className="approval-meta-line">
          <span className="approval-meta-label">网络访问</span>
          <span className="mono">
            {network.protocol}://{network.host}
          </span>
        </div>
      )}
      {reason && <div className="approval-reason">{reason}</div>}
      {amendment && amendment.length > 0 && (
        <label className="approval-checkbox-row">
          <input
            type="checkbox"
            checked={rememberExec}
            onChange={(e) => setRememberExec(e.target.checked)}
          />
          <span>
            记住此规则（{amendment.join(" ")}），以后同类命令不再询问
          </span>
        </label>
      )}
    </CardShell>
  );
};

const FileChangeApprovalCard: React.FC<{
  request: PendingServerRequest;
  onRespond: (id: any, result: any) => void;
  onRespondError: (id: any, message: string) => void;
}> = ({ request, onRespond }) => {
  const params = (request.params ?? {}) as FileChangeRequestApprovalParams;
  return (
    <CardShell
      icon={<DiffIcon size={18} />}
      title="需要批准文件变更"
      subtitle={params.reason || "Codex 请求在工作区写入文件"}
      footer={
        <>
          <button
            type="button"
            className="btn-approve"
            onClick={() => onRespond(request.id, fileChangeApprovalResponse("accept"))}
          >
            <CheckIcon size={14} /> 允许本次变更
          </button>
          <button
            type="button"
            className="btn-session"
            onClick={() => onRespond(request.id, fileChangeApprovalResponse("acceptForSession"))}
          >
            本会话始终允许
          </button>
          <button
            type="button"
            className="btn-decline"
            onClick={() => onRespond(request.id, fileChangeApprovalResponse("decline"))}
          >
            拒绝
          </button>
          <button
            type="button"
            className="btn-cancel"
            onClick={() => onRespond(request.id, fileChangeApprovalResponse("cancel"))}
          >
            <CloseIcon size={14} /> 拒绝并中断
          </button>
        </>
      }
    >
      {params.grantRoot && (
        <div className="approval-meta-line">
          <span className="approval-meta-label">额外写入根目录</span>
          <span className="mono ellipsis" title={params.grantRoot}>
            {params.grantRoot}
          </span>
        </div>
      )}
      <div className="approval-hint">
        变更内容会显示在本轮 diff 中，可在右侧「变更」面板审阅后再决定。
      </div>
    </CardShell>
  );
};

function describePermissionPath(path: any): string {
  if (!path) return "";
  if (typeof path === "string") return path;
  if (path.type === "path") return String(path.path ?? "");
  if (path.type === "glob_pattern") return String(path.pattern ?? "");
  if (path.type === "special") return `special:${JSON.stringify(path.value ?? "")}`;
  return JSON.stringify(path);
}

const PermissionsApprovalCard: React.FC<{
  request: PendingServerRequest;
  onRespond: (id: any, result: any) => void;
  onRespondError: (id: any, message: string) => void;
}> = ({ request, onRespond }) => {
  const params = (request.params ?? {}) as PermissionsRequestApprovalParams;
  const [scope, setScope] = useState<"turn" | "session">("turn");
  const [strictAutoReview, setStrictAutoReview] = useState(false);
  const fsPerms = params.permissions?.fileSystem;
  const netPerms = params.permissions?.network;

  const entries = useMemo(() => {
    const list: Array<{ access: string; path: string }> = [];
    for (const entry of fsPerms?.entries || []) {
      list.push({ access: entry.access, path: describePermissionPath(entry.path) });
    }
    for (const p of fsPerms?.read || []) list.push({ access: "read", path: p });
    for (const p of fsPerms?.write || []) list.push({ access: "write", path: p });
    return list;
  }, [params]);

  return (
    <CardShell
      icon={<HandApprovalIcon size={18} />}
      title="需要额外权限"
      subtitle={params.reason || "Codex 请求本次任务所需的额外文件系统 / 网络权限"}
      footer={
        <>
          <div className="approval-scope-toggle">
            <button
              type="button"
              className={scope === "turn" ? "active" : ""}
              onClick={() => setScope("turn")}
            >
              仅本次任务
            </button>
            <button
              type="button"
              className={scope === "session" ? "active" : ""}
              onClick={() => setScope("session")}
            >
              整个会话
            </button>
          </div>
          <label className="approval-checkbox-row inline">
            <input
              type="checkbox"
              checked={strictAutoReview}
              onChange={(e) => setStrictAutoReview(e.target.checked)}
            />
            <span>严格审查后续命令</span>
          </label>
          <button
            type="button"
            className="btn-approve"
            onClick={() =>
              onRespond(
                request.id,
                permissionsApprovalResponse(params, scope, true, strictAutoReview)
              )
            }
          >
            <CheckIcon size={14} /> 授予权限
          </button>
          <button
            type="button"
            className="btn-decline"
            onClick={() => onRespond(request.id, permissionsApprovalResponse(params, scope, false))}
          >
            拒绝
          </button>
        </>
      }
    >
      {params.cwd && (
        <div className="approval-meta-line">
          <span className="approval-meta-label">工作目录</span>
          <span className="mono ellipsis" title={params.cwd}>
            {params.cwd}
          </span>
        </div>
      )}
      {entries.length > 0 && (
        <div className="approval-perm-list">
          <span className="approval-meta-label">文件系统</span>
          {entries.map((entry, idx) => (
            <div key={idx} className={`perm-row perm-${entry.access}`}>
              <span className="perm-badge">{entry.access}</span>
              <span className="mono ellipsis" title={entry.path}>
                {entry.path}
              </span>
            </div>
          ))}
        </div>
      )}
      {netPerms?.enabled != null && (
        <div className="approval-perm-list">
          <span className="approval-meta-label">网络</span>
          <div className={`perm-row ${netPerms.enabled ? "perm-write" : "perm-deny"}`}>
            <span className="perm-badge">{netPerms.enabled ? "allow" : "deny"}</span>
            <span>网络访问</span>
          </div>
        </div>
      )}
    </CardShell>
  );
};

const UserInputCard: React.FC<{
  request: PendingServerRequest;
  onRespond: (id: any, result: any) => void;
}> = ({ request, onRespond }) => {
  const params = (request.params ?? {}) as ToolRequestUserInputParams;
  const questions: ToolRequestUserInputQuestion[] = Array.isArray(params.questions)
    ? params.questions
    : [];
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [freeform, setFreeform] = useState<Record<string, string>>({});
  const [focused, setFocused] = useState(0);

  const pick = (question: ToolRequestUserInputQuestion, label: string) => {
    setAnswers((prev) => ({ ...prev, [question.id]: [label] }));
    setFocused(questions.findIndex((q) => q.id === question.id));
  };

  const submit = () => {
    const payload: Record<string, string[]> = {};
    for (const q of questions) {
      const custom = (freeform[q.id] || "").trim();
      if (custom) payload[q.id] = [custom];
      else if (answers[q.id]?.length) payload[q.id] = answers[q.id];
    }
    onRespond(request.id, userInputResponse(payload));
  };

  const canSubmit = questions.some((q) => (freeform[q.id] || "").trim() || answers[q.id]?.length);

  return (
    <CardShell
      tone="info"
      icon={<ShieldIcon size={18} />}
      title={questions.length > 1 ? `Codex 提问（${questions.length} 项）` : "Codex 需要您的确认"}
      subtitle={params.isBlocking === false ? "选择或输入后继续" : "回答后任务将继续执行"}
      footer={
        <>
          <button
            type="button"
            className="btn-approve"
            disabled={!canSubmit}
            onClick={submit}
          >
            <CheckIcon size={14} /> 发送答复
          </button>
          <button
            type="button"
            className="btn-decline"
            onClick={() => onRespond(request.id, { answers: {} })}
          >
            跳过
          </button>
        </>
      }
    >
      <div className="question-stack">
        {questions.map((q, idx) => {
          const selected = answers[q.id]?.[0] || freeform[q.id] || "";
          return (
            <div
              key={q.id || idx}
              className={`question-block ${focused === idx ? "focused" : ""}`}
              onFocus={() => setFocused(idx)}
            >
              {q.header && <div className="question-header">{q.header}</div>}
              <div className="question-text">{q.question}</div>
              {Array.isArray(q.options) && q.options.length > 0 && (
                <div className="question-options-list">
                  {q.options.map((opt, oIdx) => {
                    const label = opt?.label ?? String(opt);
                    const isActive = answers[q.id]?.[0] === label;
                    return (
                      <button
                        key={oIdx}
                        type="button"
                        className={`question-opt-btn ${isActive ? "selected" : ""}`}
                        onClick={() => pick(q, label)}
                        title={opt?.description || ""}
                      >
                        <span className="question-opt-label">{label}</span>
                        {opt?.description && (
                          <span className="question-opt-desc">{opt.description}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {(q.isOther !== false || !q.options?.length) && (
                <input
                  className="question-freeform-input"
                  type={q.isSecret ? "password" : "text"}
                  placeholder={
                    q.isSecret ? "输入保密内容…" : q.options?.length ? "或输入自定义答复…" : "输入答复…"
                  }
                  value={freeform[q.id] || ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    setFreeform((prev) => ({ ...prev, [q.id]: value }));
                    if (value) {
                      setAnswers((prev) => {
                        const next = { ...prev };
                        delete next[q.id];
                        return next;
                      });
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submit();
                    }
                  }}
                />
              )}
              {selected && <div className="question-selected-hint">已选择：{selected}</div>}
            </div>
          );
        })}
      </div>
    </CardShell>
  );
};

const GenericRequestCard: React.FC<{
  request: PendingServerRequest;
  onRespond: (id: any, result: any) => void;
  onRespondError: (id: any, message: string) => void;
}> = ({ request, onRespond, onRespondError }) => {
  const isOptionPicker = request.method === "item/tool/requestOptionPicker";
  const options: any[] = Array.isArray(request.params?.options) ? request.params.options : [];
  return (
    <CardShell
      tone="info"
      icon={<ShieldIcon size={18} />}
      title={isOptionPicker ? "Codex 需要选择" : "需要响应请求"}
      subtitle={request.method}
      footer={
        isOptionPicker ? (
          <>
            {options.slice(0, 4).map((opt: any, idx: number) => {
              const label = opt?.label ?? opt?.title ?? opt?.id ?? `选项 ${idx + 1}`;
              return (
                <button
                  key={idx}
                  type="button"
                  className="btn-approve"
                  onClick={() =>
                    onRespond(request.id, {
                      action: "select",
                      selectedOptions: [String(opt?.id ?? label)],
                      freeformAnswer: null,
                    })
                  }
                >
                  {label}
                </button>
              );
            })}
            <button
              type="button"
              className="btn-decline"
              onClick={() =>
                onRespond(request.id, {
                  action: "dismiss",
                  selectedOptions: [],
                  freeformAnswer: null,
                })
              }
            >
              取消
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn-approve"
              onClick={() => onRespond(request.id, {})}
            >
              确认
            </button>
            <button
              type="button"
              className="btn-decline"
              onClick={() => onRespondError(request.id, "User declined request")}
            >
              拒绝
            </button>
          </>
        )
      }
    >
      <pre className="approval-raw-json">
        {JSON.stringify(request.params ?? {}, null, 2)}
      </pre>
    </CardShell>
  );
};
