import { useEffect, useRef, useState } from "react";
import { tauriInvoke } from "./bridge";
import type { InstalledPetItem } from "./types";

export interface PetPreferences {
  selectedAvatarId: string | null;
  petSize: number;
  petVisibility: "always-visible" | "on-demand";
}

export function parsePetPreferences(value: unknown): PetPreferences {
  const data = value as PetPreferences | null;
  if (!data || !(data.selectedAvatarId === null || (typeof data.selectedAvatarId === "string" && data.selectedAvatarId.trim())) ||
    !Number.isInteger(data.petSize) || data.petSize < 80 || data.petSize > 224 ||
    !["always-visible", "on-demand"].includes(data.petVisibility)) throw Error("宠物偏好响应格式无效");
  return { selectedAvatarId: data.selectedAvatarId, petSize: data.petSize, petVisibility: data.petVisibility };
}

async function readPets() {
  const pets = await tauriInvoke<InstalledPetItem[]>("pets_list_installed");
  if (!Array.isArray(pets) || pets.some(pet => !pet || typeof pet.id !== "string" ||
    !pet.id || typeof pet.displayName !== "string" || !pet.spritesheetDataUrl ||
    ![1, 2].includes(pet.spriteVersionNumber)) || new Set(pets.map(pet => pet.id)).size !== pets.length) {
    throw Error("本地宠物列表格式无效");
  }
  await Promise.all(pets.map(pet => new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const height = pet.spriteVersionNumber === 2 ? 2288 : 1872;
      if (image.naturalWidth === 1536 && image.naturalHeight === height) resolve();
      else reject(Error(`${pet.displayName} 的精灵帧尺寸无效`));
    };
    image.onerror = () => reject(Error(`${pet.displayName} 的精灵图无法解码`));
    if (!/^data:image\/(?:png|webp);base64,/.test(pet.spritesheetDataUrl!)) reject(Error("不支持的精灵图来源"));
    else image.src = pet.spritesheetDataUrl!;
  })));
  return pets;
}

export function usePetPreferences() {
  const [preferences, setPreferences] = useState<PetPreferences>({
    selectedAvatarId: null, petSize: 112, petVisibility: "always-visible",
  });
  const [pets, setPets] = useState<InstalledPetItem[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const generation = useRef(0);
  const load = async () => {
    if (pending.current) return;
    pending.current = true;
    const version = generation.current;
    setBusy(true); setReady(false); setError(null);
    try {
      const [stored, assets] = await Promise.all([tauriInvoke("pet_preferences_get"), readPets()]);
      const parsed = parsePetPreferences(stored);
      if (version !== generation.current) return;
      setPreferences(parsed); setPets(assets); setReady(true);
    } catch (error) {
      if (version === generation.current) setError(`读取宠物设置失败：${String(error)}`);
    } finally {
      if (version === generation.current) { pending.current = false; setBusy(false); }
    }
  };
  useEffect(() => {
    void load();
    return () => { generation.current++; pending.current = false; };
  }, []);
  const save = async (patch: Partial<PetPreferences>) => {
    if (pending.current || !ready) return false;
    if ((Object.keys(patch) as (keyof PetPreferences)[]).every(key => patch[key] === preferences[key])) return true;
    pending.current = true;
    const version = generation.current;
    setBusy(true); setError(null);
    try {
      parsePetPreferences({ ...preferences, ...patch });
      if (patch.selectedAvatarId != null && !["codex", "rocky"].includes(patch.selectedAvatarId)) {
        const assets = await readPets();
        if (!assets.some(pet => pet.id === patch.selectedAvatarId)) throw Error("所选宠物已不可用，请刷新本地资源。");
      }
      const result = parsePetPreferences(await tauriInvoke("pet_preferences_update", { patch }));
      const readback = parsePetPreferences(await tauriInvoke("pet_preferences_get"));
      for (const key of Object.keys(patch) as (keyof PetPreferences)[]) {
        if (readback[key] !== patch[key] || result[key] !== patch[key]) throw Error("保存后读回与提交值不同");
      }
      if (version !== generation.current) return false;
      setPreferences(readback); return true;
    } catch (error) {
      if (version === generation.current) { setError(`保存未确认，请重新读取后核对：${String(error)}`); setReady(false); }
      return false;
    } finally {
      if (version === generation.current) { pending.current = false; setBusy(false); }
    }
  };
  return { preferences, pets, ready, busy, error, load, save };
}
export type PetPreferencesState = ReturnType<typeof usePetPreferences>;
