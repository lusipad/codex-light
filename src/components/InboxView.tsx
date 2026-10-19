import React, { useState } from "react";
import { BellIcon, CheckIcon, AutomationIcon, ShieldIcon } from "./Icons";
import { InboxNotificationItem } from "../types";

export interface InboxViewProps {
  items: InboxNotificationItem[];
  onMarkAllRead: () => void;
  onSelectNotification: (item: InboxNotificationItem) => void;
}

export const InboxView: React.FC<InboxViewProps> = ({
  items,
  onMarkAllRead,
  onSelectNotification,
}) => {
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const visibleItems =
    filter === "unread" ? items.filter((i) => !i.read) : items;

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
            <div className="effort-segmented-bar" style={{ width: 180 }}>
              <button
                type="button"
                className={`effort-segment-btn ${filter === "all" ? "active" : ""}`}
                onClick={() => setFilter("all")}
              >
                全部通知
              </button>
              <button
                type="button"
                className={`effort-segment-btn ${filter === "unread" ? "active" : ""}`}
                onClick={() => setFilter("unread")}
              >
                仅显示未读
              </button>
            </div>
            <button
              type="button"
              className="secondary-pill-action-btn"
              onClick={onMarkAllRead}
            >
              <CheckIcon size={13} />
              <span>全部标记为已读</span>
            </button>
          </div>
        </div>

        {visibleItems.length === 0 ? (
          <div className="route-empty-state">
            <BellIcon size={32} />
            <h3>{filter === "unread" ? "没有未读通知" : "暂无通知"}</h3>
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
                <span className="inbox-item-time">
                  {new Date(item.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
