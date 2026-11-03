import React, { useState } from "react";
import { BellIcon, CheckIcon, AutomationIcon, ShieldIcon, CloseIcon } from "./Icons";
import { InboxNotificationItem } from "../types";

export interface InboxViewProps {
  items: InboxNotificationItem[];
  loadError?: string | null;
  onRetryLoad?: () => void;
  onMarkAllRead: () => void;
  onClearAll?: () => void;
  onDeleteItem?: (id: string, e: React.MouseEvent) => void;
  onToggleRead?: (id: string, e: React.MouseEvent) => void;
  onSelectNotification: (item: InboxNotificationItem) => void;
  onNavigateScheduled?: () => void;
}

export const InboxView: React.FC<InboxViewProps> = ({
  items,
  loadError,
  onRetryLoad,
  onMarkAllRead,
  onClearAll,
  onDeleteItem,
  onToggleRead,
  onSelectNotification,
  onNavigateScheduled,
}) => {
  const [filter, setFilter] = useState<"all" | "unread" | "automation" | "approval">("all");

  const visibleItems = items.filter((i) => {
    if (filter === "unread") return !i.read;
    if (filter === "automation") return i.kind === "automation";
    if (filter === "approval") return i.kind === "approval";
    return true;
  });

  return (
    <div className="full-route-view">
      <div className="full-route-container">
        <div className="full-route-header">
          <div>
            <h1 className="full-route-title">动态与收件箱</h1>
            <p className="full-route-subtitle">
              查看计划任务运行报告、后台完成的会话以及待处理的审批提醒。
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="effort-segmented-bar" style={{ minWidth: 320 }}>
              <button
                type="button"
                className={`effort-segment-btn ${filter === "all" ? "active" : ""}`}
                onClick={() => setFilter("all")}
              >
                全部 ({items.length})
              </button>
              <button
                type="button"
                className={`effort-segment-btn ${filter === "unread" ? "active" : ""}`}
                onClick={() => setFilter("unread")}
              >
                未读 ({items.filter((i) => !i.read).length})
              </button>
              <button
                type="button"
                className={`effort-segment-btn ${filter === "automation" ? "active" : ""}`}
                onClick={() => setFilter("automation")}
              >
                自动化
              </button>
              <button
                type="button"
                className={`effort-segment-btn ${filter === "approval" ? "active" : ""}`}
                onClick={() => setFilter("approval")}
              >
                审批
              </button>
            </div>
            {onNavigateScheduled && (
              <button
                type="button"
                className="secondary-pill-action-btn"
                onClick={onNavigateScheduled}
                title="查看已排期自动化任务列表"
              >
                <AutomationIcon size={13} />
                <span>已排期任务 (Scheduled)</span>
              </button>
            )}
            {items.some((i) => !i.read) && (
              <button
                type="button"
                className="secondary-pill-action-btn"
                onClick={onMarkAllRead}
                title="将所有通知标记为已读"
              >
                <CheckIcon size={13} />
                <span>全部已读</span>
              </button>
            )}
            {onClearAll && items.length > 0 && (
              <button
                type="button"
                className="secondary-pill-action-btn"
                onClick={onClearAll}
                title="清空所有收件箱通知"
              >
                <CloseIcon size={13} />
                <span>清空通知</span>
              </button>
            )}
          </div>
        </div>

        {loadError && (
          <div role="alert">
            {loadError}
            <button type="button" onClick={onRetryLoad}>重试读取通知</button>
          </div>
        )}
        {visibleItems.length === 0 ? (
          <div className="route-empty-state">
            <BellIcon size={32} />
            <h3>{filter === "unread" ? "没有未读通知" : "暂无相关通知"}</h3>
            <p>当计划任务完成运行或后台会话需要你批准时，你会在此收到通知。</p>
          </div>
        ) : (
          <div className="inbox-list">
            {visibleItems.map((item) => (
              <div
                key={item.id}
                className={`inbox-item-row ${!item.read ? "unread" : ""}`}
                onClick={() => onSelectNotification(item)}
              >
                <div className="inbox-item-icon">
                  {item.kind === "automation" ? (
                    <AutomationIcon size={16} />
                  ) : item.kind === "approval" ? (
                    <ShieldIcon size={16} />
                  ) : (
                    <BellIcon size={16} />
                  )}
                </div>
                <div className="inbox-item-body">
                  <div className="inbox-item-title-row">
                    <span className="inbox-item-title">{item.title}</span>
                    {!item.read && <span className="inbox-unread-pill">未读</span>}
                  </div>
                  <span className="inbox-item-subtitle">{item.subtitle}</span>
                </div>
                <div className="inbox-item-right" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="inbox-item-time">
                    {new Date(item.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {onToggleRead && (
                    <button
                      type="button"
                      className="thread-icon-btn"
                      title={item.read ? "标为未读" : "标为已读"}
                      onClick={(e) => onToggleRead(item.id, e)}
                    >
                      <CheckIcon size={12} />
                    </button>
                  )}
                  {onDeleteItem && (
                    <button
                      type="button"
                      className="thread-icon-btn danger"
                      title="删除此通知"
                      onClick={(e) => onDeleteItem(item.id, e)}
                    >
                      <CloseIcon size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
