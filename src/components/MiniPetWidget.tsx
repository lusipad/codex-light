import React, { useState } from "react";
import { PetSpeciesId } from "../types";
import { PET_SPECIES_LIST } from "./SettingsView";
import { SendArrowIcon, XIcon } from "./Icons";

interface MiniPetWidgetProps {
  visible: boolean;
  species: PetSpeciesId;
  isStreaming: boolean;
  onChangeSpecies: (species: PetSpeciesId) => void;
  onQuickPrompt: (prompt: string) => void;
  onClose: () => void;
}

export const MiniPetWidget: React.FC<MiniPetWidgetProps> = ({
  visible,
  species,
  isStreaming,
  onChangeSpecies,
  onQuickPrompt,
  onClose,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [quickText, setQuickText] = useState("");
  const [pokedCount, setPokedCount] = useState(0);

  if (!visible) return null;

  const petMeta =
    PET_SPECIES_LIST.find((p) => p.id === species) || PET_SPECIES_LIST[0];

  const statusText = isStreaming
    ? "正在高速思考与编码中..."
    : pokedCount > 0
      ? `心情愉悦 (+${pokedCount} 互动)`
      : "待命值守中 · 点击召唤快捷栏";

  return (
    <div className={`mini-pet-widget ${expanded ? "expanded" : ""}`}>
      {expanded && (
        <div className="mini-pet-popover">
          <div className="mini-pet-popover-header">
            <div className="mini-pet-title">
              <span>{petMeta.emoji}</span>
              <strong>{petMeta.name}</strong>
              <span className="tag-badge accent">Mini Companion</span>
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setExpanded(false)}
              title="收起面板"
            >
              <XIcon size={12} />
            </button>
          </div>

          <p className="mini-pet-status-line">{statusText}</p>

          <div className="mini-pet-species-row">
            {PET_SPECIES_LIST.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`mini-pet-species-btn ${
                  p.id === species ? "active" : ""
                }`}
                onClick={() => onChangeSpecies(p.id)}
                title={`${p.name}: ${p.desc}`}
              >
                {p.emoji}
              </button>
            ))}
          </div>

          <div className="mini-pet-quick-input-row">
            <input
              type="text"
              placeholder="快速向 Codex 提问或下达指令..."
              value={quickText}
              onChange={(e) => setQuickText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && quickText.trim()) {
                  onQuickPrompt(quickText.trim());
                  setQuickText("");
                  setExpanded(false);
                }
              }}
            />
            <button
              type="button"
              className="send-circle-btn ready"
              onClick={() => {
                if (!quickText.trim()) return;
                onQuickPrompt(quickText.trim());
                setQuickText("");
                setExpanded(false);
              }}
            >
              <SendArrowIcon size={13} />
            </button>
          </div>

          <div className="mini-pet-footer-actions">
            <button
              type="button"
              className="mini-link-btn"
              onClick={() => setPokedCount((c) => c + 1)}
            >
              摸摸头 👋
            </button>
            <button
              type="button"
              className="mini-link-btn"
              onClick={() => {
                onQuickPrompt("@电脑 请检查当前桌面窗口状态并提供协助");
                setExpanded(false);
              }}
            >
              @电脑 桌面协助
            </button>
            <button
              type="button"
              className="mini-link-btn"
              style={{ marginLeft: "auto", color: "var(--text-tertiary)" }}
              onClick={onClose}
            >
              隐藏宠物
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        className={`mini-pet-avatar-btn ${isStreaming ? "streaming" : ""}`}
        onClick={() => setExpanded((v) => !v)}
        title={`${petMeta.name} (${statusText})`}
      >
        <span className="mini-pet-emoji">{petMeta.emoji}</span>
        {isStreaming && <span className="mini-pet-pulse-ring" />}
      </button>
    </div>
  );
};
