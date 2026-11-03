import React, { useState, useRef, useEffect } from "react";
import { PetSpeciesId, InstalledPetItem, PET_SPECIES_LIST } from "../types";
import { SendArrowIcon, SettingsIcon, XIcon, SparklesIcon } from "./Icons";
import { PetSprite } from "./PetSprite";

export interface MiniPetWidgetProps {
  visible: boolean;
  species: PetSpeciesId;
  size?: number;
  visibility?: "always-visible" | "on-demand";
  isStreaming: boolean;
  installedPets?: InstalledPetItem[];
  onQuickPrompt: (prompt: string) => Promise<boolean | undefined> | boolean | undefined;
  onOpenSettings?: (section: string) => void;
  onClose: () => void;
}

export const MiniPetWidget: React.FC<MiniPetWidgetProps> = ({
  visible,
  species,
  size = 112,
  visibility = "always-visible",
  isStreaming,
  installedPets = [],
  onQuickPrompt,
  onOpenSettings,
  onClose,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const generation = useRef(0);
  const draftRef = useRef(promptText);
  draftRef.current = promptText;

  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    if (!visible) { setExpanded(false); return; }
    if (visibility !== "on-demand") return;
    const outside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener("click", outside);
    return () => document.removeEventListener("click", outside);
  }, [visible, visibility, onClose]);

  // Focus input whenever Quick Chat expands
  useEffect(() => {
    if (expanded) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [expanded]);

  if (!visible) return null;

  const currentInstalled = installedPets.find((p) => p.id === species);
  const fallbackMeta = PET_SPECIES_LIST.find((p) => p.id === species);

  const petName = currentInstalled?.displayName || fallbackMeta?.name || "宠物不可用";
  const hasCustomSprite = Boolean(currentInstalled?.spritesheetDataUrl);

  const baseWidth = Math.round(Math.max(80, Math.min(size, 224)));

  const handleSend = async () => {
    const trimmed = promptText.trim();
    if (!trimmed || pending.current) return;
    pending.current = true;
    const version = generation.current;
    setSending(true); setSendError(null);
    try {
      const accepted = await onQuickPrompt(trimmed);
      if (version !== generation.current) return;
      if (accepted === true) {
        if (draftRef.current === promptText) { setPromptText(""); setExpanded(false); }
      } else {
        setSendError("发送结果未确认，输入已保留。请在会话中核对后再重试。");
      }
    } catch (error) {
      if (version === generation.current) setSendError(`发送失败，输入已保留：${String(error)}`);
    } finally {
      if (version === generation.current) { pending.current = false; setSending(false); }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!e.repeat) void handleSend();
    } else if (e.key === "Escape") {
      setExpanded(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="codex-mascot-container"
      data-testid="codex-mascot-container"
    >
      {/* ── Quick Chat Capsule (_QuickChatMaterial_1emyd_2) ── */}
      {expanded && (
        <div
          className="codex-quick-chat-capsule"
          data-testid="codex-quick-chat-capsule"
          data-avatar-overlay-material-variant="quick-chat"
        >
          <div className="quick-chat-leading-icon" title={petName}>
            <SparklesIcon size={15} />
          </div>

          <input
            ref={inputRef}
            type="text"
            className="quick-chat-input"
            placeholder="Ask Codex anything..."
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            onKeyDown={handleKeyDown}
          />

          <div className="quick-chat-actions">
            <button
              type="button"
              className={`quick-chat-send-btn ${promptText.trim() ? "ready" : "disabled"}`}
              onClick={handleSend}
              disabled={!promptText.trim() || sending}
              title="Send message (Enter)"
            >
              <SendArrowIcon size={14} />
            </button>

            {onOpenSettings && (
              <button
                type="button"
                className="quick-chat-icon-btn"
                onClick={() => {
                  onOpenSettings("pets");
                  setExpanded(false);
                }}
                title="Mini & Pets settings"
              >
                <SettingsIcon size={14} />
              </button>
            )}

            <button
              type="button"
              className="quick-chat-icon-btn"
              onClick={() => setExpanded(false)}
              title="Close Quick Chat (Esc)"
            >
              <XIcon size={13} />
            </button>
          </div>
          {sendError && <span role="alert">{sendError}</span>}
        </div>
      )}

      {/* ── Mascot Button & Floating Activity Badge ── */}
      <div className="codex-mascot-wrapper">
        {/* Activity / Notification Badge */}
        {isStreaming && (
          <div
            className="mascot-notification-badge running"
            data-avatar-overlay-native-surface-id="mascot-badge"
            onClick={() => setExpanded(true)}
            title="Codex is working..."
          >
            <span className="mascot-badge-dot" />
            <span className="mascot-badge-text">Working...</span>
          </div>
        )}

        {/* The Sprite Character Button */}
        <button
          type="button"
          className="codex-avatar-button"
          data-testid="avatar-mascot-button"
          onClick={() => setExpanded((prev) => !prev)}
          title={`${petName} · Click to open Quick Chat`}
          style={{ width: baseWidth }}
        >
          {hasCustomSprite ? (
            <PetSprite
              spritesheetUrl={currentInstalled!.spritesheetDataUrl}
              spriteVersionNumber={currentInstalled!.spriteVersionNumber}
              size={baseWidth}
              state={isStreaming ? "running" : "idle"}
              respondToHover
              trackCursor
            />
          ) : (
            <div className="codex-avatar-fallback">
              {fallbackMeta ? <span className="avatar-fallback-emoji">{fallbackMeta.emoji}</span> : <span role="alert">宠物不可用</span>}
            </div>
          )}
          <div className="codex-mascot-ground-shadow" />
        </button>
      </div>
    </div>
  );
};
