import React, { useEffect, useRef, useState } from "react";
import type { PetPreferencesState } from "../petPreferences";
import { tauriInvoke } from "../bridge";
import { PET_SPECIES_LIST } from "../types";
import { PetSprite } from "./PetSprite";

export function PetsSettings({ state, visible, onSetVisible }: {
  state: PetPreferencesState; visible: boolean; onSetVisible: (visible: boolean) => void;
}) {
  const { preferences, pets, ready, busy, error, save, load } = state;
  const [folderError, setFolderError] = useState<string | null>(null);
  const folderGeneration = useRef(0);
  useEffect(() => () => { folderGeneration.current++; }, []);
  const [sizeDraft, setSizeDraft] = useState(preferences.petSize);
  useEffect(() => { setSizeDraft(preferences.petSize); }, [preferences.petSize]);
  const selected = preferences.selectedAvatarId ?? "codex";
  const unavailable = !PET_SPECIES_LIST.some(pet => pet.id === selected) && !pets.some(pet => pet.id === selected);
  return <div className="settings-scroll-container">
    <div className="card-section">
      <h3>Mini 与宠物</h3>
      <p className="card-subtitle-desc">当前 Mini 显示在应用内；官方独立桌面窗口和云端宠物创建尚未接入。</p>
      <button type="button" className="secondary-btn" disabled={!ready || busy} onClick={() => onSetVisible(!visible)}>{visible ? "隐藏 Mini" : "显示 Mini"}</button>
    </div>
    {error && <div role="alert" className="error-banner">{error}</div>}
    {busy && <p role="status">正在读取或保存宠物设置…</p>}
    <div className="card-section">
      <label>可见模式
        <select disabled={!ready || busy} value={preferences.petVisibility}
          onChange={event => save({ petVisibility: event.target.value as "always-visible" | "on-demand" })}>
          <option value="always-visible">始终可见</option>
          <option value="on-demand">按需显示，点击外部时隐藏</option>
        </select>
      </label>
      <label htmlFor="pet-size">宠物大小</label>
      <input id="pet-size" type="range" min={80} max={224} step={1} value={sizeDraft} disabled={!ready || busy}
        onChange={event => setSizeDraft(Number(event.target.value))}
        onPointerUp={event => save({ petSize: Number(event.currentTarget.value) })}
        onKeyUp={event => save({ petSize: Number(event.currentTarget.value) })}
        onBlur={event => save({ petSize: Number(event.currentTarget.value) })} />
      <span>{sizeDraft} px</span>
      <button type="button" className="secondary-btn" disabled={!ready || busy} onClick={() => { setSizeDraft(112); return save({ petSize: 112 }); }}>重置大小</button>
    </div>
    <div className="card-section">
      <h3>选择宠物</h3>
      {unavailable && <p role="alert">已选宠物当前不可用，请刷新或重新选择。</p>}
      {ready && !pets.length && <p>没有已安装的本地宠物。</p>}
      <div className="preset-cards-grid">
        {pets.map(pet => <button type="button" key={pet.id} className={`preset-template-card ${selected === pet.id ? "active" : ""}`}
          aria-pressed={selected === pet.id} disabled={!ready || busy} onClick={() => save({ selectedAvatarId: pet.id })}>
          <PetSprite spritesheetUrl={pet.spritesheetDataUrl} spriteVersionNumber={pet.spriteVersionNumber} size={48} />
          <strong>{pet.displayName}</strong><span>{pet.description}</span>
        </button>)}
      </div>
      <h4>本地表情回退</h4>
      <p className="card-subtitle-desc">以下表情不代表官方内置精灵资源。</p>
      {PET_SPECIES_LIST.map(pet => <button type="button" key={pet.id} className="secondary-btn" aria-pressed={selected === pet.id}
        disabled={!ready || busy} onClick={() => save({ selectedAvatarId: pet.id })}>{pet.emoji} {pet.name}</button>)}
    </div>
    <div className="card-section">
      <h3>自定义宠物</h3>
      <button type="button" className="secondary-btn" onClick={async () => {
        const version = folderGeneration.current;
        setFolderError(null);
        try { await tauriInvoke("pets_open_folder"); }
        catch (error) { if (version === folderGeneration.current) setFolderError(`无法打开宠物目录：${String(error)}`); }
      }}>打开本地宠物目录</button>
      <button type="button" className="secondary-btn" disabled={busy} onClick={load}>刷新本地资源和偏好</button>
      {folderError && <p role="alert">{folderError}</p>}
    </div>
  </div>;
}
