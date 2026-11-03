import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

let commands = [], chosen = null, channels = [[-1, 0, 1]], duration = 0.01, decodeFailure = null, decoding = null;
let sampleRate = 48000;
const contexts = [];
const compile = ts.transpileModule(fs.readFileSync("src/sound.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(compile, {
  exports: mod.exports,
  require: () => ({ tauriInvoke: async (command, args) => {
    commands.push({ command, args });
    if (command === "notification_audio_pick") return chosen;
    if (command === "notification_audio_store") return { fileName: `codex-custom-${"a".repeat(64)}.wav`, name: args.name };
  }}),
  OfflineAudioContext: class {
    constructor(options) { contexts.push(options); }
    async decodeAudioData() {
      if (decoding) await decoding;
      if (decodeFailure) throw decodeFailure;
      return { numberOfChannels: channels.length, length: channels[0]?.length || 0, duration, sampleRate,
        getChannelData: index => channels[index] };
    }
  },
  atob: value => Buffer.from(value, "base64").toString("binary"),
  btoa: value => Buffer.from(value, "binary").toString("base64"),
  Uint8Array, DataView, Error, Math, Number,
});
const { playNotificationChime: play, stopNotificationSound: stop, importNotificationSound: importSound } = mod.exports;
await play("nudge", "classic");
assert.equal(commands.at(-1).args.sound, "classic", "nudge must use chosen sound");
await play("done", "none");
assert.equal(commands.at(-1).args.sound, "none");
await stop();
assert.equal(commands.at(-1).command, "notification_audio_stop");
assert.equal(await importSound(), null, "cancel returns null");
assert.equal(commands.filter(item => item.command === "notification_audio_store").length, 0);
chosen = { name: "中文 '提示音'.ogg", dataBase64: Buffer.from("actual encoded file").toString("base64") };
let result = await importSound();
assert.equal(result.name, chosen.name);
let save = commands.at(-1);
assert.equal(save.command, "notification_audio_store");
assert.equal(save.args.sampleRate, 48000, "persist the official normalized 48k PCM rate");
assert.deepEqual([...Buffer.from(save.args.samplesBase64, "base64")], [0,128,0,0,255,127], "signed16 little-endian clamps extremes");
channels = [[-1, 1], [1, -1]];
await importSound();
assert.deepEqual([...Buffer.from(commands.at(-1).args.samplesBase64, "base64")], [0,128,255,127,255,127,0,128], "stereo is interleaved by frame");
const stores = () => commands.filter(item => item.command === "notification_audio_store").length;
const before = stores();
for (const invalid of [30, 30.001, Infinity, NaN]) {
  duration = invalid;
  await assert.rejects(importSound(), /小于 30 秒/);
}
duration = 1; channels = [[0], [0], [0]];
await assert.rejects(importSound(), /单声道或双声道/);
channels = [[]];
await assert.rejects(importSound(), /单声道或双声道/);
channels = [[NaN]];
await assert.rejects(importSound(), /无效音频样本/);
channels = [[0]]; decodeFailure = Error("corrupt audio");
await assert.rejects(importSound(), /corrupt audio/);
decodeFailure = null;
sampleRate = 44100;
await assert.rejects(importSound(), /采样率规范化失败/);
sampleRate = 48000;
assert.equal(stores(), before, "invalid audio never stores");
let release;
decoding = new Promise(resolve => { release = resolve; });
const pending = importSound();
await new Promise(resolve => setImmediate(resolve));
await stop(); release();
assert.equal(await pending, null, "leaving during decode cannot select/store stale sound");
assert.equal(stores(), before);
assert.ok(contexts.length >= 10);
for (const options of contexts) assert.equal(JSON.stringify(options), JSON.stringify({ numberOfChannels: 2, length: 1, sampleRate: 48000 }),
  "offline decoder rate must not depend on the hardware AudioContext sample rate");
assert.ok(!fs.readFileSync("src/sound.ts", "utf8").includes("createOscillator"), "no synthetic placeholder tone");
console.log("Notification audio: actual PCM conversion, stereo interleave, validation, cancellation, shared selection passed");
