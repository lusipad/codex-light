import { tauriInvoke } from "./bridge";
import type { NotificationSound } from "./notificationPreferences";

export const NOTIFICATION_SOUND_THEMES = [
  { id: "default", label: "默认", desc: "默认提示音" },
  { id: "classic", label: "经典", desc: "经典提示音" },
  { id: "none", label: "无", desc: "不播放提示音" },
] as const;

let generation = 0;
const NOTIFICATION_AUDIO_SAMPLE_RATE = 48000;

export async function stopNotificationSound(): Promise<void> {
  generation++;
  await tauriInvoke("notification_audio_stop");
}

export async function playNotificationChime(
  _kind: "nudge" | "done" = "done", sound: NotificationSound = "default",
): Promise<void> {
  generation++;
  // All notification categories use the selected real sound, including none.
  await tauriInvoke("notification_audio_play", { sound });
}

export async function importNotificationSound(): Promise<{ fileName: string; name: string } | null> {
  const current = ++generation;
  await tauriInvoke("notification_audio_stop");
  const selected = await tauriInvoke<{ name: string; dataBase64: string } | null>("notification_audio_pick");
  if (!selected || current !== generation) return null;
  const binary = atob(selected.dataBase64);
  if (!binary.length || binary.length > 10 * 1024 * 1024) throw Error("提示音文件必须非空且不超过 10 MiB");
  const bytes = Uint8Array.from(binary, value => value.charCodeAt(0));
  const context = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: NOTIFICATION_AUDIO_SAMPLE_RATE });
  const decoded = await context.decodeAudioData(bytes.buffer);
  if (current !== generation) return null;
  if (![1, 2].includes(decoded.numberOfChannels) || !decoded.length || !(decoded.duration < 30)) {
    throw Error("提示音必须为单声道或双声道，且时长小于 30 秒");
  }
  if (decoded.sampleRate !== NOTIFICATION_AUDIO_SAMPLE_RATE) throw Error("提示音采样率规范化失败");
  const samples = new Uint8Array(decoded.length * decoded.numberOfChannels * 2);
  const view = new DataView(samples.buffer);
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const values = decoded.getChannelData(channel);
    for (let frame = 0; frame < decoded.length; frame++) {
      if (!Number.isFinite(values[frame])) throw Error("提示音包含无效音频样本");
      const value = Math.max(-1, Math.min(1, values[frame]));
      view.setInt16((frame * decoded.numberOfChannels + channel) * 2,
        value < 0 ? value * 32768 : value * 32767, true);
    }
  }
  let encoded = "";
  for (let offset = 0; offset < samples.length; offset += 8192) {
    encoded += String.fromCharCode(...samples.subarray(offset, offset + 8192));
  }
  const saved = await tauriInvoke<{ fileName: string; name: string }>("notification_audio_store", {
    samplesBase64: btoa(encoded), channels: decoded.numberOfChannels, sampleRate: decoded.sampleRate, name: selected.name,
  });
  return current === generation ? saved : null;
}
