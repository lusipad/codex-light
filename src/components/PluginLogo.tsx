import React, { useEffect, useState } from "react";
import type { PluginSummary } from "../plugins";
import { base64ToBytes, getMetadata, joinFsPath, readFileBase64 } from "../fsClient";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
type LogoPlugin = Pick<PluginSummary, "id" | "interface" | "remotePluginId"> & Partial<Pick<PluginSummary, "source">>;
type LogoCandidate = { kind: "url" | "file"; value: string };
const absolutePath = (value: string) => /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+|\/)/i.test(value);

function httpsUrl(value?: string | null): string | null {
  if (!value || /[\x00-\x20]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function localPath(plugin: LogoPlugin, value?: string | null): string | null {
  if (!value || /[\x00-\x1f]/.test(value) || /^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return null;
  if (absolutePath(value)) return value;
  if (plugin.source?.type !== "local" || !absolutePath(plugin.source.path)) return null;
  const segments = value.split(/[\\/]/);
  if (segments.some(segment => !segment || segment === ".." || segment.includes(":"))) return null;
  return segments.filter(segment => segment !== ".").reduce((path, segment) => joinFsPath(path, segment), plugin.source.path);
}

export function pluginLogoCandidates(plugin: LogoPlugin, dark: boolean): LogoCandidate[] {
  const info = plugin.interface;
  if (!info) return [];
  const variants = dark ? [[info.logoUrlDark, info.logoDark], [info.logoUrl, info.logo]] : [[info.logoUrl, info.logo], [info.logoUrlDark, info.logoDark]];
  const result: LogoCandidate[] = [];
  for (const [urlValue, pathValue] of variants) {
    const url = httpsUrl(urlValue), path = localPath(plugin, pathValue);
    if (url) result.push({ kind: "url", value: url });
    if (path) result.push({ kind: "file", value: path });
  }
  return result.filter((candidate, index) => result.findIndex(other => other.kind === candidate.kind && other.value === candidate.value) === index);
}

export function pluginLogoMime(bytes: Uint8Array): string | null {
  if (!bytes.length || bytes.length > MAX_LOGO_BYTES) return null;
  const matches = (offset: number, values: number[]) => values.every((value, index) => bytes[offset + index] === value);
  if (bytes.length >= 29 && matches(0, [137, 80, 78, 71, 13, 10, 26, 10]) && matches(8, [0, 0, 0, 13, 73, 72, 68, 82])) return "image/png";
  if (bytes.length >= 4 && matches(0, [255, 216, 255]) && matches(bytes.length - 2, [255, 217])) return "image/jpeg";
  if (bytes.length >= 13 && (matches(0, [71, 73, 70, 56, 55, 97]) || matches(0, [71, 73, 70, 56, 57, 97]))) return "image/gif";
  if (bytes.length >= 20 && matches(0, [82, 73, 70, 70]) && matches(8, [87, 69, 66, 80])) {
    const declared = bytes[4] + bytes[5] * 256 + bytes[6] * 65536 + bytes[7] * 16777216;
    if (declared + 8 === bytes.length) return "image/webp";
  }
  return null;
}

function darkTheme() {
  const theme = document.documentElement.getAttribute("data-theme");
  return theme === "dark" || theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function usePluginLogoSource(plugin: LogoPlugin) {
  const [dark, setDark] = useState(darkTheme);
  useEffect(() => {
    const update = () => setDark(darkTheme());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    update();
    return () => { observer.disconnect(); media.removeEventListener("change", update); };
  }, []);
  const candidates = pluginLogoCandidates(plugin, dark);
  const identity = JSON.stringify([plugin.id, plugin.remotePluginId, plugin.source, dark, candidates]);
  const [start, setStart] = useState({ identity, index: 0 });
  const [resolved, setResolved] = useState<{ identity: string; src: string; index: number } | null>(null);
  const startIndex = start.identity === identity ? start.index : 0;
  useEffect(() => {
    let active = true, objectUrl: string | null = null;
    setResolved(null);
    void (async () => {
      for (let index = startIndex; index < candidates.length && active; index++) {
        const candidate = candidates[index];
        try {
          let src = candidate.value;
          if (candidate.kind === "file") {
            const metadata = await getMetadata(candidate.value);
            if (!active) return;
            if (!metadata.isFile || metadata.isDirectory) continue;
            const encoded = await readFileBase64(candidate.value);
            if (!active) return;
            if (encoded.length > Math.ceil(MAX_LOGO_BYTES / 3) * 4 || !/^[a-z\d+/]*={0,2}$/i.test(encoded) || encoded.length % 4 !== 0) continue;
            const bytes = base64ToBytes(encoded), mime = pluginLogoMime(bytes);
            if (!mime) continue;
            objectUrl = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: mime }));
            src = objectUrl;
          }
          if (active) setResolved({ identity, src, index });
          return;
        } catch { /* A decorative asset failure falls through to the next real variant. */ }
      }
    })();
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [identity, startIndex]);
  return { src: resolved?.identity === identity ? resolved.src : null, onError: () => {
    if (resolved?.identity === identity) setStart({ identity, index: resolved.index + 1 });
  } };
}

export function PluginLogo({ plugin, className }: { plugin: LogoPlugin; className?: string }) {
  const logo = usePluginLogoSource(plugin);
  return <span className={className} aria-hidden="true" style={{ display: "inline-flex", overflow: "hidden", background: logo.src ? undefined : "color-mix(in srgb, currentColor 10%, transparent)" }}>
    {logo.src && <img src={logo.src} alt="" onError={logo.onError} style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
  </span>;
}
