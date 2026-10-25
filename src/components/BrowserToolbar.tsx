import React, { useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  EllipsisIcon,
  ExternalWindowIcon,
  RefreshIcon,
  ShieldIcon,
} from "./Icons";
import "./BrowserToolbar.css";

export interface BrowserToolbarProps {
  currentUrl?: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload?: () => void;
  onNavigate: (url: string) => void;
  onClose: () => void;
  onNotify: (message: string) => void;
}

function normalizeNavigationInput(input: string): string {
  const query = input.trim();
  if (/^https?:\/\//i.test(query)) return query;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/.*)?$/i.test(query)) {
    return `http://${query}`;
  }
  if (/^[\w.-]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(query)) {
    return `https://${query}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function urlParts(url: string) {
  try {
    const parsed = new URL(url);
    return { protocol: parsed.protocol, host: parsed.host || "本地页面" };
  } catch {
    return { protocol: "未知", host: "未知" };
  }
}

export const BrowserToolbar: React.FC<BrowserToolbarProps> = ({
  currentUrl = "",
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onReload,
  onNavigate,
  onClose,
  onNotify,
}) => {
  const instanceId = useId().replace(/:/g, "");
  const siteTriggerRef = useRef<HTMLButtonElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const [addressInput, setAddressInput] = useState(currentUrl);
  const [sitePosition, setSitePosition] = useState({ top: 0, left: 0 });
  const [morePosition, setMorePosition] = useState({ top: 0, left: 0 });
  const parts = currentUrl ? urlParts(currentUrl) : null;

  useEffect(() => {
    setAddressInput(currentUrl);
  }, [currentUrl]);

  const positionPopover = (
    event: React.MouseEvent<HTMLButtonElement>,
    setter: (position: { top: number; left: number }) => void
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setter({ top: rect.bottom + 4, left: Math.max(8, rect.right - 320) });
  };

  const focusMenuItem = (event: React.SyntheticEvent<HTMLElement>) => {
    const toggle = event.nativeEvent as ToggleEvent;
    if (toggle.newState === "open") {
      requestAnimationFrame(() => {
        event.currentTarget.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
      });
    }
  };

  return (
    <div className="browser-nav-bar">
      <div className="browser-nav-buttons">
        <button type="button" className="browser-nav-btn" onClick={onBack} disabled={!canGoBack} title={canGoBack ? "后退" : "没有可后退的地址"} aria-label="后退">
          <ArrowLeftIcon size={14} />
        </button>
        <button type="button" className="browser-nav-btn" onClick={onForward} disabled={!canGoForward} title={canGoForward ? "前进" : "没有可前进的地址"} aria-label="前进">
          <ArrowRightIcon size={14} />
        </button>
        <button type="button" className="browser-nav-btn circle-btn" onClick={onReload} disabled={!onReload} title={onReload ? "重新加载" : "当前没有可刷新的网页"} aria-label="重新加载">
          <RefreshIcon size={13} />
        </button>
      </div>

      <form
        className="browser-address-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!addressInput.trim()) return;
          onNavigate(normalizeNavigationInput(addressInput));
        }}
      >
        <div className="browser-address-pill">
          <input
            type="text"
            className="browser-address-input"
            placeholder="搜索或输入网址"
            aria-label="搜索或输入网址"
            value={addressInput}
            onChange={(event) => setAddressInput(event.target.value)}
            spellCheck={false}
          />
          <div className="browser-address-trailing-actions">
            <button
              ref={siteTriggerRef}
              type="button"
              className="browser-address-icon-btn"
              title="查看站点信息"
              aria-label="查看站点信息"
              onClick={(event) => positionPopover(event, setSitePosition)}
              {...({ popovertarget: `${instanceId}-site` } as any)}
            >
              <ShieldIcon size={14} />
            </button>
            <button type="button" className="browser-address-icon-btn" disabled title="下载历史将在后续阶段提供" aria-label="下载（尚未接入）">
              <DownloadIcon size={14} />
            </button>
            <button
              ref={moreTriggerRef}
              type="button"
              className="browser-address-icon-btn"
              title="更多选项"
              aria-label="更多选项"
              onClick={(event) => positionPopover(event, setMorePosition)}
              {...({ popovertarget: `${instanceId}-more` } as any)}
            >
              <EllipsisIcon size={14} />
            </button>
          </div>
        </div>
      </form>

      <div
        id={`${instanceId}-site`}
        className="browser-info-popover"
        style={sitePosition}
        onToggle={focusMenuItem}
        {...({ popover: "auto" } as any)}
      >
        <h2>{parts ? "站点信息" : "新标签页"}</h2>
        {parts ? (
          <dl>
            <dt>地址</dt>
            <dd className="browser-info-url">{currentUrl}</dd>
            <dt>协议</dt>
            <dd>{parts.protocol}</dd>
            <dt>主机</dt>
            <dd>{parts.host}</dd>
          </dl>
        ) : (
          <p>内置工作区新标签页，没有加载远程站点。</p>
        )}
        <p className="browser-info-note">此处只展示可验证的地址信息，不代表站点安全评估。地址历史记录当前仅包含在此地址栏提交的导航。</p>
      </div>

      <div
        id={`${instanceId}-more`}
        className="browser-more-popover"
        role="menu"
        aria-label="浏览器更多选项"
        style={morePosition}
        onToggle={focusMenuItem}
        {...({ popover: "auto" } as any)}
      >
        <button
          type="button"
          role="menuitem"
          disabled={!currentUrl}
          onClick={async () => {
            await navigator.clipboard.writeText(currentUrl);
            onNotify("已复制页面地址");
            (document.getElementById(`${instanceId}-more`) as any)?.hidePopover?.();
          }}
        >
          <CopyIcon size={14} />
          <span>复制页面地址</span>
        </button>
        {currentUrl && (
          <a
            href={currentUrl}
            target="_blank"
            rel="noreferrer"
            role="menuitem"
            onClick={() => {
              (document.getElementById(`${instanceId}-more`) as any)?.hidePopover?.();
            }}
          >
            <ExternalWindowIcon size={14} />
            <span>在外部浏览器中打开</span>
          </a>
        )}
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            (document.getElementById(`${instanceId}-more`) as any)?.hidePopover?.();
            onClose();
          }}
        >
          <CloseIcon size={14} />
          <span>关闭当前标签页</span>
        </button>
      </div>
    </div>
  );
};
