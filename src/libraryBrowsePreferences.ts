import type { ServiceIdentity } from "./chatgptService";
import { decodeLibraryBrowsePreferences, libraryBrowsePreferenceKey, type LibraryBrowsePreferences } from "./libraryBrowse";

// Equivalent WebView persistence; the official host's injected storage wrapper
// is not copied. Preserve unrelated display fields when changing our two fields.
export function readLibraryBrowsePreferences(identity: ServiceIdentity): LibraryBrowsePreferences {
  const key = libraryBrowsePreferenceKey(identity);
  if (!key) return decodeLibraryBrowsePreferences(null);
  try { return decodeLibraryBrowsePreferences(JSON.parse(localStorage.getItem(key) ?? "null")); }
  catch { return decodeLibraryBrowsePreferences(null); }
}

export function writeLibraryBrowsePreferences(identity: ServiceIdentity, patch: Partial<LibraryBrowsePreferences>): boolean {
  const key = libraryBrowsePreferenceKey(identity);
  if (!key) return true;
  try {
    let stored: unknown;
    try { stored = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { stored = null; }
    const previous = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    localStorage.setItem(key, JSON.stringify({ ...previous, ...patch }));
    return true;
  } catch { return false; }
}
