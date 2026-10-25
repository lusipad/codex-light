import React, { useState, useRef, useEffect } from "react";
import { PetSpeciesId, InstalledPetItem, PET_SPECIES_LIST } from "../types";
import { SendArrowIcon, SettingsIcon, XIcon, SparklesIcon } from "./Icons";
import { PetSprite } from "./PetSprite";

export interface MiniPetWidgetProps {
  visible: boolean;
  species: PetSpeciesId;
  scale?: number;
  isStreaming: boolean;
  installedPets?: InstalledPetItem[];
  onQuickPrompt: (prompt: string) => void;
  onOpenSettings?: (section: string) => void;
  onClose: () => void;
}

export const MiniPetWidget: React.FC<MiniPetWidgetProps> = ({
  visible,
  species,
  scale = 1.0,
  isStreaming,
  installedPets = [],
  onQuickPrompt,
  onOpenSettings,
  onClose,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [promptText, setPromptText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input whenever Quick Chat expands
  useEffect(() => {
    if (expanded) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [expanded]);

  if (!visible) return null;

  const currentInstalled = installedPets.find((p) => p.id === species);
  const fallbackMeta =
    PET_SPECIES_LIST.find((p) => p.id === species) || PET_SPECIES_LIST[0];

  const petName = currentInstalled?.displayName || fallbackMeta.name;
  const hasCustomSprite = Boolean(currentInstalled?.spritesheetDataUrl);

  const baseWidth = Math.round(68 * Math.max(0.6, Math.min(scale, 1.8)));

  const handleSend = () => {
    const trimmed = promptText.trim();
    if (!trimmed) return;
    onQuickPrompt(trimmed);
    setPromptText("");
    setExpanded(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === "Escape") {
      setExpanded(false);
    }
  };

  return (
    <div
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
              disabled={!promptText.trim()}
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
              size={baseWidth}
              state={isStreaming ? "running" : "idle"}
              respondToHover
              trackCursor
            />
          ) : (
            <div className="codex-avatar-fallback">
              <span className="avatar-fallback-emoji">{fallbackMeta.emoji}</span>
            </div>
          )}
          <div className="codex-mascot-ground-shadow" />
        </button>
      </div>
    </div>
  );
};
