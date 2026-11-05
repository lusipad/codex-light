import { useEffect, useState } from "react";
import { tauriInvoke } from "./bridge";
import { firstThemeFontFamily, type ThemeFontFace } from "./appearanceTheme";

export interface SystemFontFace { fullName: string; postscriptName: string; styleName: string; isMonospaced: boolean }
export interface SystemFontFamily { family: string; faces: SystemFontFace[] }
let directory: Promise<SystemFontFamily[] | null> | undefined;
export function useSystemFonts() {
  const [state, setState] = useState<{ pending: boolean; families: SystemFontFamily[] | null }>({ pending: true, families: null });
  useEffect(() => {
    let alive = true;
    directory ??= tauriInvoke<SystemFontFamily[]>("system_font_families").catch(() => null);
    void directory.then(families => { if (alive) setState({ pending: false, families }); });
    return () => { alive = false; };
  }, []);
  return state;
}
export function selectedSystemFont(value: string | null, face: ThemeFontFace | undefined, families: SystemFontFamily[] | null) {
  const family = families?.find(item => item.family.toLowerCase() === firstThemeFontFamily(value)?.toLowerCase());
  if (!family) return null;
  return { family, face: (face?.family.toLowerCase() === family.family.toLowerCase()
    ? family.faces.find(item => item.postscriptName === face.postscriptName) : undefined) ?? family.faces[0] };
}
export const fontFamilyAllowed = (family: SystemFontFamily, monospace: boolean) => !monospace || family.faces.every(face => face.isMonospaced);
