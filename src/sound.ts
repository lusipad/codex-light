import { NotificationSoundTheme } from "./types";

export const NOTIFICATION_SOUND_THEMES: Array<{
  id: NotificationSoundTheme;
  label: string;
  desc: string;
}> = [
  { id: "default", label: "Default (默认和弦)", desc: "经典的双音上扬和弦提示音" },
  { id: "basso", label: "Basso (沉稳低音)", desc: "浑厚低频双音，温和不刺耳" },
  { id: "classic", label: "Classic (经典双音铃)", desc: "清脆利落的高低双音风铃" },
  { id: "glass", label: "Glass (晶莹玻璃)", desc: "空灵透明的水晶音效" },
  { id: "ping", label: "Ping (雷达探针)", desc: "极短促干脆的高频声纳音" },
  { id: "pop", label: "Pop (气泡轻弹)", desc: "敏捷俏皮的低音滑落气泡音" },
  { id: "purr", label: "Purr (猫咪呼噜)", desc: "温暖柔和的微颤提示" },
  { id: "tink", label: "Tink (金属轻触)", desc: "细致小巧的高频金属轻触声" },
  { id: "none", label: "None (完全静音)", desc: "不播放任何声音提示" },
];

let activeContext: AudioContext | null = null;
let closeTimer: ReturnType<typeof setTimeout> | undefined;

export function playNotificationChime(
  kind: "nudge" | "done" = "done",
  soundTheme: NotificationSoundTheme = "default"
) {
  if (closeTimer) clearTimeout(closeTimer);
  if (activeContext) {
    void activeContext.close().catch(() => {});
    activeContext = null;
  }
  if (soundTheme === "none") return;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) throw Error("当前环境不支持音频播放");
    const ctx = new AudioCtx();
    activeContext = ctx;
    closeTimer = setTimeout(() => {
      if (activeContext === ctx) activeContext = null;
      void ctx.close().catch(() => {});
    }, 500);
    const now = ctx.currentTime;

    if (kind === "nudge") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.1);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.22);
      return;
    }

    switch (soundTheme) {
      case "basso": {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc1.type = "triangle";
        osc2.type = "sine";
        osc1.frequency.setValueAtTime(110, now);
        osc2.frequency.setValueAtTime(220, now);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.45);
        osc2.stop(now + 0.45);
        break;
      }
      case "classic": {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(1046.5, now);
        osc.frequency.setValueAtTime(1567.98, now + 0.09);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.35);
        break;
      }
      case "glass": {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc1.type = "sine";
        osc2.type = "sine";
        osc1.frequency.setValueAtTime(1318.5, now);
        osc2.frequency.setValueAtTime(1975.5, now);
        gain.gain.setValueAtTime(0.07, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.4);
        osc2.stop(now + 0.4);
        break;
      }
      case "ping": {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(1200, now);
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.22);
        break;
      }
      case "pop": {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(550, now);
        osc.frequency.exponentialRampToValueAtTime(160, now + 0.08);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.12);
        break;
      }
      case "purr": {
        const osc = ctx.createOscillator();
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(220, now);
        lfo.frequency.setValueAtTime(25, now);
        lfoGain.gain.setValueAtTime(30, now);
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
        osc.connect(gain);
        gain.connect(ctx.destination);
        lfo.start(now);
        osc.start(now);
        lfo.stop(now + 0.32);
        osc.stop(now + 0.32);
        break;
      }
      case "tink": {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(2400, now);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.15);
        break;
      }
      case "default":
      default: {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(587.33, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.35);
        break;
      }
    }
}
