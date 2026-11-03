# 16.04B 真实音频实现补充合同

2026-11-03。依赖 [修改前总合同](16-04-next-closure.md)。本文件只记录音频实现边界，不代表官方运行时、原生播放或像素验收已通过。

## 接口与真实数据

- `playNotificationChime(kind,sound): Promise<void>`：完成、权限、问题都传原始 `NotificationSound`；`kind` 不再改变声音。`none` 停止此前播放且不发声。
- `stopNotificationSound(): Promise<void>`：结束试听，并使未完成的导入解码结果失效。
- `importNotificationSound(): Promise<{fileName,name}|null>`：原生单选，取消返回 null，不修改偏好。选择原文件→宿主普通文件/大小检查→固定48kHz OfflineAudioContext 真实解码→mono/stereo、非空、严格小于30秒→交错16位PCM→宿主再次验证→RIFF/WAVE→SHA256命名→临时文件写入/rename→读取逐字节确认。调用方只有拿到成功结果才保存偏好。
- Rust 命令：`notification_audio_pick`、`notification_audio_store`、`notification_audio_play`、`notification_audio_stop`。读写目录是 Tauri `app_data_dir()/notification-sounds`，配置保存 `{fileName,name}`，不保存源绝对路径。源文件删除不影响持久副本。
- 输入文件不超过10MiB；解码后的PCM单独按声道、8k–192kHz采样率、<30秒限制，不能误用压缩文件10MiB阈值拒绝有效PCM。宿主base64输入另有32MiB上限，避免无界分配。
- SHA256 无新依赖，采用标准算法；空串、abc、百万a标准向量、RIFF字段、30秒边界、读回、已有文件损坏均有 Rust 回归用例。

## Windows 播放和资源边界

Windows 使用 `winmm!PlaySoundW` 的文件播放、异步、禁止系统默认声音后备选项；进程级 mutex 串行化替换/停止命令。不同窗口共享同一进程级播放器；选择新音或none会停止旧音。系统 API 返回失败时向调用方返回真实错误，不显示虚假试听成功。异步启动成功不等于整个文件实际扬声器发声已被实测。

不复制、打包或分发官方音频；只读本机固定 Store `26.1027.3384.0` 的 `app/resources/codex-notification.wav`、`codex-classic.wav`，逐字节计算 SHA256 对照已保存官方取证。版本移除、资源不可读或内容变化时明确提示不可用，用户可导入自己有权使用的文件。固定版本安装资源依赖尚未解决，不能宣称独立安装后内置音色1:1可用；资源分发许可仍未确认。Windows 不支持 macOS Basso 等系统音，旧设置若保留会返回明确不支持错误，不偷偷改播其它音。

## 验证边界

`scripts/verify-notification-audio.mjs` 执行真实 TypeScript PCM转换及取消逻辑，使用受控 AudioContext 解码结果，覆盖带中文/引号名称、signed16两端、双声道交错、30秒/多声道/空/损坏/NaN、解码晚到取消、无扬声器上下文创建及固定规范化采样率及各类通知共享选择。该回归不是实际编解码器或原生播放证据。

必须在最终源码原生构建补测：有效 MP3/WAV/FLAC/Ogg 的实际 WebAudio 解码支持、损坏文件、10MiB边界、恰30秒、原生选择取消/长Unicode路径、连续试听/跨窗替换/离页停止、真实扬声器、删除源文件后播放、删除或篡改副本后真实失败。声音未实际播放、官方资源不可用、原生构建未测、用户未验收均不能标为通过。


## 固定解码采样率取证与修正

同一份已校验 Store 包的 `notification-sound-audio-1601ea93fadd.js` @62 将共享导出 `Jyt` 绑定为 `t`；@828 明确使用 `new OfflineAudioContext({numberOfChannels:2,length:1,sampleRate:t})`。`app-shared-b9a49a97ca55.js` @6122156 导出 `hrt as Jyt`，@1716503 定义赋值 `hrt=48e3`，因此官方导入规范化采样率是 **48000Hz**，不是硬件默认采样率。上述偏移均为0-based UTF-16；[精确片段与SHA256证据](../../../.ref/parity/16.04/actual/16-04B-research/audio-normalization-evidence.json)独立留存。

生产导入据此使用固定 OfflineAudioContext（两声道、长度1、48000Hz）进行实际 `decodeAudioData`，输出仍允许实际mono/stereo；拒绝意外返回非48000Hz，避免给不同采样率PCM贴错标签。离页/新播放使代次失效，旧解码结果不落入配置。OfflineAudioContext 不创建扬声器播放流，且无 AudioContext.close 接口，不沿用实时AudioContext关闭流程。Node专项验证每次构造参数与持久化48000Hz、错误率拒绝、解码失败、晚到取消；实际编解码器仍需原生/真实浏览器验证。
